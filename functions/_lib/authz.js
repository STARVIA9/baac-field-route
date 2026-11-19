// Role helpers — แอดมินกลาง (admin) vs ผู้ดูแลสาขา (branch_admin) vs พนักงาน (user)
// หลัก: ทุก endpoint ที่ "แอดมินเท่านั้น" ต้องเรียก canManageUsers() แล้วบังคับ scope สาขา
//       ด้วย sameBranch() ทุกครั้ง — อย่าเช็คแค่ role ใน handler เดี่ยวๆ (ลืม scope = รั่วข้ามสาขา)

export const ROLE_USER = 'user';
export const ROLE_BRANCH_ADMIN = 'branch_admin';
export const ROLE_ADMIN = 'admin';

// แอดมินกลาง — เห็นทุกสาขา, เพิ่มสาขา, อัปเดตหนี้, เปลี่ยน PIN แอดมิน
export function isSuper(user) {
  return !!user && user.role === ROLE_ADMIN;
}

// ผู้ดูแลสาขา — จัดการผู้ใช้/PIN เฉพาะสาขาตัวเอง
export function isBranchAdmin(user) {
  return !!user && user.role === ROLE_BRANCH_ADMIN;
}

// ใครเข้าเมนู "จัดการระบบ" ได้ (จำกัดสิทธิ์จริงต่อในแต่ละ endpoint)
export function canManageUsers(user) {
  return isSuper(user) || isBranchAdmin(user);
}

// '' = ไม่ล็อกสาขา (แอดมินกลาง) · ค่าอื่น = รหัสสาขาที่ถูกล็อก
export function scopedBranch(user) {
  return isSuper(user) ? '' : String((user && user.branch) || '').trim();
}

// เป้าหมายอยู่ในขอบเขตของผู้เรียกหรือไม่
export function sameBranch(user, target) {
  if (isSuper(user)) return true;
  const b = scopedBranch(user);
  return !!b && String((target && target.branch) || '').trim() === b;
}

// role ที่ผู้เรียกมีสิทธิ์ตั้ง — แอดมินกลางตั้งได้ทุกค่า, ผู้ดูแลสาขาตั้งได้แค่ user
export function canAssignRole(actor, role) {
  if (![ROLE_USER, ROLE_BRANCH_ADMIN, ROLE_ADMIN].includes(role)) return false;
  if (isSuper(actor)) return true;
  return role === ROLE_USER;
}

export function roleLabel(role) {
  if (role === ROLE_ADMIN) return 'แอดมินกลาง';
  if (role === ROLE_BRANCH_ADMIN) return 'ผู้ดูแลสาขา';
  return 'พนักงาน';
}
