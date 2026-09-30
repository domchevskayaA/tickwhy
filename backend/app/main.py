import asyncio
import json
from datetime import date, timedelta

from dotenv import load_dotenv

# Export .env into os.environ so LangSmith and the Anthropic SDK can read it.
load_dotenv()

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from app.agent.graph import analyze_moves, graph, select_moves_to_explain
from app.agent.index_graph import index_graph
from app import cache, usage
from app.clients import finnhub, twelvedata
from app.config import get_settings
from app.services import indexes, market, moves

app = FastAPI(title="Tickwhy API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPSTREAM_ERRORS = (finnhub.FinnhubError, twelvedata.TwelveDataError)


def _upstream(exc: Exception) -> HTTPException:
    return HTTPException(status_code=502, detail=str(exc))


@app.get("/api/health")
async def health():
    s = get_settings()
    return {
        "finnhub": bool(s.finnhub_api_key),
        "twelvedata": bool(s.twelvedata_api_key),
        "model": s.claude_model,
    }


@app.get("/api/symbols/search")
async def search_symbols(q: str = Query(min_length=1), limit: int = Query(15, le=50)):
    try:
        symbols = await finnhub.list_us_symbols()
    except UPSTREAM_ERRORS as exc:
        if matches := indexes.search_indexes(q):
            return matches
        raise _upstream(exc)
    needle = q.strip().upper()
    ranked: list[tuple[int, dict]] = []
    for s in symbols:
        sym, name = s["symbol"], s["name"].upper()
        if sym == needle:
            rank = 0
        elif sym.startswith(needle):
            rank = 1
        elif name.startswith(needle):
            rank = 2
        elif needle in name:
            rank = 3
        else:
            continue
        # Prefer ordinary shares over warrants, units, etc.
        if s["type"] not in ("Common Stock", "ADR", "ETP"):
            rank += 4
        ranked.append((rank * 10 + min(len(sym), 9), s))
    ranked.sort(key=lambda x: x[0])
    return (indexes.search_indexes(q) + [s for _, s in ranked])[:limit]


@app.get("/api/stocks/{symbol}/overview")
async def overview(symbol: str):
    symbol = symbol.upper()
    try:
        profile = await market.load_profile(symbol)
        quote = await finnhub.get_quote(symbol)
    except UPSTREAM_ERRORS as exc:
        raise _upstream(exc)
    return {
        **profile,
        "quote": {
            "price": quote.get("c"),
            "change": quote.get("d"),
            "change_pct": quote.get("dp"),
            "prev_close": quote.get("pc"),
        },
    }


@app.get("/api/stocks/{symbol}/chart")
async def chart(symbol: str, range: market.RangeKey = "1Y"):
    """Candles, benchmark comparison, flagged big moves and earnings dates.

    Runs the deterministic part of the analysis (no LLM), so the chart can show
    move markers and the market/sector/company breakdown instantly.
    """
    symbol = symbol.upper()
    try:
        profile = await market.load_profile(symbol)
        prices = await market.load_price_bundle(symbol, range, profile["sector_etf"])
        earnings = await finnhub.get_earnings(symbol, market.range_start(range), date.today())
    except UPSTREAM_ERRORS as exc:
        raise _upstream(exc)

    analysis = analyze_moves(
        {"range": range, "profile": profile, "candles": prices["candles"],
         "benchmarks": prices["benchmarks"]}
    )
    visible_from = market.range_start(range).isoformat()
    return {
        "symbol": symbol,
        "range": range,
        "candles": [c for c in prices["candles"] if c["time"] >= visible_from],
        "moves": analysis["moves"],
        "stats": analysis["stats"],
        "earnings": earnings,
    }


@app.get("/api/stocks/{symbol}/news")
async def news(
    symbol: str,
    start: date | None = Query(None, alias="from"),
    end: date | None = Query(None, alias="to"),
):
    end = end or date.today()
    start = start or end - timedelta(days=14)
    try:
        return await finnhub.get_company_news(symbol.upper(), start, end)
    except UPSTREAM_ERRORS as exc:
        raise _upstream(exc)


@app.post("/api/stocks/{symbol}/analyze")
async def analyze(request: Request, symbol: str, range: market.RangeKey = "1Y"):
    """Run the LangGraph analysis and stream progress as server-sent events."""
    symbol = symbol.upper()
    return _stream_graph(
        request,
        f"stock:{symbol}:{range}",
        graph,
        {"symbol": symbol, "range": range},
        {
            "run_name": f"analyze {symbol} {range}",
            "tags": ["stock-analysis"],
            "metadata": {"symbol": symbol, "range": range},
        },
    )


# ── indexes ─────────────────────────────────────────────────────────────────


def _index_or_404(index_id: str) -> dict:
    index = indexes.get_index(index_id)
    if not index:
        raise HTTPException(status_code=404, detail=f"Unknown index {index_id}")
    return index


def _index_info(index: dict, quote: dict | None) -> dict:
    return {
        "id": index["id"],
        "name": index["name"],
        "etf": index["etf"],
        "description": index["description"],
        "quote": {
            "price": quote.get("c") if quote else None,
            "change": quote.get("d") if quote else None,
            "change_pct": quote.get("dp") if quote else None,
        },
    }


@app.get("/api/indexes")
async def list_indexes():
    """All indexes with today's ETF quote (quotes come from Finnhub, not Twelve Data)."""
    all_indexes = list(indexes.INDEXES.values())
    quotes = await asyncio.gather(
        *(finnhub.get_quote(i["etf"]) for i in all_indexes), return_exceptions=True
    )
    return [
        _index_info(i, None if isinstance(q, Exception) else q) for i, q in zip(all_indexes, quotes)
    ]


@app.get("/api/indexes/{index_id}/overview")
async def index_overview(index_id: str):
    index = _index_or_404(index_id)
    try:
        quote = await finnhub.get_quote(index["etf"])
    except UPSTREAM_ERRORS:
        quote = None
    return _index_info(index, quote)


@app.get("/api/indexes/{index_id}/chart")
async def index_chart(index_id: str, range: market.RangeKey = "1Y"):
    """Index candles and its unusual moves. One price request, so it loads fast."""
    index = _index_or_404(index_id)
    try:
        candles = await indexes.load_index_candles(index, range)
    except UPSTREAM_ERRORS as exc:
        raise _upstream(exc)
    visible_from = market.range_start(range)
    detected = moves.detect_moves(candles, visible_from, get_settings().move_z_threshold)
    stats = moves.period_stats(candles, {}, visible_from)
    stats["moves_detected"] = len(detected)
    return {
        "id": index["id"],
        "range": range,
        "candles": [c for c in candles if c["time"] >= visible_from.isoformat()],
        "moves": detected,
        "stats": stats,
    }


@app.get("/api/indexes/{index_id}/sectors")
async def index_sectors(index_id: str, range: market.RangeKey = "1Y"):
    """Daily sector contributions. Needs 11 sector ETFs, so the first (uncached)
    load can take about a minute on Twelve Data's free tier."""
    index = _index_or_404(index_id)
    try:
        candles = await indexes.load_index_candles(index, range)
    except UPSTREAM_ERRORS as exc:
        raise _upstream(exc)
    sector_candles, failed = await indexes.load_sector_candles(range)
    if not sector_candles:
        raise HTTPException(status_code=502, detail="Sector data unavailable: " + "; ".join(failed))
    result = indexes.sector_attribution(candles, sector_candles, market.range_start(range))
    return {**result, "errors": failed}


@app.get("/api/indexes/{index_id}/news")
async def index_news(
    index_id: str,
    start: date | None = Query(None, alias="from"),
    end: date | None = Query(None, alias="to"),
):
    index = _index_or_404(index_id)
    end = end or date.today()
    start = start or end - timedelta(days=14)
    return await indexes.get_index_news(index, start, end)


@app.post("/api/indexes/{index_id}/analyze")
async def analyze_index(request: Request, index_id: str, range: market.RangeKey = "1Y"):
    index = _index_or_404(index_id)
    return _stream_graph(
        request,
        f"index:{index['id']}:{range}",
        index_graph,
        {"index_id": index["id"], "range": range},
        {
            "run_name": f"analyze index {index['id']} {range}",
            "tags": ["index-analysis"],
            "metadata": {"index": index["id"], "range": range},
        },
    )


# ── streaming ───────────────────────────────────────────────────────────────


def _stream_graph(request: Request, key: str, compiled, inputs: dict, config: dict):
    """Stream a graph run as SSE, serving repeat runs from cache and enforcing usage limits."""
    cache_key = f"analysis:{key}:{date.today()}"
    if replay := cache.get(cache_key):
        async def cached_events():
            for event, data in replay:
                yield _sse(event, data)

        return _sse_response(cached_events())

    ip = request.client.host if request.client else "unknown"
    if reason := usage.try_start_analysis(ip):
        return JSONResponse(status_code=429, content={"detail": reason})

    async def events():
        recorded: list[tuple[str, dict]] = []
        failed = False
        try:
            async for update in compiled.astream(inputs, config, stream_mode="updates"):
                for node, output in update.items():
                    data = _public(node, output or {})
                    recorded.append((node, data))
                    yield _sse(node, data)
        except Exception as exc:
            failed = True
            yield _sse("error", {"message": str(exc)})
        # Cache only complete, successful runs.
        if not failed and any(e == "summarize" and "summary" in d for e, d in recorded):
            hours = get_settings().analysis_cache_hours
            if hours > 0:
                cache.put(cache_key, hours * 3600, recorded + [("done", {})])
        yield _sse("done", {})

    return _sse_response(events())


def _sse_response(body) -> StreamingResponse:
    return StreamingResponse(
        body,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _public(node: str, output: dict) -> dict:
    """Trim node outputs to what the browser needs (it already has candles etc.)."""
    if node == "gather_data":
        news = output.get("news")
        return {"news_count": len(news) if news is not None else None, "errors": output.get("errors", [])}
    if node == "analyze_moves":
        explain = select_moves_to_explain(output.get("moves", []))
        return {
            "moves": output.get("moves", []),
            "stats": output.get("stats", {}),
            "explain_dates": [m["date"] for m in explain],
        }
    if node == "gather_news":
        by_date = output.get("news_by_date", {})
        return {"news_count": sum(len(v) for v in by_date.values()), "errors": output.get("errors", [])}
    return output


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"
