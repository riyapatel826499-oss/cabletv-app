"""Per-operator white-label settings — read/write as JSON.
This module provides helper functions to get/set operator settings,
with sensible defaults that match the current hardcoded values.
"""
import json
from datetime import datetime
from typing import Any

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
    "primary_color": "#5aa2ff",
    "secondary_color": "#8b5cff",
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
        if row and row.get("settings"):
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
    """Migration: add settings column if missing."""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(operators)").fetchall()]
    if "settings" not in cols:
        conn.execute(
            "ALTER TABLE operators ADD COLUMN settings TEXT DEFAULT '{}'"
        )
        return True
    return False
