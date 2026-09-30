"""Finnhub client: symbol list, company profile, quote, news, earnings calendar.

Free tier: ~60 requests/minute. Note that historical candles are a paid Finnhub
feature, so price history comes from Twelve Data instead (see twelvedata.py).
"""

from datetime import date

import httpx
from langsmith import traceable

from app.cache import cached
from app.config import get_settings
from app.ratelimit import RateLimiter

BASE_URL = "https://finnhub.io/api/v1"

# Large responses (e.g. the full symbol list) are served via a redirect to a file download.
_client = httpx.AsyncClient(base_url=BASE_URL, timeout=60.0, follow_redirects=True)
_limiter = RateLimiter(get_settings().finnhub_rate_per_min)


class FinnhubError(RuntimeError):
    pass


async def _get(path: str, **params) -> object:
    key = get_settings().finnhub_api_key
    if not key:
        raise FinnhubError("FINNHUB_API_KEY is not set")
    await _limiter.acquire()
    resp = await _client.get(path, params={**params, "token": key})
    if resp.status_code == 429:
        raise FinnhubError("Finnhub rate limit reached, try again in a minute")
    if resp.status_code >= 400:
        raise FinnhubError(f"Finnhub {path} failed ({resp.status_code}): {resp.text[:200]}")
    try:
        return resp.json()
    except ValueError:
        raise FinnhubError(f"Finnhub {path} returned an unexpected response: {resp.text[:200]}")


async def list_us_symbols() -> list[dict]:
    """All US-listed symbols (~30k). Cached for a day."""

    async def load():
        rows = await _get("/stock/symbol", exchange="US")
        return [
            {
                "symbol": r["symbol"],
                "name": r.get("description") or "",
                "type": r.get("type") or "",
            }
            for r in rows
            if r.get("symbol")
        ]

    return await cached("finnhub:symbols:US", 24 * 3600, load)


@traceable(name="finnhub.profile")
async def get_profile(symbol: str) -> dict:
    return await cached(
        f"finnhub:profile:{symbol}", 24 * 3600, lambda: _get("/stock/profile2", symbol=symbol)
    )


@traceable(name="finnhub.quote")
async def get_quote(symbol: str) -> dict:
    return await cached(f"finnhub:quote:{symbol}", 30, lambda: _get("/quote", symbol=symbol))


@traceable(name="finnhub.company_news")
async def get_company_news(symbol: str, start: date, end: date) -> list[dict]:
    async def load():
        rows = await _get(
            "/company-news", symbol=symbol, **{"from": start.isoformat(), "to": end.isoformat()}
        )
        return normalize_news(rows)

    return await cached(f"finnhub:news:{symbol}:{start}:{end}", 15 * 60, load)


@traceable(name="finnhub.market_news")
async def get_market_news() -> list[dict]:
    """Latest general market headlines (Finnhub keeps only the most recent ones)."""

    async def load():
        return normalize_news(await _get("/news", category="general"))

    return await cached("finnhub:news:general", 15 * 60, load)


def normalize_news(rows: list[dict]) -> list[dict]:
    news = [
        {
            "id": r["id"],
            "datetime": r["datetime"],
            "headline": r.get("headline", ""),
            "summary": r.get("summary", ""),
            "source": r.get("source", ""),
            "url": r.get("url", ""),
            "image": r.get("image", ""),
        }
        for r in rows
        if r.get("headline")
    ]
    # Finnhub can return the same story from several feeds; keep one per headline.
    seen: set[str] = set()
    unique = []
    for n in sorted(news, key=lambda n: n["datetime"], reverse=True):
        if n["headline"] not in seen:
            seen.add(n["headline"])
            unique.append(n)
    return unique


@traceable(name="finnhub.earnings")
async def get_earnings(symbol: str, start: date, end: date) -> list[dict]:
    async def load():
        data = await _get(
            "/calendar/earnings",
            symbol=symbol,
            **{"from": start.isoformat(), "to": end.isoformat()},
        )
        return [
            {
                "date": e["date"],
                "hour": e.get("hour") or "",  # bmo = before open, amc = after close
                "eps_actual": e.get("epsActual"),
                "eps_estimate": e.get("epsEstimate"),
                "revenue_actual": e.get("revenueActual"),
                "revenue_estimate": e.get("revenueEstimate"),
            }
            for e in data.get("earningsCalendar", [])
        ]

    return await cached(f"finnhub:earnings:{symbol}:{start}:{end}", 6 * 3600, load)
