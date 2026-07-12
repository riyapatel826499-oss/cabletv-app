"""Tests for WhatsApp Cloud API integration.

All tests use mocked httpx — no live WhatsApp account needed.
Tests that hit the API mock set WA_PHONE_NUMBER_ID + WA_ACCESS_TOKEN via
monkeypatch so the service doesn't short-circuit. Tests that skip the API
(bad phone, unconfigured) don't use httpx_mock at all.
"""
import pytest
from pytest_httpx import HTTPXMock

from services.whatsapp_service import (
    normalize_phone,
    send_whatsapp_template,
    send_payment_confirmation,
    send_payment_reminder,
)


def _set_creds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "services.whatsapp_service.WA_PHONE_NUMBER_ID", "123456789"
    )
    monkeypatch.setattr(
        "services.whatsapp_service.WA_ACCESS_TOKEN", "test-token"
    )


# ── normalize_phone ─────────────────────────────────────────────────────────


class TestNormalizePhone:
    def test_full_international(self):
        assert normalize_phone("+91 86681-62593") == "918668162593"

    def test_leading_zero(self):
        assert normalize_phone("08668162593") == "918668162593"

    def test_bare_10_digit(self):
        assert normalize_phone("8668162593") == "918668162593"

    def test_already_e164(self):
        assert normalize_phone("918668162593") == "918668162593"

    def test_with_dashes(self):
        assert normalize_phone("866-816-2593") == "918668162593"

    def test_with_parentheses(self):
        assert normalize_phone("(91) 8668162593") == "918668162593"

    def test_double_zero_prefix(self):
        assert normalize_phone("00918668162593") == "918668162593"

    def test_empty_returns_empty(self):
        assert normalize_phone("") == ""
        assert normalize_phone(None) == ""

    def test_odd_format_returns_raw_digits(self):
        result = normalize_phone("(866) 816-2593"[:10])
        assert isinstance(result, str) and len(result) > 0


# ── send_whatsapp_template ──────────────────────────────────────────────────


class TestSendWhatsAppTemplate:
    def test_not_configured_returns_none(self, monkeypatch):
        monkeypatch.setattr("services.whatsapp_service.WA_PHONE_NUMBER_ID", "")
        monkeypatch.setattr("services.whatsapp_service.WA_ACCESS_TOKEN", "")
        result = send_whatsapp_template("918668162593", "payment_reminder", ["T", "1"])
        assert result is None

    def test_success(self, httpx_mock: HTTPXMock, monkeypatch):
        _set_creds(monkeypatch)
        httpx_mock.add_response(
            json={"messages": [{"id": "wamid.test123"}]},
            status_code=200,
        )
        assert send_whatsapp_template(
            "918668162593", "payment_reminder", ["Test", "100"]
        )["messages"][0]["id"] == "wamid.test123"

    def test_http_error_returns_none(self, httpx_mock: HTTPXMock, monkeypatch):
        _set_creds(monkeypatch)
        httpx_mock.add_response(
            json={"error": {"code": 131031, "message": "Business Account locked"}},
            status_code=400,
        )
        assert send_whatsapp_template(
            "918668162593", "payment_reminder", ["Test", "100"]
        ) is None

    def test_network_error_returns_none(self, httpx_mock: HTTPXMock, monkeypatch):
        import httpx
        _set_creds(monkeypatch)
        httpx_mock.add_exception(httpx.TimeoutException("Connection timed out"))
        assert send_whatsapp_template(
            "918668162593", "payment_reminder", ["Test", "100"]
        ) is None


# ── send_payment_confirmation ───────────────────────────────────────────────


class TestSendPaymentConfirmation:
    def test_success(self, httpx_mock: HTTPXMock, monkeypatch):
        _set_creds(monkeypatch)
        httpx_mock.add_response(
            json={"messages": [{"id": "wamid.c123"}]},
            status_code=200,
        )
        assert send_payment_confirmation("Ravi", "8668162593", "500")[
            "messages"
        ][0]["id"] == "wamid.c123"

    def test_bad_phone_returns_none(self):
        # No httpx_mock — should short-circuit before API call
        assert send_payment_confirmation("Ravi", "", "500") is None

    def test_api_failure_returns_none(self, httpx_mock: HTTPXMock, monkeypatch):
        _set_creds(monkeypatch)
        httpx_mock.add_response(
            json={"error": {"code": 100, "message": "Invalid parameter"}},
            status_code=400,
        )
        assert send_payment_confirmation("Ravi", "8668162593", "500") is None


# ── send_payment_reminder ───────────────────────────────────────────────────


class TestSendPaymentReminder:
    def test_success(self, httpx_mock: HTTPXMock, monkeypatch):
        _set_creds(monkeypatch)
        httpx_mock.add_response(
            json={"messages": [{"id": "wamid.r123"}]},
            status_code=200,
        )
        assert send_payment_reminder(
            "Ravi", "8668162593", "500", "2026-07-15", "https://pay.link"
        )["messages"][0]["id"] == "wamid.r123"

    def test_bad_phone_returns_none(self):
        assert send_payment_reminder("Ravi", "12", "500", "2026-07-15") is None

    def test_api_failure_returns_none(self, httpx_mock: HTTPXMock, monkeypatch):
        _set_creds(monkeypatch)
        httpx_mock.add_response(status_code=503)
        assert send_payment_reminder(
            "Ravi", "8668162593", "500", "2026-07-15"
        ) is None