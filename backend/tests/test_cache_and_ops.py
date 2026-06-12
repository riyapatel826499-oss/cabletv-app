"""Tests for the cache backend (in-memory fallback path), dashboard cache
invalidation, and the /api/ready readiness probe.

These run with no REDIS_URL set, so they exercise the in-memory fallback — the
exact behaviour production gets when Redis isn't configured (no breakage).
"""
import os
import sys
import time

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cache
from main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class TestCacheBackend:
    def test_set_get_roundtrip(self):
        cache.set_cached("t:roundtrip", {"a": 1, "b": [2, 3]})
        assert cache.get_cached("t:roundtrip", ttl=30) == {"a": 1, "b": [2, 3]}

    def test_ttl_expiry(self):
        cache.set_cached("t:ttl", 42)
        # ttl=0 means nothing is ever considered fresh
        assert cache.get_cached("t:ttl", ttl=0) is None

    def test_miss_returns_none(self):
        assert cache.get_cached("t:does-not-exist", ttl=30) is None

    def test_clear_specific_key(self):
        cache.set_cached("t:clearme", 1)
        cache.clear_cache("t:clearme")
        assert cache.get_cached("t:clearme", ttl=30) is None

    def test_invalidate_dashboard_clears_operator_and_master(self):
        cache.set_cached("dashboard_stats:7", {"x": 1})
        cache.set_cached("payment_modes:7", {"y": 2})
        cache.set_cached("dashboard_stats:None", {"z": 3})
        cache.invalidate_dashboard(7)
        assert cache.get_cached("dashboard_stats:7", ttl=99) is None
        assert cache.get_cached("payment_modes:7", ttl=99) is None
        assert cache.get_cached("dashboard_stats:None", ttl=99) is None

    def test_in_memory_backend_active_without_redis(self):
        # With no REDIS_URL configured, the fallback store must be in use.
        assert cache._redis_ready is False


class TestReadiness:
    def test_ready_returns_200(self, client):
        r = client.get("/api/ready")
        assert r.status_code == 200
        assert r.json()["status"] == "ready"

    def test_request_id_header_echoed(self, client):
        r = client.get("/api/health", headers={"X-Request-ID": "test-rid-123"})
        assert r.headers.get("X-Request-ID") == "test-rid-123"

    def test_request_id_generated_when_absent(self, client):
        r = client.get("/api/health")
        assert r.headers.get("X-Request-ID")  # non-empty generated id
