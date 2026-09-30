"""Twelve Data client for daily OHLCV history.

Free tier: 8 requests/minute, 800/day. Every symbol is fetched once with enough
history for the longest range (5Y + lookback) and cached for an hour, so
switching ranges costs no extra requests.
"""

import asyncio
import time

import httpx
from langsmith import traceable

from app.cache import cached
from app.config import get_settings
from app.ratelimit import RateLimiter

BASE_URL = "https://api.twelvedata.com"
# 5Y of trading days (~1260) plus the volatility/beta lookback.
HISTORY_BARS = 1400

_client = httpx.AsyncClient(base_url=BASE_URL, timeout=20.0)
_limiter = RateLimiter(get_settings().twelvedata_rate_per_min)


class TwelveDataError(RuntimeError):
    pass


async def _fetch(symbol: str, key: str) -> dict:
    for attempt in range(2):
        await _limiter.acquire()
        resp = await _client.get(
            "/time_series",
            params={"symbol": symbol, "interval": "1day", "outputsize": HISTORY_BARS, "apikey": key},
        )
        data = resp.json()
        # Out of credits for this minute (e.g. the key is also used elsewhere):
        # wait for the next minute and retry once.
        if data.get("code") == 429 and attempt == 0:
            await asyncio.sleep(61 - time.time() % 60)
            continue
        return data
    return data


@traceable(name="twelvedata.daily_candles")
async def get_daily_candles(symbol: str) -> list[dict]:
    """Daily candles, oldest first: [{time, open, high, low, close, volume}]."""

    async def load():
        key = get_settings().twelvedata_api_key
        if not key:
            raise TwelveDataError("TWELVEDATA_API_KEY is not set")
        data = await _fetch(symbol, key)
        if data.get("status") == "error":
            raise TwelveDataError(f"Twelve Data error for {symbol}: {data.get('message')}")
        return [
            {
                "time": v["datetime"][:10],
                "open": float(v["open"]),
                "high": float(v["high"]),
                "low": float(v["low"]),
                "close": float(v["close"]),
                "volume": float(v.get("volume") or 0),
            }
            for v in reversed(data.get("values", []))
        ]

    return await cached(f"twelvedata:daily:{symbol}", 3600, load)
