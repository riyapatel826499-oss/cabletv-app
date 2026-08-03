"""Operator settings API — get/set white-label configuration per operator.
Requires admin or master auth. Public settings available at /api/portal/settings.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import get_current_user, op_id, require_master
from conn import get_conn
from utils.operator_settings import get_settings, update_settings, DEFAULT_SETTINGS

router = APIRouter(prefix="/api", tags=["Settings"])


@router.get("/operator-settings")
def read_operator_settings(user=Depends(get_current_user), operator_id: int = Depends(op_id)):
    """Get current operator's white-label settings."""
    with get_conn() as conn:
        settings = get_settings(conn, operator_id)
    return settings


class SettingsUpdate(BaseModel):
    updates: dict


@router.patch("/operator-settings")
def patch_operator_settings(
    data: SettingsUpdate,
    user=Depends(require_master),
    operator_id: int = Depends(op_id),
):
    """Update operator settings (master only)."""
    with get_conn() as conn:
        updated = update_settings(conn, operator_id, data.updates)
        conn.commit()
    return {"ok": True, "settings": updated}


@router.get("/portal/settings")
def public_portal_settings():
    """Public settings for customer portal (no auth required)."""
    with get_conn() as conn:
        settings = get_settings(conn, operator_id=1)
    # Only return safe public fields
    return {
        "business_name": settings.get("business_name", DEFAULT_SETTINGS["business_name"]),
        "phone": settings.get("phone", DEFAULT_SETTINGS["phone"]),
        "care_phone": settings.get("care_phone", DEFAULT_SETTINGS["care_phone"]),
        "email": settings.get("email", DEFAULT_SETTINGS["email"]),
        "app_name": settings.get("app_name", DEFAULT_SETTINGS["app_name"]),
        "upi_id": settings.get("upi_id", DEFAULT_SETTINGS["upi_id"]),
        "upi_reconnect_id": settings.get("upi_reconnect_id", DEFAULT_SETTINGS["upi_reconnect_id"]),
        "prorata_enabled": settings.get("prorata_enabled", DEFAULT_SETTINGS["prorata_enabled"]),
    }
