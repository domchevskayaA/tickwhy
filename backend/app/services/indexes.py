"""Market indexes: definitions, sector attribution and market news.

Indexes are tracked through the ETFs that replicate them (SPY, QQQ, DIA, IWM),
which the free data tiers cover. Daily ETF returns match the index to within a
few hundredths of a percent, which is plenty for explaining moves.

Sector attribution
------------------
Each day, the index return is split across the 11 SPDR sector ETFs:

    contribution_s = weight_s × return(sector ETF s)

The weights are *estimated* from the data rather than hard-coded: a
non-negative least-squares fit of the index's daily returns on the sector ETF
returns over the trailing ~6 months, refit monthly and using only past data.
For the S&P 500 this recovers the real sector weights closely (the sector ETFs
are carved out of it); for other indexes the fit is looser and whatever the
sectors can't explain shows up as the residual.
"""

import asyncio
from datetime import date, datetime, timedelta, timezone

import numpy as np

from app.clients import finnhub
from app.services import market
from app.services.moves import returns_by_date

INDEXES: dict[str, dict] = {
    "SPX": {
        "id": "SPX",
        "name": "S&P 500",
        "etf": "SPY",
        "description": "500 large US companies, weighted by market value. The usual meaning of \"the market\".",
        # Largest companies; their news coverage is where market-wide stories show up.
        "news_tickers": ["NVDA", "MSFT", "AAPL", "AMZN", "GOOGL"],
        "aliases": ["S&P", "SP500", "S&P 500", "SPX", "SPY", "MARKET"],
    },
    "NDX": {
        "id": "NDX",
        "name": "Nasdaq-100",
        "etf": "QQQ",
        "description": "The 100 largest non-financial companies on the Nasdaq exchange. Heavy in technology.",
        "news_tickers": ["NVDA", "MSFT", "AAPL", "AMZN", "AVGO"],
        "aliases": ["NASDAQ", "NASDAQ 100", "NDX", "QQQ", "TECH"],
    },
    "DJI": {
        "id": "DJI",
        "name": "Dow Jones Industrial Average",
        "etf": "DIA",
        "description": "30 large blue-chip companies, weighted by share price rather than company size.",
        "news_tickers": ["GS", "MSFT", "CAT", "HD", "V"],
        "aliases": ["DOW", "DOW JONES", "DJIA", "DJI", "DIA"],
    },
    "RUT": {
        "id": "RUT",
        "name": "Russell 2000",
        "etf": "IWM",
        "description": "2,000 small US companies. More sensitive to interest rates and the domestic economy.",
        "news_tickers": ["NVDA", "MSFT", "AAPL", "AMZN", "GOOGL"],
        "aliases": ["RUSSELL", "RUSSELL 2000", "RUT", "IWM", "SMALL CAP", "SMALL CAPS"],
    },
}

SECTOR_ETFS: dict[str, str] = {
    "XLK": "Technology",
    "XLF": "Financials",
    "XLV": "Health Care",
    "XLY": "Consumer Discretionary",
    "XLC": "Communication Services",
    "XLI": "Industrials",
    "XLP": "Consumer Staples",
    "XLE": "Energy",
    "XLU": "Utilities",
    "XLRE": "Real Estate",
    "XLB": "Materials",
}

FIT_WINDOW = 126  # ~6 months of trading days
REFIT_EVERY = 21  # ~monthly
MIN_FIT_ROWS = 40

# Headlines that talk about the market as a whole rank first in index news.
MARKET_KEYWORDS = (
    "stock market", "stocks", "wall street", "s&p", "dow", "nasdaq", "russell", "small-cap",
    "small cap", "fed", "powell", "interest rate", "rate cut", "rate hike", "inflation", "cpi",
    "jobs report", "payroll", "unemployment", "treasury", "yields", "bond", "tariff", "trade war",
    "recession", "gdp", "economy", "selloff", "sell-off", "rally", "futures", "volatility", "vix",
)


def get_index(index_id: str) -> dict | None:
    return INDEXES.get(index_id.upper())


def search_indexes(query: str) -> list[dict]:
    q = query.strip().upper()
    return [
        {"symbol": i["id"], "name": i["name"], "type": "Index"}
        for i in INDEXES.values()
        if any(a.startswith(q) or q in a for a in [i["id"], i["name"].upper(), *i["aliases"]])
    ]


# ── prices & sector attribution ─────────────────────────────────────────────


async def load_index_candles(index: dict, range_key: str) -> list[dict]:
    return await market.load_candles(index["etf"], market.bars_to_fetch(range_key))


async def load_sector_candles(range_key: str) -> tuple[dict[str, list[dict]], list[str]]:
    """Candles for every sector ETF that loads; also returns the ones that failed."""
    n = market.bars_to_fetch(range_key)
    etfs = list(SECTOR_ETFS)
    results = await asyncio.gather(*(market.load_candles(e, n) for e in etfs), return_exceptions=True)
    loaded = {e: r for e, r in zip(etfs, results) if not isinstance(r, Exception)}
    failed = [f"{e}: {r}" for e, r in zip(etfs, results) if isinstance(r, Exception)]
    return loaded, failed


def nnls(X: np.ndarray, y: np.ndarray, iters: int = 300) -> np.ndarray:
    """Non-negative least squares by coordinate descent (small problems only)."""
    A, b = X.T @ X, X.T @ y
    diag = np.where(np.diag(A) > 0, np.diag(A), 1e-12)
    w = np.zeros(A.shape[0])
    for _ in range(iters):
        prev = w.copy()
        for j in range(len(w)):
            w[j] = max(0.0, w[j] - (A[j] @ w - b[j]) / diag[j])
        if np.max(np.abs(w - prev)) < 1e-7:
            break
    return w


def sector_attribution(
    index_candles: list[dict], sector_candles: dict[str, list[dict]], visible_from: date
) -> dict:
    etfs = [e for e in SECTOR_ETFS if e in sector_candles]
    idx_r = returns_by_date(index_candles)
    sec_r = {e: returns_by_date(sector_candles[e]) for e in etfs}
    dates = [d for d in idx_r if all(d in sec_r[e] for e in etfs)]
    empty = {
        "sectors": [{"etf": e, "name": SECTOR_ETFS[e], "weight": None} for e in etfs],
        "r2": None, "days": {}, "period": None,
    }
    if not etfs or len(dates) < MIN_FIT_ROWS + 1:
        return empty

    y = np.array([idx_r[d] for d in dates])
    X = np.array([[sec_r[e][d] for e in etfs] for d in dates])
    visible = [i for i, d in enumerate(dates) if date.fromisoformat(d) >= visible_from]

    days: dict[str, dict] = {}
    residuals, actuals = [], []
    weights = None
    for n, i in enumerate(visible):
        if weights is None or n % REFIT_EVERY == 0:
            lo = max(0, i - FIT_WINDOW)
            if i - lo >= MIN_FIT_ROWS:  # fit on past days only
                weights = nnls(X[lo:i], y[lo:i])
        if weights is None:
            continue
        contrib = weights * X[i]
        residual = y[i] - contrib.sum()
        residuals.append(residual)
        actuals.append(y[i])
        days[dates[i]] = {
            "return_pct": round(float(y[i]) * 100, 4),
            "contributions": [round(float(c) * 100, 4) for c in contrib],
            "etf_returns": [round(float(r) * 100, 4) for r in X[i]],
            "residual_pct": round(float(residual) * 100, 4),
        }

    if not days:
        return empty
    ss_tot = float(np.sum((np.array(actuals) - np.mean(actuals)) ** 2)) or 1e-12
    period_contrib = np.sum([d["contributions"] for d in days.values()], axis=0)
    latest = nnls(X[-FIT_WINDOW:], y[-FIT_WINDOW:])
    return {
        "sectors": [
            {"etf": e, "name": SECTOR_ETFS[e], "weight": round(float(w), 4)} for e, w in zip(etfs, latest)
        ],
        # Share of the index's day-to-day moves that the sectors explain.
        "r2": 1 - float(np.sum(np.square(residuals))) / ss_tot,
        "days": days,
        # Daily contributions added up over the range (ignores compounding).
        "period": {
            "contributions": [round(float(c), 3) for c in period_contrib],
            "residual_pct": round(sum(d["residual_pct"] for d in days.values()), 3),
            "sum_return_pct": round(sum(d["return_pct"] for d in days.values()), 3),
        },
    }


def sector_breakdown_for_day(attribution: dict, day: str) -> list[dict]:
    """Per-sector contribution on one day, largest first."""
    d = attribution["days"].get(day)
    if not d:
        return []
    rows = [
        {**s, "etf_return_pct": r, "contribution_pct": c}
        for s, r, c in zip(attribution["sectors"], d["etf_returns"], d["contributions"])
    ]
    return sorted(rows, key=lambda r: abs(r["contribution_pct"]), reverse=True)


# ── news ────────────────────────────────────────────────────────────────────


def is_market_story(item: dict) -> bool:
    text = f"{item['headline']} {item.get('summary', '')}".lower()
    return any(k in text for k in MARKET_KEYWORDS)


async def get_index_news(index: dict, start: date, end: date, limit: int = 60) -> list[dict]:
    """Market-wide stories for a date window.

    Finnhub's free tier has no historical market-news search, so this combines
    (a) news about the index's largest companies, where market wrap-ups show up,
    and (b) the general market feed, which only covers the last few days.
    Market-wide stories are ranked above company-specific ones.
    """
    results = await asyncio.gather(
        *(finnhub.get_company_news(t, start, end) for t in index["news_tickers"]),
        finnhub.get_market_news(),
        return_exceptions=True,
    )
    lo = _ts(start)
    hi = _ts(end + timedelta(days=1))
    # The same article is often filed under several tickers.
    seen_ids: set[int] = set()
    seen_headlines: set[str] = set()
    merged = []
    for batch in results:
        if isinstance(batch, Exception):
            continue
        for n in batch:
            if not lo <= n["datetime"] < hi or n["id"] in seen_ids or n["headline"] in seen_headlines:
                continue
            seen_ids.add(n["id"])
            seen_headlines.add(n["headline"])
            merged.append({**n, "market_wide": is_market_story(n)})
    merged.sort(key=lambda n: (n["market_wide"], n["datetime"]), reverse=True)
    return merged[:limit]


def _ts(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())
