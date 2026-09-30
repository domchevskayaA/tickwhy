"""LangGraph workflow that explains why a stock moved over a period.

    gather_data ─► analyze_moves ─┬─► explain_move (one per big move, in parallel) ─► summarize
                                  └──────────────────────────────────────────────────► summarize

Every node, and every Claude call inside it, shows up as a span in LangSmith
when LANGSMITH_TRACING=true.
"""

import asyncio
import json
import operator
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from app.agent.llm import structured_call
from app.agent.prompts import SYSTEM_PROMPT, MoveExplanation, PeriodSummary
from app.clients import finnhub
from app.config import get_settings
from app.services import market, moves

NEWS_PER_MOVE = 25


class AnalysisState(TypedDict, total=False):
    symbol: str
    range: str
    profile: dict
    candles: list[dict]
    benchmarks: dict[str, list[dict]]
    news: list[dict]
    earnings: list[dict]
    factor_model: dict
    moves: list[dict]
    stats: dict
    explanations: Annotated[list[dict], operator.add]
    summary: dict
    errors: Annotated[list[str], operator.add]


class MoveTask(TypedDict):
    symbol: str
    profile: dict
    move: dict
    news: list[dict]
    earnings: list[dict]


# ── nodes ───────────────────────────────────────────────────────────────────


async def gather_data(state: AnalysisState) -> dict:
    symbol, range_key = state["symbol"], state["range"]
    start, end = market.range_start(range_key), date.today()

    profile = await market.load_profile(symbol)
    prices, news, earnings = await asyncio.gather(
        market.load_price_bundle(symbol, range_key, profile["sector_etf"]),
        finnhub.get_company_news(symbol, start, end),
        finnhub.get_earnings(symbol, start, end),
        return_exceptions=True,
    )
    if isinstance(prices, Exception):
        raise prices

    errors = []
    if isinstance(news, Exception):
        errors.append(f"news unavailable: {news}")
        news = []
    if isinstance(earnings, Exception):
        errors.append(f"earnings unavailable: {earnings}")
        earnings = []

    return {
        "profile": profile,
        "candles": prices["candles"],
        "benchmarks": prices["benchmarks"],
        "news": news,
        "earnings": earnings,
        "errors": errors,
    }


def analyze_moves(state: AnalysisState) -> dict:
    """Deterministic step: factor model, big-move detection, attribution."""
    settings = get_settings()
    visible_from = market.range_start(state["range"])
    sector_etf = state["profile"].get("sector_etf")
    model = moves.compute_factor_model(
        state["candles"],
        state["benchmarks"].get(market.MARKET_ETF),
        state["benchmarks"].get(sector_etf) if sector_etf else None,
    )
    detected = moves.with_attribution(
        moves.detect_moves(state["candles"], visible_from, settings.move_z_threshold), model
    )
    stats = moves.period_stats(state["candles"], state["benchmarks"], visible_from)
    stats.update(
        beta_market=model["beta_market"],
        beta_sector=model["beta_sector"],
        r2=model["r2"],
        sector_etf=sector_etf,
        moves_detected=len(detected),
    )
    return {
        "factor_model": {k: v for k, v in model.items() if k not in ("market_r", "sector_r")},
        "moves": detected,
        "stats": stats,
    }


def select_moves_to_explain(detected: list[dict]) -> list[dict]:
    """The largest moves (by z-score) get an LLM explanation."""
    top = sorted(detected, key=lambda m: abs(m["z_score"]), reverse=True)
    return top[: get_settings().max_moves_to_explain]


def fan_out_moves(state: AnalysisState) -> list[Send] | str:
    top = select_moves_to_explain(state["moves"])
    if not top:
        return "summarize"
    return [
        Send(
            "explain_move",
            MoveTask(
                symbol=state["symbol"],
                profile=state["profile"],
                move=m,
                news=_news_near(state["news"], m["date"]),
                earnings=_earnings_near(state["earnings"], m["date"]),
            ),
        )
        for m in top
    ]


async def explain_move(task: MoveTask) -> dict:
    move = task["move"]
    prompt = _format_move_prompt(task)
    try:
        result = await structured_call(SYSTEM_PROMPT, prompt, MoveExplanation)
    except Exception as exc:  # keep the other explanations if one fails
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


async def summarize(state: AnalysisState) -> dict:
    explanations = sorted(state.get("explanations", []), key=lambda e: e["date"])
    payload = {
        "company": _company_line(state["profile"]),
        "range": state["range"],
        "stats": state["stats"],
        "explained_moves": [
            {k: e[k] for k in ("date", "primary_driver", "headline", "explanation")}
            for e in explanations
        ],
        "earnings_dates": [e["date"] for e in state.get("earnings", [])],
        "most_recent_headlines": [
            f"{datetime.fromtimestamp(n['datetime'], tz=timezone.utc):%Y-%m-%d}: {n['headline']}"
            for n in state.get("news", [])[:30]
        ],
    }
    prompt = (
        "Summarize what drove this stock over the period, using the statistics and the "
        "per-move explanations below. Compare the stock's return with SPY and its sector ETF.\n\n"
        + json.dumps(payload, indent=1, default=_round)
    )
    try:
        result = await structured_call(SYSTEM_PROMPT, prompt, PeriodSummary)
    except Exception as exc:
        return {"errors": [f"summary: {exc}"]}
    return {"summary": result.model_dump()}


# ── helpers ─────────────────────────────────────────────────────────────────


def _news_near(news: list[dict], day: str) -> list[dict]:
    """News from 3 days before the move through the end of the move day (UTC)."""
    d = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
    lo, hi = (d - timedelta(days=3)).timestamp(), (d + timedelta(days=1)).timestamp()
    window = [n for n in news if lo <= n["datetime"] < hi]
    # Prefer items published closest to the move day.
    window.sort(key=lambda n: abs(n["datetime"] - (d + timedelta(hours=14)).timestamp()))
    return window[:NEWS_PER_MOVE]


def _earnings_near(earnings: list[dict], day: str) -> list[dict]:
    d = date.fromisoformat(day)
    return [e for e in earnings if timedelta(0) <= d - date.fromisoformat(e["date"]) <= timedelta(days=3)]


def _company_line(profile: dict) -> str:
    return f"{profile['name']} ({profile['symbol']}), industry: {profile.get('industry') or 'n/a'}"


def _round(x: Any) -> Any:
    return round(x, 3) if isinstance(x, float) else str(x)


def _format_move_prompt(task: MoveTask) -> str:
    m = task["move"]
    sector_etf = task["profile"].get("sector_etf") or "n/a"
    lines = [
        f"Company: {_company_line(task['profile'])}. Sector ETF: {sector_etf}.",
        f"Date: {m['date']}",
        f"Daily return: {m['return_pct']:+.2f}% ({m['z_score']:+.1f} standard deviations vs the prior 60 days)",
        f"Overnight gap: {m['gap_pct']:+.2f}%, open-to-close: {m['intraday_pct']:+.2f}%",
    ]
    if m.get("volume_ratio"):
        lines.append(f"Volume: {m['volume_ratio']:.1f}x the 20-day average")
    if m.get("market_pct") is not None:
        lines.append(
            f"Attribution: market {m['market_pct']:+.2f}% (SPY {m['market_etf_pct']:+.2f}%), "
            + (
                f"sector {m['sector_pct']:+.2f}% ({sector_etf} {m['sector_etf_pct']:+.2f}%), "
                if m.get("sector_pct") is not None
                else ""
            )
            + f"company-specific {m['company_pct']:+.2f}%"
        )
    if task["earnings"]:
        lines.append("\nEarnings events:")
        for e in task["earnings"]:
            timing = {"bmo": "before open", "amc": "after close"}.get(e["hour"], e["hour"] or "time n/a")
            lines.append(
                f"- {e['date']} ({timing}): EPS {e['eps_actual']} vs est. {e['eps_estimate']}; "
                f"revenue {e['revenue_actual']} vs est. {e['revenue_estimate']}"
            )
    lines.append("\nNews (id | published UTC | source | headline — summary):")
    if not task["news"]:
        lines.append("(no news found in the window)")
    for n in task["news"]:
        ts = datetime.fromtimestamp(n["datetime"], tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
        summary = (n["summary"] or "")[:300]
        lines.append(f"{n['id']} | {ts} | {n['source']} | {n['headline']} — {summary}")
    lines.append("\nExplain why the stock moved on this date.")
    return "\n".join(lines)


# ── graph ───────────────────────────────────────────────────────────────────


def build_graph():
    g = StateGraph(AnalysisState)
    g.add_node("gather_data", gather_data)
    g.add_node("analyze_moves", analyze_moves)
    g.add_node("explain_move", explain_move)
    g.add_node("summarize", summarize)

    g.add_edge(START, "gather_data")
    g.add_edge("gather_data", "analyze_moves")
    g.add_conditional_edges("analyze_moves", fan_out_moves, ["explain_move", "summarize"])
    g.add_edge("explain_move", "summarize")
    g.add_edge("summarize", END)
    return g.compile()


graph = build_graph()
