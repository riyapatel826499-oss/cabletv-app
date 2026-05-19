     1|     1|from fastapi import APIRouter, Depends, HTTPException
     2|     2|from pydantic import BaseModel
     3|     3|from typing import Optional
     4|     4|from datetime import datetime
     5|     5|
     6|     6|from models.base import get_db
     7|from conn import get_conn
     8|     7|from deps_orm import _op_flt, get_current_user, apply_op_filter, op_id
     9|     8|
    10|     9|router = APIRouter(prefix="/api", tags=["Surrenders"])
    11|    10|
    12|    11|class SurrenderRequest(BaseModel):
    13|    12|    reason: Optional[str] = None
    14|    13|
    15|    14|@router.post("/customers/{customer_id}/surrender")
    16|    15|def surrender_customer(customer_id: str, req: SurrenderRequest = SurrenderRequest(), current_user=Depends(get_current_user)):
    17|    16|    """Surrender a customer. Admin/Support = immediate. Agent = pending approval."""
    18|    17|    flt = _op_flt(current_user)
    19|    18|    _oid = op_id(current_user)
    20|    19|
    21|    20|    with get_conn() as conn:
    22|    21|        cust = conn.execute(f"SELECT * FROM customers WHERE customer_id = ? AND {flt}", [customer_id]).fetchone()
    23|    22|        if not cust:
    24|    23|            raise HTTPException(status_code=404, detail="Customer not found")
    25|    24|        if cust["status"] in ["Surrendered", "Pending Surrender"]:
    26|    25|            raise HTTPException(status_code=400, detail=f"Customer is already {cust['status']}")
    27|    26|    
    28|    27|        # Derive operator_id from the customer's record (not the admin's) so
    29|    28|        # inventory rows are always scoped to the correct operator even when
    30|    29|        # a master admin (operator_id=NULL) performs the action.
    31|    30|        cust_oid = cust["operator_id"] if cust["operator_id"] else _oid
    32|    31|
    33|    32|        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    34|    33|        stbs = conn.execute(f"SELECT stb_no, id FROM connections WHERE customer_id = ? AND {flt}", [customer_id]).fetchall()
    35|    34|        stb_list = [row["stb_no"] for row in stbs if row["stb_no"]]
    36|    35|    
    37|    36|        # Admin/Support → immediate surrender
    38|    37|        if current_user["role"] in ["admin", "support"]:
    39|    38|            conn.execute(f"UPDATE connections SET status = 'Surrendered' WHERE customer_id = ? AND {flt}", [customer_id])
    40|    39|            # Release the UNIQUE stb_no on surrendered connections so the STB
    41|    40|            # can be reused for new customers without renaming later.
    42|    41|            for row in stbs:
    43|    42|                if row["stb_no"]:
    44|    43|                    conn.execute("UPDATE connections SET stb_no = 'SURRENDERED-' || ? WHERE id = ?",
    45|    44|                                 [row["id"], row["id"]])
    46|    45|            conn.execute(f"""UPDATE customers SET status = 'Surrendered', 
    47|    46|                            surrendered_date = ?, surrender_reason = ? 
    48|    47|                            WHERE customer_id = ? AND {flt}""",
    49|    48|                         [now, req.reason, customer_id])
    50|    49|            # Add freed STBs to inventory
    51|    50|            for stb_no in stb_list:
    52|    51|                existing = conn.execute("SELECT id FROM stb_inventory WHERE stb_no = ?", [stb_no]).fetchone()
    53|    52|                if existing:
    54|    53|                    conn.execute("UPDATE stb_inventory SET status = 'available', notes = ?, operator_id = ? WHERE stb_no = ?",
    55|    54|                                [f"Returned from surrendered customer {customer_id}", cust_oid, stb_no])
    56|    55|                else:
    57|    56|                    conn.execute("""INSERT INTO stb_inventory (stb_no, status, added_at, notes, operator_id)
    58|    57|                                    VALUES (?, 'available', ?, ?, ?)""",
    59|    58|                                [stb_no, now, f"Returned from surrendered customer {customer_id}", cust_oid])
    60|    59|            conn.commit()
    61|    60|            return {
    62|    61|                "message": f"Customer {customer_id} surrendered successfully",
    63|    62|                "customer_id": customer_id, "customer_name": cust["name"],
    64|    63|                "surrendered_date": now, "freed_stbs": stb_list,
    65|    64|                "added_to_inventory": stb_list, "reason": req.reason
    66|    65|            }
    67|    66|    
    68|    67|        # Agent/Service Agent → create pending request, freeze STB
    69|    68|        conn.execute(f"UPDATE connections SET status = 'Frozen' WHERE customer_id = ? AND {flt}", [customer_id])
    70|    69|        conn.execute(f"""UPDATE customers SET status = 'Pending Surrender',
    71|    70|                        surrender_reason = ? WHERE customer_id = ? AND {flt}""",
    72|    71|                     [req.reason, customer_id])
    73|    72|    
    74|    73|        # Create surrender request
    75|    74|        conn.execute(f"""INSERT INTO surrender_requests 
    76|    75|                        (customer_id, customer_name, stb_no, reason, 
    77|    76|                         requested_by, requested_by_name, requested_at, status, operator_id)
    78|    77|                        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
    79|    78|                     [customer_id, cust["name"], ",".join(stb_list), req.reason,
    80|    79|                      current_user["id"], current_user["name"], now, cust_oid])
    81|    80|    
    82|    81|        conn.commit()
    83|    82|        return {
    84|    83|            "message": f"Surrender request submitted for {customer_id}. Awaiting admin approval.",
    85|    84|            "customer_id": customer_id, "customer_name": cust["name"],
    86|    85|            "stb_frozen": stb_list, "reason": req.reason,
    87|    86|            "status": "pending_approval"
    88|    87|        }
    89|    88|
    90|    89|
    91|    90|    # ========== SURRENDER REQUESTS (Admin) ==========
    92|    91|@router.get("/surrender-requests")
    93|    92|def list_surrender_requests(status: Optional[str] = None, current_user=Depends(get_current_user)):
    94|    93|    """List surrender requests. Admin/Support only."""
    95|    94|    if current_user["role"] not in ["master", "admin", "support"]:
    96|    95|        raise HTTPException(status_code=403, detail="Only Admin or Support can view surrender requests")
    97|    96|    
    98|    97|    flt = _op_flt(current_user)
    99|    98|    with get_conn() as conn:
   100|    99|        if status and status in ["pending", "approved", "rejected"]:
   101|   100|            rows = conn.execute(
   102|   101|                f"SELECT * FROM surrender_requests WHERE status = ? AND {flt} ORDER BY requested_at DESC", [status]
   103|   102|            ).fetchall()
   104|   103|        else:
   105|   104|            rows = conn.execute(
   106|   105|                f"SELECT * FROM surrender_requests WHERE {flt} ORDER BY requested_at DESC"
   107|   106|            ).fetchall()
   108|   107|    
   109|   108|        result = []
   110|   109|        for r in rows:
   111|   110|            result.append({
   112|   111|                "id": r["id"],
   113|   112|                "customer_id": r["customer_id"],
   114|   113|                "customer_name": r["customer_name"],
   115|   114|                "stb_no": r["stb_no"],
   116|   115|                "reason": r["reason"],
   117|   116|                "requested_by": r["requested_by"],
   118|   117|                "requested_by_name": r["requested_by_name"],
   119|   118|                "requested_at": r["requested_at"],
   120|   119|                "status": r["status"],
   121|   120|                "reviewed_by": r["reviewed_by"],
   122|   121|                "reviewed_by_name": r["reviewed_by_name"],
   123|   122|                "reviewed_at": r["reviewed_at"],
   124|   123|                "review_notes": r["review_notes"]
   125|   124|            })
   126|   125|        return {"requests": result, "total": len(result)}
   127|   126|
   128|   127|
   129|   128|class ReviewRequest(BaseModel):
   130|   129|    action: str  # "approve" or "reject"
   131|   130|    notes: Optional[str] = None
   132|   131|
   133|   132|@router.post("/surrender-requests/{request_id}/review")
   134|   133|def review_surrender_request(request_id: int, req: ReviewRequest, current_user=Depends(get_current_user)):
   135|   134|    """Approve or reject a surrender request. Admin/Support only."""
   136|   135|    if current_user["role"] not in ["master", "admin", "support"]:
   137|   136|        raise HTTPException(status_code=403, detail="Only Admin or Support can review surrender requests")
   138|   137|    
   139|   138|    flt = _op_flt(current_user)
   140|   139|    _oid = op_id(current_user)
   141|   140|
   142|   141|    with get_conn() as conn:
   143|   142|        sr = conn.execute(f"SELECT * FROM surrender_requests WHERE id = ? AND {flt}", [request_id]).fetchone()
   144|   143|        if not sr:
   145|   144|            raise HTTPException(status_code=404, detail="Surrender request not found")
   146|   145|        if sr["status"] != "pending":
   147|   146|            raise HTTPException(status_code=400, detail=f"Request is already {sr['status']}")
   148|   147|    
   149|   148|        customer_id = sr["customer_id"]
   150|   149|        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
   151|   150|    
   152|   151|        if req.action == "approve":
   153|   152|            # Full surrender: mark customer, connections, move STBs to inventory
   154|   153|            # Derive operator_id from the surrender request (set by the agent
   155|   154|            # who created it), NOT from the reviewing admin, so that inventory
   156|   155|            # rows are always scoped to the correct operator.
   157|   156|            cust_oid = sr["operator_id"] if sr["operator_id"] else _oid
   158|   157|
   159|   158|            stb_list = [s.strip() for s in sr["stb_no"].split(",") if s.strip()] if sr["stb_no"] else []
   160|   159|
   161|   160|            conn.execute(f"UPDATE connections SET status = 'Surrendered' WHERE customer_id = ? AND {flt}", [customer_id])
   162|   161|            # Release the UNIQUE stb_no on surrendered connections so the STB
   163|   162|            # can be reused for new customers without renaming later.
   164|   163|            surrendered_conns = conn.execute(f"SELECT id, stb_no FROM connections WHERE customer_id = ? AND {flt}", [customer_id]).fetchall()
   165|   164|            for row in surrendered_conns:
   166|   165|                if row["stb_no"]:
   167|   166|                    conn.execute("UPDATE connections SET stb_no = 'SURRENDERED-' || ? WHERE id = ?",
   168|   167|                                 [row["id"], row["id"]])
   169|   168|            conn.execute(f"""UPDATE customers SET status = 'Surrendered',
   170|   169|                            surrendered_date = ?, surrender_reason = ?
   171|   170|                            WHERE customer_id = ? AND {flt}""",
   172|   171|                         [now, sr["reason"], customer_id])
   173|   172|            # Add STBs to inventory
   174|   173|            for stb_no in stb_list:
   175|   174|                existing = conn.execute("SELECT id FROM stb_inventory WHERE stb_no = ?", [stb_no]).fetchone()
   176|   175|                if existing:
   177|   176|                    conn.execute("UPDATE stb_inventory SET status = 'available', notes = ?, operator_id = ? WHERE stb_no = ?",
   178|   177|                                [f"Approved surrender - customer {customer_id}", cust_oid, stb_no])
   179|   178|                else:
   180|   179|                    conn.execute("""INSERT INTO stb_inventory (stb_no, status, added_at, notes, operator_id)
   181|   180|                                    VALUES (?, 'available', ?, ?, ?)""",
   182|   181|                                [stb_no, now, f"Approved surrender - customer {customer_id}", cust_oid])
   183|   182|        
   184|   183|            # Update request
   185|   184|            conn.execute(f"""UPDATE surrender_requests SET status = 'approved',
   186|   185|                            reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_notes = ?
   187|   186|                            WHERE id = ? AND {flt}""",
   188|   187|                         [current_user["id"], current_user["name"], now, req.notes, request_id])
   189|   188|            conn.commit()
   190|   189|            return {
   191|   190|                "message": f"Surrender request approved. Customer {customer_id} surrendered.",
   192|   191|                "customer_id": customer_id, "stbs_to_inventory": stb_list,
   193|   192|                "action": "approved"
   194|   193|            }
   195|   194|    
   196|   195|        elif req.action == "reject":
   197|   196|            # Revert: customer back to Active, connections unfrozen
   198|   197|            conn.execute(f"UPDATE connections SET status = 'Active' WHERE customer_id = ? AND {flt}", [customer_id])
   199|   198|            conn.execute(f"""UPDATE customers SET status = 'Active',
   200|   199|                            surrender_reason = NULL WHERE customer_id = ? AND {flt}""",
   201|   200|                         [customer_id])
   202|   201|            # Update request
   203|   202|            conn.execute(f"""UPDATE surrender_requests SET status = 'rejected',
   204|   203|                            reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_notes = ?
   205|   204|                            WHERE id = ? AND {flt}""",
   206|   205|                         [current_user["id"], current_user["name"], now, req.notes, request_id])
   207|   206|            conn.commit()
   208|   207|            return {
   209|   208|                "message": f"Surrender request rejected. Customer {customer_id} reactivated.",
   210|   209|                "customer_id": customer_id, "action": "rejected"
   211|   210|            }
   212|   211|    
   213|   212|        else:
   214|   213|            raise HTTPException(status_code=400, detail="Action must be 'approve' or 'reject'")
   215|   214|
   216|   215|
   217|   216|    # ========== REACTIVATE ==========
   218|   217|@router.post("/customers/{customer_id}/reactivate")
   219|   218|def reactivate_customer(customer_id: str, current_user=Depends(get_current_user)):
   220|   219|    """Reactivate a surrendered customer."""
   221|   220|    if current_user["role"] not in ["master", "admin", "support"]:
   222|   221|        raise HTTPException(status_code=403, detail="Only Admin or Support can reactivate customers")
   223|   222|    
   224|   223|    flt = _op_flt(current_user)
   225|   224|    with get_conn() as conn:
   226|   225|        cust = conn.execute(f"SELECT * FROM customers WHERE customer_id = ? AND {flt}", [customer_id]).fetchone()
   227|   226|        if not cust:
   228|   227|            raise HTTPException(status_code=404, detail="Customer not found")
   229|   228|        if cust["status"] not in ["Surrendered"]:
   230|   229|            raise HTTPException(status_code=400, detail="Customer is not surrendered")
   231|   230|    
   232|   231|        # Before reactivating, find STBs currently in inventory that were
   233|   232|        # associated with this customer so we can remove them.
   234|   233|        inv_stbs = conn.execute(
   235|   234|            f"""SELECT si.stb_no FROM stb_inventory si
   236|   235|                WHERE si.notes LIKE ? AND {_op_flt(current_user, 'si.')}""",
   237|   236|            [f"%customer {customer_id}%"]
   238|   237|        ).fetchall()
   239|   238|        inv_stb_list = [row["stb_no"] for row in inv_stbs]
   240|   239|
   241|   240|        conn.execute(f"""UPDATE customers SET status = 'Active', 
   242|   241|                        surrendered_date = NULL, surrender_reason = NULL 
   243|   242|                        WHERE customer_id = ? AND {flt}""", [customer_id])
   244|   243|        conn.execute(f"UPDATE connections SET status = 'Active' WHERE customer_id = ? AND {flt}", [customer_id])
   245|   244|    
   246|   245|        # Remove reactivated STBs from inventory (they're back in use)
   247|   246|        for stb_no in inv_stb_list:
   248|   247|            conn.execute("DELETE FROM stb_inventory WHERE stb_no = ?", [stb_no])
   249|   248|    
   250|   249|        conn.commit()
   251|   250|    
   252|   251|        return {"message": f"Customer {customer_id} reactivated", "customer_id": customer_id}
   253|   252|