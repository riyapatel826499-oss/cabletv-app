"""Fix MSO for TACTV boxes - STBs starting with 172 or 173 should be TACTV"""
import sqlite3

DB_PATH = "/home/administrator/cabletv-app/backend/cabletv.db"
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

# 1. Show current state: STBs starting with 172/173 grouped by MSO
print("=== BEFORE FIX ===")
print("\nSTBs starting with 172/173 by MSO:")
rows = conn.execute("""
    SELECT mso, COUNT(*) as cnt 
    FROM connections 
    WHERE (stb_no LIKE '172%' OR stb_no LIKE '173%')
    AND stb_no != '' AND stb_no IS NOT NULL
    GROUP BY mso
    ORDER BY cnt DESC
""").fetchall()
for r in rows:
    print(f"  {r['mso']}: {r['cnt']}")

# 2. Show how many will change
wrong = conn.execute("""
    SELECT COUNT(*) as cnt FROM connections 
    WHERE (stb_no LIKE '172%' OR stb_no LIKE '173%')
    AND stb_no != '' AND stb_no IS NOT NULL
    AND mso != 'TACTV'
""").fetchone()[0]
print(f"\nConnections to fix (172/173 STBs with MSO != TACTV): {wrong}")

# 3. Show some examples
examples = conn.execute("""
    SELECT c.customer_id, c.name, conn.stb_no, conn.mso, conn.plan_name
    FROM connections conn
    JOIN customers c ON c.customer_id = conn.customer_id
    WHERE (conn.stb_no LIKE '172%' OR conn.stb_no LIKE '173%')
    AND conn.stb_no != '' AND conn.stb_no IS NOT NULL
    AND conn.mso != 'TACTV'
    LIMIT 10
""").fetchall()
print("\nExamples to fix:")
for e in examples:
    print(f"  {e['customer_id']} | {e['name'][:25]:25s} | STB: {e['stb_no']} | MSO: {e['mso']} -> TACTV | Plan: {e['plan_name']}")

conn.close()
