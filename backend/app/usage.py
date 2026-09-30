"""Limits on AI analyses, which cost money per run (several Claude calls each).

- per visitor (IP): at most `analyze_limit_per_hour` fresh analyses per hour
- whole site: at most `analyze_limit_per_day` fresh analyses per UTC day

Cached results (see main.py) don't count. State is in memory, so the backend
must run as a single process (it does: one uvicorn worker).
"""

import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from app.config import get_settings

_per_ip: dict[str, deque[float]] = defaultdict(deque)
_day = ""
_day_count = 0


def try_start_analysis(ip: str) -> str | None:
    """Record an analysis for `ip`, or return why it isn't allowed right now."""
    global _day, _day_count
    settings = get_settings()
    now = time.monotonic()

    today = datetime.now(timezone.utc).date().isoformat()
    if today != _day:
        _day, _day_count = today, 0
    if settings.analyze_limit_per_day and _day_count >= settings.analyze_limit_per_day:
        return "The daily limit for AI analyses has been reached. Please try again tomorrow."

    calls = _per_ip[ip]
    while calls and now - calls[0] >= 3600:
        calls.popleft()
    if settings.analyze_limit_per_hour and len(calls) >= settings.analyze_limit_per_hour:
        wait_min = int((3600 - (now - calls[0])) / 60) + 1
        return f"You've run {len(calls)} AI analyses in the last hour. Try again in about {wait_min} min."

    calls.append(now)
    _day_count += 1
    return None
