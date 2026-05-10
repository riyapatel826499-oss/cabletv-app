from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional, Dict

from deps import get_db, get_current_user, op_filter, op_id
try:
    from config import SR_BOT_TOKEN, SR_GROUP_ID
except ImportError:
    SR_BOT_TOKEN = None
    SR_GROUP_ID = None
try:
    from routes.tg_service_bot import (
        update_ticket_message, process_webhook_update, answer_callback,
        post_new_ticket, send_daily_summary
    )
except ImportError:
    update_ticket_message = process_webhook_update = answer_callback = post_new_ticket = send_daily_summary = None

import random, time as _time

def gen_ticket_no(prefix='SR', conn=None):
    from datetime import datetime
    today = datetime.utcnow().strftime("%d%m")  # IST ~ UTC+5:30 but date boundary fine for ticket labels
    date_prefix = f"{prefix}-{today}"
    if conn is not None:
        row = conn.execute(
            "SELECT ticket_no FROM service_requests WHERE ticket_no LIKE ? ORDER BY id DESC LIMIT 1",
            (date_prefix + '-%',)
        ).fetchone()
        if row:
            try:
                num = int(row[0].split('-')[-1]) + 1
            except (ValueError, IndexError):
                num = 1
        else:
            num = 1
        return f"{date_prefix}-{num:03d}"
    return f"{date_prefix}-{_time.strftime('%H%M')}"

router = APIRouter(prefix="/api", tags=["Service Requests"])

# --- Models ---


class ServiceRequestCreate(BaseModel):
    ticket_no: str
    customer_id: str
    type: str
    category: str
    priority: str = "medium"
    description: str
    assigned_to: Optional[int] = None
    source: str = "app"


class ServiceRequestUpdateStatus(BaseModel):
    status: str


class ServiceRequestAssign(BaseModel):
    assigned_to: int


# --- Core CRUD routes ---


@router.post("/service-requests/", status_code=201)
async def create_service_request(
    data: ServiceRequestCreate,
    current_user: dict = Depends(get_current_user),
):
    with get_db() as conn:
        _opf = op_filter(current_user)
        _opfsr = op_filter(current_user, "sr")
        # Validate customer
        customer = conn.execute(
            f"SELECT customer_id, name, phone, area FROM customers WHERE customer_id = ? AND {_opf}",
            (data.customer_id,)
        ).fetchone()
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")

        # Auto-assign to first service_agent if not specified
        assigned_to = data.assigned_to
        if not assigned_to:
            agent = conn.execute(
                f"SELECT id, name FROM users WHERE role = 'service_agent' AND {_opf} LIMIT 1",
            ).fetchone()
            if agent:
                assigned_to = agent["id"]

        # Ensure ticket_no is unique
        if not data.ticket_no:
            prefix = "SR"
            tno = gen_ticket_no(prefix, conn)
        else:
            tno = data.ticket_no

        # Insert service request
        created_by_id = current_user.get("id")
        conn.execute(
            """INSERT INTO service_requests (
                ticket_no, customer_id, type, category, priority, description, assigned_to, status, source, created_by, operator_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                tno,
                data.customer_id,
                data.type,
                data.category,
                data.priority,
                data.description,
                assigned_to,
                "open",
                data.source,
                created_by_id,
                op_id(current_user) or 1,
            ),
        )
        sr_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.commit()

        # Fetch enriched row
        sr = conn.execute(
            f"""
            SELECT 
                sr.*, c.name as customer_name, c.phone as customer_phone, c.area as customer_area,
                u.name as assigned_to_name
            FROM service_requests sr
            LEFT JOIN customers c ON c.customer_id = sr.customer_id
            LEFT JOIN users u ON u.id = sr.assigned_to
            WHERE sr.id = ? AND {_opfsr}
            """,
            (sr_id,),
        ).fetchone()
        if not sr:
            raise HTTPException(status_code=404, detail="Service request not persisted correctly")

        # Post to TG if group set
        if SR_GROUP_ID and SR_BOT_TOKEN:
            try:
                card = {
                    "ticket_no": sr["ticket_no"],
                    "customer_id": sr["customer_id"],
                    "customer_name": sr["customer_name"],
                    "customer_phone": sr["customer_phone"],
                    "customer_area": sr["customer_area"],
                    "type": sr["type"],
                    "category": sr["category"],
                    "priority": sr["priority"],
                    "description": sr["description"],
                    "status": sr["status"],
                    "assigned_to_name": sr["assigned_to_name"],
                    "deadline": None,
                    "created_at": sr["created_at"],
                    "acknowledged_at": sr["acknowledged_at"],
                    "on_the_way_at": sr["on_the_way_at"],
                    "resolved_at": sr["resolved_at"],
                }
                msg_id = post_new_ticket(card, is_admin=True)  # Web app = admin
                if msg_id:
                    conn.execute(
                        "UPDATE service_requests SET tg_message_id = ? WHERE id = ?",
                        (msg_id, sr_id),
                    )
                    conn.commit()
            except Exception as exc:
                # Non-fatal; application continues without TG post
                pass

        return {"message": "Service request created", "ticket_no": sr["ticket_no"]}


@router.get("/service-requests/")
async def list_service_requests(
    status: str = "",
    current_user: dict = Depends(get_current_user),
):
    with get_db() as conn:
        try:
            _opf = op_filter(current_user, "sr")
            where = f"WHERE {_opf}"
            params = []
            if status:
                where += " AND sr.status = ?"
                params.append(status)
            srs = conn.execute(
                f"""
                SELECT 
                sr.*, c.name as customer_name, c.phone as customer_phone, c.area as customer_area,
                u.name as assigned_to_name
                FROM service_requests sr
                LEFT JOIN customers c ON c.customer_id = sr.customer_id
                LEFT JOIN users u ON u.id = sr.assigned_to
                {where}
                ORDER BY sr.created_at DESC
                """,
                params,
            ).fetchall()
            return [dict(sr) for sr in srs]
        except Exception as e:
            # Table might not exist yet
            if "no such table" in str(e).lower():
                return []
            raise


@router.get("/service-requests/{ticket_no}")
async def get_service_request(
    ticket_no: str,
    current_user: dict = Depends(get_current_user),
):
    with get_db() as conn:
        _opf = op_filter(current_user, "sr")
        sr = conn.execute(
            f"""
            SELECT 
                sr.*, c.name as customer_name, c.phone as customer_phone, c.area as customer_area,
                u.name as assigned_to_name
            FROM service_requests sr
            LEFT JOIN customers c ON c.customer_id = sr.customer_id
            LEFT JOIN users u ON u.id = sr.assigned_to
            WHERE sr.ticket_no = ? AND {_opf}
            """,
            (ticket_no,),
        ).fetchone()
        if not sr:
            raise HTTPException(status_code=404, detail="Service request not found")
        return dict(sr)


# --- Actions routes ---


@router.put("/service-requests/{ticket_no}/status")
async def update_service_request_status(
    ticket_no: str,
    data: ServiceRequestUpdateStatus,
    current_user: dict = Depends(get_current_user),
):
    with get_db() as conn:
        _opf = op_filter(current_user)
        _opfsr = op_filter(current_user, "sr")
        sr = conn.execute(
            f"SELECT * FROM service_requests WHERE ticket_no = ? AND {_opf}",
            (ticket_no,),
        ).fetchone()
        if not sr:
            raise HTTPException(status_code=404, detail="Service request not found")
        if sr["status"] == "resolved" and data.status != "closed":
            raise HTTPException(status_code=400, detail="Cannot update resolved service request")

        updated = conn.execute(
            f"""
            UPDATE service_requests SET 
                status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE ticket_no = ? AND {_opf}
            """,
            (data.status, ticket_no),
        )
        if updated.rowcount == 0:
            raise HTTPException(status_code=403, detail="Record locked or not operator-scoped")
        conn.commit()

        # Fetch fresh
        sr2 = conn.execute(
            f"""
            SELECT sr.*, u.name as assigned_to_name, c.name as customer_name, c.phone as customer_phone, c.area as customer_area
            FROM service_requests sr
            LEFT JOIN users u ON u.id = sr.assigned_to
            LEFT JOIN customers c ON c.customer_id = sr.customer_id
            WHERE sr.ticket_no = ? AND {_opfsr}
            """,
            (ticket_no,),
        ).fetchone()
        # Post updated card to TG if available
        if sr2 and SR_GROUP_ID and SR_BOT_TOKEN and sr2.get("tg_message_id"):
            try:
                card = dict(sr2)
                msg_id = post_new_ticket(card)
                if msg_id:
                    conn.execute(
                        "UPDATE service_requests SET tg_message_id = ? WHERE ticket_no = ?",
                        (msg_id, ticket_no),
                    )
                    conn.commit()
            except Exception:
                pass

        return {"message": "Service request status updated"}


@router.put("/service-requests/{ticket_no}/assign")
async def assign_service_request(
    ticket_no: str,
    data: ServiceRequestAssign,
    current_user: dict = Depends(get_current_user),
):
    with get_db() as conn:
        _opf = op_filter(current_user)
        _opfsr = op_filter(current_user, "sr")
        sr = conn.execute(
            f"SELECT * FROM service_requests WHERE ticket_no = ? AND {_opf}",
            (ticket_no,),
        ).fetchone()
        if not sr:
            raise HTTPException(status_code=404, detail="Service request not found")
        if sr["status"] != "open":
            raise HTTPException(status_code=400, detail="Cannot assign service request that is not open")

        conn.execute(
            f"UPDATE service_requests SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE ticket_no = ? AND {_opf}",
            (data.assigned_to, ticket_no),
        )
        conn.commit()

        # Fetch updated for response
        updated = conn.execute(
            f"""
            SELECT sr.*, u.name as assigned_to_name, c.name as customer_name, c.phone as customer_phone
            FROM service_requests sr
            LEFT JOIN users u ON u.id = sr.assigned_to
            LEFT JOIN customers c ON c.customer_id = sr.customer_id
            WHERE sr.ticket_no = ? AND {_opfsr}
            """,
            (ticket_no,),
        ).fetchone()
        return dict(updated)


@router.get("/service-requests/stats/summary")
async def get_service_request_stats(
    current_user: dict = Depends(get_current_user),
):
    with get_db() as conn:
        try:
            _opf = op_filter(current_user)
            stats = conn.execute(
                f"""
                SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
                SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) as assigned_count,
                SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
                SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count,
                SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count
                FROM service_requests WHERE {_opf}
                """,
            ).fetchone()
            return dict(stats)
        except Exception as e:
            if "no such table" in str(e).lower():
                return {"total": 0, "open_count": 0, "assigned_count": 0, "in_progress_count": 0, "resolved_count": 0, "closed_count": 0, "cancelled_count": 0}
            raise


@router.get("/service-requests/agent/{user_id}/tasks")
async def get_service_requests_for_agent(
    user_id: int,
    current_user: dict = Depends(get_current_user),
):
    with get_db() as conn:
        _opf = op_filter(current_user, "sr")
        srs = conn.execute(
            f"""
            SELECT 
                sr.*, c.name as customer_name, c.phone as customer_phone, c.area as customer_area,
                u.name as assigned_to_name
            FROM service_requests sr
            LEFT JOIN customers c ON c.customer_id = sr.customer_id
            LEFT JOIN users u ON u.id = sr.assigned_to
            WHERE assigned_to = ? AND sr.status IN ('open','assigned','in_progress') AND {_opf}
            ORDER BY sr.created_at DESC
            """,
            (user_id,),
        ).fetchall()
        return [dict(sr) for sr in srs]


# --- Webhook route for Telegram callbacks ---

@router.post("/service-requests/webhook")
async def service_request_webhook(request: Request):
    try:
        try:
            body = await request.json()
        except Exception:
            return {"ok": True, "error": "invalid json"}
        
        if not SR_BOT_TOKEN or not SR_GROUP_ID:
            return {"ok": True, "result": []}

        if not process_webhook_update:
            return {"ok": True, "error": "bot module not loaded"}

        parsed = process_webhook_update(body)
        if not parsed:
            return {"ok": True, "result": []}

        # Handle /commands (messages starting with /)
        if parsed.get("type") == "command":
            cmd = parsed.get("command", "")
            if cmd == "/new":
                return await _handle_new_command(parsed)
            elif cmd == "/start":
                from routes.tg_service_bot import send_message as tg_send
                tg_send(str(parsed.get("chat_id", SR_GROUP_ID)),
                    "<b>SSNA Cables Service Request Bot</b>\n\n"
                    "<b>Commands:</b>\n"
                    "  /new PHONE TYPE DESCRIPTION - Create ticket\n\n"
                    "<b>Types:</b> complaint, reconnection, new_connection, plan_change, stb_swap, address_shift")
                return {"ok": True}
            return {"ok": True, "result": []}

        # Handle callback button presses
        from routes.tg_service_bot import ACTION_STATUS, ACTION_ACK_MSG, is_admin_user
        action = parsed.get("action")
        ticket_no = parsed.get("ticket_no")
        cbqid = parsed.get("callback_query_id")
        msg_id = parsed.get("message_id")
        from_user = parsed.get("from_user", {})
        tg_user_name = from_user.get("first_name", from_user.get("username", "Agent"))
        admin = is_admin_user(from_user)

        new_status = ACTION_STATUS.get(action)

        # Block non-admin from close/cancel
        if action in ("close", "cancel") and not admin:
            if cbqid:
                answer_callback(cbqid, text="⛔ Only admin can close/cancel")
            return {"ok": True, "error": "unauthorized"}

        if new_status and ticket_no:
            with get_db() as conn:
                extra = ""
                if action == "ack":
                    extra = ", acknowledged_at = CURRENT_TIMESTAMP"
                elif action == "onway":
                    extra = ", on_the_way_at = CURRENT_TIMESTAMP"
                elif new_status == "settled":
                    extra = ", resolved_at = CURRENT_TIMESTAMP"
                conn.execute(
                    f"UPDATE service_requests SET status = ?, updated_at = CURRENT_TIMESTAMP{extra} WHERE ticket_no = ?",
                    (new_status, ticket_no),
                )
                conn.commit()

                sr = conn.execute(
                    """SELECT sr.*, c.name as customer_name, c.phone as customer_phone,
                       c.area as customer_area, u.name as assigned_to_name
                       FROM service_requests sr
                       LEFT JOIN customers c ON c.customer_id = sr.customer_id
                       LEFT JOIN users u ON u.id = sr.assigned_to
                       WHERE sr.ticket_no = ?""",
                    (ticket_no,),
                ).fetchone()

                if sr and msg_id:
                    card = {
                        "ticket_no": sr["ticket_no"],
                        "customer_id": sr["customer_id"],
                        "customer_name": sr["customer_name"],
                        "customer_phone": sr["customer_phone"],
                        "customer_area": sr["customer_area"],
                        "type": sr["type"],
                        "category": sr["category"],
                        "priority": sr["priority"],
                        "description": sr["description"],
                        "status": new_status,
                        "assigned_to_name": sr["assigned_to_name"],
                        "deadline": sr["deadline"],
                        "created_at": sr["created_at"],
                        "acknowledged_at": sr["acknowledged_at"],
                        "on_the_way_at": sr["on_the_way_at"],
                        "resolved_at": sr["resolved_at"],
                    }
                    update_ticket_message(ticket_no, card, msg_id, is_admin=admin)

        if cbqid:
            ack_text = ACTION_ACK_MSG.get(action, "✅ Updated")
            answer_callback(cbqid, text=f"{ack_text} by {tg_user_name}")

    except Exception as exc:
        import traceback
        return {"ok": False, "error": str(exc), "traceback": traceback.format_exc()}

    return {"message": "handled"}


async def _handle_new_command(parsed: dict) -> dict:
    """Handle /new command: /new PHONE [TYPE] [description...]"""
    from routes.tg_service_bot import send_message as tg_send, post_new_ticket
    chat_id = parsed.get("chat_id")
    args = parsed.get("args", [])

    # Usage help
    if not args:
        tg_send(str(chat_id),
            "<b>Usage:</b> <code>/new PHONE TYPE DESCRIPTION</code>\n"
            "Example: <code>/new 9787225577 complaint signal issue in Settop box</code>\n\n"
            "<b>Types:</b> complaint, reconnection, new_connection, plan_change, stb_swap, address_shift")
        return {"ok": True}

    phone_raw = args[0].strip()
    sr_type = args[1].lower() if len(args) > 1 else "complaint"
    desc = " ".join(args[2:]) if len(args) > 2 else ""

    # Normalize type aliases
    type_map = {"reconnect": "reconnection", "new": "new_connection", "swap": "stb_swap", "shift": "address_shift", "plan": "plan_change"}
    sr_type = type_map.get(sr_type, sr_type)

    try:
        with get_db() as conn:
            # Extract last 10 digits from whatever user typed
            digits = ''.join(c for c in phone_raw if c.isdigit())
            if len(digits) >= 10:
                last_10 = digits[-10:]
            else:
                last_10 = digits

            # Find customer by phone — need at least 5 digits
            customer = None
            if len(last_10) >= 5:
                customer = conn.execute(
                    "SELECT customer_id, name, phone, area FROM customers WHERE phone LIKE ? LIMIT 1",
                    (f"%{last_10}%",)
                ).fetchone()

            if not customer:
                # Customer not found — ask user to provide valid phone
                tg_send(str(chat_id),
                    f"❌ <b>Customer not found</b> for phone/ID: <code>{phone_raw}</code>\n\n"
                    f"Please use a registered phone number.\n"
                    f"<b>Usage:</b> <code>/new PHONE TYPE DESCRIPTION</code>")
                return {"ok": True}

            # Auto-assign to first service_agent
            assigned_to = None
            agent = conn.execute("SELECT id FROM users WHERE role = 'service_agent' LIMIT 1").fetchone()
            if agent:
                assigned_to = agent["id"]

            # Determine category from description
            category = "misc"
            desc_lower = desc.lower()
            if any(w in desc_lower for w in ("signal", "picture", "video", "settop", "stb", "box")):
                category = "signal"
            elif any(w in desc_lower for w in ("internet", "wifi", "speed", "data", "connection")):
                category = "internet"
            elif any(w in desc_lower for w in ("bill", "payment", "receipt", "amount")):
                category = "billing"
            elif any(w in desc_lower for w in ("remote", "wire")):
                category = "hardware"

            ticket_no = gen_ticket_no("SR", conn)
            conn.execute(
                """INSERT INTO service_requests
                   (ticket_no, customer_id, type, category, priority, description, assigned_to, status, source, created_by, operator_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 'telegram', ?, 1)""",
                (ticket_no,
                 customer["customer_id"],
                 sr_type, category, "medium",
                 desc or "Created from Telegram",
                 assigned_to,
                 1)  # created_by = admin
            )
            sr_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            conn.commit()

            # Fetch enriched SR for TG card
            sr = conn.execute(
                """SELECT sr.*, c.name as customer_name, c.phone as customer_phone,
                          c.area as customer_area, u.name as assigned_to_name
                   FROM service_requests sr
                   LEFT JOIN customers c ON c.customer_id = sr.customer_id
                   LEFT JOIN users u ON u.id = sr.assigned_to
                   WHERE sr.id = ?""", (sr_id,)
            ).fetchone()

            # Post ticket card to TG group
            if sr:
                card = {
                    "ticket_no": sr["ticket_no"],
                    "customer_id": sr["customer_id"],
                    "customer_name": sr["customer_name"],
                    "customer_phone": sr["customer_phone"],
                    "customer_area": sr["customer_area"],
                    "type": sr["type"],
                    "category": sr["category"],
                    "priority": sr["priority"],
                    "description": sr["description"],
                    "status": sr["status"],
                    "assigned_to_name": sr["assigned_to_name"],
                    "deadline": sr["deadline"],
                    "created_at": sr["created_at"],
                    "acknowledged_at": sr["acknowledged_at"],
                    "on_the_way_at": sr["on_the_way_at"],
                    "resolved_at": sr["resolved_at"],
                }
                msg_id = post_new_ticket(card)
                if msg_id:
                    conn.execute("UPDATE service_requests SET tg_message_id = ? WHERE id = ?", (msg_id, sr_id))
                    conn.commit()

    except Exception as exc:
        tg_send(str(chat_id), f"❌ Failed to create SR: {str(exc)[:200]}")

    return {"ok": True}


@router.post("/service-requests/daily-summary")
def trigger_daily_summary():
    """Trigger daily SR summary — called by server cron (no auth needed)."""
    if not send_daily_summary:
        raise HTTPException(500, "send_daily_summary not available")
    try:
        with get_db() as conn:
            ok = send_daily_summary(conn)
        return {"ok": ok}
    except Exception as e:
        raise HTTPException(500, str(e))



# Temporary debug endpoint - REMOVE AFTER TESTING
@router.get("/service-requests/debug-imports")
def debug_imports():
    results = {}
    try:
        from routes.tg_service_bot import send_message, post_new_ticket, process_webhook_update
        results["tg_service_bot"] = "OK"
    except Exception as e:
        results["tg_service_bot"] = f"FAIL: {e}"
    try:
        import requests
        results["requests"] = "OK"
    except Exception as e:
        results["requests"] = f"FAIL: {e}"
    try:
        from config import SR_BOT_TOKEN, SR_GROUP_ID
        results["SR_BOT_TOKEN_len"] = len(SR_BOT_TOKEN) if SR_BOT_TOKEN else 0
        results["SR_GROUP_ID"] = SR_GROUP_ID
    except Exception as e:
        results["config"] = f"FAIL: {e}"
    return results
