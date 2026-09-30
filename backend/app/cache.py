import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

_store: dict[str, tuple[float, Any]] = {}
_locks: dict[str, asyncio.Lock] = {}


def get(key: str) -> Any | None:
    hit = _store.get(key)
    return hit[1] if hit and hit[0] > time.monotonic() else None


def put(key: str, ttl: float, value: Any) -> None:
    _store[key] = (time.monotonic() + ttl, value)


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
