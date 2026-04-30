from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from deps import get_db, get_current_user

router = APIRouter(prefix="/api", tags=["Surrenders"])


class SurrenderRequest(BaseModel):
    reason: Optional[str] = None

@router.post("/customers/{customer_id}/surrender")
def surrender_customer(customer_id: str, req: SurrenderRequest = SurrenderRequest(), current_user=Depends(get_current_user)):
    """Surrender a customer. Admin/Support = immediate. Agent = pending approval."""
    with get_db() as conn:
        cust = conn.execute("SELECT * FROM customers WHERE customer_id = ?", [customer_id]).fetchone()
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")
        if cust["status"] in ["Surrendered", "Pending Surrender"]:
            raise HTTPException(status_code=400, detail=f"Customer is already {cust['status']}")
    
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        stbs = conn.execute("SELECT stb_no FROM connections WHERE customer_id = ?", [customer_id]).fetchall()
        stb_list = [row["stb_no"] for row in stbs if row["stb_no"]]
    
        # Admin/Support → immediate surrender
        if current_user["role"] in ["admin", "support"]:
            conn.execute("UPDATE connections SET status = 'Surrendered' WHERE customer_id = ?", [customer_id])
            conn.execute("""UPDATE customers SET status = 'Surrendered', 
                            surrendered_date = ?, surrender_reason = ? 
                            WHERE customer_id = ?""",
                         [now, req.reason, customer_id])
            # Add freed STBs to inventory
            for stb_no in stb_list:
                existing = conn.execute("SELECT id FROM stb_inventory WHERE stb_no = ?", [stb_no]).fetchone()
                if existing:
                    conn.execute("UPDATE stb_inventory SET status = 'available', notes = ? WHERE stb_no = ?",
                                [f"Returned from surrendered customer {customer_id}", stb_no])
                else:
                    conn.execute("""INSERT INTO stb_inventory (stb_no, status, added_at, notes)
                                    VALUES (?, 'available', ?, ?)""",
                                [stb_no, now, f"Returned from surrendered customer {customer_id}"])
            conn.commit()
            return {
                "message": f"Customer {customer_id} surrendered successfully",
                "customer_id": customer_id, "customer_name": cust["name"],
                "surrendered_date": now, "freed_stbs": stb_list,
                "added_to_inventory": stb_list, "reason": req.reason
            }
    
        # Agent/Service Agent → create pending request, freeze STB
        conn.execute("UPDATE connections SET status = 'Frozen' WHERE customer_id = ?", [customer_id])
        conn.execute("""UPDATE customers SET status = 'Pending Surrender',
                        surrender_reason = ? WHERE customer_id = ?""",
                     [req.reason, customer_id])
    
        # Create surrender request
        conn.execute("""INSERT INTO surrender_requests 
                        (customer_id, customer_name, stb_no, reason, 
                         requested_by, requested_by_name, requested_at, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')""",
                     [customer_id, cust["name"], ",".join(stb_list), req.reason,
                      current_user["id"], current_user["name"], now])
    
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
    """List surrender requests. Admin/Support only."""
    if current_user["role"] not in ["admin", "support"]:
        raise HTTPException(status_code=403, detail="Only Admin or Support can view surrender requests")
    
    with get_db() as conn:
        if status and status in ["pending", "approved", "rejected"]:
            rows = conn.execute(
                "SELECT * FROM surrender_requests WHERE status = ? ORDER BY requested_at DESC", [status]
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM surrender_requests ORDER BY requested_at DESC"
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
    
    with get_db() as conn:
        sr = conn.execute("SELECT * FROM surrender_requests WHERE id = ?", [request_id]).fetchone()
        if not sr:
            raise HTTPException(status_code=404, detail="Surrender request not found")
        if sr["status"] != "pending":
            raise HTTPException(status_code=400, detail=f"Request is already {sr['status']}")
    
        customer_id = sr["customer_id"]
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
        if req.action == "approve":
            # Full surrender: mark customer, connections, move STBs to inventory
            conn.execute("UPDATE connections SET status = 'Surrendered' WHERE customer_id = ?", [customer_id])
            conn.execute("""UPDATE customers SET status = 'Surrendered',
                            surrendered_date = ?, surrender_reason = ?
                            WHERE customer_id = ?""",
                         [now, sr["reason"], customer_id])
            # Add STBs to inventory
            stb_list = [s.strip() for s in sr["stb_no"].split(",") if s.strip()] if sr["stb_no"] else []
            for stb_no in stb_list:
                existing = conn.execute("SELECT id FROM stb_inventory WHERE stb_no = ?", [stb_no]).fetchone()
                if existing:
                    conn.execute("UPDATE stb_inventory SET status = 'available', notes = ? WHERE stb_no = ?",
                                [f"Approved surrender - customer {customer_id}", stb_no])
                else:
                    conn.execute("""INSERT INTO stb_inventory (stb_no, status, added_at, notes)
                                    VALUES (?, 'available', ?, ?)""",
                                [stb_no, now, f"Approved surrender - customer {customer_id}"])
        
            # Update request
            conn.execute("""UPDATE surrender_requests SET status = 'approved',
                            reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_notes = ?
                            WHERE id = ?""",
                         [current_user["id"], current_user["name"], now, req.notes, request_id])
            conn.commit()
            return {
                "message": f"Surrender request approved. Customer {customer_id} surrendered.",
                "customer_id": customer_id, "stbs_to_inventory": stb_list,
                "action": "approved"
            }
    
        elif req.action == "reject":
            # Revert: customer back to Active, connections unfrozen
            conn.execute("UPDATE connections SET status = 'Active' WHERE customer_id = ?", [customer_id])
            conn.execute("""UPDATE customers SET status = 'Active',
                            surrender_reason = NULL WHERE customer_id = ?""",
                         [customer_id])
            # Update request
            conn.execute("""UPDATE surrender_requests SET status = 'rejected',
                            reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_notes = ?
                            WHERE id = ?""",
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
    
    with get_db() as conn:
        cust = conn.execute("SELECT * FROM customers WHERE customer_id = ?", [customer_id]).fetchone()
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")
        if cust["status"] not in ["Surrendered"]:
            raise HTTPException(status_code=400, detail="Customer is not surrendered")
    
        conn.execute("""UPDATE customers SET status = 'Active', 
                        surrendered_date = NULL, surrender_reason = NULL 
                        WHERE customer_id = ?""", [customer_id])
        conn.execute("UPDATE connections SET status = 'Active' WHERE customer_id = ?", [customer_id])
    
        # Remove reactivated STBs from inventory (they're back in use)
        stbs = conn.execute("SELECT stb_no FROM connections WHERE customer_id = ?", [customer_id]).fetchall()
        for row in stbs:
            if row["stb_no"]:
                conn.execute("DELETE FROM stb_inventory WHERE stb_no = ?", [row["stb_no"]])
    
        conn.commit()
    
        return {"message": f"Customer {customer_id} reactivated", "customer_id": customer_id}
