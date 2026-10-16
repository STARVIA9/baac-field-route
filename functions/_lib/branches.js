// Branch list — BAAC สาขาในพื้นที่
// Single source of truth for branch codes and display names
// baacCode = รหัสสาขาจริงของ ธ.ก.ส. (จากไฟล์ Customer Indicator COL_2 รูปแบบ "854 - สาขาวังท่าช้าง")

export const BRANCHES = [
  { code: 'WTC', name: 'สาขาวังท่าช้าง', baacCode: '854' },
  { code: 'KBB', name: 'สาขากบินทร์บุรี', baacCode: '145' },
  { code: 'KPS', name: 'สาขาเกาะเปริด', baacCode: '' },
  { code: 'CPK', name: 'สาขาฉะเชิงเทรา', baacCode: '' },
  { code: 'PLK', name: 'สาขาบางคล้า', baacCode: '' },
  { code: 'BKM', name: 'สาขาบางน้ำเปรี้ยว', baacCode: '' },
  { code: 'KCN', name: 'สาขาแหลมสิงห์', baacCode: '' },
  { code: 'THB', name: 'สาขาท่าถิ่น', baacCode: '' },
  { code: 'BNG', name: 'สาขาบางแก้ว', baacCode: '' },
];

// Map user's branch code → BAAC code (ใช้กรองข้อมูลลูกค้าจาก D1)
export function toBaacCode(branchCode, branches = BRANCHES) {
  const b = branches.find(x => x.code === branchCode || x.baacCode === branchCode);
  return b?.baacCode || branchCode;
}

// Map BAAC code → user's branch code
export function fromBaacCode(baacCode, branches = BRANCHES) {
  const b = branches.find(x => x.baacCode === baacCode);
  return b ? b.code : baacCode;
}

// Map BAAC code → branch display name
export function baacCodeToName(baacCode, branches = BRANCHES) {
  const b = branches.find(x => x.baacCode === baacCode);
  return b ? b.name : baacCode;
}

// Extract BAAC code from CI column format: "854 - สาขาวังท่าช้าง" → "854"
export function extractBaacCode(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d+)/);
  return m ? m[1] : '';
}

// Get branch name from CI column format
export function extractBranchName(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/-\s*(.+)$/);
  return m ? m[1].trim() : s;
}