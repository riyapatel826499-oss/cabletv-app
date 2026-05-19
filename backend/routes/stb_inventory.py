     1|from fastapi import APIRouter, Depends, HTTPException
     2|from pydantic import BaseModel
     3|from typing import Optional
     4|from datetime import datetime
     5|
     6|from models.base import get_db
from conn import get_conn
     7|from deps_orm import get_current_user, apply_op_filter, op_id
     8|
     9|router = APIRouter(prefix="/api", tags=["STB Inventory"])
    10|
    11|class STBAddRequest(BaseModel):
    12|    stb_no: str
    13|    status: Optional[str] = "spare"  # spare, faulty, with_mso
    14|    notes: Optional[str] = None
    15|
    16|
    17|class STBExchangeRequest(BaseModel):
    18|    old_stb_status: Optional[str] = "faulty"  # what happens to old STB: faulty, spare
    19|    new_stb_no: str
    20|    old_stb_notes: Optional[str] = None
    21|
    22|
    23|# ========== INVENTORY MANAGEMENT ==========
    24|
    25|@router.get("/stb-inventory")
    26|def list_inventory(status: Optional[str] = None, operator_id: int = None, current_user=Depends(get_current_user)):
    27|    """List all spare/faulty STBs in inventory. Master can pass ?operator_id=X."""
    28|    if current_user.get("role") == "master" and operator_id is not None:
    29|        flt = f"operator_id = {operator_id}"
    30|    else:
    31|        flt = op_filter(current_user)
    32|    with get_conn() as conn:
    33|        query = f"SELECT * FROM stb_inventory WHERE {flt}"
    34|        params = []
    35|        if status:
    36|            query += " AND status = ?"
    37|            params.append(status)
    38|        query += " ORDER BY added_at DESC"
    39|        rows = conn.execute(query, params).fetchall()
    40|    return {
    41|        "inventory": [dict(r) for r in rows],
    42|        "total": len(rows)
    43|    }
    44|
    45|
    46|@router.post("/stb-inventory")
    47|def add_to_inventory(data: STBAddRequest, operator_id: int = None, current_user=Depends(get_current_user)):
    48|    """Add a spare STB to inventory. Master can pass ?operator_id=X."""
    49|    flt = op_filter(current_user)
    50|    flt_con = op_filter(current_user, "con.")
    51|    if current_user.get("role") == "master" and operator_id is not None:
    52|        _oid = operator_id
    53|    else:
    54|        _oid = op_id(current_user)
    55|    with get_conn() as conn:
    56|        # Check STB is not already with a customer
    57|        active = conn.execute(f"""
    58|            SELECT c.customer_id, c.name FROM connections con
    59|            JOIN customers c ON con.customer_id = c.customer_id
    60|            WHERE con.stb_no = ? AND con.status = 'Active' AND {flt_con}
    61|        """, [data.stb_no]).fetchone()
    62|        if active:
    63|            raise HTTPException(status_code=400, detail=f"STB {data.stb_no} is currently assigned to {active['name']} ({active['customer_id']})")
    64|
    65|        # Check not already in inventory
    66|        existing = conn.execute(f"SELECT * FROM stb_inventory WHERE stb_no = ? AND {flt}", [data.stb_no]).fetchone()
    67|        if existing:
    68|            raise HTTPException(status_code=400, detail=f"STB {data.stb_no} already in inventory as '{existing['status']}'")
    69|
    70|        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    71|        conn.execute("INSERT INTO stb_inventory (stb_no, status, notes, added_at, added_by, operator_id) VALUES (?, ?, ?, ?, ?, ?)",
    72|                     [data.stb_no, data.status, data.notes, now, current_user["name"], _oid])
    73|        conn.commit()
    74|    return {"message": f"STB {data.stb_no} added to inventory", "status": data.status}
    75|
    76|
    77|@router.delete("/stb-inventory/{stb_id}")
    78|def remove_from_inventory(stb_id: int, operator_id: int = None, current_user=Depends(get_current_user)):
    79|    """Remove an STB from inventory."""
    80|    if current_user["role"] not in ["admin", "master", "support"]:
    81|        raise HTTPException(status_code=403, detail="Only Admin or Support can remove STBs")
    82|    if current_user.get("role") == "master" and operator_id is not None:
    83|        flt = f"operator_id = {operator_id}"
    84|    else:
    85|        flt = op_filter(current_user)
    86|    with get_conn() as conn:
    87|        row = conn.execute(f"SELECT * FROM stb_inventory WHERE id = ? AND {flt}", [stb_id]).fetchone()
    88|        if not row:
    89|            raise HTTPException(status_code=404, detail="STB not found in inventory")
    90|        conn.execute(f"DELETE FROM stb_inventory WHERE id = ? AND {flt}", [stb_id])
    91|        conn.commit()
    92|    return {"message": f"STB {row['stb_no']} removed from inventory"}
    93|
    94|
    95|# ========== STB EXCHANGE ON CUSTOMER ==========
    96|
    97|@router.post("/customers/{customer_id}/connections/{connection_id}/exchange-stb")
    98|def exchange_stb(customer_id: str, connection_id: int, data: STBExchangeRequest, current_user=Depends(get_current_user)):
    99|    """Exchange a customer's faulty STB with a new/spare one."""
   100|    if current_user["role"] not in ["master", "admin", "support"]:
   101|        raise HTTPException(status_code=403, detail="Only Admin or Support can exchange STBs")
   102|
   103|    flt = op_filter(current_user)
   104|    flt_con = op_filter(current_user, "con.")
   105|    _oid = op_id(current_user)
   106|
   107|    with get_conn() as conn:
   108|        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
   109|
   110|        # 1. Validate connection
   111|        connection = conn.execute(
   112|            f"SELECT * FROM connections WHERE id = ? AND customer_id = ? AND {flt}",
   113|            [connection_id, customer_id]
   114|        ).fetchone()
   115|        if not connection:
   116|            raise HTTPException(status_code=404, detail="Connection not found")
   117|
   118|        old_stb = connection["stb_no"]
   119|
   120|        # 2. Validate new STB not assigned to another active customer
   121|        active = conn.execute(f"""
   122|            SELECT c.customer_id, c.name FROM connections con
   123|            JOIN customers c ON con.customer_id = c.customer_id
   124|            WHERE con.stb_no = ? AND con.status = 'Active' AND con.id != ? AND {flt_con}
   125|        """, [data.new_stb_no, connection_id]).fetchone()
   126|        if active:
   127|            raise HTTPException(status_code=400, detail=f"STB {data.new_stb_no} is assigned to {active['name']} ({active['customer_id']})")
   128|
   129|        # 3. Remove new STB from inventory if it exists there
   130|        conn.execute(f"DELETE FROM stb_inventory WHERE stb_no = ? AND {flt}", [data.new_stb_no])
   131|
   132|        # 4. Update connection with new STB
   133|        conn.execute(f"UPDATE connections SET stb_no = ? WHERE id = ? AND {flt}", [data.new_stb_no, connection_id])
   134|
   135|        # 5. Add old STB to inventory
   136|        notes = data.old_stb_notes or f"Exchanged from {customer_id}"
   137|        conn.execute("""INSERT INTO stb_inventory (stb_no, status, notes, added_at, added_by, operator_id) VALUES (?, ?, ?, ?, ?, ?)
   138|                        ON CONFLICT (stb_no) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes, added_at = EXCLUDED.added_at, added_by = EXCLUDED.added_by, operator_id = EXCLUDED.operator_id""",
   139|                     [old_stb, data.old_stb_status, notes, now, current_user["name"], _oid])
   140|
   141|        conn.commit()
   142|
   143|    return {
   144|        "message": "STB exchanged successfully",
   145|        "customer_id": customer_id,
   146|        "old_stb": old_stb,
   147|        "new_stb": data.new_stb_no,
   148|        "old_stb_status": data.old_stb_status,
   149|        "note": f"Old STB {old_stb} moved to inventory as '{data.old_stb_status}'"
   150|    }
   151|
   152|
   153|@router.get("/stb-inventory/available")
   154|def list_available_stbs(network: Optional[str] = None, current_user=Depends(get_current_user)):
   155|    """List spare/available STBs for assignment, optionally filtered by network/MSO."""
   156|    flt = op_filter(current_user)
   157|    with get_conn() as conn:
   158|        query = f"SELECT * FROM stb_inventory WHERE status IN ('spare', 'available') AND {flt}"
   159|        params = []
   160|        if network:
   161|            # Filter by STB number prefix (172/173=TACTV, 5000=SCV, rest=GTPL)
   162|            if network.upper() == "TACTV":
   163|                query += " AND (stb_no LIKE '172%' OR stb_no LIKE '173%')"
   164|            elif network.upper() == "SCV":
   165|                query += " AND stb_no LIKE '5000%'"
   166|            elif network.upper() == "GTPL":
   167|                query += " AND stb_no NOT LIKE '172%' AND stb_no NOT LIKE '173%' AND stb_no NOT LIKE '5000%'"
   168|        query += " ORDER BY stb_no ASC"
   169|        rows = conn.execute(query, params).fetchall()
   170|    return {"available": [dict(r) for r in rows], "total": len(rows)}
   171|