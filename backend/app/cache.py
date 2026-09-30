import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

_store: dict[str, tuple[float, Any]] = {}
_locks: dict[str, asyncio.Lock] = {}


async def cached(key: str, ttl: float, loader: Callable[[], Awaitable[Any]]) -> Any:
    """Return a cached value, loading it at most once concurrently per key."""
    hit = _store.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        hit = _store.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        value = await loader()
        _store[key] = (time.monotonic() + ttl, value)
        return value
