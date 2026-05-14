"""
GTPL Integration Routes
POST /api/gtpl/suspend      — Suspend STB on GTPL
POST /api/gtpl/activate     — Activate/Reconnect STB on GTPL
POST /api/gtpl/renew        — Renew STB subscription on GTPL
POST /api/gtpl/change-plan  — Change STB package on GTPL
GET  /api/gtpl/status/{stb} — Get GTPL status for an STB
GET  /api/gtpl/plans        — List available GTPL plan codes
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from deps import get_current_user
from services.gtpl_client import (
    suspend_stb, activate_stb, renew_stb,
    change_package, get_stb_status, GTPL_PLANS
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/gtpl", tags=["gtpl"])


# ── Request Models ────────────────────────────────────────────────

class StbRequest(BaseModel):
    stb_no: str
    customer_id: Optional[str] = None  # for logging only

class RenewRequest(BaseModel):
    stb_no: str
    months: int = 1
    customer_id: Optional[str] = None

class ChangePlanRequest(BaseModel):
    stb_no: str
    plan_code: str
    customer_id: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────

@router.post("/suspend")
def gtpl_suspend(data: StbRequest, current_user=Depends(get_current_user)):
    """Suspend STB on GTPL Saathi (cuts signal)."""
    if not data.stb_no or not data.stb_no.startswith("338"):
        raise HTTPException(400, "Only GTPL STBs (338xxxxx) can be managed via this portal")
    log.info(f"GTPL suspend: {data.stb_no} by {current_user['username']}")
    result = suspend_stb(data.stb_no)
    if not result["success"]:
        raise HTTPException(502, result["message"])
    return result


@router.post("/activate")
def gtpl_activate(data: StbRequest, current_user=Depends(get_current_user)):
    """Activate/reconnect STB on GTPL Saathi (restores signal)."""
    if not data.stb_no or not data.stb_no.startswith("338"):
        raise HTTPException(400, "Only GTPL STBs (338xxxxx) can be managed via this portal")
    log.info(f"GTPL activate: {data.stb_no} by {current_user['username']}")
    result = activate_stb(data.stb_no)
    if not result["success"]:
        raise HTTPException(502, result["message"])
    return result


@router.post("/renew")
def gtpl_renew(data: RenewRequest, current_user=Depends(get_current_user)):
    """Renew STB subscription on GTPL (deducts from LCO wallet)."""
    if not data.stb_no or not data.stb_no.startswith("338"):
        raise HTTPException(400, "Only GTPL STBs (338xxxxx) supported")
    if data.months not in [1, 2, 3, 6, 12]:
        raise HTTPException(400, "months must be 1, 2, 3, 6, or 12")
    log.info(f"GTPL renew: {data.stb_no} x{data.months}mo by {current_user['username']}")
    result = renew_stb(data.stb_no, data.months)
    if not result["success"]:
        raise HTTPException(502, result["message"])
    return result


@router.post("/change-plan")
def gtpl_change_plan(data: ChangePlanRequest, current_user=Depends(get_current_user)):
    """Change STB package on GTPL Saathi."""
    if not data.stb_no or not data.stb_no.startswith("338"):
        raise HTTPException(400, "Only GTPL STBs (338xxxxx) supported")
    log.info(f"GTPL change-plan: {data.stb_no} → {data.plan_code} by {current_user['username']}")
    result = change_package(data.stb_no, data.plan_code)
    if not result["success"]:
        raise HTTPException(502, result["message"])
    return result


@router.get("/status/{stb_no}")
def gtpl_status(stb_no: str, current_user=Depends(get_current_user)):
    """Get current GTPL portal status for an STB."""
    if not stb_no.startswith("338"):
        raise HTTPException(400, "Only GTPL STBs (338xxxxx) supported")
    result = get_stb_status(stb_no)
    if not result["success"]:
        raise HTTPException(502, result["message"])
    return result


@router.get("/plans")
def gtpl_plan_list(current_user=Depends(get_current_user)):
    """List all available GTPL plan codes."""
    return {"plans": [{"name": k, "code": v} for k, v in GTPL_PLANS.items()]}
