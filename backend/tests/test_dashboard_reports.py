"""Tests for collector performance and MSO summary dashboard endpoints."""
import pytest
from fastapi.testclient import TestClient
import sqlite3
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app
from deps import create_token


@pytest.fixture
def client():
    """Test client with auth header."""
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_headers():
    """Valid auth headers for API calls."""
    token = create_token("1", token_type="staff")
    return {"Authorization": f"Bearer {token}"}


# ─── RED: Tests that should FAIL because endpoints don't exist yet ───

class TestCollectorPerformanceEndpoint:
    """Tests for GET /api/reports/collector-performance"""

    def test_endpoint_exists(self, client, auth_headers):
        """Endpoint should return 200, not 404."""
        response = client.get("/api/reports/collector-performance", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    def test_returns_collectors_list(self, client, auth_headers):
        """Response should contain 'collectors' key with a list."""
        response = client.get("/api/reports/collector-performance", headers=auth_headers)
        data = response.json()
        assert "collectors" in data, f"Expected 'collectors' key, got: {list(data.keys())}"
        assert isinstance(data["collectors"], list)

    def test_collector_item_structure(self, client, auth_headers):
        """Each collector should have: name, total_collected, payment_count."""
        response = client.get("/api/reports/collector-performance", headers=auth_headers)
        data = response.json()
        if data["collectors"]:
            item = data["collectors"][0]
            required = {"name", "total_collected", "payment_count"}
            missing = required - set(item.keys())
            assert not missing, f"Missing keys: {missing}. Got: {list(item.keys())}"

    def test_sorted_by_amount_desc(self, client, auth_headers):
        """Collectors should be sorted by total_collected descending."""
        response = client.get("/api/reports/collector-performance", headers=auth_headers)
        data = response.json()
        if len(data["collectors"]) >= 2:
            amounts = [c["total_collected"] for c in data["collectors"]]
            assert amounts == sorted(amounts, reverse=True), f"Not sorted: {amounts}"

    def test_supports_date_filter(self, client, auth_headers):
        """Should accept from_date and to_date query params."""
        response = client.get(
            "/api/reports/collector-performance?from_date=2026-04-01&to_date=2026-04-30",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "collectors" in data

    def test_includes_total_summary(self, client, auth_headers):
        """Response should include total_amount and total_payments."""
        response = client.get("/api/reports/collector-performance", headers=auth_headers)
        data = response.json()
        assert "total_amount" in data, f"Missing total_amount. Got: {list(data.keys())}"
        assert "total_payments" in data, f"Missing total_payments. Got: {list(data.keys())}"


class TestMSOSummaryEndpoint:
    """Tests for GET /api/reports/mso-summary"""

    def test_endpoint_exists(self, client, auth_headers):
        """Endpoint should return 200, not 404."""
        response = client.get("/api/reports/mso-summary", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    def test_returns_mso_list(self, client, auth_headers):
        """Response should contain 'msos' key with a list."""
        response = client.get("/api/reports/mso-summary", headers=auth_headers)
        data = response.json()
        assert "msos" in data, f"Expected 'msos' key, got: {list(data.keys())}"
        assert isinstance(data["msos"], list)

    def test_mso_item_structure(self, client, auth_headers):
        """Each MSO should have: name, total_customers, active_customers, total_collected."""
        response = client.get("/api/reports/mso-summary", headers=auth_headers)
        data = response.json()
        if data["msos"]:
            item = data["msos"][0]
            required = {"name", "total_customers", "active_customers", "total_collected"}
            missing = required - set(item.keys())
            assert not missing, f"Missing keys: {missing}. Got: {list(item.keys())}"

    def test_supports_date_filter(self, client, auth_headers):
        """Should accept from_date and to_date for collection data."""
        response = client.get(
            "/api/reports/mso-summary?from_date=2026-04-01&to_date=2026-04-30",
            headers=auth_headers
        )
        assert response.status_code == 200
