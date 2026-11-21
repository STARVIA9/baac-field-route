// Phase 2 self-check — รันจริงด้วย node:sqlite ในเครื่อง (ไม่แตะ D1 จริง)
// ใช้: node tests/phase2.selftest.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequestPost as enrollPost, onRequestGet as enrollGet } from '../ci-app/functions/api/enroll.js';
import { onRequestGet as adminGet, onRequestPost as adminPost } from '../ci-app/functions/api/admin/enrollments.js';
import { makeToken } from '../ci-app/functions/_lib/ci-auth.js';

const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE enrollments (
  device_id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, full_name TEXT NOT NULL,
  position TEXT NOT NULL, branch TEXT NOT NULL, province TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
  decided_at TEXT, decided_by TEXT
);
CREATE INDEX idx_enroll_branch ON enrollments(branch, status);
`);
const CI_DB = {
  prepare(sql) {
    const st = { args: [], bind(...a) { this.args = a; return this; },
      async run() { return db.prepare(sql).run(...this.args); },
      async first() { return db.prepare(sql).get(...this.args) || null; },
      async all() { return { results: db.prepare(sql).all(...this.args) }; } };
    return st;
  }
};
const env = { CI_DB, CI_SESSION_SECRET: 'test-secret-at-least-16-chars-long' };
const req = (url, method = 'GET', body, cookie) => new Request(url, {
  method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {})
});
const post = (r) => r.json().then(d => { assert.equal(r.status, 200, JSON.stringify(d)); return d; });
const device = 'test-854-0001';
const form = { deviceId: device, employeeId: '854-0123', fullName: 'นายทดสอบ ระบบ',
  position: 'เจ้าหน้าที่สินเชื่อ', branch: '854', province: 'ปราจีนบุรี' };
const cookie854 = 'ci_sid=' + encodeURIComponent(await makeToken(env, '854'));
const cookie145 = 'ci_sid=' + encodeURIComponent(await makeToken(env, '145'));

// 1. สมัคร → pending
assert.equal((await post(await enrollPost({ request: req('https://x/api/enroll', 'POST', form), env }))).status, 'pending');
// 2. เช็คสถานะ
assert.equal((await (await enrollGet({ request: req('https://x/api/enroll?device=' + device), env })).json()).status, 'pending');
// 3. หัวหน้าสาขา 854 เห็นคำขอ
const list = await (await adminGet({ request: req('https://x/api/admin/enrollments', 'GET', null, cookie854), env })).json();
assert.equal(list.items.length, 1); assert.equal(list.items[0].full_name, form.fullName);
// 4. อนุมัติ
assert.equal((await post(await adminPost({ request: req('https://x/api/admin/enrollments', 'POST',
  { deviceId: device, decision: 'approved' }, cookie854), env }))).status, 'approved');
// 5. สถานะเปลี่ยนจริง
assert.equal((await (await enrollGet({ request: req('https://x/api/enroll?device=' + device), env })).json()).status, 'approved');
// 6. สมัครซ้ำต้องไม่ตกกลับมา pending
await enrollPost({ request: req('https://x/api/enroll', 'POST', form), env });
assert.equal((await (await enrollGet({ request: req('https://x/api/enroll?device=' + device), env })).json()).status, 'approved');
// 7. หัวหน้าสาขาอื่นอนุมัติเครื่องนี้ไม่ได้
const wrong = await adminPost({ request: req('https://x/api/admin/enrollments', 'POST',
  { deviceId: device, decision: 'revoked' }, cookie145), env });
assert.equal(wrong.status, 403);
// 8. เพิกถอนแล้วสถานะ revoked
await adminPost({ request: req('https://x/api/admin/enrollments', 'POST',
  { deviceId: device, decision: 'revoked' }, cookie854), env });
assert.equal((await (await enrollGet({ request: req('https://x/api/enroll?device=' + device), env })).json()).status, 'revoked');
// 9. ไม่มี cookie → 401
assert.equal((await adminGet({ request: req('https://x/api/admin/enrollments'), env })).status, 401);

db.close();
console.log('PASS phase2 self-check — enroll/pending/approve/re-enroll/cross-branch 403/revoke/401 (' + 9 + ' assertions)');
