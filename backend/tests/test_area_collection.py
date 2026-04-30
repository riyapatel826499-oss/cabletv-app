"""Tests for area-wise collection report API endpoint."""
import pytest
from fastapi.testclient import TestClient
import sqlite3
import os
import sys

# Add parent dir to path
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


@pytest.fixture
def db():
    """Direct DB connection for test data setup."""
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cabletv.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()


# ─── RED: Tests that should FAIL because endpoint doesn't exist yet ───

class TestAreaCollectionEndpoint:
    """Tests for GET /api/reports/area-collection"""

    def test_endpoint_exists(self, client, auth_headers):
        """Endpoint should return 200, not 404."""
        response = client.get("/api/reports/area-collection", headers=auth_headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    def test_returns_list(self, client, auth_headers):
        """Response should contain a 'areas' key with a list."""
        response = client.get("/api/reports/area-collection", headers=auth_headers)
        data = response.json()
        assert "areas" in data, f"Expected 'areas' key in response, got keys: {list(data.keys())}"
        assert isinstance(data["areas"], list), f"Expected list, got {type(data['areas'])}"

    def test_area_item_structure(self, client, auth_headers):
        """Each area item should have: area, total_amount, customer_count, mso_breakdown."""
        response = client.get("/api/reports/area-collection", headers=auth_headers)
        data = response.json()
        if data["areas"]:
            item = data["areas"][0]
            required_keys = {"area", "total_amount", "customer_count"}
            missing = required_keys - set(item.keys())
            assert not missing, f"Missing keys in area item: {missing}. Got: {list(item.keys())}"

    def test_areas_sorted_by_amount_desc(self, client, auth_headers):
        """Areas should be sorted by total_amount descending (highest first)."""
        response = client.get("/api/reports/area-collection", headers=auth_headers)
        data = response.json()
        if len(data["areas"]) >= 2:
            amounts = [a["total_amount"] for a in data["areas"]]
            assert amounts == sorted(amounts, reverse=True), f"Not sorted desc: {amounts}"

    def test_supports_date_filter(self, client, auth_headers):
        """Should accept from_date and to_date query params."""
        response = client.get(
            "/api/reports/area-collection?from_date=2026-04-01&to_date=2026-04-30",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Date filter failed: {response.status_code}"

    def test_total_summary(self, client, auth_headers):
        """Response should include total_amount and total_customers summary."""
        response = client.get("/api/reports/area-collection", headers=auth_headers)
        data = response.json()
        assert "total_amount" in data, f"Missing total_amount summary"
        assert "total_areas" in data, f"Missing total_areas summary"
