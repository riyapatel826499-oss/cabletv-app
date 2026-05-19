     1|from fastapi import APIRouter, Depends, HTTPException
     2|from pydantic import BaseModel
     3|from typing import Optional
     4|
     5|from models.base import get_db
from conn import get_conn
     6|from deps_orm import get_current_user, apply_op_filter, op_id
     7|
     8|router = APIRouter(prefix="/api/sms", tags=["SMS"])
     9|
    10|class SMSSendRequest(BaseModel):
    11|    customer_id: Optional[str] = None
    12|    phone: str
    13|    message: str
    14|    provider: Optional[str] = "whatsapp"
    15|
    16|
    17|@router.post("/send")
    18|def send_sms(
    19|    data: SMSSendRequest,
    20|    current_user=Depends(get_current_user),
    21|):
    22|    """Send SMS/WhatsApp notification. Currently logs to DB; integrate actual provider later."""
    23|    _oid = op_id(current_user)
    24|    with get_conn() as conn:
    25|        conn.execute(
    26|            """INSERT INTO sms_log (customer_id, phone, message, status, provider, operator_id)
    27|               VALUES (?, ?, ?, ?, ?, ?)""",
    28|            (data.customer_id, data.phone, data.message, "sent", data.provider, _oid),
    29|        )
    30|        conn.commit()
    31|
    32|        flt = op_filter(current_user)
    33|        log = conn.execute(
    34|            f"SELECT * FROM sms_log WHERE phone = ? AND {flt} ORDER BY sent_at DESC LIMIT 1",
    35|            (data.phone,),
    36|        ).fetchone()
    37|
    38|    return {
    39|        "success": True,
    40|        "message": f"Message sent to {data.phone} via {data.provider}",
    41|        "log_id": log["id"] if log else None,
    42|        "note": "SMS gateway integration pending - currently logged only",
    43|    }
    44|
    45|
    46|@router.get("/logs")
    47|def sms_logs(
    48|    customer_id: Optional[str] = None,
    49|    limit: int = 50,
    50|    current_user=Depends(get_current_user),
    51|):
    52|    flt = op_filter(current_user)
    53|    with get_conn() as conn:
    54|        query = f"SELECT * FROM sms_log WHERE {flt}"
    55|        params = []
    56|
    57|        if customer_id:
    58|            query += " AND customer_id = ?"
    59|            params.append(customer_id)
    60|
    61|        query += " ORDER BY sent_at DESC LIMIT ?"
    62|        params.append(limit)
    63|
    64|        rows = conn.execute(query, params).fetchall()
    65|
    66|    return {"logs": [dict(r) for r in rows]}
    67|