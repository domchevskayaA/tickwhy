"""LangGraph workflow that explains why a market index moved over a period.

    gather_data ─► analyze_moves ─► gather_news ─┬─► explain_move (one per big move, in parallel) ─► summarize
                                                 └────────────────────────────────────────────────► summarize

Node names match the stock workflow so the frontend can stream both the same way.
"""

import asyncio
import json
import operator
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from app.agent.graph import _round, select_moves_to_explain
from app.agent.llm import structured_call
from app.agent.prompts import INDEX_SYSTEM_PROMPT, IndexMoveExplanation, PeriodSummary
from app.config import get_settings
from app.services import indexes, market, moves

NEWS_PER_MOVE = 25


class IndexAnalysisState(TypedDict, total=False):
    index_id: str
    range: str
    index: dict
    candles: list[dict]
    sector_candles: dict[str, list[dict]]
    attribution: dict
    moves: list[dict]
    stats: dict
    news_by_date: dict[str, list[dict]]
    explanations: Annotated[list[dict], operator.add]
    summary: dict
    errors: Annotated[list[str], operator.add]


class IndexMoveTask(TypedDict):
    index: dict
    move: dict
    sectors: list[dict]
    residual_pct: float | None
    news: list[dict]


async def gather_data(state: IndexAnalysisState) -> dict:
    index = indexes.get_index(state["index_id"])
    candles, (sector_candles, failed) = await asyncio.gather(
        indexes.load_index_candles(index, state["range"]),
        indexes.load_sector_candles(state["range"]),
    )
    return {
        "index": index,
        "candles": candles,
        "sector_candles": sector_candles,
        "errors": [f"sector data unavailable: {f}" for f in failed],
    }


def analyze_moves(state: IndexAnalysisState) -> dict:
    visible_from = market.range_start(state["range"])
    detected = moves.detect_moves(state["candles"], visible_from, get_settings().move_z_threshold)
    attribution = indexes.sector_attribution(state["candles"], state["sector_candles"], visible_from)
    stats = moves.period_stats(state["candles"], {}, visible_from)
    stats.update(moves_detected=len(detected), sector_r2=attribution["r2"])
    return {"moves": detected, "attribution": attribution, "stats": stats}


async def gather_news(state: IndexAnalysisState) -> dict:
    top = select_moves_to_explain(state["moves"])
    windows = [
        indexes.get_index_news(
            state["index"],
            date.fromisoformat(m["date"]) - timedelta(days=3),
            date.fromisoformat(m["date"]) + timedelta(days=1),
            limit=NEWS_PER_MOVE,
        )
        for m in top
    ]
    results = await asyncio.gather(*windows, return_exceptions=True)
    news_by_date, errors = {}, []
    for m, r in zip(top, results):
        if isinstance(r, Exception):
            errors.append(f"news for {m['date']} unavailable: {r}")
            r = []
        news_by_date[m["date"]] = r
    return {"news_by_date": news_by_date, "errors": errors}


def fan_out_moves(state: IndexAnalysisState) -> list[Send] | str:
    top = select_moves_to_explain(state["moves"])
    if not top:
        return "summarize"
    attribution = state["attribution"]
    return [
        Send(
            "explain_move",
            IndexMoveTask(
                index=state["index"],
                move=m,
                sectors=indexes.sector_breakdown_for_day(attribution, m["date"]),
                residual_pct=attribution["days"].get(m["date"], {}).get("residual_pct"),
                news=state["news_by_date"].get(m["date"], []),
            ),
        )
        for m in top
    ]


async def explain_move(task: IndexMoveTask) -> dict:
    move = task["move"]
    try:
        result = await structured_call(INDEX_SYSTEM_PROMPT, _format_move_prompt(task), IndexMoveExplanation)
    except Exception as exc:
        return {"errors": [f"{move['date']}: {exc}"]}

    valid_ids = {n["id"] for n in task["news"]}
    explanation = result.model_dump()
    explanation["supporting_news_ids"] = [i for i in result.supporting_news_ids if i in valid_ids]
    explanation["supporting_news"] = [
        {k: n[k] for k in ("id", "headline", "source", "url", "datetime")}
        for n in task["news"]
        if n["id"] in explanation["supporting_news_ids"]
    ]
    return {"explanations": [{"date": move["date"], **explanation}]}


async def summarize(state: IndexAnalysisState) -> dict:
    attribution = state["attribution"]
    period = attribution.get("period")
    sector_totals = (
        sorted(
            (
                {"sector": s["name"], "etf": s["etf"], "est_weight": s["weight"], "contribution_pct": c}
                for s, c in zip(attribution["sectors"], period["contributions"])
            ),
            key=lambda r: abs(r["contribution_pct"]),
            reverse=True,
        )
        if period
        else []
    )
    explanations = sorted(state.get("explanations", []), key=lambda e: e["date"])
    payload = {
        "index": f"{state['index']['name']} (tracked via {state['index']['etf']})",
        "range": state["range"],
        "stats": state["stats"],
        "sector_contributions_over_period": sector_totals,
        "not_explained_by_sectors_pct": period["residual_pct"] if period else None,
        "explained_moves": [
            {k: e[k] for k in ("date", "primary_driver", "headline", "explanation")} for e in explanations
        ],
    }
    prompt = (
        "Summarize what drove this index over the period: which sectors contributed most to its "
        "return, and what the biggest daily moves had in common.\n\n"
        + json.dumps(payload, indent=1, default=_round)
    )
    try:
        result = await structured_call(INDEX_SYSTEM_PROMPT, prompt, PeriodSummary)
    except Exception as exc:
        return {"errors": [f"summary: {exc}"]}
    return {"summary": result.model_dump()}


def _format_move_prompt(task: IndexMoveTask) -> str:
    m, index = task["move"], task["index"]
    lines = [
        f"Index: {index['name']} — {index['description']} (tracked via the {index['etf']} ETF)",
        f"Date: {m['date']}",
        f"Daily return: {m['return_pct']:+.2f}% ({m['z_score']:+.1f} standard deviations vs the prior 60 days)",
        f"Overnight gap: {m['gap_pct']:+.2f}%, open-to-close: {m['intraday_pct']:+.2f}%",
    ]
    if m.get("volume_ratio"):
        lines.append(f"Volume: {m['volume_ratio']:.1f}x the 20-day average")
    if task["sectors"]:
        lines.append("\nSector breakdown (sector ETF return × estimated weight = contribution):")
        for s in task["sectors"]:
            lines.append(
                f"- {s['name']} ({s['etf']}): {s['etf_return_pct']:+.2f}% × {s['weight'] or 0:.0%} "
                f"= {s['contribution_pct']:+.2f}%"
            )
        if task["residual_pct"] is not None:
            lines.append(f"- Not explained by sectors: {task['residual_pct']:+.2f}%")
        falling = sum(1 for s in task["sectors"] if s["etf_return_pct"] < 0)
        lines.append(f"{falling} of {len(task['sectors'])} sectors fell that day.")
    lines.append("\nNews (id | published UTC | source | headline — summary):")
    if not task["news"]:
        lines.append("(no news found in the window)")
    for n in task["news"]:
        ts = datetime.fromtimestamp(n["datetime"], tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
        summary = (n["summary"] or "")[:300]
        lines.append(f"{n['id']} | {ts} | {n['source']} | {n['headline']} — {summary}")
    lines.append("\nExplain why the index moved on this date.")
    return "\n".join(lines)


def build_graph():
    g = StateGraph(IndexAnalysisState)
    g.add_node("gather_data", gather_data)
    g.add_node("analyze_moves", analyze_moves)
    g.add_node("gather_news", gather_news)
    g.add_node("explain_move", explain_move)
    g.add_node("summarize", summarize)

    g.add_edge(START, "gather_data")
    g.add_edge("gather_data", "analyze_moves")
    g.add_edge("analyze_moves", "gather_news")
    g.add_conditional_edges("gather_news", fan_out_moves, ["explain_move", "summarize"])
    g.add_edge("explain_move", "summarize")
    g.add_edge("summarize", END)
    return g.compile()


index_graph = build_graph()
