#!/usr/bin/env python3
"""
Import plans, customer plans, and payment history from Paypakka API.
Usage: python3 import_paypakka.py <JWT_TOKEN>

Steps:
1. Login to https://app.paypakka.com via browser
2. Capture JWT token via XHR interception
3. Run: python3 import_paypakka.py <token>
"""
import sys
import json
import sqlite3
import requests
import time
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'cabletv.db')
API_BASE = 'https://api.paypakka.com'
DISTRIBUTOR_REF_ID = '5e9d475db9d83920ec941ce4'

HEADERS = {
    'Content-Type': 'application/json',
    'x-app-version': '1.0',
    'x-user-agent': 'Web',
    'x-app-id': 'Distributor',
}

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def api_post(token, endpoint, body):
    """Make a Paypakka API call."""
    headers = {**HEADERS, 'x-access-token': token}
    resp = requests.post(f'{API_BASE}{endpoint}', json=body, headers=headers, timeout=30)
    if resp.status_code != 200:
        print(f"  API error {resp.status_code}: {resp.text[:200]}")
        return None
    return resp.json()


def import_plans(token):
    """Import all 1537 plans from Paypakka."""
    print("\n=== Importing Plans ===")
    conn = get_db()
    c = conn.cursor()

    data = api_post(token, '/api/v2/plans/list', {
        'distributor_ref_id': DISTRIBUTOR_REF_ID
    })

    if not data:
        print("Failed to fetch plans")
        conn.close()
        return 0

    plans = data if isinstance(data, list) else data.get('data', data.get('plans', []))
    if isinstance(data, dict) and not plans:
        # Maybe it's paginated - check for data key
        for key in data:
            if isinstance(data[key], list) and len(data[key]) > 10:
                plans = data[key]
                break

    # If still not found, it might be the direct array
    if not plans and isinstance(data, list):
        plans = data

    print(f"  Found {len(plans)} plans")

    imported = 0
    for plan in plans:
        try:
            plan_id = plan.get('_id', '')
            if not plan_id:
                continue

            c.execute("""INSERT OR REPLACE INTO paypakka_plans
                (paypakka_plan_id, plan_name, plan_amount, package_category, billing_cycle,
                 billing_type, service_type, mso, sd_count, hd_count, inclusive_of_tax,
                 plan_validity, status, distributor_ref_id, paypakka_created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    plan_id,
                    plan.get('plan_name', ''),
                    plan.get('plan_amount', 0),
                    plan.get('package_category', 'package'),
                    plan.get('billing_cycle', 'monthly'),
                    plan.get('billing_type', 'Prepaid'),
                    plan.get('service_type', 'Cable'),
                    plan.get('mso', 'GTPL'),
                    plan.get('sd_count', 0),
                    plan.get('hd_count', 0),
                    1 if plan.get('inclusive_of_tax', True) else 0,
                    plan.get('plan_validity', '1 month'),
                    plan.get('status', 'Active'),
                    plan.get('distributor_ref_id', ''),
                    plan.get('created_at', ''),
                )
            )
            imported += 1
        except Exception as e:
            print(f"  Error importing plan {plan.get('_id', '?')}: {e}")

    conn.commit()
    conn.close()
    print(f"  Imported {imported} plans")
    return imported


def import_payments(token):
    """Import all payment history from Paypakka (paginated)."""
    print("\n=== Importing Payment History ===")
    conn = get_db()
    c = conn.cursor()

    total_imported = 0
    start = 0
    limit = 500

    # First, build paypakka_id -> customer_id mapping
    c.execute("SELECT paypakka_id, customer_id FROM customers WHERE paypakka_id IS NOT NULL")
    paypakka_to_cust = {row['paypakka_id']: row['customer_id'] for row in c.fetchall()}
    print(f"  Customer mapping: {len(paypakka_to_cust)} customers")

    while True:
        data = api_post(token, '/api/v2/payment/list', {
            'distributor_ref_id': DISTRIBUTOR_REF_ID,
            'start': start,
            'limit': limit,
        })

        if not data:
            print(f"  Failed at start={start}")
            break

        payments = data.get('data', [])
        total_count = data.get('total_count', 0)

        if not payments:
            print(f"  No more payments at start={start}")
            break

        batch_imported = 0
        for pay in payments:
            try:
                cust_ref_id = pay.get('cust_ref_id', '')
                customer_id = paypakka_to_cust.get(cust_ref_id)

                if not customer_id:
                    # Skip payments for customers not in our DB
                    continue

                payment_ref_id = pay.get('_id', '')
                if not payment_ref_id:
                    continue

                c.execute("""INSERT OR IGNORE INTO paypakka_payments
                    (customer_id, payment_ref_id, transaction_id, service_ref_id,
                     plan_amount, bill_amount, collection_amount, discount_amount, tax,
                     payment_type, status, paypakka_created_at, emp_ref_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        customer_id,
                        payment_ref_id,
                        pay.get('transaction_id', ''),
                        pay.get('service_ref_id', ''),
                        pay.get('plan_amount', 0),
                        pay.get('bill_amount', 0),
                        pay.get('collection_amount', 0),
                        pay.get('discount_amount', 0),
                        pay.get('tax', 0),
                        pay.get('payment_type', ''),
                        pay.get('status', 'Success'),
                        pay.get('created_at', ''),
                        pay.get('emp_ref_id', ''),
                    )
                )
                batch_imported += 1
            except Exception as e:
                print(f"  Error importing payment {pay.get('_id', '?')}: {e}")

        total_imported += batch_imported
        start += limit

        print(f"  Batch: {len(payments)} fetched, {batch_imported} imported (total: {total_imported}/{total_count})")

        if start >= total_count or len(payments) < limit:
            break

        # Small delay to avoid rate limiting
        time.sleep(0.5)

    conn.commit()
    conn.close()
    print(f"  Total imported: {total_imported} payments")
    return total_imported


def import_customer_plans(token):
    """Import customer plan subscriptions for all customers."""
    print("\n=== Importing Customer Plans ===")
    conn = get_db()
    c = conn.cursor()

    # Get all customers with their paypakka_id and connections
    c.execute("""SELECT c.customer_id, c.paypakka_id, conn.id as conn_id, conn.stb_no
                 FROM customers c
                 JOIN connections conn ON c.customer_id = conn.customer_id
                 WHERE c.paypakka_id IS NOT NULL AND c.status = 'Active'
                 ORDER BY c.customer_id""")
    customers = c.fetchall()
    print(f"  Processing {len(customers)} customer-connections")

    total_imported = 0
    failed = 0

    for i, cust in enumerate(customers):
        cust_ref_id = cust['paypakka_id']
        customer_id = cust['customer_id']

        # Need service_ref_id - it's the paypakka _id of the service
        # We can try getting it from the customer's data
        # First, let's try with just cust_ref_id (no service_ref_id filter)
        try:
            data = api_post(token, '/api/v2/cust/plan/list', {
                'cust_ref_id': cust_ref_id,
            })

            if not data or not isinstance(data, list) or len(data) == 0:
                # Try without filter - sometimes works
                failed += 1
                if (i + 1) % 50 == 0:
                    print(f"  Progress: {i+1}/{len(customers)} (imported: {total_imported}, no plans: {failed})")
                continue

            for plan in data:
                plan_ref_id = plan.get('plan_ref_id', '')
                cust_plan_ref_id = plan.get('_id', '')

                if not cust_plan_ref_id:
                    continue

                c.execute("""INSERT OR IGNORE INTO paypakka_customer_plans
                    (customer_id, cust_plan_ref_id, plan_ref_id, service_ref_id,
                     activate_date, expired_date, status, paypakka_created_at, paypakka_updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        customer_id,
                        cust_plan_ref_id,
                        plan_ref_id,
                        plan.get('service_ref_id', ''),
                        plan.get('activate_date', ''),
                        plan.get('expired_date', ''),
                        plan.get('status', 'Active'),
                        plan.get('created_at', ''),
                        plan.get('updated_at', ''),
                    )
                )
                total_imported += 1

        except Exception as e:
            print(f"  Error for {customer_id}: {e}")
            failed += 1

        # Progress log every 50 customers
        if (i + 1) % 50 == 0:
            print(f"  Progress: {i+1}/{len(customers)} (imported: {total_imported}, no plans: {failed})")

        # Small delay to avoid rate limiting
        time.sleep(0.1)

    conn.commit()
    conn.close()
    print(f"  Total imported: {total_imported} customer plans ({failed} had no plans)")
    return total_imported


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 import_paypakka.py <JWT_TOKEN>")
        print("\nGet token by logging into app.paypakka.com and capturing via XHR interception")
        sys.exit(1)

    token = sys.argv[1]
    print(f"Token: {token[:20]}...")

    # Step 1: Import all plans
    plan_count = import_plans(token)

    # Step 2: Import payment history
    payment_count = import_payments(token)

    # Step 3: Import customer plan subscriptions
    cust_plan_count = import_customer_plans(token)

    print(f"\n=== IMPORT COMPLETE ===")
    print(f"Plans: {plan_count}")
    print(f"Payments: {payment_count}")
    print(f"Customer Plans: {cust_plan_count}")


if __name__ == '__main__':
    main()
