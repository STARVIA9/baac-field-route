# แดชบอร์ดรายคน KPI — Implementation Plan

> **For Hermes:** implement task-by-task below.

**Goal:** เลือกชื่อคนใน "มุมมองสรุป" แล้วเห็นแดชบอร์ด: จุดแข็ง vs เพื่อน (กราฟ), จุดที่ขาด + ต้องวิ่งอะไร (แต้มที่เก็บได้)

**Architecture:** ไม่แตะหลังบ้าน (`functions/api/kpi.js`) — ข้อมูลรายคนมีครบใน `CACHE` อยู่แล้ว เติมแค่ฟังก์ชัน render ใน `public/kpi/index.html` ใช้ `.bar`/`.pill`/SVG เดิม

**Tech Stack:** vanilla JS + SVG เดิมในไฟล์เดียว

---

### Task 1: `pgap(p, it, pid)` — ข้อความ "ต้องวิ่ง" รายคน

**Objective:** คืน {need(อีกเท่าไร), nextPts(แต้มขั้นถัดไป), gain(แต้มที่จะได้เพิ่ม)} ต่อ 1 ข้อ

**Files:** Modify: `public/kpi/index.html` (~บรรทัด 146, ต่อจาก `pbands`)

**Step 1: เขียนเทส** — สร้าง `~/.hermes/cache/scratch/kpi-dash-test.mjs` คัดลอก `jscoreI/pbands/pscore/pgap` มาวาง + เคส: วรรณวิษา p6 (2.4669/เป้า1 → เต็มแล้ว, gain 0), ณภัทร p6 (-0.119/ขั้น1=0.656 → need 0.775, gain ถึงขั้น1), อภิสรา p11 (3.20/เป้า1.84 ยิ่งน้อยยิ่งดี → เต็มแล้ว)

**Step 2: รันเทสต้องแดง** — `node ~/.hermes/cache/scratch/kpi-dash-test.mjs` → FAIL (pgap not defined)

**Step 3: เติม implementation** (ตรรกะเดียวกับ `gapTxt` แต่ใช้ `pbands(p,it)` + `actuals[pid]`; ข้อ 4.1/4.2 รายเดือนข้ามไปก่อน — คืน null):

```js
function pgap(p,it,pid){const f=Number(it.full),b=pbands(p,it).map(Number);
const r=((it.actuals||{})[pid]);const a=r==null||r==='' ?null:Number(r),lo=b[0]>b[4],u=it.unit;
const fmt=v=>Number(Math.round(v*10000)/10000);
if(a==null)return{text:'ยังไม่คีย์',need:null,gain:f};
const th=[b[4],b[3],b[2],b[1],b[0]],pts=[1,.8,.6,.4,.2],cur=jscoreI(f,b,a);
for(let i=0;i<5;i++){if(lo?a<=th[i]:a>=th[i]){if(i===0)return{text:'เต็มขั้นแล้ว',need:0,gain:0};
const nd=lo?fmt(a-th[i-1]):fmt(th[i-1]-a);
const nx=Math.round(f*pts[i-1]*100)/100;return{text:`อีก ${nd} ${u} → +${Math.round((nx-cur)*100)/100} แต้ม`,need:nd,gain:Math.round((nx-cur)*100)/100};}}
const nd=lo?fmt(a-b[0]):fmt(b[0]-a);return{text:`ต่ำกว่าขั้น 1 อีก ${nd} ${u}`,need:nd,gain:Math.round((f/5-cur)*100)/100};}
```

**Step 4: รันเทสต้องเขียว** — `node` เทสผ่าน 3 เคส

### Task 2: ตารางเทียบเพื่อนต่อข้อ

**Objective:** ฟังก์ชัน `peerRows(items, persons, pid)` คืน array ต่อข้อ {code,name,me,best,bestName,behind} โดย best = คะแนนสูงสุดของเพื่อน (ข้ามคนไม่มีข้อมูล)

**Files:** Modify: `public/kpi/index.html` (ต่อจาก `pgap`)

**Step 1-2:** เติมเคสในเทสเดิม: ข้อ 3.1 (วรรณวิษา 3 = เต็ม, best = 3 เสมอ), ข้อ 3.9 (อภิสรา 1 ต่ำสุด, behind = max(5,5,...)-1) → รันแดง

**Step 3:** implementation (~10 บรรทัด, วน items × persons ใช้ `pscore` เดิม):

```js
function peerRows(items,persons,pid){return items.map(it=>{let best=null,bn='';
persons.forEach(q=>{if(q.id===pid)return;const s=pscore(q,it,q.id);if(s!=null&&(best==null||s>best)){best=s;bn=q.name;}});
const me=pscore(persons.find(q=>q.id===pid),it,pid);
return{code:it.code,name:it.name,full:Number(it.full),me,best,bestName:bn,
behind:(me!=null&&best!=null)?Math.round((best-me)*100)/100:null};});}
```

**Step 4:** รันเทสเขียว

### Task 3: render แดชบอร์ดใน `#psum`

**Objective:** เลือกคนแล้วเห็น: โดนัทเดิม + อันดับที่ X/4 + 💪 จุดแข็ง 3 ข้อ (แต้ม%สูงสุด) + 🎯 ต้องวิ่ง (ไม่เต็ม เรียง gain มาก→น้อย พร้อมข้อความ pgap) + 📊 เทียบเพื่อนรายข้อ (แท่งฉัน vs ดีสุด)

**Files:** Modify: `public/kpi/index.html` บรรทัด 156 (แทน `$('#psum').innerHTML=...` เดิม)

**Verify:** `node --check` ผ่าน + เปิด `public/kpi/index.html` ผ่าน browser เห็นแดชบอร์ดทั้งจอ 390px และ desktop (screenshot)

### Task 4: QA + ส่งพ่ออนุมัติก่อน deploy

- `node --check public/kpi/index.html` (เป็น HTML — ตรวจ JS ด้วยการดึง `<script>` มาตรวจแยกถ้าจำเป็น)
- browser: เลือกชื่อ วรรณวิษา → screenshot มือถือ + desktop, vision ตรวจตัวเลข ≥14px
- ส่งรูปให้พ่อ → พ่อบอก "ขึ้นเว็บจริง" ค่อย commit+push (`wrangler pages deploy public --project-name baac-field-route --branch=main`) + verify สด
