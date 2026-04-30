from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from deps import get_db, get_current_user

router = APIRouter(prefix="/api", tags=["STB Inventory"])


class STBAddRequest(BaseModel):
    stb_no: str
    status: Optional[str] = "spare"  # spare, faulty, with_mso
    notes: Optional[str] = None


class STBExchangeRequest(BaseModel):
    old_stb_status: Optional[str] = "faulty"  # what happens to old STB: faulty, spare
    new_stb_no: str
    old_stb_notes: Optional[str] = None


# ========== INVENTORY MANAGEMENT ==========

@router.get("/stb-inventory")
def list_inventory(status: Optional[str] = None, current_user=Depends(get_current_user)):
    """List all spare/faulty STBs in inventory."""
    with get_db() as conn:
        query = "SELECT * FROM stb_inventory"
        params = []
        if status:
            query += " WHERE status = ?"
            params.append(status)
        query += " ORDER BY added_at DESC"
        rows = conn.execute(query, params).fetchall()
    return {
        "inventory": [dict(r) for r in rows],
        "total": len(rows)
    }


@router.post("/stb-inventory")
def add_to_inventory(data: STBAddRequest, current_user=Depends(get_current_user)):
    """Add a spare STB to inventory."""
    with get_db() as conn:
        # Check STB is not already with a customer
        active = conn.execute("""
            SELECT c.customer_id, c.name FROM connections con
            JOIN customers c ON con.customer_id = c.customer_id
            WHERE con.stb_no = ? AND con.status = 'Active'
        """, [data.stb_no]).fetchone()
        if active:
            raise HTTPException(status_code=400, detail=f"STB {data.stb_no} is currently assigned to {active['name']} ({active['customer_id']})")

        # Check not already in inventory
        existing = conn.execute("SELECT * FROM stb_inventory WHERE stb_no = ?", [data.stb_no]).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail=f"STB {data.stb_no} already in inventory as '{existing['status']}'")

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute("INSERT INTO stb_inventory (stb_no, status, notes, added_at, added_by) VALUES (?, ?, ?, ?, ?)",
                     [data.stb_no, data.status, data.notes, now, current_user["name"]])
        conn.commit()
    return {"message": f"STB {data.stb_no} added to inventory", "status": data.status}


@router.delete("/stb-inventory/{stb_id}")
def remove_from_inventory(stb_id: int, current_user=Depends(get_current_user)):
    """Remove an STB from inventory."""
    if current_user["role"] not in ["admin", "support"]:
        raise HTTPException(status_code=403, detail="Only Admin or Support can remove STBs")
    with get_db() as conn:
        row = conn.execute("SELECT * FROM stb_inventory WHERE id = ?", [stb_id]).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="STB not found in inventory")
        conn.execute("DELETE FROM stb_inventory WHERE id = ?", [stb_id])
        conn.commit()
    return {"message": f"STB {row['stb_no']} removed from inventory"}


# ========== STB EXCHANGE ON CUSTOMER ==========

@router.post("/customers/{customer_id}/connections/{connection_id}/exchange-stb")
def exchange_stb(customer_id: str, connection_id: int, data: STBExchangeRequest, current_user=Depends(get_current_user)):
    """Exchange a customer's faulty STB with a new/spare one."""
    if current_user["role"] not in ["admin", "support"]:
        raise HTTPException(status_code=403, detail="Only Admin or Support can exchange STBs")

    with get_db() as conn:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # 1. Validate connection
        connection = conn.execute(
            "SELECT * FROM connections WHERE id = ? AND customer_id = ?",
            [connection_id, customer_id]
        ).fetchone()
        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")

        old_stb = connection["stb_no"]

        # 2. Validate new STB not assigned to another active customer
        active = conn.execute("""
            SELECT c.customer_id, c.name FROM connections con
            JOIN customers c ON con.customer_id = c.customer_id
            WHERE con.stb_no = ? AND con.status = 'Active' AND con.id != ?
        """, [data.new_stb_no, connection_id]).fetchone()
        if active:
            raise HTTPException(status_code=400, detail=f"STB {data.new_stb_no} is assigned to {active['name']} ({active['customer_id']})")

        # 3. Remove new STB from inventory if it exists there
        conn.execute("DELETE FROM stb_inventory WHERE stb_no = ?", [data.new_stb_no])

        # 4. Update connection with new STB
        conn.execute("UPDATE connections SET stb_no = ? WHERE id = ?", [data.new_stb_no, connection_id])

        # 5. Add old STB to inventory
        notes = data.old_stb_notes or f"Exchanged from {customer_id}"
        conn.execute("INSERT OR REPLACE INTO stb_inventory (stb_no, status, notes, added_at, added_by) VALUES (?, ?, ?, ?, ?)",
                     [old_stb, data.old_stb_status, notes, now, current_user["name"]])

        conn.commit()

    return {
        "message": "STB exchanged successfully",
        "customer_id": customer_id,
        "old_stb": old_stb,
        "new_stb": data.new_stb_no,
        "old_stb_status": data.old_stb_status,
        "note": f"Old STB {old_stb} moved to inventory as '{data.old_stb_status}'"
    }


@router.get("/stb-inventory/available")
def list_available_stbs(current_user=Depends(get_current_user)):
    """List only spare STBs available for exchange."""
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM stb_inventory WHERE status = 'spare' ORDER BY added_at DESC").fetchall()
    return {"available": [dict(r) for r in rows], "total": len(rows)}
