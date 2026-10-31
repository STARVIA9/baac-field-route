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


// ---- shared debt matcher (ใช้ร่วมกันทั้งแผนที่และหน้า "งานวันนี้") ----
import Customers from '../public/js/customers.js';
const F = (o) => Object.assign({ month: '', tier: '', omsom: '', m15: '', reserve: '', zone: '', branch: '' }, o);
const D = (o) => Object.assign({ due: '', maxTier: 0, omsom: false, has15: false, reserves: [], zone: null, branch: '' }, o);
ok('ว่างหมดผ่าน', Customers.matchDebt(F({}), D({})));
ok('เดือนตรง', Customers.matchDebt(F({ month: '08/2026' }), D({ due: '08/2026' })));
ok('เดือนไม่ตรงตก', !Customers.matchDebt(F({ month: '08/2026' }), D({ due: '09/2026' })));
ok('NPL ข้ามเดือน', Customers.matchDebt(F({ month: '08/2026', tier: 'npl' }), D({ due: '', maxTier: 4 })));
ok('NPL แต่ชั้น 2 ตก', !Customers.matchDebt(F({ tier: 'npl' }), D({ maxTier: 2 })));
ok('ชั้นตรง', Customers.matchDebt(F({ tier: '2' }), D({ maxTier: 2 })));
ok('ชั้นไม่ตรงตก', !Customers.matchDebt(F({ tier: '2' }), D({ maxTier: 1 })));
ok('15 เดือน', Customers.matchDebt(F({ m15: 'Y' }), D({ has15: true })));
ok('ไม่มี 15 เดือน', Customers.matchDebt(F({ m15: 'none' }), D({ has15: false })));
ok('สำรอง 100', Customers.matchDebt(F({ reserve: '100' }), D({ reserves: ['100', ''] })));
ok('ไม่มีสำรอง', Customers.matchDebt(F({ reserve: 'none' }), D({ reserves: [] })));
ok('มีสำรองแต่ขอ none ตก', !Customers.matchDebt(F({ reserve: 'none' }), D({ reserves: ['1'] })));
ok('เขตตรง', Customers.matchDebt(F({ zone: '3' }), D({ zone: '3' })));
ok('ไม่มีทะเบียนเขตตก', !Customers.matchDebt(F({ zone: '3' }), D({ zone: null })));
ok('สาขาตรง', Customers.matchDebt(F({ branch: 'WTC' }), D({ branch: 'WTC' })));
ok('สาขาไม่ตรงตก', !Customers.matchDebt(F({ branch: 'KBB' }), D({ branch: 'WTC' })));
const di = Customers.debtInfo({ cif: 'x', branch: 'WTC' });
ok('debtInfo ไม่มีข้อมูลหลังบ้านไม่พัง', di.due === '' && di.maxTier === 0 && di.zone === null && di.branch === 'WTC');
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
