"""Big-move detection and market / sector / company return attribution.

For each trading day we regress the stock's daily return on two factors:

    r_stock = alpha + b_mkt * r_market + b_sec * (r_sector - r_market) + residual

Using the *excess* sector return keeps the two factors roughly orthogonal, so a
day's move splits cleanly into:
    market  = b_mkt * r_market
    sector  = b_sec * (r_sector - r_market)
    company = everything else (news, earnings, idiosyncratic flows)
"""

from datetime import date

import numpy as np

VOL_WINDOW = 60
VOLUME_WINDOW = 20


def returns_by_date(candles: list[dict]) -> dict[str, float]:
    out: dict[str, float] = {}
    for prev, cur in zip(candles, candles[1:]):
        if prev["close"]:
            out[cur["time"]] = cur["close"] / prev["close"] - 1
    return out


def compute_factor_model(
    candles: list[dict], market: list[dict] | None, sector: list[dict] | None
) -> dict:
    stock_r = returns_by_date(candles)
    mkt_r = returns_by_date(market) if market else {}
    sec_r = returns_by_date(sector) if sector else {}

    dates = [d for d in stock_r if d in mkt_r and (not sec_r or d in sec_r)]
    if len(dates) < 30:
        return {"beta_market": None, "beta_sector": None, "alpha": 0.0, "r2": None,
                "market_r": mkt_r, "sector_r": sec_r}

    y = np.array([stock_r[d] for d in dates])
    cols = [np.ones(len(dates)), np.array([mkt_r[d] for d in dates])]
    if sec_r:
        cols.append(np.array([sec_r[d] - mkt_r[d] for d in dates]))
    X = np.column_stack(cols)
    coef, *_ = np.linalg.lstsq(X, y, rcond=None)
    fitted = X @ coef
    ss_res = float(np.sum((y - fitted) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2)) or 1e-12
    return {
        "alpha": float(coef[0]),
        "beta_market": float(coef[1]),
        "beta_sector": float(coef[2]) if sec_r else None,
        "r2": 1 - ss_res / ss_tot,
        "market_r": mkt_r,
        "sector_r": sec_r,
    }


def detect_moves(candles: list[dict], visible_from: date, z_threshold: float) -> list[dict]:
    """Flag days whose return is unusually large relative to recent volatility."""
    closes = np.array([c["close"] for c in candles])
    volumes = np.array([c["volume"] for c in candles])
    if len(closes) < VOL_WINDOW + 2:
        return []
    rets = closes[1:] / closes[:-1] - 1  # rets[i] belongs to candles[i + 1]

    moves = []
    for i in range(VOL_WINDOW, len(rets)):
        c = candles[i + 1]
        if date.fromisoformat(c["time"]) < visible_from:
            continue
        sigma = float(np.std(rets[i - VOL_WINDOW:i], ddof=1))
        if sigma <= 0:
            continue
        r = float(rets[i])
        z = r / sigma
        if abs(z) < z_threshold:
            continue

        avg_vol = float(np.mean(volumes[i + 1 - VOLUME_WINDOW:i + 1])) or 1.0
        prev_close = candles[i]["close"]
        move = {
            "date": c["time"],
            "return_pct": r * 100,
            "z_score": z,
            "volume_ratio": c["volume"] / avg_vol if avg_vol else None,
            # A large overnight gap usually means news landed outside market hours.
            "gap_pct": (c["open"] / prev_close - 1) * 100,
            "intraday_pct": (c["close"] / c["open"] - 1) * 100 if c["open"] else 0.0,
            "close": c["close"],
        }
        moves.append(move)
    return moves


def with_attribution(detected: list[dict], model: dict) -> list[dict]:
    return [{**m, **attribute(m["date"], m["return_pct"] / 100, model)} for m in detected]


def attribute(day: str, r: float, model: dict) -> dict:
    mkt = model["market_r"].get(day)
    sec = model["sector_r"].get(day)
    if model["beta_market"] is None or mkt is None:
        return {"market_pct": None, "sector_pct": None, "company_pct": r * 100,
                "market_etf_pct": None, "sector_etf_pct": None}
    market_part = model["beta_market"] * mkt
    sector_part = (
        model["beta_sector"] * (sec - mkt)
        if model["beta_sector"] is not None and sec is not None
        else 0.0
    )
    return {
        "market_pct": market_part * 100,
        "sector_pct": sector_part * 100 if sec is not None else None,
        "company_pct": (r - market_part - sector_part) * 100,
        "market_etf_pct": mkt * 100,
        "sector_etf_pct": sec * 100 if sec is not None else None,
    }


def period_stats(candles: list[dict], benchmarks: dict[str, list[dict]], visible_from: date) -> dict:
    def period_return(cs: list[dict]) -> float | None:
        vis = [c for c in cs if date.fromisoformat(c["time"]) >= visible_from]
        if len(vis) < 2:
            return None
        return (vis[-1]["close"] / vis[0]["close"] - 1) * 100

    return {
        "return_pct": period_return(candles),
        "typical_daily_move_pct": typical_daily_move(candles, visible_from),
        "benchmark_returns_pct": {t: period_return(cs) for t, cs in benchmarks.items()},
    }


def typical_daily_move(candles: list[dict], visible_from: date) -> float | None:
    """Standard deviation of daily returns over the visible range, in %."""
    rets = [r for d, r in returns_by_date(candles).items() if date.fromisoformat(d) >= visible_from]
    return float(np.std(rets, ddof=1) * 100) if len(rets) > 2 else None
