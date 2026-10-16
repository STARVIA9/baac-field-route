-- GPS history (audit + restore) — 16 ต.ค.69
-- บันทึกทุกครั้งที่พิกัด lat/lng เปลี่ยน (gps-import / sync / แก้รายใบ / admin)
-- ถ้ายังไม่มีตาราง โค้ดจะ try/catch ข้ามไป (กันพังก่อน migration)
CREATE TABLE IF NOT EXISTS gps_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cif TEXT NOT NULL,
  old_lat REAL, old_lng REAL,
  new_lat REAL, new_lng REAL,
  changed_by TEXT DEFAULT '',
  source TEXT DEFAULT '',
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gpsh_cif ON gps_history(cif);
CREATE INDEX IF NOT EXISTS idx_gpsh_at ON gps_history(changed_at);
