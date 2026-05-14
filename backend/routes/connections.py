from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from deps import get_db, get_current_user, op_filter, op_id

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
        _opf = op_filter(current_user)
        plans = conn.execute(f"""
            SELECT cp.*, p.name as plan_name
            FROM customer_plans cp
            LEFT JOIN plans p ON cp.plan_id = p.id
            WHERE cp.customer_id = ? AND {op_filter(current_user, 'cp.')}
            ORDER BY cp.created_at DESC
        """, [customer_id]).fetchall()
        return {"plans": [_plan_to_dict(r) for r in plans]}


@router.get("/customers/{customer_id}/payment-history")
def get_customer_payment_history(customer_id: str, current_user=Depends(get_current_user)):
    with get_db() as conn:
        _opf = op_filter(current_user)
        # Local payments
        local = conn.execute(f"""
            SELECT p.*, c.name as customer_name
            FROM payments p
            LEFT JOIN customers c ON p.customer_id = c.customer_id
            WHERE p.customer_id = ? AND {op_filter(current_user, 'p.')}
            ORDER BY p.collected_at DESC LIMIT 50
        """, [customer_id]).fetchall()
        # Paypakka payments
        ppay = conn.execute(f"""
            SELECT pp.*, e.emp_name as collector_name
            FROM paypakka_payments pp
            LEFT JOIN paypakka_employees e ON pp.emp_ref_id = e.emp_ref_id
            WHERE pp.customer_id = ? AND {op_filter(current_user, 'pp.')}
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
        _opf = op_filter(current_user)
        msgs = conn.execute(f"""
            SELECT * FROM sms_log WHERE customer_id = ? AND {_opf}
            ORDER BY sent_at DESC LIMIT 50
        """, [customer_id]).fetchall()
        return {"sms_history": [dict(m) for m in msgs]}


@router.post("/customers/{customer_id}/connections")
def add_connection(customer_id: str, data: ConnectionCreate, current_user=Depends(get_current_user)):
    _opf = op_filter(current_user)
    _opid = op_id(current_user)
    with get_db() as conn:
        existing = conn.execute(f"SELECT * FROM customers WHERE customer_id = ? AND {_opf}", [customer_id]).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Customer not found")

        # Validate STB uniqueness
        dup = conn.execute(f"""
            SELECT c.customer_id, c.name FROM connections con
            JOIN customers c ON con.customer_id = c.customer_id
            WHERE con.stb_no = ? AND con.status = 'Active' AND {op_filter(current_user, 'con.')}
        """, [data.stb_no]).fetchone()
        if dup:
            raise HTTPException(status_code=400, detail=f"STB {data.stb_no} is already assigned to {dup['name']} ({dup['customer_id']})")

        # Free up STB from any surrendered connections so UNIQUE constraint passes
        # Can't set stb_no = NULL due to NOT NULL constraint — use unique marker instead
        surrendered_rows = conn.execute(
            f"SELECT id FROM connections WHERE stb_no = ? AND status = 'Surrendered' AND {_opf}",
            [data.stb_no]
        ).fetchall()
        for row in surrendered_rows:
            conn.execute(
                "UPDATE connections SET stb_no = 'SURRENDERED-' || ? WHERE id = ?",
                [row['id'], row['id']]
            )

        network = _detect_network(data.stb_no)

        conn.execute(f"""
            INSERT INTO connections (customer_id, stb_no, can_id, mso, service_type, billing_type, status, network, created_at, operator_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), {_opid or 'NULL'})
        """, [customer_id, data.stb_no, data.can_id, data.mso, data.service_type, data.billing_type, data.status, network])
        conn.commit()
        return {"ok": True, "message": "Connection added"}


# ── Temp Disconnect: Reclaim STB from customer (no refund, reconnectable free) ──

class TempDisconnectRequest(BaseModel):
    connection_id: int
    reason: Optional[str] = None

@router.post("/connections/temp-disconnect")
def temp_disconnect(data: TempDisconnectRequest, current_user=Depends(get_current_user)):
    """Mark a connection as 'Temp Disconnected' — STB reclaimed, customer stays Active.
    STB becomes available in inventory for reassignment. No refund given.
    Customer can reconnect anytime without extra charges."""
    if current_user["role"] not in ("admin", "master", "support", "collection_agent"):
        raise HTTPException(status_code=403, detail="Not authorized")
    
    with get_db() as conn:
        _opf = op_filter(current_user, "con.")
        _of = op_filter(current_user)
        _opid = op_id(current_user)
        
        # Get the connection
        row = conn.execute(f"""
            SELECT con.*, c.name as customer_name, c.customer_id
            FROM connections con
            JOIN customers c ON con.customer_id = c.customer_id
            WHERE con.id = ? AND {_opf}
        """, [data.connection_id]).fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Connection not found")
        if row["status"] != "Active":
            raise HTTPException(status_code=400, detail=f"Connection is already '{row['status']}', only Active connections can be temp disconnected")
        
        stb_no = row["stb_no"]
        customer_id = row["customer_id"]
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # 1. Update connection status to Temp Disconnected
        conn.execute(f"""
            UPDATE connections SET status = 'Temp Disconnected'
            WHERE id = ? AND {_opf}
        """, [data.connection_id])
        
        # Try to add notes/disconnect_date if columns exist
        try:
            conn.execute(f"""
                UPDATE connections SET notes = COALESCE(notes, '') || ?,
                disconnect_date = ?, updated_at = ?
                WHERE id = ? AND {_opf}
            """, [f"\n[Temp Disconnected: {now}" + (f" — {data.reason}" if data.reason else "") + "]", now, now, data.connection_id])
        except Exception:
            pass  # Columns don't exist yet, that's OK
        
        # 2. Release STB number — rename to TEMPDISC-{id} so UNIQUE constraint passes
        conn.execute("UPDATE connections SET stb_no = 'TEMPDISC-' || ? WHERE id = ?",
                     [data.connection_id, data.connection_id])
        
        # 3. Add STB to inventory as 'available'
        cust_oid = _opid or 1
        inv = conn.execute("SELECT id FROM stb_inventory WHERE stb_no = ?", [stb_no]).fetchone()
        note = f"Reclaimed from {row['customer_name']} ({customer_id}) — temp disconnect"
        if inv:
            conn.execute("UPDATE stb_inventory SET status = 'available', notes = ?, operator_id = ? WHERE stb_no = ?",
                        [note, cust_oid, stb_no])
        else:
            conn.execute("""INSERT INTO stb_inventory (stb_no, status, added_at, notes, operator_id)
                           VALUES (?, 'available', ?, ?, ?)""",
                        [stb_no, now, note, cust_oid])
        
        # 4. Check if customer has any remaining Active connections
        remaining = conn.execute(f"""
            SELECT COUNT(*) as cnt FROM connections
            WHERE customer_id = ? AND status = 'Active' AND {_opf}
        """, [customer_id]).fetchone()
        
        # If no active connections left, mark customer as 'Temp Disconnected' too
        if remaining["cnt"] == 0:
            conn.execute(f"UPDATE customers SET status = 'Temp Disconnected' WHERE customer_id = ? AND {_of}",
                        [customer_id])
        
        conn.commit()
        return {
            "ok": True,
            "message": f"STB {stb_no} reclaimed from {row['customer_name']}. Customer can reconnect anytime without charges.",
            "stb_no": stb_no,
            "customer_name": row["customer_name"],
            "customer_status": "Temp Disconnected" if remaining["cnt"] == 0 else "Active"
        }


class ReconnectRequest(BaseModel):
    customer_id: str
    stb_no: str
    connection_id: Optional[int] = None  # If reconnecting specific connection
    plan_id: Optional[int] = None
    month_year: Optional[str] = None

@router.post("/connections/reconnect")
def reconnect_customer(data: ReconnectRequest, current_user=Depends(get_current_user)):
    """Reconnect a Temp Disconnected customer — assigns STB (can be same or different),
    sets connection back to Active. No installation/extra charges."""
    if current_user["role"] not in ("admin", "master", "support", "collection_agent"):
        raise HTTPException(status_code=403, detail="Not authorized")
    
    with get_db() as conn:
        _opf = op_filter(current_user, "con.")
        _of = op_filter(current_user)
        _opid = op_id(current_user)
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Get customer
        cust = conn.execute(f"SELECT * FROM customers WHERE customer_id = ? AND {_of}", [data.customer_id]).fetchone()
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")
        if cust["status"] != "Temp Disconnected":
            raise HTTPException(status_code=400, detail=f"Customer status is '{cust['status']}', not 'Temp Disconnected'. Use normal connection add instead.")
        
        # Validate STB is available
        stb_in_use = conn.execute(f"""
            SELECT c.name FROM connections con
            JOIN customers c ON con.customer_id = c.customer_id
            WHERE con.stb_no = ? AND con.status = 'Active' AND {_opf}
        """, [data.stb_no]).fetchone()
        if stb_in_use:
            raise HTTPException(status_code=400, detail=f"STB {data.stb_no} is already assigned to {stb_in_use['name']}")
        
        # Find the temp disconnected connection for this customer
        td_conn = conn.execute(f"""
            SELECT * FROM connections
            WHERE customer_id = ? AND status = 'Temp Disconnected' AND {_opf}
            ORDER BY id DESC LIMIT 1
        """, [data.customer_id]).fetchone()
        
        if td_conn:
            # Reactivate existing connection with new STB
            network = _detect_network(data.stb_no)
            conn.execute(f"""
                UPDATE connections SET status = 'Active', stb_no = ?, network = ?
                WHERE id = ? AND {_opf}
            """, [data.stb_no, network, td_conn["id"]])
            try:
                conn.execute(f"""
                    UPDATE connections SET notes = COALESCE(notes, '') || ?, updated_at = ?
                    WHERE id = ? AND {_opf}
                """, [f"\n[Reconnected: {now} with STB {data.stb_no}]", now, td_conn["id"]])
            except Exception:
                pass
        else:
            # Create new connection
            network = _detect_network(data.stb_no)
            conn.execute(f"""
                INSERT INTO connections (customer_id, stb_no, mso, service_type, billing_type, status, network, created_at, operator_id)
                VALUES (?, ?, 'GTPL', 'Cable', 'Prepaid', 'Active', ?, datetime('now'), {_opid or 'NULL'})
            """, [data.customer_id, data.stb_no, network])
        
        # Set customer back to Active
        conn.execute(f"UPDATE customers SET status = 'Active' WHERE customer_id = ? AND {_of}",
                    [data.customer_id])
        
        # Remove STB from inventory (or mark as assigned)
        conn.execute("UPDATE stb_inventory SET status = 'assigned' WHERE stb_no = ?",
                    [data.stb_no])
        
        conn.commit()
        return {
            "ok": True,
            "message": f"{cust['name']} reconnected with STB {data.stb_no}. No installation charges applied.",
            "customer_id": data.customer_id,
            "stb_no": data.stb_no
        }
