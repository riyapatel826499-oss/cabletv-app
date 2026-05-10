"""Shared rate limiter instance — import and decorate endpoints."""
limiter_available = False
try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address
    limiter = Limiter(key_func=get_remote_address)
    limiter_available = True
except ImportError:
    class _DummyLimiter:
        def limit(self, *a, **kw):
            def decorator(fn): return fn
            return decorator
    limiter = _DummyLimiter()
