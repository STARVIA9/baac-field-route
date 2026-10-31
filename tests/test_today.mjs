// Harness: หน้าแรกงานวันนี้ — คณิตวันที่นัด + นับพิกัด (pure, ไม่แตะ DOM/Storage)
import TodayUI from '../public/js/today.js';

let fails = 0;
const ok = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n); if (!c) fails++; };

ok('offset +7 ข้ามเดือน', TodayUI.promiseDateOffset(7, '2026-10-28') === '2026-11-04');
ok('offset พรุ่งนี้ข้ามปี', TodayUI.promiseDateOffset(1, '2026-12-31') === '2027-01-01');
ok('สิ้นเดือน ก.พ. ปีอธิกสุรทิน', TodayUI.monthEndStr('2028-02-10') === '2028-02-29');
ok('สิ้นเดือนปกติ', TodayUI.monthEndStr('2026-10-28') === '2026-10-31');
ok('รูปแบบ YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(TodayUI.todayStr()));

const custs = [
  { id: 'a', name: 'ก', zone: '2', lat: 13.1, lng: 101.1 },
  { id: 'b', name: 'ข', zone: '1' },
  { id: 'c', name: 'ค', zone: '1', lat: NaN, lng: 101.0 },
  { id: 'd', name: 'ง', zone: '1', lat: 13.2, lng: 101.2 },
];
const st = TodayUI.coverageStats(custs);
ok('นับ total/with', st.total === 4 && st.with === 2);
ok('missing 2 ราย', st.missing.length === 2);
ok('missing เรียงตาม zone ก่อน', st.missing[0].zone === '1' && st.missing[1].zone === '1');
ok('ไม่นับ NaN ว่ามีพิกัด', st.missing.some((m) => m.id === 'c'));
ok('array ว่าง/null ไม่พัง', TodayUI.coverageStats([]).total === 0 && TodayUI.coverageStats(null).total === 0);

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
