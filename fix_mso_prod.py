"""Fix MSO for TACTV boxes on PRODUCTION DB - STBs starting with 172 or 173 -> TACTV"""
import sqlite3
import shutil
from datetime import datetime

DB_PATH = "/tmp/cabletv_prod.db"

# Backup
backup = DB_PATH + f".bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
shutil.copy2(DB_PATH, backup)
print(f"Backup: {backup}")

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

# Before fix
print("\n=== BEFORE FIX ===")
print("STBs starting with 172/173 by MSO:")
rows = conn.execute("""
    SELECT mso, COUNT(*) as cnt 
    FROM connections 
    WHERE (stb_no LIKE '172%' OR stb_no LIKE '173%')
    AND stb_no != '' AND stb_no IS NOT NULL
    GROUP BY mso ORDER BY cnt DESC
""").fetchall()
for r in rows:
    print(f"  {r['mso']}: {r['cnt']}")

# Apply fix
result = conn.execute("""
    UPDATE connections 
    SET mso = 'TACTV'
    WHERE (stb_no LIKE '172%' OR stb_no LIKE '173%')
    AND stb_no != '' AND stb_no IS NOT NULL
    AND mso != 'TACTV'
""")
conn.commit()
print(f"\nUpdated {result.rowcount} connections")

# After fix
print("\n=== AFTER FIX ===")
print("STBs starting with 172/173 by MSO:")
rows = conn.execute("""
    SELECT mso, COUNT(*) as cnt 
    FROM connections 
    WHERE (stb_no LIKE '172%' OR stb_no LIKE '173%')
    AND stb_no != '' AND stb_no IS NOT NULL
    GROUP BY mso
""").fetchall()
for r in rows:
    print(f"  {r['mso']}: {r['cnt']}")

# Overall MSO distribution
print("\nAll connections by MSO:")
rows2 = conn.execute("""
    SELECT mso, COUNT(*) as cnt FROM connections 
    WHERE status = 'Active'
    GROUP BY mso ORDER BY cnt DESC
""").fetchall()
for r in rows2:
    print(f"  {r['mso']}: {r['cnt']}")

conn.close()
print("\nDone! Upload /tmp/cabletv_prod.db to production.")
