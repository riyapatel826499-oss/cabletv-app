from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from deps import get_db, get_current_user

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
    with get_db() as conn:
        conn.execute(
            """INSERT INTO sms_log (customer_id, phone, message, status, provider)
               VALUES (?, ?, ?, ?, ?)""",
            (data.customer_id, data.phone, data.message, "sent", data.provider),
        )
        conn.commit()

        log = conn.execute(
            "SELECT * FROM sms_log WHERE phone = ? ORDER BY sent_at DESC LIMIT 1",
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
    with get_db() as conn:
        query = "SELECT * FROM sms_log WHERE 1=1"
        params = []

        if customer_id:
            query += " AND customer_id = ?"
            params.append(customer_id)

        query += " ORDER BY sent_at DESC LIMIT ?"
        params.append(limit)

        rows = conn.execute(query, params).fetchall()

    return {"logs": [dict(r) for r in rows]}
