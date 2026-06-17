#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sqlite3, json, sys
from collections import defaultdict

db_path = '/home/administrator/cabletv-app/backend/cabletv.db'
out_path = '/tmp/payments_june_2026.json'

conn = sqlite3.connect(db_path)
c = conn.cursor()

# Try to find payments from June 2026 using collected_at column (most reliable)
rows = c.execute(
    """
    SELECT p.id, p.customer_id, p.amount, p.payment_mode, p.collected_at,
           p.bill_amount, p.months_paid, p.discount, p.discount_reason,
           c.name as customer_name, c.phone as phone,
           conn.mso as mso, conn.stb_no, conn.plan_name
    FROM payments p
    LEFT JOIN customers c ON p.customer_id = c.customer_id
    LEFT JOIN connections conn ON p.connection_id = conn.id
    WHERE p.collected_at IS NOT NULL AND p.collected_at != ''
      AND p.collected_at LIKE '%2026-%'
    ORDER BY p.collected_at DESC
    """
).fetchall()

# Aggregate
bucket = defaultdict(lambda: {'count':0, 'amount':0.0, 'discount':0.0})
total_amount = 0.0
total_discount = 0.0
modes = defaultdict(int)

for r in rows:
    id, cid, amt, mode, col_at, bill, months, disc, disc_reason, name, phone, mso, stb, plan = r
    if amt is None: amt=0
    total_amount += float(amt)
    total_discount += float(disc or 0)
    bucket[mso or 'UNKNOWN']['count'] += 1
    bucket[mso]['amount'] += float(amt)
    bucket[mso]['discount'] += float(disc or 0)
    modes[mode or 'Unknown'] += 1

print(f"Payments in June 2026 (by collected_at LIKE '%2026-%') = {len(rows)} rows")
print()
print("Total collected: ₹{:,.2f}".format(total_amount))
print("Total discounts: ₹{:,.2f}".format(total_discount))
print()
print("Breakdown by MSO:")
for m in sorted(bucket.keys()):
    d = bucket[m]
    print("  {:<10s} {:>5d} customers → ₹{:,.2f} (after ₹{:,.2f} discounts)".format(m, d['count'], d['amount'], d['discount']))
print()
print("Payment modes:")
for m in sorted(modes):
    print("  {:<25s} {:>4d} times".format(m, modes[m]))

# Export full dataset so Prabhu can audit extractions
out = []
for r in rows:
    out.append({
        'id': r[0], 'customer_id': r[1],
        'amount': r[2], 'mode': r[3], 'collected': r[4],
        'bill': r[5], 'months': r[6], 'discount': r[7], 'reason': r[8],
        'name': r[9], 'phone': r[10],
        'mso': r[11], 'stb': r[12], 'plan': r[13]
    })

with open(out_path, 'w') as f:
    json.dump(out, f, indent=2, default=str)
print("\nExported full dataset to", out_path)
conn.close()
