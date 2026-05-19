     1|     1|from fastapi import APIRouter, Depends, HTTPException
     2|     2|from pydantic import BaseModel
     3|     3|from typing import Optional
     4|     4|
     5|     5|from models.base import get_db
     6|from conn import get_conn
     7|     6|from deps_orm import _op_flt, get_current_user, apply_op_filter, op_id
     8|     7|
     9|     8|router = APIRouter(prefix="/api/sms", tags=["SMS"])
    10|     9|
    11|    10|class SMSSendRequest(BaseModel):
    12|    11|    customer_id: Optional[str] = None
    13|    12|    phone: str
    14|    13|    message: str
    15|    14|    provider: Optional[str] = "whatsapp"
    16|    15|
    17|    16|
    18|    17|@router.post("/send")
    19|    18|def send_sms(
    20|    19|    data: SMSSendRequest,
    21|    20|    current_user=Depends(get_current_user),
    22|    21|):
    23|    22|    """Send SMS/WhatsApp notification. Currently logs to DB; integrate actual provider later."""
    24|    23|    _oid = op_id(current_user)
    25|    24|    with get_conn() as conn:
    26|    25|        conn.execute(
    27|    26|            """INSERT INTO sms_log (customer_id, phone, message, status, provider, operator_id)
    28|    27|               VALUES (?, ?, ?, ?, ?, ?)""",
    29|    28|            (data.customer_id, data.phone, data.message, "sent", data.provider, _oid),
    30|    29|        )
    31|    30|        conn.commit()
    32|    31|
    33|    32|        flt = _op_flt(current_user)
    34|    33|        log = conn.execute(
    35|    34|            f"SELECT * FROM sms_log WHERE phone = ? AND {flt} ORDER BY sent_at DESC LIMIT 1",
    36|    35|            (data.phone,),
    37|    36|        ).fetchone()
    38|    37|
    39|    38|    return {
    40|    39|        "success": True,
    41|    40|        "message": f"Message sent to {data.phone} via {data.provider}",
    42|    41|        "log_id": log["id"] if log else None,
    43|    42|        "note": "SMS gateway integration pending - currently logged only",
    44|    43|    }
    45|    44|
    46|    45|
    47|    46|@router.get("/logs")
    48|    47|def sms_logs(
    49|    48|    customer_id: Optional[str] = None,
    50|    49|    limit: int = 50,
    51|    50|    current_user=Depends(get_current_user),
    52|    51|):
    53|    52|    flt = _op_flt(current_user)
    54|    53|    with get_conn() as conn:
    55|    54|        query = f"SELECT * FROM sms_log WHERE {flt}"
    56|    55|        params = []
    57|    56|
    58|    57|        if customer_id:
    59|    58|            query += " AND customer_id = ?"
    60|    59|            params.append(customer_id)
    61|    60|
    62|    61|        query += " ORDER BY sent_at DESC LIMIT ?"
    63|    62|        params.append(limit)
    64|    63|
    65|    64|        rows = conn.execute(query, params).fetchall()
    66|    65|
    67|    66|    return {"logs": [dict(r) for r in rows]}
    68|    67|