from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from models.base import get_db
from conn import get_conn
from deps_orm import _op_flt, get_current_user, apply_op_filter, op_id
router = APIRouter(prefix="/api", tags=["Surrenders"])
class SurrenderRequest(BaseModel):
   reason: Optional[str] = None
@router.post("/customers/{customer_id}/surrender")
def surrender_customer(customer_id: str, req: SurrenderRequest = SurrenderRequest(), current_user=Depends(get_current_user)):
   """Surrender a customer. Admin/Support = immediate. Agent = pending approval."""
   flt = _op_flt(current_user)
   _oid = op_id(current_user)
   with get_conn() as conn:
       cust = conn.execute(f"SELECT * FROM customers WHERE customer_id = ? AND {flt}", [customer_id]).fetchone()
       if not cust:
           raise HTTPException(status_code=404, detail="Customer not found")
       if cust["status"] in ["Surrendered", "Pending Surrender"]:
           raise HTTPException(status_code=400, detail=f"Customer is already {cust['status']}")
   
       # Derive operator_id from the customer's record (not the admin's) so
       # inventory rows are always scoped to the correct operator even when
       # a master admin (operator_id=NULL) performs the action.
       cust_oid = cust["operator_id"] if cust["operator_id"] else _oid
       now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
       stbs = conn.execute(f"SELECT stb_no, id FROM connections WHERE customer_id = ? AND {flt}", [customer_id]).fetchall()
       stb_list = [row["stb_no"] for row in stbs if row["stb_no"]]
   
       # Admin/Support → immediate surrender
       if current_user["role"] in ["master", "admin", "support"]:
           conn.execute(f"UPDATE connections SET status = 'Surrendered' WHERE customer_id = ? AND {flt}", [customer_id])
           # Release the UNIQUE stb_no on surrendered connections so the STB
           # can be reused for new customers without renaming later.
           for row in stbs:
               if row["stb_no"]:
                   conn.execute("UPDATE connections SET stb_no = 'SURRENDERED-' || ? WHERE id = ?",
                                [row["id"], row["id"]])
           conn.execute(f"""UPDATE customers SET status = 'Surrendered', 
                           surrendered_date = ?, surrender_reason = ? 
                           WHERE customer_id = ? AND {flt}""",
                        [now, req.reason, customer_id])
           # Add freed STBs to inventory
           for stb_no in stb_list:
               existing = conn.execute("SELECT id FROM stb_inventory WHERE stb_no = ?", [stb_no]).fetchone()
               if existing:
                   conn.execute("UPDATE stb_inventory SET status = 'available', notes = ?, operator_id = ? WHERE stb_no = ?",
                               [f"Returned from surrendered customer {customer_id}", cust_oid, stb_no])
               else:
                   conn.execute("""INSERT INTO stb_inventory (stb_no, status, added_at, notes, operator_id)
                                   VALUES (?, 'available', ?, ?, ?)""",
                               [stb_no, now, f"Returned from surrendered customer {customer_id}", cust_oid])
           conn.commit()
           return {
               "message": f"Customer {customer_id} surrendered successfully",
               "customer_id": customer_id, "customer_name": cust["name"],
               "surrendered_date": now, "freed_stbs": stb_list,
               "added_to_inventory": stb_list, "reason": req.reason
           }
   
       # Agent/Service Agent → create pending request, freeze STB
       conn.execute(f"UPDATE connections SET status = 'Frozen' WHERE customer_id = ? AND {flt}", [customer_id])
       conn.execute(f"""UPDATE customers SET status = 'Pending Surrender',
                       surrender_reason = ? WHERE customer_id = ? AND {flt}""",
                    [req.reason, customer_id])
   
       # Create surrender request
       conn.execute(f"""INSERT INTO surrender_requests 
                       (customer_id, customer_name, stb_no, reason, 
                        requested_by, requested_by_name, requested_at, status, operator_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
                    [customer_id, cust["name"], ",".join(stb_list), req.reason,
                     current_user["id"], current_user["name"], now, cust_oid])
   
       conn.commit()
       return {
           "message": f"Surrender request submitted for {customer_id}. Awaiting admin approval.",
           "customer_id": customer_id, "customer_name": cust["name"],
           "stb_frozen": stb_list, "reason": req.reason,
           "status": "pending_approval"
       }
   # ========== SURRENDER REQUESTS (Admin) ==========
@router.get("/surrender-requests")
def list_surrender_requests(status: Optional[str] = None, current_user=Depends(get_current_user)):
   """List surrender requests. Master views all, Admin/Support see their operator."""
   if current_user["role"] not in ["master", "admin", "support", "service_agent"]:
       raise HTTPException(status_code=403, detail="Only Admin, Support or Service Agent can view surrender requests")
   
   flt = _op_flt(current_user)
   with get_conn() as conn:
       if status and status in ["pending", "approved", "rejected"]:
           rows = conn.execute(
               f"SELECT * FROM surrender_requests WHERE status = ? AND {flt} ORDER BY requested_at DESC", [status]
           ).fetchall()
       else:
           rows = conn.execute(
               f"SELECT * FROM surrender_requests WHERE {flt} ORDER BY requested_at DESC"
           ).fetchall()
   
       result = []
       for r in rows:
           result.append({
               "id": r["id"],
               "customer_id": r["customer_id"],
               "customer_name": r["customer_name"],
               "stb_no": r["stb_no"],
               "reason": r["reason"],
               "requested_by": r["requested_by"],
               "requested_by_name": r["requested_by_name"],
               "requested_at": r["requested_at"],
               "status": r["status"],
               "reviewed_by": r["reviewed_by"],
               "reviewed_by_name": r["reviewed_by_name"],
               "reviewed_at": r["reviewed_at"],
               "review_notes": r["review_notes"]
           })
       return {"requests": result, "total": len(result)}
class ReviewRequest(BaseModel):
   action: str  # "approve" or "reject"
   notes: Optional[str] = None
@router.post("/surrender-requests/{request_id}/review")
def review_surrender_request(request_id: int, req: ReviewRequest, current_user=Depends(get_current_user)):
   """Approve or reject a surrender request. Admin/Support only."""
   if current_user["role"] not in ["admin", "support"]:
       raise HTTPException(status_code=403, detail="Only Admin or Support can review surrender requests")
   
   flt = _op_flt(current_user)
   _oid = op_id(current_user)
   with get_conn() as conn:
       sr = conn.execute(f"SELECT * FROM surrender_requests WHERE id = ? AND {flt}", [request_id]).fetchone()
       if not sr:
           raise HTTPException(status_code=404, detail="Surrender request not found")
       if sr["status"] != "pending":
           raise HTTPException(status_code=400, detail=f"Request is already {sr['status']}")
   
       customer_id = sr["customer_id"]
       now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
   
       if req.action == "approve":
           # Full surrender: mark customer, connections, move STBs to inventory
           # Derive operator_id from the surrender request (set by the agent
           # who created it), NOT from the reviewing admin, so that inventory
           # rows are always scoped to the correct operator.
           cust_oid = sr["operator_id"] if sr["operator_id"] else _oid
           stb_list = [s.strip() for s in sr["stb_no"].split(",") if s.strip()] if sr["stb_no"] else []
           conn.execute(f"UPDATE connections SET status = 'Surrendered' WHERE customer_id = ? AND {flt}", [customer_id])
           # Release the UNIQUE stb_no on surrendered connections so the STB
           # can be reused for new customers without renaming later.
           surrendered_conns = conn.execute(f"SELECT id, stb_no FROM connections WHERE customer_id = ? AND {flt}", [customer_id]).fetchall()
           for row in surrendered_conns:
               if row["stb_no"]:
                   conn.execute("UPDATE connections SET stb_no = 'SURRENDERED-' || ? WHERE id = ?",
                                [row["id"], row["id"]])
           conn.execute(f"""UPDATE customers SET status = 'Surrendered',
                           surrendered_date = ?, surrender_reason = ?
                           WHERE customer_id = ? AND {flt}""",
                        [now, sr["reason"], customer_id])
           # Add STBs to inventory
           for stb_no in stb_list:
               existing = conn.execute("SELECT id FROM stb_inventory WHERE stb_no = ?", [stb_no]).fetchone()
               if existing:
                   conn.execute("UPDATE stb_inventory SET status = 'available', notes = ?, operator_id = ? WHERE stb_no = ?",
                               [f"Approved surrender - customer {customer_id}", cust_oid, stb_no])
               else:
                   conn.execute("""INSERT INTO stb_inventory (stb_no, status, added_at, notes, operator_id)
                                   VALUES (?, 'available', ?, ?, ?)""",
                               [stb_no, now, f"Approved surrender - customer {customer_id}", cust_oid])
       
           # Update request
           conn.execute(f"""UPDATE surrender_requests SET status = 'approved',
                           reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_notes = ?
                           WHERE id = ? AND {flt}""",
                        [current_user["id"], current_user["name"], now, req.notes, request_id])
           conn.commit()
           return {
               "message": f"Surrender request approved. Customer {customer_id} surrendered.",
               "customer_id": customer_id, "stbs_to_inventory": stb_list,
               "action": "approved"
           }
   
       elif req.action == "reject":
           # Revert: customer back to Active, connections unfrozen
           conn.execute(f"UPDATE connections SET status = 'Active' WHERE customer_id = ? AND {flt}", [customer_id])
           conn.execute(f"""UPDATE customers SET status = 'Active',
                           surrender_reason = NULL WHERE customer_id = ? AND {flt}""",
                        [customer_id])
           # Update request
           conn.execute(f"""UPDATE surrender_requests SET status = 'rejected',
                           reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_notes = ?
                           WHERE id = ? AND {flt}""",
                        [current_user["id"], current_user["name"], now, req.notes, request_id])
           conn.commit()
           return {
               "message": f"Surrender request rejected. Customer {customer_id} reactivated.",
               "customer_id": customer_id, "action": "rejected"
           }
   
       else:
           raise HTTPException(status_code=400, detail="Action must be 'approve' or 'reject'")
   # ========== REACTIVATE ==========
@router.post("/customers/{customer_id}/reactivate")
def reactivate_customer(customer_id: str, current_user=Depends(get_current_user)):
   """Reactivate a surrendered customer."""
   if current_user["role"] not in ["admin", "support"]:
       raise HTTPException(status_code=403, detail="Only Admin or Support can reactivate customers")
   
   flt = _op_flt(current_user)
   with get_conn() as conn:
       cust = conn.execute(f"SELECT * FROM customers WHERE customer_id = ? AND {flt}", [customer_id]).fetchone()
       if not cust:
           raise HTTPException(status_code=404, detail="Customer not found")
       if cust["status"] not in ["Surrendered"]:
           raise HTTPException(status_code=400, detail="Customer is not surrendered")
   
       # Before reactivating, find STBs currently in inventory that were
       # associated with this customer so we can remove them.
       inv_stbs = conn.execute(
           f"""SELECT si.stb_no FROM stb_inventory si
               WHERE si.notes LIKE ? AND {_op_flt(current_user, 'si.')}""",
           [f"%customer {customer_id}%"]
       ).fetchall()
       inv_stb_list = [row["stb_no"] for row in inv_stbs]
       conn.execute(f"""UPDATE customers SET status = 'Active', 
                       surrendered_date = NULL, surrender_reason = NULL 
                       WHERE customer_id = ? AND {flt}""", [customer_id])
       conn.execute(f"UPDATE connections SET status = 'Active' WHERE customer_id = ? AND {flt}", [customer_id])
   
       # Remove reactivated STBs from inventory (they're back in use)
       for stb_no in inv_stb_list:
           conn.execute("DELETE FROM stb_inventory WHERE stb_no = ?", [stb_no])
   
       conn.commit()
   
       return {"message": f"Customer {customer_id} reactivated", "customer_id": customer_id}
