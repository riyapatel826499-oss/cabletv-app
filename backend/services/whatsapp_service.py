"""WhatsApp Business Cloud API integration.

Sends approved Meta template messages (payment_reminder, payment_confirmation).
Coexists alongside the existing Baileys bridge (wa_notify.py) — this is the
official Meta Cloud API path using an access token + phone number ID.

Phone numbers must be in E.164 without '+', e.g. '9198XXXXXXXX'.
All functions are **sync** (uses httpx sync client) so they work from both
sync FastAPI endpoints (create_payment) and async endpoints (run_reminders).
Any failure returns None and logs the error — never raises.
"""
import logging
import re

import httpx

from config import WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN, WA_API_VERSION

logger = logging.getLogger(__name__)

_API_BASE = (
    f"https://graph.facebook.com/{WA_API_VERSION}/{WA_PHONE_NUMBER_ID}/messages"
)

# ── Helpers ─────────────────────────────────────────────────────────────────


def normalize_phone(raw: str, default_cc: str = "91") -> str:
    """Normalise an Indian phone number to E.164 (no '+' prefix).

    Handles: +91XXXXXXXXXX, 91XXXXXXXXXX, 0XXXXXXXXXX, 10-digit bare numbers,
    numbers with spaces/dashes/parentheses, and 00-prefixed international.

    Returns the normalized number (always 12 digits starting with country code)
    or the raw digits as-is if it can't be parsed (so the API rejects it
    visibly in logs rather than silently dropping the message).
    """
    if not raw:
        return ""
    digits = re.sub(r"[^\d]", "", raw)

    if digits.startswith("00"):
        digits = digits[2:]

    if digits.startswith(default_cc) and len(digits) == 12:
        return digits

    if digits.startswith("0") and len(digits) == 11:
        return default_cc + digits[1:]

    if len(digits) == 10:
        return default_cc + digits

    # Unrecognisable — return as-is so API rejection is visible in logs
    logger.warning("WhatsApp: unparseable phone %r → %r", raw, digits)
    return digits


# ── Core sender ─────────────────────────────────────────────────────────────


def send_whatsapp_template(
    to_number: str,
    template_name: str,
    params: list[str],
    lang: str = "en",
) -> dict | None:
    """Send an approved Meta WhatsApp template message.

    Sync — works from both sync and async callers.
    Returns parsed JSON on success, None on failure (always logged).
    """
    if not WA_PHONE_NUMBER_ID or not WA_ACCESS_TOKEN:
        logger.warning("WhatsApp Cloud API not configured — skipping message")
        return None

    headers = {
        "Authorization": f"Bearer {WA_ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": to_number,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": lang},
            "components": [
                {
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": str(p)} for p in params
                    ],
                }
            ],
        },
    }
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.post(_API_BASE, headers=headers, json=payload)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as e:
        body = {}
        try:
            body = e.response.json()
        except Exception:
            pass
        error = body.get("error", {})
        logger.error(
            "WhatsApp API HTTP %d | to=%s template=%s code=%s msg=%s",
            e.response.status_code,
            to_number,
            template_name,
            error.get("code"),
            error.get("message"),
        )
        return None
    except httpx.RequestError as e:
        logger.error(
            "WhatsApp network error | to=%s template=%s err=%s",
            to_number,
            template_name,
            e,
        )
        return None


# ── Convenience wrappers ────────────────────────────────────────────────────


def send_payment_reminder(
    customer_name: str,
    phone: str,
    amount: str,
    due_date: str,
    pay_link: str = "",
) -> dict | None:
    """Send a payment_reminder template message."""
    normalized = normalize_phone(phone)
    if not normalized:
        logger.warning("WhatsApp: invalid phone, skipping reminder — %r", phone)
        return None
    return send_whatsapp_template(
        normalized,
        "payment_reminder",
        [customer_name, amount, due_date, pay_link],
    )


def send_payment_confirmation(
    customer_name: str,
    phone: str,
    amount: str,
) -> dict | None:
    """Send a payment_confirmation template message."""
    normalized = normalize_phone(phone)
    if not normalized:
        logger.warning("WhatsApp: invalid phone, skipping confirmation — %r", phone)
        return None
    return send_whatsapp_template(
        normalized,
        "payment_confirmation",
        [customer_name, amount],
    )
