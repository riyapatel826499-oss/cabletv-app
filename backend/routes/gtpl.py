"""
GTPL Integration Routes — Proxy to WSL Playwright Service
The curl-based gtpl_client.py was broken (ASP.NET disabled dropdowns).
All GTPL operations now go through a real browser (Playwright) running on WSL.

POST /api/gtpl/suspend      — Suspend STB on GTPL
POST /api/gtpl/activate     — Activate/Reconnect STB on GTPL
POST /api/gtpl/renew        — Renew STB subscription on GTPL
POST /api/gtpl/change-plan  — Change STB package on GTPL
GET  /api/gtpl/status/{stb} — Get GTPL status for an STB
GET  /api/gtpl/plans        — List available GTPL plan codes
"""
import os, logging, httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from deps_orm import get_current_user, require_role, get_db
from conn import get_conn
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)
router = APIRouter(prefix="/gtpl", tags=["gtpl"])


def _assert_stb_ownership(stb_no: str, current_user: dict):
    """Defense-in-depth: prevent an operator from managing another operator's STB.

    Fails open (allows) for master, for STBs not found in our DB, and for legacy
    connections with a NULL operator_id — so existing operations are never broken.
    Only blocks the clear cross-tenant case (STB owned by a different operator).
    """
    oid = current_user.get("operator_id")
    if current_user.get("role") == "master" or oid is None:
        return
    try:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT operator_id FROM connections WHERE stb_no = ? LIMIT 1", [stb_no]
            ).fetchone()
    except Exception:
        return  # lookup failure must not block operations
    if row and row["operator_id"] is not None and row["operator_id"] != oid:
        raise HTTPException(403, "This STB belongs to a different operator")

# WSL Playwright service URL (via Cloudflare tunnel)
GTPL_SERVICE_URL = os.environ.get("GTPL_SERVICE_URL", "")
GTPL_SERVICE_TOKEN = os.environ.get("GTPL_SERVICE_TOKEN", "gtpl_secret_2026")

# Fallback plan codes (for /plans endpoint if service is down)
GTPL_PLANS = {
    "TAMIL PRIME": "PRIME_CC",
    "TAMIL POWER": "POWER_CC",
    "TAMIL ROYAL HD": "ROYALHD_CC",
    "TAMIL POWER PLUS": "POWRPLS_CC",
    "TAMIL MALAYALAM POWER PLUS": "TP_TMML_PP",
    "TAMIL TELUGU POWER PLUS": "TP_TMTL_PP",
    "TAMIL KANNADA POWER PLUS": "TP_TMTP_PP",
    "TAMIL HINDI POWER PLUS": "TP_TMHN_PP",
    "TAMIL FTA": "FTA_CC",
}

_headers = {"Authorization": f"Bearer {GTPL_SERVICE_TOKEN}"}
_timeout = httpx.Timeout(120.0, connect=10.0)  # GTPL ops can take 60-90s

# Admin phone for low-balance WhatsApp alerts
ADMIN_PHONE = os.environ.get("ADMIN_PHONE", "919787225577")


def _notify_low_wallet(db, balance: float, stb_no: str = None, operator_id: int = 1):
    """Create app notification + WhatsApp alert when GTPL wallet is low."""
    from routes.notifications import _create_notification

    stb_ctx = f" (while activating STB {stb_no})" if stb_no else ""
    msg = (
        f"GTPL LCO wallet balance is LOW: Rs {balance:.2f}"
        f"{stb_ctx}. Recharge needed — renewals will fail."
    )

    # 1. App notification
    _create_notification(
        db,
        type="wallet_alert",
        title="GTPL Wallet Low Balance",
        message=msg,
        status="error",
        mso="GTPL",
        stb_no=stb_no,
        operator_id=operator_id,
    )

    # 2. WhatsApp alert to admin
    try:
        import json, urllib.request
        wa_url = "http://localhost:3000/send"
        payload = json.dumps({
            "jid": f"{ADMIN_PHONE}@s.whatsapp.net",
            "message": f"⚠️ GTPL Wallet Low Balance\n\nBalance: Rs {balance:.2f}\n{stb_ctx or 'Auto-renewals will fail until recharged.'}\n\nRecharge GTPL LCO wallet immediately."
        }).encode()
        req = urllib.request.Request(wa_url, data=payload,
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass  # WA bridge may be down — app notification is the primary channel


async def _proxy(method: str, path: str, json_data: dict = None) -> dict:
    """Proxy request to WSL Playwright service."""
    if not GTPL_SERVICE_URL:
        raise HTTPException(503, "GTPL service not configured (GTPL_SERVICE_URL not set)")
    
    url = f"{GTPL_SERVICE_URL.rstrip('/')}{path}"
    try:
        async with httpx.AsyncClient(timeout=_timeout) as client:
            if method == "GET":
                resp = await client.get(url, headers=_headers)
            else:
                resp = await client.post(url, json=json_data, headers=_headers)
        
        if resp.status_code == 401:
            raise HTTPException(503, "GTPL service auth failed")
        
        data = resp.json()
        if resp.status_code >= 400:
            raise HTTPException(resp.status_code, data.get("detail", str(data)))
        return data
    
    except httpx.ConnectError:
        raise HTTPException(503, "GTPL Playwright service is down — WSL may be offline")
    except httpx.TimeoutException:
        raise HTTPException(504, "GTPL operation timed out — browser may be stuck")
    except HTTPException:
        raise
    except Exception as e:
        log.exception(f"GTPL proxy error: {e}")
        raise HTTPException(502, f"GTPL service error: {str(e)}")


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
async def gtpl_suspend(data: StbRequest, current_user=Depends(require_role('admin', 'support')), db: Session = Depends(get_db)):
    """Suspend STB on GTPL Saathi (cuts signal)."""
    if not data.stb_no or not data.stb_no.startswith("338"):
        raise HTTPException(400, "Only GTPL STBs (338xxxxx) can be managed via this portal")
    _assert_stb_ownership(data.stb_no, current_user)
    log.info(f"GTPL suspend: {data.stb_no} by {current_user['username']}")
    result = await _proxy("POST", "/suspend", {"stb_no": data.stb_no})
    # Create notification
    from routes.notifications import _create_notification
    _create_notification(
        db,
        type="suspension",
        title=f"STB {data.stb_no} suspended on GTPL",
        message=f"Signal cut for STB {data.stb_no} by {current_user.get('name', current_user['username'])}",
        status="success" if result.get("success") else "error",
        mso="GTPL",
        stb_no=data.stb_no,
        operator_id=current_user.get("operator_id", 1),
    )
    return result


@router.post("/activate")
async def gtpl_activate(data: StbRequest, current_user=Depends(require_role('admin', 'support')), db: Session = Depends(get_db)):
    """Activate/reconnect STB on GTPL Saathi (restores signal).

    If the subscription has expired, activation alone won't restore signal.
    The system will detect this and auto-renew (1 month) instead of falsely
    reporting success.
    """
    if not data.stb_no or not data.stb_no.startswith("338"):
        raise HTTPException(400, "Only GTPL STBs (338xxxxx) can be managed via this portal")
    _assert_stb_ownership(data.stb_no, current_user)
    log.info(f"GTPL activate: {data.stb_no} by {current_user['username']}")
    result = await _proxy("POST", "/activate", {"stb_no": data.stb_no})

    from routes.notifications import _create_notification

    # If activation detected that subscription is expired → auto-renew
    if result.get("needs_renewal"):
        log.info(f"STB {data.stb_no}: subscription expired, auto-renewing 1 month...")
        renew_result = await _proxy("POST", "/renew", {"stb_no": data.stb_no, "months": 1})
        if renew_result.get("success"):
            _create_notification(
                db,
                type="activation",
                title=f"STB {data.stb_no} renewed on GTPL (auto)",
                message=(
                    f"Subscription expired — auto-renewed 1 month for STB {data.stb_no}. "
                    f"Signal restored. {renew_result.get('message', '')}"
                ),
                status="success",
                mso="GTPL",
                stb_no=data.stb_no,
                operator_id=current_user.get("operator_id", 1),
            )
            return {
                "success": True,
                "message": f"STB {data.stb_no} renewed (auto). Signal restored.",
                "auto_renewed": True,
                **renew_result,
            }
        else:
            # Auto-renewal failed — check if due to insufficient wallet balance
            if renew_result.get("insufficient_balance"):
                _notify_low_wallet(
                    db,
                    balance=0,  # exact balance unknown from proxy; message says it
                    stb_no=data.stb_no,
                    operator_id=current_user.get("operator_id", 1),
                )
                _create_notification(
                    db,
                    type="activation",
                    title=f"STB {data.stb_no}: Activation FAILED — GTPL wallet low",
                    message=(
                        f"Subscription expired and auto-renewal failed: "
                        f"{renew_result.get('message', 'Insufficient wallet balance')}. "
                        f"Signal NOT restored. Recharge GTPL wallet and retry."
                    ),
                    status="error",
                    mso="GTPL",
                    stb_no=data.stb_no,
                    operator_id=current_user.get("operator_id", 1),
                )
            else:
                _create_notification(
                    db,
                    type="activation",
                    title=f"STB {data.stb_no}: Renewal needed",
                    message=(
                        f"Activation flag set but subscription expired. "
                        f"Auto-renewal failed: {renew_result.get('message', 'unknown')}. "
                        f"Manual renewal required."
                    ),
                    status="error",
                    mso="GTPL",
                    stb_no=data.stb_no,
                    operator_id=current_user.get("operator_id", 1),
                )
            return renew_result

    # Normal activation result
    _create_notification(
        db,
        type="activation",
        title=f"STB {data.stb_no} activated on GTPL",
        message=f"Signal restored for STB {data.stb_no} by {current_user.get('name', current_user['username'])}",
        status="success" if result.get("success") else "error",
        mso="GTPL",
        stb_no=data.stb_no,
        operator_id=current_user.get("operator_id", 1),
    )
    return result


@router.post("/renew")
async def gtpl_renew(data: RenewRequest, current_user=Depends(require_role('admin', 'support')), db: Session = Depends(get_db)):
    """Renew STB subscription on GTPL (deducts from LCO wallet)."""
    if not data.stb_no or not data.stb_no.startswith("338"):
        raise HTTPException(400, "Only GTPL STBs (338xxxxx) supported")
    if data.months not in [1, 2, 3, 6, 12]:
        raise HTTPException(400, "months must be 1, 2, 3, 6, or 12")
    _assert_stb_ownership(data.stb_no, current_user)
    log.info(f"GTPL renew: {data.stb_no} x{data.months}mo by {current_user['username']}")
    result = await _proxy("POST", "/renew", {"stb_no": data.stb_no, "months": data.months})
    from routes.notifications import _create_notification

    # Check for insufficient balance
    if not result.get("success") and result.get("insufficient_balance"):
        _notify_low_wallet(db, balance=0, stb_no=data.stb_no,
                           operator_id=current_user.get("operator_id", 1))

    _create_notification(
        db,
        type="renew",
        title=f"STB {data.stb_no} renewed on GTPL",
        message=f"{data.months} month(s) renewal for STB {data.stb_no} by {current_user.get('name', current_user['username'])}. {result.get('message', '')}",
        status="success" if result.get("success") else "error",
        mso="GTPL",
        stb_no=data.stb_no,
        operator_id=current_user.get("operator_id", 1),
    )
    return result


@router.post("/change-plan")
async def gtpl_change_plan(data: ChangePlanRequest, current_user=Depends(require_role('admin', 'support'))):
    """Change STB package on GTPL Saathi."""
    if not data.stb_no or not data.stb_no.startswith("338"):
        raise HTTPException(400, "Only GTPL STBs (338xxxxx) supported")
    _assert_stb_ownership(data.stb_no, current_user)
    log.info(f"GTPL change-plan: {data.stb_no} → {data.plan_code} by {current_user['username']}")
    return await _proxy("POST", "/change-package", {"stb_no": data.stb_no, "plan_code": data.plan_code})


@router.get("/status/{stb_no}")
async def gtpl_status(stb_no: str, current_user=Depends(require_role('admin', 'support'))):
    """Get current GTPL portal status for an STB."""
    if not stb_no.startswith("338"):
        raise HTTPException(400, "Only GTPL STBs (338xxxxx) supported")
    _assert_stb_ownership(stb_no, current_user)
    return await _proxy("GET", f"/status/{stb_no}")


@router.get("/wallet")
async def gtpl_wallet(current_user=Depends(require_role('admin', 'support'))):
    """Get current GTPL LCO wallet balance."""
    result = await _proxy("GET", "/wallet", None)
    return result


@router.get("/plans")
def gtpl_plan_list(current_user=Depends(require_role('admin', 'support'))):
    """List all available GTPL plan codes."""
    return {"plans": [{"name": k, "code": v} for k, v in GTPL_PLANS.items()]}
