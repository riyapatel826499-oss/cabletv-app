"""Shared rate limiter instance — import and decorate endpoints.

Uses Redis storage when REDIS_URL is set (so limits are enforced consistently
across gunicorn workers/replicas); otherwise falls back to slowapi's default
in-memory storage. Falls back to a no-op limiter if slowapi isn't installed.
"""
import os

limiter_available = False
try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address

    _redis_url = os.getenv("REDIS_URL", "")
    _use_redis = False
    if _redis_url:
        # Only use Redis storage if it's actually reachable; otherwise fall back
        # to in-memory so a misconfigured/unreachable REDIS_URL can't break
        # rate-limited endpoints (slowapi connects lazily and won't fall back).
        try:
            import redis as _redis_lib
            _redis_lib.from_url(_redis_url, socket_connect_timeout=2, socket_timeout=2).ping()
            _use_redis = True
        except Exception:
            _use_redis = False
    if _use_redis:
        limiter = Limiter(key_func=get_remote_address, storage_uri=_redis_url)
    else:
        limiter = Limiter(key_func=get_remote_address)
    limiter_available = True
except ImportError:
    class _DummyLimiter:
        def limit(self, *a, **kw):
            def decorator(fn): return fn
            return decorator
    limiter = _DummyLimiter()
