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

// ---- ปีบัญชี เม.ย.-มี.ค. ----
const am = TodayUI.accountingMonths('2026-11-01');
ok('ปีบัญชี 12 เดือน เริ่ม เม.ย. 69', am.length === 12 && am[0].value === '04/2026' && am[0].label === 'เม.ย. 69');
ok('สิ้นปีบัญชี มี.ค. 70', am[11].value === '03/2027' && am[11].label === 'มี.ค. 70');
ok('currentAccountingMonth = 11/2026', TodayUI.currentAccountingMonth('2026-11-01') === '11/2026');
ok('ก่อน เม.ย. ยังเป็นปีบัญชีเก่า', TodayUI.accountingRange('2027-02-15').startYear === 2026);
ok('เม.ย. เริ่มปีบัญชีใหม่', TodayUI.accountingRange('2027-04-01').startYear === 2027);

// ---- คิวเก็บพิกัด: กรอง + เรียงด่วน (pure) ----
const M = TodayUI.currentMonthKey();
globalThis.Customers = { debtInfo: (c) => c._info || { due: '', maxTier: 0, has15: false, reserves: [], zone: c.zone || null, branch: c.branch || '' } };
const queue = [
  { id: 'normal', name: 'ง', zone: '1', _info: { maxTier: 1, due: '12/2026' } },
  { id: 'due', name: 'ค', zone: '2', _info: { maxTier: 1, due: M } },
  { id: 'npl', name: 'ก', zone: '3', _info: { maxTier: 4, due: M } },
  { id: 'm15', name: 'ข', zone: '1', _info: { maxTier: 1, has15: true } },
];
ok('เรียง NPL → 15 เดือน → ถึงกำหนด → ปกติ',
  JSON.stringify(TodayUI._sortQueue(queue).map((x) => x.id)) === JSON.stringify(['npl', 'm15', 'due', 'normal']));
const F0 = { status: 'missing', urgency: 'all', zone: '', branch: '', q: '' };
ok('กรองยังไม่มีพิกัด', TodayUI._matchGps({ id: 'x', lat: null, lng: null }, F0));
ok('มีพิกัดแล้วตกจากคิว missing', !TodayUI._matchGps({ id: 'x', lat: 13, lng: 101 }, F0));
ok('กรองมีพิกัดแล้ว', TodayUI._matchGps({ id: 'x', lat: 13, lng: 101 }, { ...F0, status: 'has' }));
ok('กรองเขต', TodayUI._matchGps({ id: 'x', zone: '3', lat: null, lng: null }, { ...F0, zone: '3' })
  && !TodayUI._matchGps({ id: 'x', zone: '2', lat: null, lng: null }, { ...F0, zone: '3' }));
ok('กรอง NPL', TodayUI._matchGps({ id: 'x', lat: null, lng: null, _info: { maxTier: 4 } }, { ...F0, urgency: 'npl' })
  && !TodayUI._matchGps({ id: 'x', lat: null, lng: null, _info: { maxTier: 2 } }, { ...F0, urgency: 'npl' }));
ok('ค้นชื่อ/CIF', TodayUI._matchGps({ id: 'x', name: 'สมชาย', cif: '1001', lat: null, lng: null }, { ...F0, q: '1001' }));
ok('ถึงกำหนดเดือนที่เลือก', TodayUI._matchGps({ id: 'x', lat: null, lng: null, _info: { due: '11/2026' } }, { ...F0, urgency: 'due', dueMonth: '11/2026' }));
ok('ถึงกำหนดคนละเดือนตก', !TodayUI._matchGps({ id: 'x', lat: null, lng: null, _info: { due: '12/2026' } }, { ...F0, urgency: 'due', dueMonth: '11/2026' }));
ok('ทุกเดือนในปีบัญชี = เม.ย.69-มี.ค.70',
  TodayUI._matchGps({ id: 'x', lat: null, lng: null, _info: { due: '01/2027' } }, { ...F0, urgency: 'due', dueMonth: '' })
  && !TodayUI._matchGps({ id: 'x', lat: null, lng: null, _info: { due: '03/2025' } }, { ...F0, urgency: 'due', dueMonth: '' }));
ok('coverageCounts นับถูก', (() => { const c = TodayUI.coverageCounts([{ lat: 1, lng: 1 }, { lat: null, lng: null }, {}]); return c.total === 3 && c.with === 1 && c.missing === 2; })());
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
