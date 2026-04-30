"""Simple in-memory TTL cache for expensive queries."""
import time
from threading import Lock

_cache = {}
_lock = Lock()


def get_cached(key: str, ttl: int = 30):
    """Return cached value if still fresh, else None."""
    with _lock:
        entry = _cache.get(key)
        if entry and (time.time() - entry["ts"]) < ttl:
            return entry["val"]
    return None


def set_cached(key: str, val):
    """Store value with current timestamp."""
    with _lock:
        _cache[key] = {"val": val, "ts": time.time()}


def clear_cache(key: str = None):
    """Clear specific key or entire cache."""
    with _lock:
        if key:
            _cache.pop(key, None)
        else:
            _cache.clear()
