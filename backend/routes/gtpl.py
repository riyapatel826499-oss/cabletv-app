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

from deps import get_current_user, require_role

log = logging.getLogger(__name__)
router = APIRouter(prefix="/gtpl", tags=["gtpl"])

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
async def gtpl_suspend(data: StbRequest, current_user=Depends(require_role('master', 'admin', 'support'))):
    """Suspend STB on GTPL Saathi (cuts signal)."""
    if not data.stb_no or not data.stb_no.startswith("338"):
        raise HTTPException(400, "Only GTPL STBs (338xxxxx) can be managed via this portal")
    log.info(f"GTPL suspend: {data.stb_no} by {current_user['username']}")
    return await _proxy("POST", "/suspend", {"stb_no": data.stb_no})


@router.post("/activate")
async def gtpl_activate(data: StbRequest, current_user=Depends(require_role('master', 'admin', 'support'))):
    """Activate/reconnect STB on GTPL Saathi (restores signal)."""
    if not data.stb_no or not data.stb_no.startswith("338"):
        raise HTTPException(400, "Only GTPL STBs (338xxxxx) can be managed via this portal")
    log.info(f"GTPL activate: {data.stb_no} by {current_user['username']}")
    return await _proxy("POST", "/activate", {"stb_no": data.stb_no})


@router.post("/renew")
async def gtpl_renew(data: RenewRequest, current_user=Depends(require_role('master', 'admin', 'support'))):
    """Renew STB subscription on GTPL (deducts from LCO wallet)."""
    if not data.stb_no or not data.stb_no.startswith("338"):
        raise HTTPException(400, "Only GTPL STBs (338xxxxx) supported")
    if data.months not in [1, 2, 3, 6, 12]:
        raise HTTPException(400, "months must be 1, 2, 3, 6, or 12")
    log.info(f"GTPL renew: {data.stb_no} x{data.months}mo by {current_user['username']}")
    return await _proxy("POST", "/renew", {"stb_no": data.stb_no, "months": data.months})


@router.post("/change-plan")
async def gtpl_change_plan(data: ChangePlanRequest, current_user=Depends(require_role('master', 'admin', 'support'))):
    """Change STB package on GTPL Saathi."""
    if not data.stb_no or not data.stb_no.startswith("338"):
        raise HTTPException(400, "Only GTPL STBs (338xxxxx) supported")
    log.info(f"GTPL change-plan: {data.stb_no} → {data.plan_code} by {current_user['username']}")
    return await _proxy("POST", "/change-package", {"stb_no": data.stb_no, "plan_code": data.plan_code})


@router.get("/status/{stb_no}")
async def gtpl_status(stb_no: str, current_user=Depends(require_role('master', 'admin', 'support'))):
    """Get current GTPL portal status for an STB."""
    if not stb_no.startswith("338"):
        raise HTTPException(400, "Only GTPL STBs (338xxxxx) supported")
    return await _proxy("GET", f"/status/{stb_no}")


@router.get("/plans")
def gtpl_plan_list(current_user=Depends(require_role('master', 'admin', 'support'))):
    """List all available GTPL plan codes."""
    return {"plans": [{"name": k, "code": v} for k, v in GTPL_PLANS.items()]}
