import asyncio
import time
from collections import deque


class RateLimiter:
    """Sliding-window limiter: at most `per_minute` acquisitions in any 60 seconds.

    Waiters are served in order, so a burst (e.g. 11 sector ETFs) queues up
    instead of tripping the provider's per-minute limit.
    """

    def __init__(self, per_minute: int):
        self.per_minute = max(1, per_minute)
        self._calls: deque[float] = deque()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = time.monotonic()
                while self._calls and now - self._calls[0] >= 60:
                    self._calls.popleft()
                if len(self._calls) < self.per_minute:
                    self._calls.append(now)
                    return
                await asyncio.sleep(60 - (now - self._calls[0]) + 0.05)
