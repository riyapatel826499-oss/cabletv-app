     1|from fastapi import APIRouter, Depends, HTTPException, status, Request
     2|from pydantic import BaseModel
     3|from datetime import datetime, timedelta
     4|from typing import Optional, Dict
     5|
     6|from models.base import get_db
from conn import get_conn
     7|from deps_orm import _op_flt, get_current_user, apply_op_filter, op_id
     8|try:
     9|    from config import SR_BOT_TOKEN, SR_GROUP_ID
    10|except ImportError:
    11|    SR_BOT_TOKEN=***
    12|    SR_GROUP_ID = None
    13|try:
    14|    from routes.tg_service_bot import (
    15|        update_ticket_message, process_webhook_update, answer_callback,
    16|        post_new_ticket, send_daily_summary
    17|    )
    18|except ImportError:
    19|    update_ticket_message = process_webhook_update = answer_callback = post_new_ticket = send_daily_summary = None
    20|
    21|import random, time as _time
    22|
    23|def gen_ticket_no(prefix='SR', conn=None):
    24|    from datetime import datetime
    25|    today = datetime.utcnow().strftime("%d%m")  # IST ~ UTC+5:30 but date boundary fine for ticket labels
    26|    date_prefix = f"{prefix}-{today}"
    27|    if conn is not None:
    28|        row = conn.execute(
    29|            "SELECT ticket_no FROM service_requests WHERE ticket_no LIKE ? ORDER BY id DESC LIMIT 1",
    30|            (date_prefix + '-%',)
    31|        ).fetchone()
    32|        if row:
    33|            try:
    34|                num = int(row[0].split('-')[-1]) + 1
    35|            except (ValueError, IndexError):
    36|                num = 1
    37|        else:
    38|            num = 1
    39|        return f"{date_prefix}-{num:03d}"
    40|    return f"{date_prefix}-{_time.strftime('%H%M')}"
    41|
    42|router = APIRouter(prefix="/api", tags=["Service Requests"])
    43|
    44|# --- Models ---
    45|
    46|
    47|class ServiceRequestCreate(BaseModel):
    48|    ticket_no: str
    49|    customer_id: str
    50|    type: str
    51|    category: str
    52|    priority: str = "medium"
    53|    description: str
    54|    assigned_to: Optional[int] = None
    55|    source: str = "app"
    56|
    57|
    58|class ServiceRequestUpdateStatus(BaseModel):
    59|    status: str
    60|
    61|
    62|class ServiceRequestAssign(BaseModel):
    63|    assigned_to: int
    64|
    65|
    66|# --- Core CRUD routes ---
    67|
    68|
    69|@router.post("/service-requests/", status_code=201)
    70|async def create_service_request(
    71|    data: ServiceRequestCreate,
    72|    current_user: dict = Depends(get_current_user),
    73|):
    74|    with get_conn() as conn:
    75|        _opf = _op_flt(current_user)
    76|        _opfsr = _op_flt(current_user, "sr")
    77|        # Validate customer
    78|        customer = conn.execute(
    79|            f"SELECT customer_id, name, phone, area FROM customers WHERE customer_id = ? AND {_opf}",
    80|            (data.customer_id,)
    81|        ).fetchone()
    82|        if not customer:
    83|            raise HTTPException(status_code=404, detail="Customer not found")
    84|
    85|        # Auto-assign to first service_agent if not specified
    86|        assigned_to = data.assigned_to
    87|        if not assigned_to:
    88|            agent = conn.execute(
    89|                f"SELECT id, name FROM users WHERE role = 'service_agent' AND {_opf} LIMIT 1",
    90|            ).fetchone()
    91|            if agent:
    92|                assigned_to = agent["id"]
    93|
    94|        # Ensure ticket_no is unique
    95|        if not data.ticket_no:
    96|            prefix = "SR"
    97|            tno = gen_ticket_no(prefix, conn)
    98|        else:
    99|            tno = data.ticket_no
   100|
   101|        # Insert service request
   102|        created_by_id = current_user.get("id")
   103|        conn.execute(
   104|            """INSERT INTO service_requests (
   105|                ticket_no, customer_id, type, category, priority, description, assigned_to, status, source, created_by, operator_id
   106|            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
   107|            (
   108|                tno,
   109|                data.customer_id,
   110|                data.type,
   111|                data.category,
   112|                data.priority,
   113|                data.description,
   114|                assigned_to,
   115|                "open",
   116|                data.source,
   117|                created_by_id,
   118|                op_id(current_user) or 1,
   119|            ),
   120|        )
   121|        sr_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
   122|        conn.commit()
   123|
   124|        # Fetch enriched row
   125|        sr = conn.execute(
   126|            f"""
   127|            SELECT 
   128|                sr.*, c.name as customer_name, c.phone as customer_phone, c.area as customer_area,
   129|                u.name as assigned_to_name
   130|            FROM service_requests sr
   131|            LEFT JOIN customers c ON c.customer_id = sr.customer_id
   132|            LEFT JOIN users u ON u.id = sr.assigned_to
   133|            WHERE sr.id = ? AND {_opfsr}
   134|            """,
   135|            (sr_id,),
   136|        ).fetchone()
   137|        if not sr:
   138|            raise HTTPException(status_code=404, detail="Service request not persisted correctly")
   139|
   140|        # Post to TG if group set
   141|        if SR_GROUP_ID and SR_BOT_TOKEN:
   142|            try:
   143|                card = {
   144|                    "ticket_no": sr["ticket_no"],
   145|                    "customer_id": sr["customer_id"],
   146|                    "customer_name": sr["customer_name"],
   147|                    "customer_phone": sr["customer_phone"],
   148|                    "customer_area": sr["customer_area"],
   149|                    "type": sr["type"],
   150|                    "category": sr["category"],
   151|                    "priority": sr["priority"],
   152|                    "description": sr["description"],
   153|                    "status": sr["status"],
   154|                    "assigned_to_name": sr["assigned_to_name"],
   155|                    "deadline": None,
   156|                    "created_at": sr["created_at"],
   157|                    "acknowledged_at": sr["acknowledged_at"],
   158|                    "on_the_way_at": sr["on_the_way_at"],
   159|                    "resolved_at": sr["resolved_at"],
   160|                }
   161|                msg_id = post_new_ticket(card, is_admin=True)  # Web app = admin
   162|                if msg_id:
   163|                    conn.execute(
   164|                        "UPDATE service_requests SET tg_message_id = ? WHERE id = ?",
   165|                        (msg_id, sr_id),
   166|                    )
   167|                    conn.commit()
   168|            except Exception as exc:
   169|                # Non-fatal; application continues without TG post
   170|                pass
   171|
   172|        return {"message": "Service request created", "ticket_no": sr["ticket_no"]}
   173|
   174|
   175|@router.get("/service-requests/")
   176|async def list_service_requests(
   177|    status: str = "",
   178|    current_user: dict = Depends(get_current_user),
   179|):
   180|    with get_conn() as conn:
   181|        try:
   182|            _opf = _op_flt(current_user, "sr")
   183|            where = f"WHERE {_opf}"
   184|            params = []
   185|            if status:
   186|                where += " AND sr.status = ?"
   187|                params.append(status)
   188|            srs = conn.execute(
   189|                f"""
   190|                SELECT 
   191|                sr.*, c.name as customer_name, c.phone as customer_phone, c.area as customer_area,
   192|                u.name as assigned_to_name
   193|                FROM service_requests sr
   194|                LEFT JOIN customers c ON c.customer_id = sr.customer_id
   195|                LEFT JOIN users u ON u.id = sr.assigned_to
   196|                {where}
   197|                ORDER BY sr.created_at DESC
   198|                """,
   199|                params,
   200|            ).fetchall()
   201|            return [dict(sr) for sr in srs]
   202|        except Exception as e:
   203|            # Table might not exist yet
   204|            if "no such table" in str(e).lower():
   205|                return []
   206|            raise
   207|
   208|
   209|@router.get("/service-requests/{ticket_no}")
   210|async def get_service_request(
   211|    ticket_no: str,
   212|    current_user: dict = Depends(get_current_user),
   213|):
   214|    with get_conn() as conn:
   215|        _opf = _op_flt(current_user, "sr")
   216|        sr = conn.execute(
   217|            f"""
   218|            SELECT 
   219|                sr.*, c.name as customer_name, c.phone as customer_phone, c.area as customer_area,
   220|                u.name as assigned_to_name
   221|            FROM service_requests sr
   222|            LEFT JOIN customers c ON c.customer_id = sr.customer_id
   223|            LEFT JOIN users u ON u.id = sr.assigned_to
   224|            WHERE sr.ticket_no = ? AND {_opf}
   225|            """,
   226|            (ticket_no,),
   227|        ).fetchone()
   228|        if not sr:
   229|            raise HTTPException(status_code=404, detail="Service request not found")
   230|        return dict(sr)
   231|
   232|
   233|# --- Actions routes ---
   234|
   235|
   236|@router.put("/service-requests/{ticket_no}/status")
   237|async def update_service_request_status(
   238|    ticket_no: str,
   239|    data: ServiceRequestUpdateStatus,
   240|    current_user: dict = Depends(get_current_user),
   241|):
   242|    with get_conn() as conn:
   243|        _opf = _op_flt(current_user)
   244|        _opfsr = _op_flt(current_user, "sr")
   245|        sr = conn.execute(
   246|            f"SELECT * FROM service_requests WHERE ticket_no = ? AND {_opf}",
   247|            (ticket_no,),
   248|        ).fetchone()
   249|        if not sr:
   250|            raise HTTPException(status_code=404, detail="Service request not found")
   251|        if sr["status"] == "resolved" and data.status != "closed":
   252|            raise HTTPException(status_code=400, detail="Cannot update resolved service request")
   253|
   254|        updated = conn.execute(
   255|            f"""
   256|            UPDATE service_requests SET 
   257|                status = ?, updated_at = CURRENT_TIMESTAMP
   258|            WHERE ticket_no = ? AND {_opf}
   259|            """,
   260|            (data.status, ticket_no),
   261|        )
   262|        if updated.rowcount == 0:
   263|            raise HTTPException(status_code=403, detail="Record locked or not operator-scoped")
   264|        conn.commit()
   265|
   266|        # Fetch fresh
   267|        sr2 = conn.execute(
   268|            f"""
   269|            SELECT sr.*, u.name as assigned_to_name, c.name as customer_name, c.phone as customer_phone, c.area as customer_area
   270|            FROM service_requests sr
   271|            LEFT JOIN users u ON u.id = sr.assigned_to
   272|            LEFT JOIN customers c ON c.customer_id = sr.customer_id
   273|            WHERE sr.ticket_no = ? AND {_opfsr}
   274|            """,
   275|            (ticket_no,),
   276|        ).fetchone()
   277|        # Post updated card to TG if available
   278|        if sr2 and SR_GROUP_ID and SR_BOT_TOKEN and sr2.get("tg_message_id"):
   279|            try:
   280|                card = dict(sr2)
   281|                msg_id = post_new_ticket(card)
   282|                if msg_id:
   283|                    conn.execute(
   284|                        "UPDATE service_requests SET tg_message_id = ? WHERE ticket_no = ?",
   285|                        (msg_id, ticket_no),
   286|                    )
   287|                    conn.commit()
   288|            except Exception:
   289|                pass
   290|
   291|        return {"message": "Service request status updated"}
   292|
   293|
   294|@router.put("/service-requests/{ticket_no}/assign")
   295|async def assign_service_request(
   296|    ticket_no: str,
   297|    data: ServiceRequestAssign,
   298|    current_user: dict = Depends(get_current_user),
   299|):
   300|    with get_conn() as conn:
   301|        _opf = _op_flt(current_user)
   302|        _opfsr = _op_flt(current_user, "sr")
   303|        sr = conn.execute(
   304|            f"SELECT * FROM service_requests WHERE ticket_no = ? AND {_opf}",
   305|            (ticket_no,),
   306|        ).fetchone()
   307|        if not sr:
   308|            raise HTTPException(status_code=404, detail="Service request not found")
   309|        if sr["status"] != "open":
   310|            raise HTTPException(status_code=400, detail="Cannot assign service request that is not open")
   311|
   312|        conn.execute(
   313|            f"UPDATE service_requests SET assigned_to = ?, status = 'assigned', updated_at = CURRENT_TIMESTAMP WHERE ticket_no = ? AND {_opf}",
   314|            (data.assigned_to, ticket_no),
   315|        )
   316|        conn.commit()
   317|
   318|        # Fetch updated for response
   319|        updated = conn.execute(
   320|            f"""
   321|            SELECT sr.*, u.name as assigned_to_name, c.name as customer_name, c.phone as customer_phone
   322|            FROM service_requests sr
   323|            LEFT JOIN users u ON u.id = sr.assigned_to
   324|            LEFT JOIN customers c ON c.customer_id = sr.customer_id
   325|            WHERE sr.ticket_no = ? AND {_opfsr}
   326|            """,
   327|            (ticket_no,),
   328|        ).fetchone()
   329|        return dict(updated)
   330|
   331|
   332|@router.get("/service-requests/stats/summary")
   333|async def get_service_request_stats(
   334|    current_user: dict = Depends(get_current_user),
   335|):
   336|    with get_conn() as conn:
   337|        try:
   338|            _opf = _op_flt(current_user)
   339|            stats = conn.execute(
   340|                f"""
   341|                SELECT 
   342|                COUNT(*) as total,
   343|                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
   344|                SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) as assigned_count,
   345|                SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
   346|                SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count,
   347|                SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count,
   348|                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count
   349|                FROM service_requests WHERE {_opf}
   350|                """,
   351|            ).fetchone()
   352|            return dict(stats)
   353|        except Exception as e:
   354|            if "no such table" in str(e).lower():
   355|                return {"total": 0, "open_count": 0, "assigned_count": 0, "in_progress_count": 0, "resolved_count": 0, "closed_count": 0, "cancelled_count": 0}
   356|            raise
   357|
   358|
   359|@router.get("/service-requests/agent/{user_id}/tasks")
   360|async def get_service_requests_for_agent(
   361|    user_id: int,
   362|    current_user: dict = Depends(get_current_user),
   363|):
   364|    with get_conn() as conn:
   365|        _opf = _op_flt(current_user, "sr")
   366|        srs = conn.execute(
   367|            f"""
   368|            SELECT 
   369|                sr.*, c.name as customer_name, c.phone as customer_phone, c.area as customer_area,
   370|                u.name as assigned_to_name
   371|            FROM service_requests sr
   372|            LEFT JOIN customers c ON c.customer_id = sr.customer_id
   373|            LEFT JOIN users u ON u.id = sr.assigned_to
   374|            WHERE assigned_to = ? AND sr.status IN ('open','assigned','in_progress') AND {_opf}
   375|            ORDER BY sr.created_at DESC
   376|            """,
   377|            (user_id,),
   378|        ).fetchall()
   379|        return [dict(sr) for sr in srs]
   380|
   381|
   382|# --- Webhook route for Telegram callbacks ---
   383|
   384|@router.post("/service-requests/webhook")
   385|async def service_request_webhook(request: Request):
   386|    try:
   387|        try:
   388|            body = await request.json()
   389|        except Exception:
   390|            return {"ok": True, "error": "invalid json"}
   391|        
   392|        if not SR_BOT_TOKEN or not SR_GROUP_ID:
   393|            return {"ok": True, "result": []}
   394|
   395|        if not process_webhook_update:
   396|            return {"ok": True, "error": "bot module not loaded"}
   397|
   398|        parsed = process_webhook_update(body)
   399|        if not parsed:
   400|            return {"ok": True, "result": []}
   401|
   402|        # Handle /commands (messages starting with /)
   403|        if parsed.get("type") == "command":
   404|            cmd = parsed.get("command", "")
   405|            if cmd == "/new":
   406|                return await _handle_new_command(parsed)
   407|            elif cmd == "/start":
   408|                from routes.tg_service_bot import send_message as tg_send
   409|                tg_send(str(parsed.get("chat_id", SR_GROUP_ID)),
   410|                    "<b>SSNA Cables Service Request Bot</b>\n\n"
   411|                    "<b>Commands:</b>\n"
   412|                    "  /new PHONE TYPE DESCRIPTION - Create ticket\n\n"
   413|                    "<b>Types:</b> complaint, reconnection, new_connection, plan_change, stb_swap, address_shift")
   414|                return {"ok": True}
   415|            return {"ok": True, "result": []}
   416|
   417|        # Handle callback button presses
   418|        from routes.tg_service_bot import ACTION_STATUS, ACTION_ACK_MSG, is_admin_user
   419|        action = parsed.get("action")
   420|        ticket_no = parsed.get("ticket_no")
   421|        cbqid = parsed.get("callback_query_id")
   422|        msg_id = parsed.get("message_id")
   423|        from_user = parsed.get("from_user", {})
   424|        tg_user_name = from_user.get("first_name", from_user.get("username", "Agent"))
   425|        admin = is_admin_user(from_user)
   426|
   427|        new_status = ACTION_STATUS.get(action)
   428|
   429|        # Block non-admin from close/cancel
   430|        if action in ("close", "cancel") and not admin:
   431|            if cbqid:
   432|                answer_callback(cbqid, text="⛔ Only admin can close/cancel")
   433|            return {"ok": True, "error": "unauthorized"}
   434|
   435|        if new_status and ticket_no:
   436|            with get_conn() as conn:
   437|                extra = ""
   438|                if action == "ack":
   439|                    extra = ", acknowledged_at = CURRENT_TIMESTAMP"
   440|                elif action == "onway":
   441|                    extra = ", on_the_way_at = CURRENT_TIMESTAMP"
   442|                elif new_status == "settled":
   443|                    extra = ", resolved_at = CURRENT_TIMESTAMP"
   444|                conn.execute(
   445|                    f"UPDATE service_requests SET status = ?, updated_at = CURRENT_TIMESTAMP{extra} WHERE ticket_no = ?",
   446|                    (new_status, ticket_no),
   447|                )
   448|                conn.commit()
   449|
   450|                sr = conn.execute(
   451|                    """SELECT sr.*, c.name as customer_name, c.phone as customer_phone,
   452|                       c.area as customer_area, u.name as assigned_to_name
   453|                       FROM service_requests sr
   454|                       LEFT JOIN customers c ON c.customer_id = sr.customer_id
   455|                       LEFT JOIN users u ON u.id = sr.assigned_to
   456|                       WHERE sr.ticket_no = ?""",
   457|                    (ticket_no,),
   458|                ).fetchone()
   459|
   460|                if sr and msg_id:
   461|                    card = {
   462|                        "ticket_no": sr["ticket_no"],
   463|                        "customer_id": sr["customer_id"],
   464|                        "customer_name": sr["customer_name"],
   465|                        "customer_phone": sr["customer_phone"],
   466|                        "customer_area": sr["customer_area"],
   467|                        "type": sr["type"],
   468|                        "category": sr["category"],
   469|                        "priority": sr["priority"],
   470|                        "description": sr["description"],
   471|                        "status": new_status,
   472|                        "assigned_to_name": sr["assigned_to_name"],
   473|                        "deadline": sr["deadline"],
   474|                        "created_at": sr["created_at"],
   475|                        "acknowledged_at": sr["acknowledged_at"],
   476|                        "on_the_way_at": sr["on_the_way_at"],
   477|                        "resolved_at": sr["resolved_at"],
   478|                    }
   479|                    update_ticket_message(ticket_no, card, msg_id, is_admin=admin)
   480|
   481|        if cbqid:
   482|            ack_text = ACTION_ACK_MSG.get(action, "✅ Updated")
   483|            answer_callback(cbqid, text=f"{ack_text} by {tg_user_name}")
   484|
   485|    except Exception as exc:
   486|        import traceback
   487|        return {"ok": False, "error": str(exc), "traceback": traceback.format_exc()}
   488|
   489|    return {"message": "handled"}
   490|
   491|
   492|async def _handle_new_command(parsed: dict) -> dict:
   493|    """Handle /new command: /new PHONE [TYPE] [description...]"""
   494|    from routes.tg_service_bot import send_message as tg_send, post_new_ticket
   495|    chat_id = parsed.get("chat_id")
   496|    args = parsed.get("args", [])
   497|
   498|    # Usage help
   499|    if not args:
   500|        tg_send(str(chat_id),
   501|            "<b>Usage:</b> <code>/new PHONE TYPE DESCRIPTION</code>\n"
   502|            "Example: <code>/new 9787225577 complaint signal issue in Settop box</code>\n\n"
   503|            "<b>Types:</b> complaint, reconnection, new_connection, plan_change, stb_swap, address_shift")
   504|        return {"ok": True}
   505|
   506|    phone_raw = args[0].strip()
   507|    sr_type = args[1].lower() if len(args) > 1 else "complaint"
   508|    desc = " ".join(args[2:]) if len(args) > 2 else ""
   509|
   510|    # Normalize type aliases
   511|    type_map = {"reconnect": "reconnection", "new": "new_connection", "swap": "stb_swap", "shift": "address_shift", "plan": "plan_change"}
   512|    sr_type = type_map.get(sr_type, sr_type)
   513|
   514|    try:
   515|        with get_conn() as conn:
   516|            # Extract last 10 digits from whatever user typed
   517|            digits = ''.join(c for c in phone_raw if c.isdigit())
   518|            if len(digits) >= 10:
   519|                last_10 = digits[-10:]
   520|            else:
   521|                last_10 = digits
   522|
   523|            # Find customer by phone — need at least 5 digits
   524|            customer = None
   525|            if len(last_10) >= 5:
   526|                customer = conn.execute(
   527|                    "SELECT customer_id, name, phone, area FROM customers WHERE phone LIKE ? LIMIT 1",
   528|                    (f"%{last_10}%",)
   529|                ).fetchone()
   530|
   531|            if not customer:
   532|                # Customer not found — ask user to provide valid phone
   533|                tg_send(str(chat_id),
   534|                    f"❌ <b>Customer not found</b> for phone/ID: <code>{phone_raw}</code>\n\n"
   535|                    f"Please use a registered phone number.\n"
   536|                    f"<b>Usage:</b> <code>/new PHONE TYPE DESCRIPTION</code>")
   537|                return {"ok": True}
   538|
   539|            # Auto-assign to first service_agent
   540|            assigned_to = None
   541|            agent = conn.execute("SELECT id FROM users WHERE role = 'service_agent' LIMIT 1").fetchone()
   542|            if agent:
   543|                assigned_to = agent["id"]
   544|
   545|            # Determine category from description
   546|            category = "misc"
   547|            desc_lower = desc.lower()
   548|            if any(w in desc_lower for w in ("signal", "picture", "video", "settop", "stb", "box")):
   549|                category = "signal"
   550|            elif any(w in desc_lower for w in ("internet", "wifi", "speed", "data", "connection")):
   551|                category = "internet"
   552|            elif any(w in desc_lower for w in ("bill", "payment", "receipt", "amount")):
   553|                category = "billing"
   554|            elif any(w in desc_lower for w in ("remote", "wire")):
   555|                category = "hardware"
   556|
   557|            ticket_no = gen_ticket_no("SR", conn)
   558|            conn.execute(
   559|                """INSERT INTO service_requests
   560|                   (ticket_no, customer_id, type, category, priority, description, assigned_to, status, source, created_by, operator_id)
   561|                   VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 'telegram', ?, 1)""",
   562|                (ticket_no,
   563|                 customer["customer_id"],
   564|                 sr_type, category, "medium",
   565|                 desc or "Created from Telegram",
   566|                 assigned_to,
   567|                 1)  # created_by = admin
   568|            )
   569|            sr_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
   570|            conn.commit()
   571|
   572|            # Fetch enriched SR for TG card
   573|            sr = conn.execute(
   574|                """SELECT sr.*, c.name as customer_name, c.phone as customer_phone,
   575|                          c.area as customer_area, u.name as assigned_to_name
   576|                   FROM service_requests sr
   577|                   LEFT JOIN customers c ON c.customer_id = sr.customer_id
   578|                   LEFT JOIN users u ON u.id = sr.assigned_to
   579|                   WHERE sr.id = ?""", (sr_id,)
   580|            ).fetchone()
   581|
   582|            # Post ticket card to TG group
   583|            if sr:
   584|                card = {
   585|                    "ticket_no": sr["ticket_no"],
   586|                    "customer_id": sr["customer_id"],
   587|                    "customer_name": sr["customer_name"],
   588|                    "customer_phone": sr["customer_phone"],
   589|                    "customer_area": sr["customer_area"],
   590|                    "type": sr["type"],
   591|                    "category": sr["category"],
   592|                    "priority": sr["priority"],
   593|                    "description": sr["description"],
   594|                    "status": sr["status"],
   595|                    "assigned_to_name": sr["assigned_to_name"],
   596|                    "deadline": sr["deadline"],
   597|                    "created_at": sr["created_at"],
   598|                    "acknowledged_at": sr["acknowledged_at"],
   599|                    "on_the_way_at": sr["on_the_way_at"],
   600|                    "resolved_at": sr["resolved_at"],
   601|                }
   602|                msg_id = post_new_ticket(card)
   603|                if msg_id:
   604|                    conn.execute("UPDATE service_requests SET tg_message_id = ? WHERE id = ?", (msg_id, sr_id))
   605|                    conn.commit()
   606|
   607|    except Exception as exc:
   608|        tg_send(str(chat_id), f"❌ Failed to create SR: {str(exc)[:200]}")
   609|
   610|    return {"ok": True}
   611|
   612|
   613|@router.post("/service-requests/daily-summary")
   614|def trigger_daily_summary():
   615|    """Trigger daily SR summary — called by server cron (no auth needed)."""
   616|    if not send_daily_summary:
   617|        raise HTTPException(500, "send_daily_summary not available")
   618|    try:
   619|        with get_conn() as conn:
   620|            ok = send_daily_summary(conn)
   621|        return {"ok": ok}
   622|    except Exception as e:
   623|        raise HTTPException(500, str(e))
   624|
   625|
   626|
   627|# Temporary debug endpoint - REMOVE AFTER TESTING
   628|@router.get("/service-requests/debug-imports")
   629|def debug_imports():
   630|    results = {}
   631|    try:
   632|        from routes.tg_service_bot import send_message, post_new_ticket, process_webhook_update
   633|        results["tg_service_bot"] = "OK"
   634|    except Exception as e:
   635|        results["tg_service_bot"] = f"FAIL: {e}"
   636|    try:
   637|        import requests
   638|        results["requests"] = "OK"
   639|    except Exception as e:
   640|        results["requests"] = f"FAIL: {e}"
   641|    try:
   642|        from config import SR_BOT_TOKEN, SR_GROUP_ID
   643|        results["SR_BOT_TOKEN_len"] = len(SR_BOT_TOKEN) if SR_BOT_TOKEN else 0
   644|        results["SR_GROUP_ID"] = SR_GROUP_ID
   645|    except Exception as e:
   646|        results["config"] = f"FAIL: {e}"
   647|    return results
   648|