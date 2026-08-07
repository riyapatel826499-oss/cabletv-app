"""Per-operator white-label settings — read/write as JSON.
This module provides helper functions to get/set operator settings,
with sensible defaults that match the current hardcoded values.
"""
import json
from datetime import datetime
from typing import Any

from config import DB_ENGINE

DEFAULT_SETTINGS = {
    "app_name": "Wasool",
    "business_name": "Sree Selvanaayakki Amman Cables & Internet Services",
    "legal_name": "Sree Selvanaayakki Amman Cables & Internet Services",
    "gstin": "33AFMPI1642D1ZW",
    "address": (
        "SF No 459/2, D.No 127, Perumal Kovil Street, "
        "Karumathampatti, Sulur, Coimbatore, Tamil Nadu – 641659"
    ),
    "phone": "+91 77085 51139",
    "email": "selvanayakiammancables@gmail.com",
    "upi_id": "ssncables@axl",
    "upi_reconnect_id": "selvanayakiammancables-3@okhdfcbank",
    "map_lat": 11.0974473,
    "map_lng": 77.2013613,
    "map_radius_km": 3,
    "care_phone": "7708551139",
    # Notification chime per type — name of a bundled res/raw resource in the
    # APK (payment.wav, reconnection.wav, chime.wav, ding.wav, beep.wav,
    # bell.wav) or "default" for the system default sound.
    "notif_sound_payment": "payment",
    "notif_sound_reconnection": "reconnection",
    "notif_sound_general": "default",
    "prorata_enabled": True,
    "prorata_billing_day": 13,
    "prorata_target_day": 16,
    # Service-request acknowledgment SLA — if a ticket is not acknowledged by
    # its service agent within sr_sla_minutes, it is escalated to admins.
    "sr_sla_enabled": False,
    "sr_sla_minutes": 15,
    "primary_color": "#5aa2ff",
    "secondary_color": "#8b5cff",
    # WhatsApp payment receipt template. Placeholders substituted at send time:
    #   {business} {customer} {customer_id} {amount} {month} {mode} {date}
    #   {valid_till} {upi} {phone}
    #   Tamil-only: {month_ta} {mode_ta} {date_ta} {valid_till_ta}
    "wa_receipt_template": (
        "*{business}*\n"
        "Payment Receipt\n"
        "-----------------------------\n"
        "Customer: {customer} ({customer_id})\n"
        "Amount paid: ₹{amount}\n"
        "For: {month}\n"
        "Mode: {mode}\n"
        "Date: {date}\n"
        "Valid till: {valid_till}\n"
        "-----------------------------\n"
        "Thank you for your payment.\n"
        "UPI for next time: {upi}\n"
        "GPay / PhonePe: {phone}\n\n"
        "- Regards, {business}"
    ),
    # Tamil version of the same receipt — sent below the English one in one message
    "wa_receipt_template_ta": (
        "*{business}*\n"
        "பணம் செலுத்திய ரசீது\n"
        "-----------------------------\n"
        "வாடிக்கையாளர்: {customer} ({customer_id})\n"
        "செலுத்திய தொகை: ₹{amount}\n"
        "மாதம்: {month_ta}\n"
        "செலுத்தும் முறை: {mode_ta}\n"
        "தேதி: {date_ta}\n"
        "செல்லுபடியாகும் வரை: {valid_till_ta}\n"
        "-----------------------------\n"
        "பணம் செலுத்தியதற்கு நன்றி.\n"
        "அடுத்த முறை UPI: {upi}\n"
        "GPay / PhonePe: {phone}\n\n"
        "- நன்றி, {business}"
    ),
}


def get_settings(conn=None, operator_id: int = 1) -> dict:
    """Get operator settings, merging DB-stored values over defaults."""
    settings = dict(DEFAULT_SETTINGS)
    if conn is None:
        return settings

    try:
        row = conn.execute(
            "SELECT settings FROM operators WHERE id = ?", (operator_id,)
        ).fetchone()
        if row and row["settings"]:
            stored = json.loads(row["settings"])
            settings.update(stored)
    except Exception:
        pass

    return settings


def update_settings(conn, operator_id: int, updates: dict) -> dict:
    """Update specific settings keys (partial update)."""
    current = get_settings(conn, operator_id)
    current.update(updates)

    conn.execute(
        "UPDATE operators SET settings = ? WHERE id = ?",
        (json.dumps(current), operator_id),
    )
    return current


def ensure_settings_column(conn):
    """Migration: add settings column if missing (SQLite + PostgreSQL)."""
    if DB_ENGINE == "postgresql":
        conn.execute(
            "ALTER TABLE operators ADD COLUMN IF NOT EXISTS settings TEXT DEFAULT '{}'"
        )
        return True
    cols = [r[1] for r in conn.execute("PRAGMA table_info(operators)").fetchall()]
    if "settings" not in cols:
        conn.execute(
            "ALTER TABLE operators ADD COLUMN settings TEXT DEFAULT '{}'"
        )
        return True
    return False
