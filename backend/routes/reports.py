     1|"""Reports API — area-wise collection, charts, etc."""
     2|from fastapi import APIRouter, Query, Depends
     3|from typing import Optional
     4|from models.base import get_db
from conn import get_conn
     5|from deps_orm import get_current_user, apply_op_filter, op_id
     6|
     7|router = APIRouter(prefix="/api/reports", tags=["Reports"])
     8|
     9|
    10|@router.get("/area-collection")
    11|def area_collection(
    12|    from_date: Optional[str] = Query(None),
    13|    to_date: Optional[str] = Query(None),
    14|    current_user=Depends(get_current_user),
    15|):
    16|    """Area-wise collection report combining local + Paypakka payments."""
    17|    flt_pp = op_filter(current_user, "pp.")
    18|    flt_p = op_filter(current_user, "p.")
    19|
    20|    with get_conn() as conn:
    21|        # Build area→amount map from BOTH payment sources
    22|        area_data = {}  # area -> {total_amount, customer_count}
    23|
    24|        # 1. Paypakka payments (LEFT JOIN — customer may not exist)
    25|        pp_query = f"""
    26|            SELECT COALESCE(c.area, 'Unknown') as area, 
    27|                   SUM(pp.collection_amount) as total, 
    28|                   COUNT(DISTINCT pp.customer_id) as cust_count
    29|            FROM paypakka_payments pp
    30|            LEFT JOIN customers c ON pp.customer_id = c.customer_id
    31|            WHERE {flt_pp}
    32|        """
    33|        pp_params = []
    34|        if from_date:
    35|            pp_query += " AND date(pp.paypakka_created_at) >= ?"
    36|            pp_params.append(from_date)
    37|        if to_date:
    38|            pp_query += " AND date(pp.paypakka_created_at) <= ?"
    39|            pp_params.append(to_date)
    40|        pp_query += " GROUP BY COALESCE(c.area, 'Unknown')"
    41|
    42|        rows = conn.execute(pp_query, pp_params).fetchall()
    43|        for r in rows:
    44|            area = r["area"]
    45|            if area not in area_data:
    46|                area_data[area] = {"total_amount": 0, "customer_count": 0}
    47|            area_data[area]["total_amount"] += r["total"] or 0
    48|            area_data[area]["customer_count"] += r["cust_count"] or 0
    49|
    50|        # 2. Local payments (LEFT JOIN — customer may not exist)
    51|        lp_query = f"""
    52|            SELECT COALESCE(c.area, 'Unknown') as area,
    53|                   SUM(p.amount) as total,
    54|                   COUNT(DISTINCT p.customer_id) as cust_count
    55|            FROM payments p
    56|            LEFT JOIN customers c ON p.customer_id = c.customer_id
    57|            WHERE {flt_p}
    58|        """
    59|        lp_params = []
    60|        if from_date:
    61|            lp_query += " AND date(p.collected_at) >= ?"
    62|            lp_params.append(from_date)
    63|        if to_date:
    64|            lp_query += " AND date(p.collected_at) <= ?"
    65|            lp_params.append(to_date)
    66|        lp_query += " GROUP BY COALESCE(c.area, 'Unknown')"
    67|
    68|        rows2 = conn.execute(lp_query, lp_params).fetchall()
    69|        for r in rows2:
    70|            area = r["area"]
    71|            if area not in area_data:
    72|                area_data[area] = {"total_amount": 0, "customer_count": 0}
    73|            area_data[area]["total_amount"] += r["total"] or 0
    74|            area_data[area]["customer_count"] += r["cust_count"] or 0
    75|
    76|        # Sort by total_amount descending
    77|        areas_list = [
    78|            {
    79|                "area": area,
    80|                "total_amount": round(data["total_amount"], 2),
    81|                "customer_count": data["customer_count"],
    82|            }
    83|            for area, data in area_data.items()
    84|        ]
    85|        areas_list.sort(key=lambda x: x["total_amount"], reverse=True)
    86|
    87|        # Summary
    88|        total_amount = sum(a["total_amount"] for a in areas_list)
    89|        total_customers = sum(a["customer_count"] for a in areas_list)
    90|
    91|        return {
    92|            "areas": areas_list,
    93|            "total_amount": round(total_amount, 2),
    94|            "total_areas": len(areas_list),
    95|            "total_customers": total_customers,
    96|        }
    97|
    98|
    99|@router.get("/collector-performance")
   100|def collector_performance(
   101|    from_date: Optional[str] = Query(None),
   102|    to_date: Optional[str] = Query(None),
   103|    current_user=Depends(get_current_user),
   104|):
   105|    """Collector-wise collection performance combining local + Paypakka payments."""
   106|    flt_pp = op_filter(current_user, "pp.")
   107|    flt_p = op_filter(current_user, "p.")
   108|
   109|    with get_conn() as conn:
   110|        collector_data = {}  # name -> {total_collected, payment_count}
   111|
   112|        # 1. Paypakka payments (JOIN with paypakka_employees for name)
   113|        pp_query = f"""
   114|            SELECT COALESCE(e.emp_name, 'Unknown') as name,
   115|                   SUM(pp.collection_amount) as total,
   116|                   COUNT(*) as cnt
   117|            FROM paypakka_payments pp
   118|            LEFT JOIN paypakka_employees e ON pp.emp_ref_id = e.emp_ref_id
   119|            WHERE {flt_pp}
   120|        """
   121|        pp_params = []
   122|        if from_date:
   123|            pp_query += " AND date(pp.paypakka_created_at) >= ?"
   124|            pp_params.append(from_date)
   125|        if to_date:
   126|            pp_query += " AND date(pp.paypakka_created_at) <= ?"
   127|            pp_params.append(to_date)
   128|        pp_query += " GROUP BY COALESCE(e.emp_name, 'Unknown')"
   129|
   130|        rows = conn.execute(pp_query, pp_params).fetchall()
   131|        for r in rows:
   132|            name = r["name"]
   133|            if name not in collector_data:
   134|                collector_data[name] = {"total_collected": 0, "payment_count": 0}
   135|            collector_data[name]["total_collected"] += r["total"] or 0
   136|            collector_data[name]["payment_count"] += r["cnt"] or 0
   137|
   138|        # 2. Local payments (join with users for collector name)
   139|        lp_query = f"""
   140|            SELECT COALESCE(u.name, 'Unknown') as name,
   141|                   SUM(p.amount) as total,
   142|                   COUNT(*) as cnt
   143|            FROM payments p
   144|            LEFT JOIN users u ON p.collected_by = u.id
   145|            WHERE {flt_p}
   146|        """
   147|        lp_params = []
   148|        if from_date:
   149|            lp_query += " AND date(p.collected_at) >= ?"
   150|            lp_params.append(from_date)
   151|        if to_date:
   152|            lp_query += " AND date(p.collected_at) <= ?"
   153|            lp_params.append(to_date)
   154|        lp_query += " GROUP BY COALESCE(u.name, 'Unknown')"
   155|
   156|        rows2 = conn.execute(lp_query, lp_params).fetchall()
   157|        for r in rows2:
   158|            name = r["name"]
   159|            if name not in collector_data:
   160|                collector_data[name] = {"total_collected": 0, "payment_count": 0}
   161|            collector_data[name]["total_collected"] += r["total"] or 0
   162|            collector_data[name]["payment_count"] += r["cnt"] or 0
   163|
   164|        # Sort by total_collected descending
   165|        collectors_list = [
   166|            {
   167|                "name": name,
   168|                "total_collected": round(data["total_collected"], 2),
   169|                "payment_count": data["payment_count"],
   170|            }
   171|            for name, data in collector_data.items()
   172|        ]
   173|        collectors_list.sort(key=lambda x: x["total_collected"], reverse=True)
   174|
   175|        total_amount = sum(c["total_collected"] for c in collectors_list)
   176|        total_payments = sum(c["payment_count"] for c in collectors_list)
   177|
   178|        return {
   179|            "collectors": collectors_list,
   180|            "total_amount": round(total_amount, 2),
   181|            "total_payments": total_payments,
   182|        }
   183|
   184|
   185|@router.get("/mso-summary")
   186|def mso_summary(
   187|    from_date: Optional[str] = Query(None),
   188|    to_date: Optional[str] = Query(None),
   189|    current_user=Depends(get_current_user),
   190|):
   191|    """MSO-wise summary: customer counts + collection amounts."""
   192|    flt = op_filter(current_user)
   193|    flt_pp = op_filter(current_user, "pp.")
   194|    flt_p = op_filter(current_user, "p.")
   195|
   196|    with get_conn() as conn:
   197|        # 1. Customer/connection counts by MSO
   198|        mso_data = {}
   199|        conn_rows = conn.execute(f"""
   200|            SELECT COALESCE(mso, 'Unknown') as mso,
   201|                   COUNT(*) as total,
   202|                   SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active
   203|            FROM connections
   204|            WHERE {flt}
   205|            GROUP BY COALESCE(mso, 'Unknown')
   206|        """).fetchall()
   207|        for r in conn_rows:
   208|            mso_data[r["mso"]] = {
   209|                "name": r["mso"],
   210|                "total_customers": r["total"],
   211|                "active_customers": r["active"],
   212|                "total_collected": 0,
   213|            }
   214|
   215|        # 2. Collection from Paypakka payments (JOIN connections → paypakka_payments)
   216|        pp_query = f"""
   217|            SELECT COALESCE(cn.mso, 'Unknown') as mso,
   218|                   SUM(pp.collection_amount) as total
   219|            FROM paypakka_payments pp
   220|            JOIN customers c ON pp.customer_id = c.customer_id
   221|            LEFT JOIN connections cn ON cn.customer_id = pp.customer_id
   222|            WHERE {flt_pp}
   223|        """
   224|        pp_params = []
   225|        if from_date:
   226|            pp_query += " AND date(pp.paypakka_created_at) >= ?"
   227|            pp_params.append(from_date)
   228|        if to_date:
   229|            pp_query += " AND date(pp.paypakka_created_at) <= ?"
   230|            pp_params.append(to_date)
   231|        pp_query += " GROUP BY COALESCE(cn.mso, 'Unknown')"
   232|
   233|        rows = conn.execute(pp_query, pp_params).fetchall()
   234|        for r in rows:
   235|            mso = r["mso"]
   236|            if mso not in mso_data:
   237|                mso_data[mso] = {"name": mso, "total_customers": 0, "active_customers": 0, "total_collected": 0}
   238|            mso_data[mso]["total_collected"] += r["total"] or 0
   239|
   240|        # 3. Collection from Local payments
   241|        lp_query = f"""
   242|            SELECT COALESCE(cn.mso, 'Unknown') as mso,
   243|                   SUM(p.amount) as total
   244|            FROM payments p
   245|            JOIN connections cn ON cn.id = p.connection_id
   246|            WHERE {flt_p}
   247|        """
   248|        lp_params = []
   249|        if from_date:
   250|            lp_query += " AND date(p.collected_at) >= ?"
   251|            lp_params.append(from_date)
   252|        if to_date:
   253|            lp_query += " AND date(p.collected_at) <= ?"
   254|            lp_params.append(to_date)
   255|        lp_query += " GROUP BY COALESCE(cn.mso, 'Unknown')"
   256|
   257|        rows2 = conn.execute(lp_query, lp_params).fetchall()
   258|        for r in rows2:
   259|            mso = r["mso"]
   260|            if mso not in mso_data:
   261|                mso_data[mso] = {"name": mso, "total_customers": 0, "active_customers": 0, "total_collected": 0}
   262|            mso_data[mso]["total_collected"] += r["total"] or 0
   263|
   264|        msos_list = list(mso_data.values())
   265|        msos_list.sort(key=lambda x: x["total_customers"], reverse=True)
   266|
   267|        return {"msos": msos_list}
   268|
   269|
   270|@router.get("/my-collections")
   271|def my_collections(
   272|    from_date: Optional[str] = Query(None),
   273|    to_date: Optional[str] = Query(None),
   274|    page: int = Query(1, ge=1),
   275|    per_page: int = Query(20, ge=1, le=200),
   276|    current_user=Depends(get_current_user),
   277|):
   278|    """Agent's own collection report — payments collected by THIS logged-in user."""
   279|    user_id = current_user["id"]
   280|    username = current_user.get("username", "")
   281|    flt = op_filter(current_user)
   282|    flt_pp = op_filter(current_user, "pp.")
   283|    flt_p = op_filter(current_user, "p.")
   284|
   285|    with get_conn() as conn:
   286|        # Try to find paypakka employee mapping by username matching employee name
   287|        emp_row = conn.execute(
   288|            f"SELECT emp_ref_id, emp_name FROM paypakka_employees WHERE LOWER(emp_name) LIKE ? AND {flt}",
   289|            (f"%{username.lower()}%",)
   290|        ).fetchone()
   291|        emp_ref_id = emp_row["emp_ref_id"] if emp_row else None
   292|        emp_name = emp_row["emp_name"] if emp_row else username
   293|
   294|        payments = []
   295|        total_collected = 0
   296|        payment_count = 0
   297|
   298|        # 1. Paypakka payments by this agent
   299|        if emp_ref_id:
   300|            pp_query = f"""
   301|                SELECT pp.id, pp.customer_id, c.name as customer_name, c.area,
   302|                       pp.collection_amount, pp.payment_type, pp.paypakka_created_at,
   303|                       pp.emp_ref_id, 'paypakka' as source
   304|                FROM paypakka_payments pp
   305|                LEFT JOIN customers c ON pp.customer_id = c.customer_id
   306|                WHERE pp.emp_ref_id = ? AND {flt_pp}
   307|            """
   308|            pp_params = [emp_ref_id]
   309|            if from_date:
   310|                pp_query += " AND date(pp.paypakka_created_at) >= ?"
   311|                pp_params.append(from_date)
   312|            if to_date:
   313|                pp_query += " AND date(pp.paypakka_created_at) <= ?"
   314|                pp_params.append(to_date)
   315|
   316|            # Get total
   317|            total_row = conn.execute(
   318|                f"SELECT COALESCE(SUM(collection_amount),0) as total, COUNT(*) as cnt FROM paypakka_payments WHERE emp_ref_id = ? AND {flt}" +
   319|                (" AND date(paypakka_created_at) >= ?" if from_date else "") +
   320|                (" AND date(paypakka_created_at) <= ?" if to_date else ""),
   321|                [emp_ref_id] + ([from_date] if from_date else []) + ([to_date] if to_date else [])
   322|            ).fetchone()
   323|            total_collected += total_row["total"] or 0
   324|            payment_count += total_row["cnt"] or 0
   325|
   326|            # Get paginated payments
   327|            pp_query += " ORDER BY pp.paypakka_created_at DESC LIMIT ? OFFSET ?"
   328|            pp_params.extend([per_page, (page - 1) * per_page])
   329|            rows = conn.execute(pp_query, pp_params).fetchall()
   330|            for r in rows:
   331|                payments.append({
   332|                    "id": r["id"],
   333|                    "customer_name": r["customer_name"] or f"Customer #{r['customer_id']}",
   334|                    "area": r["area"] or "",
   335|                    "amount": r["collection_amount"],
   336|                    "mode": r["payment_type"],
   337|                    "date": r["paypakka_created_at"],
   338|                    "source": "paypakka"
   339|                })
   340|
   341|# 2. Local payments by this user
   342|        lp_query = f"""
   343|            SELECT p.id, p.customer_id, c.name as customer_name, c.area,
   344|                   p.amount, p.payment_mode, p.collected_at, 'local' as source
   345|            FROM payments p
   346|            LEFT JOIN customers c ON p.customer_id = c.customer_id
   347|            WHERE p.collected_by = ? AND {flt_p}
   348|        """
   349|        lp_params = [user_id]
   350|        if from_date:
   351|            lp_query += " AND date(p.collected_at) >= ?"
   352|            lp_params.append(from_date)
   353|        if to_date:
   354|            lp_query += " AND date(p.collected_at) <= ?"
   355|            lp_params.append(to_date)
   356|
   357|        lp_total = conn.execute(
   358|            f"SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as cnt FROM payments WHERE collected_by = ? AND {flt}" +
   359|            (" AND date(collected_at) >= ?" if from_date else "") +
   360|            (" AND date(collected_at) <= ?" if to_date else ""),
   361|            [user_id] + ([from_date] if from_date else []) + ([to_date] if to_date else [])
   362|        ).fetchone()
   363|        total_collected += lp_total["total"] or 0
   364|        payment_count += lp_total["cnt"] or 0
   365|
   366|        lp_query += " ORDER BY p.collected_at DESC LIMIT ? OFFSET ?"
   367|        lp_params.extend([per_page, (page - 1) * per_page])
   368|        lp_rows = conn.execute(lp_query, lp_params).fetchall()
   369|        for r in lp_rows:
   370|            payments.append({
   371|                "id": r["id"],
   372|                "customer_name": r["customer_name"] or f"Customer #{r['customer_id']}",
   373|                "area": r["area"] or "",
   374|                "amount": r["amount"],
   375|                "mode": r["payment_mode"],
   376|                "date": r["collected_at"],
   377|                "source": "local"
   378|            })
   379|
   380|        # Sort all by date desc
   381|        payments.sort(key=lambda x: x["date"] or "", reverse=True)
   382|        payments = payments[:per_page]
   383|
   384|        return {
   385|            "agent_name": emp_name,
   386|            "total_collected": total_collected,
   387|            "payment_count": payment_count,
   388|            "from_date": from_date,
   389|            "to_date": to_date,
   390|            "page": page,
   391|            "per_page": per_page,
   392|            "payments": payments
   393|        }
   394|
   395|
   396|@router.get("/mom-trend")
   397|def mom_trend(
   398|    months: int = Query(6, ge=2, le=24),
   399|    current_user=Depends(get_current_user),
   400|):
   401|    """Month-over-month revenue trend for the last N months (local + Paypakka combined)."""
   402|    from datetime import datetime, date
   403|    import calendar
   404|
   405|    flt_c = op_filter(current_user, "c.")
   406|    flt_pp = op_filter(current_user, "pp.")
   407|    now = datetime.now()
   408|
   409|    # Build list of months to query
   410|    month_list = []
   411|    for i in range(months - 1, -1, -1):
   412|        m = now.month - i
   413|        y = now.year
   414|        while m <= 0:
   415|            m += 12
   416|            y -= 1
   417|        label = date(y, m, 1).strftime("%b %Y")
   418|        first = f"{y}-{m:02d}-01"
   419|        last_day = calendar.monthrange(y, m)[1]
   420|        last = f"{y}-{m:02d}-{last_day}"
   421|        month_list.append({"label": label, "first": first, "last": last})
   422|
   423|    results = []
   424|    with get_conn() as conn:
   425|        for mo in month_list:
   426|            # Local payments
   427|            local = conn.execute(
   428|                f"""SELECT COALESCE(SUM(p.amount), 0) as total, COUNT(*) as cnt
   429|                    FROM payments p
   430|                    JOIN customers c ON p.customer_id = c.customer_id
   431|                    WHERE (p.deleted IS NULL OR p.deleted = 0)
   432|                      AND DATE(p.collected_at) >= ? AND DATE(p.collected_at) <= ?
   433|                      AND {flt_c}""",
   434|                (mo["first"], mo["last"])
   435|            ).fetchone()
   436|
   437|            # Paypakka payments
   438|            pp = conn.execute(
   439|                f"""SELECT COALESCE(SUM(pp.collection_amount), 0) as total, COUNT(*) as cnt
   440|                    FROM paypakka_payments pp
   441|                    LEFT JOIN customers c ON pp.customer_id = c.customer_id
   442|                    WHERE DATE(pp.paypakka_created_at) >= ? AND DATE(pp.paypakka_created_at) <= ?
   443|                      AND {flt_pp}""",
   444|                (mo["first"], mo["last"])
   445|            ).fetchone()
   446|
   447|            local_total = local["total"] if local else 0
   448|            pp_total = pp["total"] if pp else 0
   449|            results.append({
   450|                "month": mo["label"],
   451|                "local": round(local_total, 2),
   452|                "paypakka": round(pp_total, 2),
   453|                "total": round(local_total + pp_total, 2),
   454|                "count": (local["cnt"] if local else 0) + (pp["cnt"] if pp else 0),
   455|            })
   456|
   457|    return {"months": months, "data": results}
   458|
   459|
   460|@router.get("/audit-log")
   461|def audit_log(
   462|    entity: Optional[str] = Query(None),
   463|    entity_id: Optional[str] = Query(None),
   464|    action: Optional[str] = Query(None),
   465|    page: int = Query(1, ge=1),
   466|    per_page: int = Query(50, ge=1, le=200),
   467|    current_user=Depends(get_current_user),
   468|):
   469|    """Fetch audit log entries. Admin/master only."""
   470|    from deps import require_role
   471|    if current_user.get("role") not in ("admin", "master"):
   472|        from fastapi import HTTPException
   473|        raise HTTPException(status_code=403, detail="Admin access required")
   474|
   475|    with get_conn() as conn:
   476|        where = ["1=1"]
   477|        params = []
   478|        if entity:
   479|            where.append("entity = ?")
   480|            params.append(entity)
   481|        if entity_id:
   482|            where.append("entity_id = ?")
   483|            params.append(entity_id)
   484|        if action:
   485|            where.append("action = ?")
   486|            params.append(action)
   487|
   488|        where_sql = " AND ".join(where)
   489|        total = conn.execute(f"SELECT COUNT(*) FROM audit_log WHERE {where_sql}", params).fetchone()[0]
   490|        rows = conn.execute(
   491|            f"""SELECT * FROM audit_log WHERE {where_sql}
   492|                ORDER BY created_at DESC LIMIT ? OFFSET ?""",
   493|            params + [per_page, (page - 1) * per_page]
   494|        ).fetchall()
   495|
   496|    return {
   497|        "total": total,
   498|        "page": page,
   499|        "per_page": per_page,
   500|        "entries": [dict(r) for r in rows],
   501|    }
   502|