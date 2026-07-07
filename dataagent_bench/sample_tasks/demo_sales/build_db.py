"""Regenerate the demo task's SQLite context file (not committed to git)."""
import sqlite3
from pathlib import Path

db = Path(__file__).parent / "context" / "stores.sqlite"
db.unlink(missing_ok=True)
conn = sqlite3.connect(db)
conn.execute("CREATE TABLE stores (store_id TEXT PRIMARY KEY, city TEXT)")
conn.executemany("INSERT INTO stores VALUES (?, ?)", [("S1", "Tokyo"), ("S2", "Osaka")])
conn.commit()
conn.close()
print(f"built {db}")
