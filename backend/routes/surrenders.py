     1|from fastapi import APIRouter, Depends, HTTPException
     2|from pydantic import BaseModel
     3|from typing import Optional
     4|from datetime import datetime
     5|
     6|from models.base import get_db
from conn import get_conn
     7|from deps_orm import get_current_user, apply_op_filter, op_id
     8|
     9|router = APIRouter(prefix="/api", tags=["Surrenders"])
    10|
    11|class SurrenderRequest(BaseModel):
    12|    reason: Optional[str] = None
    13|
    14|@router.post("/customers/{customer_id}/surrender")
    15|def surrender_customer(customer_id: str, req: SurrenderRequest = SurrenderRequest(), current_user=Depends(get_current_user)):
    16|    """Surrender a customer. Admin/Support = immediate. Agent = pending approval."""
    17|    flt = op_filter(current_user)
    18|    _oid = op_id(current_user)
    19|
    20|    with get_conn() as conn:
    21|        cust = conn.execute(f"SELECT * FROM customers WHERE customer_id = ? AND {flt}", [customer_id]).fetchone()
    22|        if not cust:
    23|            raise HTTPException(status_code=404, detail="Customer not found")
    24|        if cust["status"] in ["Surrendered", "Pending Surrender"]:
    25|            raise HTTPException(status_code=400, detail=f"Customer is already {cust['status']}")
    26|    
    27|        # Derive operator_id from the customer's record (not the admin's) so
    28|        # inventory rows are always scoped to the correct operator even when
    29|        # a master admin (operator_id=NULL) performs the action.
    30|        cust_oid = cust["operator_id"] if cust["operator_id"] else _oid
    31|
    32|        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    33|        stbs = conn.execute(f"SELECT stb_no, id FROM connections WHERE customer_id = ? AND {flt}", [customer_id]).fetchall()
    34|        stb_list = [row["stb_no"] for row in stbs if row["stb_no"]]
    35|    
    36|        # Admin/Support → immediate surrender
    37|        if current_user["role"] in ["admin", "support"]:
    38|            conn.execute(f"UPDATE connections SET status = 'Surrendered' WHERE customer_id = ? AND {flt}", [customer_id])
    39|            # Release the UNIQUE stb_no on surrendered connections so the STB
    40|            # can be reused for new customers without renaming later.
    41|            for row in stbs:
    42|                if row["stb_no"]:
    43|                    conn.execute("UPDATE connections SET stb_no = 'SURRENDERED-' || ? WHERE id = ?",
    44|                                 [row["id"], row["id"]])
    45|            conn.execute(f"""UPDATE customers SET status = 'Surrendered', 
    46|                            surrendered_date = ?, surrender_reason = ? 
    47|                            WHERE customer_id = ? AND {flt}""",
    48|                         [now, req.reason, customer_id])
    49|            # Add freed STBs to inventory
    50|            for stb_no in stb_list:
    51|                existing = conn.execute("SELECT id FROM stb_inventory WHERE stb_no = ?", [stb_no]).fetchone()
    52|                if existing:
    53|                    conn.execute("UPDATE stb_inventory SET status = 'available', notes = ?, operator_id = ? WHERE stb_no = ?",
    54|                                [f"Returned from surrendered customer {customer_id}", cust_oid, stb_no])
    55|                else:
    56|                    conn.execute("""INSERT INTO stb_inventory (stb_no, status, added_at, notes, operator_id)
    57|                                    VALUES (?, 'available', ?, ?, ?)""",
    58|                                [stb_no, now, f"Returned from surrendered customer {customer_id}", cust_oid])
    59|            conn.commit()
    60|            return {
    61|                "message": f"Customer {customer_id} surrendered successfully",
    62|                "customer_id": customer_id, "customer_name": cust["name"],
    63|                "surrendered_date": now, "freed_stbs": stb_list,
    64|                "added_to_inventory": stb_list, "reason": req.reason
    65|            }
    66|    
    67|        # Agent/Service Agent → create pending request, freeze STB
    68|        conn.execute(f"UPDATE connections SET status = 'Frozen' WHERE customer_id = ? AND {flt}", [customer_id])
    69|        conn.execute(f"""UPDATE customers SET status = 'Pending Surrender',
    70|                        surrender_reason = ? WHERE customer_id = ? AND {flt}""",
    71|                     [req.reason, customer_id])
    72|    
    73|        # Create surrender request
    74|        conn.execute(f"""INSERT INTO surrender_requests 
    75|                        (customer_id, customer_name, stb_no, reason, 
    76|                         requested_by, requested_by_name, requested_at, status, operator_id)
    77|                        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
    78|                     [customer_id, cust["name"], ",".join(stb_list), req.reason,
    79|                      current_user["id"], current_user["name"], now, cust_oid])
    80|    
    81|        conn.commit()
    82|        return {
    83|            "message": f"Surrender request submitted for {customer_id}. Awaiting admin approval.",
    84|            "customer_id": customer_id, "customer_name": cust["name"],
    85|            "stb_frozen": stb_list, "reason": req.reason,
    86|            "status": "pending_approval"
    87|        }
    88|
    89|
    90|    # ========== SURRENDER REQUESTS (Admin) ==========
    91|@router.get("/surrender-requests")
    92|def list_surrender_requests(status: Optional[str] = None, current_user=Depends(get_current_user)):
    93|    """List surrender requests. Admin/Support only."""
    94|    if current_user["role"] not in ["master", "admin", "support"]:
    95|        raise HTTPException(status_code=403, detail="Only Admin or Support can view surrender requests")
    96|    
    97|    flt = op_filter(current_user)
    98|    with get_conn() as conn:
    99|        if status and status in ["pending", "approved", "rejected"]:
   100|            rows = conn.execute(
   101|                f"SELECT * FROM surrender_requests WHERE status = ? AND {flt} ORDER BY requested_at DESC", [status]
   102|            ).fetchall()
   103|        else:
   104|            rows = conn.execute(
   105|                f"SELECT * FROM surrender_requests WHERE {flt} ORDER BY requested_at DESC"
   106|            ).fetchall()
   107|    
   108|        result = []
   109|        for r in rows:
   110|            result.append({
   111|                "id": r["id"],
   112|                "customer_id": r["customer_id"],
   113|                "customer_name": r["customer_name"],
   114|                "stb_no": r["stb_no"],
   115|                "reason": r["reason"],
   116|                "requested_by": r["requested_by"],
   117|                "requested_by_name": r["requested_by_name"],
   118|                "requested_at": r["requested_at"],
   119|                "status": r["status"],
   120|                "reviewed_by": r["reviewed_by"],
   121|                "reviewed_by_name": r["reviewed_by_name"],
   122|                "reviewed_at": r["reviewed_at"],
   123|                "review_notes": r["review_notes"]
   124|            })
   125|        return {"requests": result, "total": len(result)}
   126|
   127|
   128|class ReviewRequest(BaseModel):
   129|    action: str  # "approve" or "reject"
   130|    notes: Optional[str] = None
   131|
   132|@router.post("/surrender-requests/{request_id}/review")
   133|def review_surrender_request(request_id: int, req: ReviewRequest, current_user=Depends(get_current_user)):
   134|    """Approve or reject a surrender request. Admin/Support only."""
   135|    if current_user["role"] not in ["master", "admin", "support"]:
   136|        raise HTTPException(status_code=403, detail="Only Admin or Support can review surrender requests")
   137|    
   138|    flt = op_filter(current_user)
   139|    _oid = op_id(current_user)
   140|
   141|    with get_conn() as conn:
   142|        sr = conn.execute(f"SELECT * FROM surrender_requests WHERE id = ? AND {flt}", [request_id]).fetchone()
   143|        if not sr:
   144|            raise HTTPException(status_code=404, detail="Surrender request not found")
   145|        if sr["status"] != "pending":
   146|            raise HTTPException(status_code=400, detail=f"Request is already {sr['status']}")
   147|    
   148|        customer_id = sr["customer_id"]
   149|        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
   150|    
   151|        if req.action == "approve":
   152|            # Full surrender: mark customer, connections, move STBs to inventory
   153|            # Derive operator_id from the surrender request (set by the agent
   154|            # who created it), NOT from the reviewing admin, so that inventory
   155|            # rows are always scoped to the correct operator.
   156|            cust_oid = sr["operator_id"] if sr["operator_id"] else _oid
   157|
   158|            stb_list = [s.strip() for s in sr["stb_no"].split(",") if s.strip()] if sr["stb_no"] else []
   159|
   160|            conn.execute(f"UPDATE connections SET status = 'Surrendered' WHERE customer_id = ? AND {flt}", [customer_id])
   161|            # Release the UNIQUE stb_no on surrendered connections so the STB
   162|            # can be reused for new customers without renaming later.
   163|            surrendered_conns = conn.execute(f"SELECT id, stb_no FROM connections WHERE customer_id = ? AND {flt}", [customer_id]).fetchall()
   164|            for row in surrendered_conns:
   165|                if row["stb_no"]:
   166|                    conn.execute("UPDATE connections SET stb_no = 'SURRENDERED-' || ? WHERE id = ?",
   167|                                 [row["id"], row["id"]])
   168|            conn.execute(f"""UPDATE customers SET status = 'Surrendered',
   169|                            surrendered_date = ?, surrender_reason = ?
   170|                            WHERE customer_id = ? AND {flt}""",
   171|                         [now, sr["reason"], customer_id])
   172|            # Add STBs to inventory
   173|            for stb_no in stb_list:
   174|                existing = conn.execute("SELECT id FROM stb_inventory WHERE stb_no = ?", [stb_no]).fetchone()
   175|                if existing:
   176|                    conn.execute("UPDATE stb_inventory SET status = 'available', notes = ?, operator_id = ? WHERE stb_no = ?",
   177|                                [f"Approved surrender - customer {customer_id}", cust_oid, stb_no])
   178|                else:
   179|                    conn.execute("""INSERT INTO stb_inventory (stb_no, status, added_at, notes, operator_id)
   180|                                    VALUES (?, 'available', ?, ?, ?)""",
   181|                                [stb_no, now, f"Approved surrender - customer {customer_id}", cust_oid])
   182|        
   183|            # Update request
   184|            conn.execute(f"""UPDATE surrender_requests SET status = 'approved',
   185|                            reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_notes = ?
   186|                            WHERE id = ? AND {flt}""",
   187|                         [current_user["id"], current_user["name"], now, req.notes, request_id])
   188|            conn.commit()
   189|            return {
   190|                "message": f"Surrender request approved. Customer {customer_id} surrendered.",
   191|                "customer_id": customer_id, "stbs_to_inventory": stb_list,
   192|                "action": "approved"
   193|            }
   194|    
   195|        elif req.action == "reject":
   196|            # Revert: customer back to Active, connections unfrozen
   197|            conn.execute(f"UPDATE connections SET status = 'Active' WHERE customer_id = ? AND {flt}", [customer_id])
   198|            conn.execute(f"""UPDATE customers SET status = 'Active',
   199|                            surrender_reason = NULL WHERE customer_id = ? AND {flt}""",
   200|                         [customer_id])
   201|            # Update request
   202|            conn.execute(f"""UPDATE surrender_requests SET status = 'rejected',
   203|                            reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_notes = ?
   204|                            WHERE id = ? AND {flt}""",
   205|                         [current_user["id"], current_user["name"], now, req.notes, request_id])
   206|            conn.commit()
   207|            return {
   208|                "message": f"Surrender request rejected. Customer {customer_id} reactivated.",
   209|                "customer_id": customer_id, "action": "rejected"
   210|            }
   211|    
   212|        else:
   213|            raise HTTPException(status_code=400, detail="Action must be 'approve' or 'reject'")
   214|
   215|
   216|    # ========== REACTIVATE ==========
   217|@router.post("/customers/{customer_id}/reactivate")
   218|def reactivate_customer(customer_id: str, current_user=Depends(get_current_user)):
   219|    """Reactivate a surrendered customer."""
   220|    if current_user["role"] not in ["master", "admin", "support"]:
   221|        raise HTTPException(status_code=403, detail="Only Admin or Support can reactivate customers")
   222|    
   223|    flt = op_filter(current_user)
   224|    with get_conn() as conn:
   225|        cust = conn.execute(f"SELECT * FROM customers WHERE customer_id = ? AND {flt}", [customer_id]).fetchone()
   226|        if not cust:
   227|            raise HTTPException(status_code=404, detail="Customer not found")
   228|        if cust["status"] not in ["Surrendered"]:
   229|            raise HTTPException(status_code=400, detail="Customer is not surrendered")
   230|    
   231|        # Before reactivating, find STBs currently in inventory that were
   232|        # associated with this customer so we can remove them.
   233|        inv_stbs = conn.execute(
   234|            f"""SELECT si.stb_no FROM stb_inventory si
   235|                WHERE si.notes LIKE ? AND {op_filter(current_user, 'si.')}""",
   236|            [f"%customer {customer_id}%"]
   237|        ).fetchall()
   238|        inv_stb_list = [row["stb_no"] for row in inv_stbs]
   239|
   240|        conn.execute(f"""UPDATE customers SET status = 'Active', 
   241|                        surrendered_date = NULL, surrender_reason = NULL 
   242|                        WHERE customer_id = ? AND {flt}""", [customer_id])
   243|        conn.execute(f"UPDATE connections SET status = 'Active' WHERE customer_id = ? AND {flt}", [customer_id])
   244|    
   245|        # Remove reactivated STBs from inventory (they're back in use)
   246|        for stb_no in inv_stb_list:
   247|            conn.execute("DELETE FROM stb_inventory WHERE stb_no = ?", [stb_no])
   248|    
   249|        conn.commit()
   250|    
   251|        return {"message": f"Customer {customer_id} reactivated", "customer_id": customer_id}
   252|