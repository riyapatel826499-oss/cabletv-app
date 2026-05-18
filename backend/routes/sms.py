from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from models.base import get_db
from deps_orm import get_current_user, apply_op_filter, op_id

router = APIRouter(prefix="/api/sms", tags=["SMS"])

class SMSSendRequest(BaseModel):
    customer_id: Optional[str] = None
    phone: str
    message: str
    provider: Optional[str] = "whatsapp"


@router.post("/send")
def send_sms(
    data: SMSSendRequest,
    current_user=Depends(get_current_user),
):
    """Send SMS/WhatsApp notification. Currently logs to DB; integrate actual provider later."""
    _oid = op_id(current_user)
    with get_db() as conn:
        conn.execute(
            """INSERT INTO sms_log (customer_id, phone, message, status, provider, operator_id)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (data.customer_id, data.phone, data.message, "sent", data.provider, _oid),
        )
        conn.commit()

        flt = op_filter(current_user)
        log = conn.execute(
            f"SELECT * FROM sms_log WHERE phone = ? AND {flt} ORDER BY sent_at DESC LIMIT 1",
            (data.phone,),
        ).fetchone()

    return {
        "success": True,
        "message": f"Message sent to {data.phone} via {data.provider}",
        "log_id": log["id"] if log else None,
        "note": "SMS gateway integration pending - currently logged only",
    }


@router.get("/logs")
def sms_logs(
    customer_id: Optional[str] = None,
    limit: int = 50,
    current_user=Depends(get_current_user),
):
    flt = op_filter(current_user)
    with get_db() as conn:
        query = f"SELECT * FROM sms_log WHERE {flt}"
        params = []

        if customer_id:
            query += " AND customer_id = ?"
            params.append(customer_id)

        query += " ORDER BY sent_at DESC LIMIT ?"
        params.append(limit)

        rows = conn.execute(query, params).fetchall()

    return {"logs": [dict(r) for r in rows]}
