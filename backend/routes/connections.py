from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from deps import get_db, get_current_user

router = APIRouter(prefix="/api", tags=["Connections"])


def _detect_network(stb_no: str) -> str:
    """Auto-detect network from STB number prefix."""
    stb = str(stb_no).strip()
    if stb.startswith("172") or stb.startswith("173"):
        return "TACTV"
    elif stb.startswith("5000"):
        return "SCV"
    else:
        return "GTPL"


class ConnectionCreate(BaseModel):
    stb_no: str
    can_id: Optional[str] = None
    mso: Optional[str] = "GTPL"
    service_type: Optional[str] = "Cable"
    billing_type: Optional[str] = "Prepaid"
    status: Optional[str] = "Active"


def _plan_to_dict(row):
    return {
        "id": row["id"],
        "customer_id": row["customer_id"],
        "connection_id": row["connection_id"],
        "plan_id": row["plan_id"],
        "plan_name": row["plan_name"] if "plan_name" in row.keys() else None,
        "amount": row["amount"],
        "start_date": row["start_date"],
        "expiry_date": row["expiry_date"],
        "status": row["status"],
    }


@router.get("/customers/{customer_id}/plans")
def get_customer_plans(customer_id: str, current_user=Depends(get_current_user)):
    with get_db() as conn:
        plans = conn.execute("""
            SELECT cp.*, p.name as plan_name
            FROM customer_plans cp
            LEFT JOIN plans p ON cp.plan_id = p.id
            WHERE cp.customer_id = ?
            ORDER BY cp.created_at DESC
        """, [customer_id]).fetchall()
        return {"plans": [_plan_to_dict(r) for r in plans]}


@router.get("/customers/{customer_id}/payment-history")
def get_customer_payment_history(customer_id: str, current_user=Depends(get_current_user)):
    with get_db() as conn:
        # Local payments
        local = conn.execute("""
            SELECT p.*, c.name as customer_name
            FROM payments p
            LEFT JOIN customers c ON p.customer_id = c.customer_id
            WHERE p.customer_id = ?
            ORDER BY p.collected_at DESC LIMIT 50
        """, [customer_id]).fetchall()
        # Paypakka payments
        ppay = conn.execute("""
            SELECT pp.*, e.emp_name as collector_name
            FROM paypakka_payments pp
            LEFT JOIN paypakka_employees e ON pp.emp_ref_id = e.emp_ref_id
            WHERE pp.customer_id = ?
            ORDER BY pp.paypakka_created_at DESC LIMIT 50
        """, [customer_id]).fetchall()

        payments = []
        for p in local:
            payments.append({
                "id": f"LOCAL-{p['id']}", "amount": p["amount"], "mode": p["payment_mode"],
                "date": p["collected_at"], "type": "Local", "notes": p["notes"]
            })
        for p in ppay:
            payments.append({
                "id": f"PP-{p['id']}", "amount": p["collection_amount"], "mode": p["payment_type"],
                "date": p["paypakka_created_at"], "type": "Paypakka", "collector": p["collector_name"] if "collector_name" in p.keys() else ""
            })
        payments.sort(key=lambda x: x.get("date") or "", reverse=True)
        return {"payments": payments, "total": len(payments)}


@router.get("/customers/{customer_id}/sms-history")
def get_customer_sms_history(customer_id: str, current_user=Depends(get_current_user)):
    with get_db() as conn:
        msgs = conn.execute("""
            SELECT * FROM sms_log WHERE customer_id = ?
            ORDER BY sent_at DESC LIMIT 50
        """, [customer_id]).fetchall()
        return {"sms_history": [dict(m) for m in msgs]}


@router.post("/customers/{customer_id}/connections")
def add_connection(customer_id: str, data: ConnectionCreate, current_user=Depends(get_current_user)):
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM customers WHERE customer_id = ?", [customer_id]).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Customer not found")

        # Validate STB uniqueness
        dup = conn.execute("""
            SELECT c.customer_id, c.name FROM connections con
            JOIN customers c ON con.customer_id = c.customer_id
            WHERE con.stb_no = ? AND con.status = 'Active'
        """, [data.stb_no]).fetchone()
        if dup:
            raise HTTPException(status_code=400, detail=f"STB {data.stb_no} is already assigned to {dup['name']} ({dup['customer_id']})")

        # Free up STB from any surrendered connections so UNIQUE constraint passes
        # Can't set stb_no = NULL due to NOT NULL constraint — use unique marker instead
        surrendered_rows = conn.execute(
            "SELECT id FROM connections WHERE stb_no = ? AND status = 'Surrendered'",
            [data.stb_no]
        ).fetchall()
        for row in surrendered_rows:
            conn.execute(
                "UPDATE connections SET stb_no = 'SURRENDERED-' || ? WHERE id = ?",
                [row['id'], row['id']]
            )

        network = _detect_network(data.stb_no)

        conn.execute("""
            INSERT INTO connections (customer_id, stb_no, can_id, mso, service_type, billing_type, status, network, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, [customer_id, data.stb_no, data.can_id, data.mso, data.service_type, data.billing_type, data.status, network])
        conn.commit()
        return {"message": "Connection added successfully", "network": network}
