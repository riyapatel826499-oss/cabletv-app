"""TTL cache with an optional Redis backend (shared across workers) and a
thread-safe in-memory fallback.

Behaviour is unchanged when REDIS_URL is not set or Redis is unreachable: the
process-local in-memory dict is used exactly as before. When REDIS_URL points to
a reachable Redis, the cache is shared across gunicorn workers/replicas, which is
the prerequisite for scaling horizontally without serving inconsistent reads.

The public API (get_cached / set_cached / clear_cache) is unchanged; callers
don't need to know which backend is active. Freshness is enforced by a stored
timestamp + the ttl passed to get_cached, so semantics match the old in-memory
implementation on both backends.
"""
import os
import json
import time
import logging
from threading import Lock

logger = logging.getLogger(__name__)

# ── In-memory fallback store ────────────────────────────────────────────────
_cache = {}
_lock = Lock()

# ── Optional Redis backend ──────────────────────────────────────────────────
_redis = None
_redis_ready = False
_REDIS_PREFIX = "wasool:cache:"
# Hard safety expiry on Redis keys; actual freshness is still enforced by the
# per-get ttl check, this just stops abandoned keys lingering forever.
_REDIS_TTL_CEILING = 600


def _init_redis():
    global _redis, _redis_ready
    url = os.getenv("REDIS_URL", "")
    if not url:
        return
    try:
        import redis  # imported lazily so the dep is optional in dev
        client = redis.from_url(
            url, socket_connect_timeout=2, socket_timeout=2, decode_responses=True
        )
        client.ping()
        _redis = client
        _redis_ready = True
        logger.info("cache: using Redis backend")
    except Exception as e:  # noqa: BLE001 — never let cache init break startup
        _redis = None
        _redis_ready = False
        logger.warning("cache: Redis unavailable (%s); using in-memory cache", e)


_init_redis()


def get_cached(key: str, ttl: int = 30):
    """Return cached value if still fresh (within ttl seconds), else None."""
    if _redis_ready:
        try:
            raw = _redis.get(_REDIS_PREFIX + key)
            if raw:
                entry = json.loads(raw)
                if (time.time() - entry["ts"]) < ttl:
                    return entry["val"]
            return None
        except Exception as e:  # noqa: BLE001
            logger.warning("cache get failed (%s); using in-memory", e)
    with _lock:
        entry = _cache.get(key)
        if entry and (time.time() - entry["ts"]) < ttl:
            return entry["val"]
    return None


def set_cached(key: str, val):
    """Store value with the current timestamp."""
    entry = {"val": val, "ts": time.time()}
    if _redis_ready:
        try:
            _redis.setex(_REDIS_PREFIX + key, _REDIS_TTL_CEILING, json.dumps(entry, default=str))
            return
        except Exception as e:  # noqa: BLE001
            logger.warning("cache set failed (%s); using in-memory", e)
    with _lock:
        _cache[key] = entry


def clear_cache(key: str = None):
    """Clear a specific key, or the entire cache when key is None."""
    if _redis_ready:
        try:
            if key:
                _redis.delete(_REDIS_PREFIX + key)
            else:
                for k in _redis.scan_iter(_REDIS_PREFIX + "*"):
                    _redis.delete(k)
        except Exception as e:  # noqa: BLE001
            logger.warning("cache clear failed (%s)", e)
    with _lock:
        if key:
            _cache.pop(key, None)
        else:
            _cache.clear()


def invalidate_dashboard(operator_id):
    """Evict cached dashboard/payment-mode aggregates after a write.

    Clears the operator's own keys plus the master (all-operators) view, whose
    totals also change when any operator's data changes. Safe to call on every
    mutation — keys are cheap to recompute and the TTL is the safety net.
    """
    for k in (
        f"dashboard_stats:{operator_id}",
        f"payment_modes:{operator_id}",
        "dashboard_stats:None",
        "payment_modes:None",
    ):
        clear_cache(k)
