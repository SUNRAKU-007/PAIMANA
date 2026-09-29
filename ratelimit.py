"""Small in-process sliding-window rate limiter.

Good enough for a single-instance deployment (Render/Railway). If you scale to
several instances, move the counters to Redis (e.g. Upstash) so limits are shared.
"""

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

_lock = threading.Lock()
_hits: dict = defaultdict(deque)
_MAX_KEYS = 50_000


def client_ip(request: Request) -> str:
    # Render, Railway, Vercel etc. sit behind a proxy that sets X-Forwarded-For;
    # the first entry is the original client.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check(key: str, limit: int, window_s: int) -> None:
    now = time.monotonic()
    with _lock:
        if len(_hits) > _MAX_KEYS:
            _hits.clear()
        q = _hits[key]
        while q and now - q[0] > window_s:
            q.popleft()
        if len(q) >= limit:
            retry_after = max(1, int(window_s - (now - q[0])))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please wait a moment and try again.",
                headers={"Retry-After": str(retry_after)},
            )
        q.append(now)


def rate_limit(name: str, limit: int, window_s: int):
    """FastAPI dependency: allow `limit` requests per `window_s` seconds per client IP."""

    def dependency(request: Request) -> None:
        _check(f"{name}:{client_ip(request)}", limit, window_s)

    return dependency
