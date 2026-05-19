#!/usr/bin/env python3
"""Migrate paypakka_payments from local SQLite to Railway PostgreSQL via API."""
import sqlite3
import json
import sys
import time
import urllib.request

BASE_URL = "https://wasool.co.in"
LOCAL_DB = "/home/administrator/cabletv-app/backend/cabletv.db"
BATCH_SIZE = 500

def get_token():
    """Login and get master token."""
    data = json.dumps({"username": "admin", "password": "admin123", "force": True}).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/api/login",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read())
    return result["access_token"]

def get_local_payments():
    """Read all paypakka_payments from local SQLite."""
    conn = sqlite3.connect(LOCAL_DB)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM paypakka_payments")
    total = c.fetchone()[0]
    print(f"Total paypakka_payments in local SQLite: {total}")
    
    c.execute("""SELECT id, customer_id, payment_ref_id, transaction_id,
        service_ref_id, plan_amount, bill_amount, collection_amount,
        discount_amount, tax, payment_type, status,
        paypakka_created_at, imported_at, emp_ref_id, operator_id
        FROM paypakka_payments ORDER BY id""")
    
    rows = []
    columns = ['id', 'customer_id', 'payment_ref_id', 'transaction_id',
               'service_ref_id', 'plan_amount', 'bill_amount', 'collection_amount',
               'discount_amount', 'tax', 'payment_type', 'status',
               'paypakka_created_at', 'imported_at', 'emp_ref_id', 'operator_id']
    
    for row in c.fetchall():
        d = {}
        for i, col in enumerate(columns):
            val = row[i]
            if val is not None:
                d[col] = val
            else:
                d[col] = None
        rows.append(d)
    
    conn.close()
    return rows

def push_batch(token, batch, batch_num):
    """Push a batch of payments to Railway."""
    data = json.dumps({"rows": batch}).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/api/import-paypakka-payments",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}"
        },
        method="POST"
    )
    try:
        resp = urllib.request.urlopen(req)
        result = json.loads(resp.read())
        return result
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  ERROR (batch {batch_num}): {e.code} - {body[:200]}")
        return {"status": "error", "imported": 0}

def main():
    print("=== Paypakka Payments Migration ===\n")
    
    # Step 1: Get token
    print("Logging in...")
    token = get_token()
    print(f"Token OK: {token[:20]}...\n")
    
    # Step 2: Read local payments
    print("Reading local paypakka_payments...")
    rows = get_local_payments()
    print(f"Read {len(rows)} payments\n")
    
    if not rows:
        print("No payments to migrate!")
        return
    
    # Step 3: Push in batches
    total_imported = 0
    total_errors = []
    num_batches = (len(rows) + BATCH_SIZE - 1) // BATCH_SIZE
    
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        print(f"Pushing batch {batch_num}/{num_batches} ({len(batch)} rows)...", end=" ", flush=True)
        
        result = push_batch(token, batch, batch_num)
        imported = result.get("imported", 0)
        errors = result.get("errors", [])
        total_imported += imported
        total_errors.extend(errors)
        
        print(f"imported: {imported}")
        
        if i + BATCH_SIZE < len(rows):
            time.sleep(0.5)  # Small delay between batches
    
    print(f"\n=== Migration Complete ===")
    print(f"Total imported: {total_imported}/{len(rows)}")
    if total_errors:
        print(f"Errors ({len(total_errors)}):")
        for e in total_errors[:10]:
            print(f"  {e}")

if __name__ == "__main__":
    main()
