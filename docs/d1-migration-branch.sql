-- D1 Migration: Add branch column to customers table
-- Run with: wrangler d1 execute baac-field-route-db --command "ALTER TABLE customers ADD COLUMN branch TEXT DEFAULT ''"
-- Or batch: wrangler d1 execute baac-field-route-db --file docs/d1-migration-branch.sql

ALTER TABLE customers ADD COLUMN branch TEXT DEFAULT '';

-- Update existing customers to have branch = '854' (วังท่าช้าง) as default
UPDATE customers SET branch = '854' WHERE branch IS NULL OR branch = '';

-- Create index for faster branch filtering
CREATE INDEX IF NOT EXISTS idx_c_branch ON customers(branch);