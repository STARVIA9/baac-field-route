-- D1 Migration: customer_views (สมุดคุมเปิดดูการ์ด — แผน B ขั้น 4)
-- Run with: wrangler d1 execute baac-field-route-db --remote --file docs/d1-migration-views.sql

CREATE TABLE IF NOT EXISTS customer_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  viewer TEXT NOT NULL,          -- username คนเปิดดู
  viewer_name TEXT NOT NULL,      -- ชื่อแสดง (snapshot ตอนดู)
  cif TEXT NOT NULL,              -- CIF ที่ถูกเปิด
  customer_name TEXT NOT NULL,    -- ชื่อลูกค้า (snapshot ตอนดู)
  branch TEXT NOT NULL,           -- สาขาของลูกค้า
  viewed_at TEXT NOT NULL         -- ISO time
);

CREATE INDEX IF NOT EXISTS idx_v_viewer ON customer_views(viewer, viewed_at);
CREATE INDEX IF NOT EXISTS idx_v_cif ON customer_views(cif, viewed_at);
