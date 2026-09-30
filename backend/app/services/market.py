"""Market data helpers shared by the REST endpoints and the LangGraph agent."""

import asyncio
from datetime import date, timedelta
from typing import Literal

from app.clients import finnhub, twelvedata

RangeKey = Literal["1M", "3M", "6M", "1Y", "2Y", "5Y"]

RANGE_DAYS: dict[str, int] = {"1M": 31, "3M": 92, "6M": 183, "1Y": 365, "2Y": 730, "5Y": 1826}

# Extra trading days fetched before the visible range so volatility / beta
# estimates are stable from the very first visible bar.
LOOKBACK_BARS = 90

MARKET_ETF = "SPY"

# Finnhub's `finnhubIndustry` → a liquid sector ETF used as the sector benchmark.
_SECTOR_KEYWORDS: list[tuple[tuple[str, ...], str]] = [
    (("semiconductor",), "SMH"),
    (("bank", "financial", "insurance", "capital markets"), "XLF"),
    (("pharma", "biotech", "health", "life sciences", "medical"), "XLV"),
    (("energy", "oil", "gas", "coal"), "XLE"),
    (("utilit",), "XLU"),
    (("real estate", "reit"), "XLRE"),
    (("media", "telecom", "communication", "entertainment"), "XLC"),
    (("food", "beverage", "tobacco", "consumer products"), "XLP"),
    (("retail", "hotel", "restaurant", "leisure", "automobile", "textile", "consumer"), "XLY"),
    (("chemical", "metal", "mining", "material", "paper", "packaging"), "XLB"),
    (
        ("industrial", "aerospace", "machinery", "airline", "logistics", "construction",
         "transport", "electrical", "building", "road & rail", "marine"),
        "XLI",
    ),
    (("technology", "software", "internet", "it services", "hardware", "electronic"), "XLK"),
]


def sector_etf_for(industry: str | None) -> str | None:
    if not industry:
        return None
    lowered = industry.lower()
    for keywords, etf in _SECTOR_KEYWORDS:
        if any(k in lowered for k in keywords):
            return etf
    return None


def range_start(range_key: str, today: date | None = None) -> date:
    return (today or date.today()) - timedelta(days=RANGE_DAYS[range_key])


def bars_to_fetch(range_key: str) -> int:
    # ~252 trading days per 365 calendar days, plus lookback.
    return int(RANGE_DAYS[range_key] * 252 / 365) + LOOKBACK_BARS + 5


async def load_candles(symbol: str, n: int) -> list[dict]:
    """The last `n` daily candles (the full history is fetched once and cached)."""
    return (await twelvedata.get_daily_candles(symbol))[-n:]


async def load_price_bundle(symbol: str, range_key: str, sector_etf: str | None) -> dict:
    """Candles for the stock, the market ETF and (optionally) the sector ETF."""
    n = bars_to_fetch(range_key)
    tickers = [symbol, MARKET_ETF] + ([sector_etf] if sector_etf and sector_etf != symbol else [])
    results = await asyncio.gather(
        *(load_candles(t, n) for t in tickers), return_exceptions=True
    )
    stock = results[0]
    if isinstance(stock, Exception):
        raise stock
    benchmarks = {
        t: r for t, r in zip(tickers[1:], results[1:]) if not isinstance(r, Exception)
    }
    return {"candles": stock, "benchmarks": benchmarks}


async def load_profile(symbol: str) -> dict:
    profile = await finnhub.get_profile(symbol)
    profile = profile or {}
    return {
        "symbol": symbol,
        "name": profile.get("name") or symbol,
        "industry": profile.get("finnhubIndustry"),
        "exchange": profile.get("exchange"),
        "country": profile.get("country"),
        "logo": profile.get("logo"),
        "weburl": profile.get("weburl"),
        "market_cap_musd": profile.get("marketCapitalization"),
        "ipo": profile.get("ipo"),
        "sector_etf": sector_etf_for(profile.get("finnhubIndustry")),
    }
