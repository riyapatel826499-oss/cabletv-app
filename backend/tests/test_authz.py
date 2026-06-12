"""Authorization & multi-tenant isolation regression tests.

These lock in the Phase 1 & 2 security fixes so they can't silently regress:
  - authentication required on protected endpoints
  - master-only destructive endpoints (token-claim gated)
  - removed debug endpoints stay gone
  - admin-only settings/audit mutations (DB-role gated)
  - operator-level data isolation
  - WebSocket broadcast tenant scoping
  - _op_flt operator-filter helper

A module-scoped fixture seeds two isolated operators with their own users,
customers and connections (high IDs to avoid colliding with real data) and
cleans them up afterwards.
"""
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app
from deps_orm import create_token, _op_flt
from conn import get_conn
from utils import hash_password

# Seeded test entities (high IDs to avoid clashing with production-like data)
OP_A, OP_B = 9001, 9002
U_ADMIN_A, U_AGENT_A, U_ADMIN_B = 9001, 9002, 9003
CUST_A, CUST_B = "TESTCUSTA", "TESTCUSTB"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:  # triggers lifespan / DB init
        yield c


@pytest.fixture(scope="module")
def seeded(client):
    pw = hash_password("testpass123")
    with get_conn() as conn:
        for oid, name in [(OP_A, "Test Operator A"), (OP_B, "Test Operator B")]:
            conn.execute("DELETE FROM operators WHERE id = ?", [oid])
            conn.execute(
                "INSERT INTO operators (id, business_name, owner_name, phone) VALUES (?,?,?,?)",
                [oid, name, "Owner", "0000000000"],
            )
        for uid, un, role, opid in [
            (U_ADMIN_A, "t_admin_a", "admin", OP_A),
            (U_AGENT_A, "t_agent_a", "agent", OP_A),
            (U_ADMIN_B, "t_admin_b", "admin", OP_B),
        ]:
            conn.execute("DELETE FROM users WHERE id = ?", [uid])
            conn.execute(
                "INSERT INTO users (id, username, password, name, role, operator_id, status) "
                "VALUES (?,?,?,?,?,?, 'Active')",
                [uid, un, pw, un, role, opid],
            )
        for cid, opid, stb in [(CUST_A, OP_A, "TESTSTBA"), (CUST_B, OP_B, "TESTSTBB")]:
            conn.execute("DELETE FROM connections WHERE stb_no = ?", [stb])
            conn.execute("DELETE FROM customers WHERE customer_id = ?", [cid])
            conn.execute(
                "INSERT INTO customers (customer_id, name, phone, area, status, operator_id) "
                "VALUES (?,?,?,?, 'Active', ?)",
                [cid, "Cust " + cid, "9999999999", "TestArea", opid],
            )
            conn.execute(
                "INSERT INTO connections (customer_id, stb_no, status, operator_id) "
                "VALUES (?,?, 'Active', ?)",
                [cid, stb, opid],
            )
        conn.commit()
    yield
    with get_conn() as conn:
        for stb in ["TESTSTBA", "TESTSTBB"]:
            conn.execute("DELETE FROM connections WHERE stb_no = ?", [stb])
        for cid in [CUST_A, CUST_B]:
            conn.execute("DELETE FROM customers WHERE customer_id = ?", [cid])
        for uid in [U_ADMIN_A, U_AGENT_A, U_ADMIN_B]:
            conn.execute("DELETE FROM users WHERE id = ?", [uid])
        for oid in [OP_A, OP_B]:
            conn.execute("DELETE FROM notification_settings WHERE operator_id = ?", [oid])
            conn.execute("DELETE FROM operators WHERE id = ?", [oid])
        conn.commit()


def _hdr(uid, role, oid):
    """Auth header for a seeded staff user (token sub must match the DB user id)."""
    tok = create_token(str(uid), token_type="staff", extra_claims={"role": role, "oid": oid})
    return {"Authorization": f"Bearer {tok}"}


# ── Authentication required ────────────────────────────────────────────────
class TestAuthRequired:
    @pytest.mark.parametrize("path", [
        "/api/customers",
        "/api/dashboard/stats",
        "/api/payments/all",
        "/api/reports/audit-log",
        "/api/me",
    ])
    def test_protected_get_requires_auth(self, client, path):
        r = client.get(path)
        assert r.status_code in (401, 403), f"{path} returned {r.status_code}"


# ── Master-only destructive endpoints (token-claim gated, Phase 1) ──────────
class TestMasterOnlyEndpoints:
    @pytest.mark.parametrize("path", [
        "/api/nuke-data",
        "/api/admin/sql",
        "/api/admin/bulk-payments",
        "/api/cleanup-hard-delete-payments",
        "/api/backup",
    ])
    def test_no_auth_rejected(self, client, path):
        assert client.post(path, json={}).status_code == 401

    @pytest.mark.parametrize("path", [
        "/api/nuke-data",
        "/api/admin/sql",
        "/api/admin/bulk-payments",
    ])
    def test_non_master_forbidden(self, client, path):
        # A valid non-master token must NOT be able to call these.
        r = client.post(path, json={}, headers=_hdr(U_AGENT_A, "agent", OP_A))
        assert r.status_code == 403


# ── Removed debug endpoints stay gone (Phase 1) ─────────────────────────────
class TestRemovedDebugEndpoints:
    @pytest.mark.parametrize("path", ["/api/debug-startup", "/api/debug/db-url"])
    def test_debug_endpoints_gone(self, client, path):
        assert client.get(path).status_code == 404


# ── Admin-only settings & audit mutations (DB-role gated, Phase 2 + H3) ─────
class TestRoleGatedSettings:
    def test_agent_cannot_update_settings(self, client, seeded):
        r = client.put("/api/settings/notifications", json={"notify_enabled": "true"},
                        headers=_hdr(U_AGENT_A, "agent", OP_A))
        assert r.status_code == 403

    def test_admin_can_update_settings(self, client, seeded):
        r = client.put("/api/settings/notifications", json={"notify_enabled": "true"},
                        headers=_hdr(U_ADMIN_A, "admin", OP_A))
        assert r.status_code == 200

    def test_settings_read_open_to_agent(self, client, seeded):
        r = client.get("/api/settings/notifications", headers=_hdr(U_AGENT_A, "agent", OP_A))
        assert r.status_code == 200

    def test_agent_cannot_read_audit_log(self, client, seeded):
        r = client.get("/api/reports/audit-log", headers=_hdr(U_AGENT_A, "agent", OP_A))
        assert r.status_code == 403

    def test_admin_can_read_audit_log(self, client, seeded):
        r = client.get("/api/reports/audit-log", headers=_hdr(U_ADMIN_A, "admin", OP_A))
        assert r.status_code == 200


# ── Multi-tenant data isolation (Phase 2, H1) ───────────────────────────────
class TestTenantIsolation:
    def _ids(self, resp):
        assert resp.status_code == 200, resp.text
        data = resp.json()
        items = data.get("customers", data.get("items", data if isinstance(data, list) else []))
        return {c.get("customer_id") for c in items}

    def test_operator_a_sees_only_its_customers(self, client, seeded):
        ids = self._ids(client.get("/api/customers?per_page=200",
                                   headers=_hdr(U_ADMIN_A, "admin", OP_A)))
        assert CUST_A in ids
        assert CUST_B not in ids

    def test_operator_b_sees_only_its_customers(self, client, seeded):
        ids = self._ids(client.get("/api/customers?per_page=200",
                                   headers=_hdr(U_ADMIN_B, "admin", OP_B)))
        assert CUST_B in ids
        assert CUST_A not in ids


# ── Unit: operator-filter helper ────────────────────────────────────────────
class TestOpFilterHelper:
    def test_master_sees_all(self):
        assert _op_flt({"role": "master", "operator_id": None}) == "1=1"

    def test_operator_scoped(self):
        out = _op_flt({"role": "admin", "operator_id": 42})
        assert "operator_id = 42" in out

    def test_prefix_applied(self):
        assert _op_flt({"operator_id": 7}, "c.") == "c.operator_id = 7"


# ── Unit: WebSocket broadcast tenant scoping (Phase 2, C5) ──────────────────
class TestWebSocketScoping:
    def test_broadcast_is_operator_scoped(self):
        import asyncio
        import routes.websocket as ws

        class FakeWS:
            def __init__(self):
                self.sent = []

            async def send_text(self, data):
                self.sent.append(data)

        a, b, master = FakeWS(), FakeWS(), FakeWS()
        mgr = ws.ConnectionManager()
        mgr.active_connections = [
            {"ws": a, "operator_id": 1, "role": "admin"},
            {"ws": b, "operator_id": 2, "role": "admin"},
            {"ws": master, "operator_id": None, "role": "master"},
        ]
        asyncio.run(mgr.broadcast({"type": "payment_received", "data": {"operator_id": 1}}))
        assert len(a.sent) == 1   # owning operator
        assert len(b.sent) == 0   # other operator excluded
        assert len(master.sent) == 1  # master sees all

    def test_broadcast_without_operator_goes_to_all(self):
        import asyncio
        import routes.websocket as ws

        class FakeWS:
            def __init__(self):
                self.sent = []

            async def send_text(self, data):
                self.sent.append(data)

        a, b = FakeWS(), FakeWS()
        mgr = ws.ConnectionManager()
        mgr.active_connections = [
            {"ws": a, "operator_id": 1, "role": "admin"},
            {"ws": b, "operator_id": 2, "role": "admin"},
        ]
        asyncio.run(mgr.broadcast({"type": "ping", "data": {}}))
        assert len(a.sent) == 1 and len(b.sent) == 1
