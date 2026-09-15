// ===== Debt Database — imported BAAC Customer Indicator (หนี้) data =====
// ข้อมูล: จำนวนสัญญา, หนี้รวม, ชั้นหนี้สูงสุด, Next Due เร็วสุด + รายการสัญญาแต่ละตัว

const DebtDB = {
  _byCif: null,
  _loaded: false,
  _loading: false,

  async load() {
    if (this._loaded) return true;
    if (this._loading) return false;
    this._loading = true;
    try {
      // โหลดจาก API (อ่าน KV ที่อัปเดตล่าสุดจาก /api/debt-import → fallback static เดิม)
      const res = await fetch(API.baseUrl() + '/api/debt-data', { headers: API.headers() });
      if (!res.ok) throw new Error('Failed to load debt data');
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('debt data not array');
      this._byCif = new Map();
      for (const r of data) this._byCif.set(r.cif, r);
      this._loaded = true;
      this._loadedAt = Date.now();
      console.log(`[DebtDB] Loaded ${data.length} customers` + (res.headers.get('X-Debt-Source') === 'kv' ? ' (from KV)' : ''));
    } catch (err) {
      console.warn('[DebtDB] Load failed:', err.message);
      this._byCif = new Map();
    }
    this._loading = false;
    return this._loaded;
  },

  // re-fetch ข้อมูลล่าสุด (หลังแอดมินอัพหนี้ใหม่ → หน้าสรุปเห็นเลขใหม่
  // โดยไม่ต้องรีเฟรชหน้า) — ไม่บล็อก ล้มเหลวเงียบ
  async refresh() {
    try {
      const res = await fetch(API.baseUrl() + '/api/debt-data', { headers: API.headers() });
      if (!res.ok) return false;
      const data = await res.json();
      if (!Array.isArray(data)) return false;
      this._byCif = new Map();
      for (const r of data) this._byCif.set(r.cif, r);
      this._loaded = true;
      this._loadedAt = Date.now();
      console.log(`[DebtDB] Refreshed ${data.length} customers (หลังอัพหนี้ใหม่)`);
      return true;
    } catch (err) {
      console.warn('[DebtDB] refresh failed:', err.message);
      return false;
    }
  },

  // Lookup debt by exact CIF -> record {cif,total_debt,num_contracts,max_tier,earliest_due,contracts[]} | null
  getByCif(cif) {
    if (!this._byCif) return null;
    return this._byCif.get(String(cif).trim()) || null;
  },

  // รูปแบบตัวเลขเงิน
  fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('th-TH', { maximumFractionDigits: 0 }) + ' บาท';
  },

  // รูปแบบวันที่ dd/mm/yyyy -> เดือนไทย
  fmtDate(d) {
    if (!d) return '';
    const m = String(d).match(/(\d+)\/(\d+)\/(\d+)/);
    if (!m) return d;
    const th = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    return th[parseInt(m[2]) - 1] + ' ' + (parseInt(m[3]) + 543);
  },

  // key สำหรับกรองเดือน: 'MM/YYYY' (ใช้ใน dropdown)
  dueMonthKey(d) {
    if (!d) return '';
    const m = String(d).match(/(\d+)\/(\d+)\/(\d+)/);
    if (!m) return '';
    return m[2] + '/' + m[3];
  },

  // สีตามชั้นหนี้
  tierColor(t) {
    t = parseInt(t) || 0;
    if (t >= 5) return '#b30000';
    if (t >= 4) return '#d00000';
    if (t >= 3) return '#ff7a00';
    if (t >= 2) return '#ffaa00';
    return '#1f8a4c';
  },

  // แสดงชั้นหนี้เป็น badge
  tierBadge(t) {
    t = parseInt(t) || 0;
    if (!t) return '<span class="meta-badge gray">ไม่ระบุ</span>';
    const labels = { 1: 'ชั้น 1', 2: 'ชั้น 2', 3: 'ชั้น 3', 4: 'ชั้น 4', 5: 'ชั้น 5' };
    return `<span class="meta-badge red-debt">${labels[t] || t}</span>`;
  },

  // แถบสรุปหนี้สำหรับการ์ด (popup + list)
  summaryHTML(debt) {
    if (!debt) return '';
    const urgent = debt.max_tier >= 2;
    const color = this.tierColor(debt.max_tier);
    return `
      ${DebtUI.zoomBarHTML()}
      <div class="debt-summary ${urgent ? 'debt-urgent' : ''}" style="border-left-color:${color}">
        <div class="debt-row">
          <span class="debt-label">💰 หนี้รวม</span>
          <span class="debt-val">${this.fmtMoney(debt.total_debt)}</span>
        </div>
        <div class="debt-row">
          <span class="debt-label">📦 สัญญา</span>
          <span class="debt-val">${debt.num_contracts} สัญญา · ชั้นสูงสุด ${debt.max_tier || '-'}</span>
        </div>
        <div class="debt-row">
          <span class="debt-label">📅 ถึงกำหนดเร็วสุด</span>
          <span class="debt-val">${this.fmtDate(debt.earliest_due) || '-'}</span>
        </div>
      </div>
    `;
  },

  // รายการสัญญา (โชว์ 3 ตัวแรก + ปุ่มดูอีก)
  contractsHTML(debt, showAll) {
    if (!debt || !debt.contracts || debt.contracts.length === 0) return '';
    const shown = showAll ? debt.contracts : debt.contracts.slice(0, 3);
    const hasMore = debt.contracts.length > 3 && !showAll;
    const fmtBaht = (n) => Number(n||0).toLocaleString('th-TH',{maximumFractionDigits:0})+' บาท';
    const rows = shown.map((c, i) => {
      const t = parseInt(c.t) || 0;
      const urgent = t >= 2;
      // 15 เดือน badges
      let m15line = '';
      if (c.m15 === 'Y') m15line += '<div class="dc-line" style="color:#92400e">⏳ <b>15 เดือน: ต้องชำระ</b></div>';
      if (c.m15_amt > 0) m15line += `<div class="dc-line" style="color:#b91c1c">💸 15เดือน 31มี.ค.70 ขั้นต่ำ ${fmtBaht(c.m15_amt)}</div>`;
      // พักหนี้ — แสดงเฉพาะรหัสที่มีตัวอักษร (SP/EP ฯลฯ) ไม่เอา ''/0/1/2/3
      let subLine = '';
      if (c.sub && !['','0','1','2','3'].includes(String(c.sub).trim()) && /[A-Za-z]/.test(c.sub)) {
        subLine = `<div class="dc-line" style="color:#0f766e">🛟 พักหนี้ (${this.escapeHTML(c.sub)})</div>`;
      }
      // คาดการณ์
      let fore='';
      if (c.f08==='Y' || c.f09==='Y' || c.f10==='Y'){
        const parts=[];
        if(c.f08==='Y') parts.push(`ส.ค.69${c.p08>0?' '+fmtBaht(c.p08):''}`);
        if(c.f09==='Y') parts.push(`ก.ย.69${c.p09>0?' '+fmtBaht(c.p09):''}`);
        if(c.f10==='Y') parts.push(`ต.ค.69${c.p10>0?' '+fmtBaht(c.p10):''}`);
        fore = `<div class="dc-line" style="color:#7c3aed">🔮 คาด 15เดือน: ${parts.join(' · ')}</div>`;
      }
      return `
        <div class="debt-contract ${urgent ? 'debt-contract-urgent' : ''}">
          <div class="dc-head">
            <span class="dc-no">สัญญา ${i + 1}</span>
            <span class="dc-tier" style="color:${this.tierColor(t)}">${t ? 'ชั้น ' + t : 'ชั้น -'}</span>
          </div>
          <div class="dc-line">🏷️ เลขสัญญา ${this.escapeHTML(c.c)}</div>
          <div class="dc-line">💰 ${this.fmtMoney(c.d)}</div>
          <div class="dc-line">📅 ถึง ${this.fmtDate(c.due) || '-'}</div>
          ${c.reserve ? `<div class="dc-line">🛡️ กันสำรอง ${this.escapeHTML(c.reserve)}%</div>` : ''}
          ${m15line}
          ${subLine}
          ${fore}
        </div>
      `;
    }).join('');
    const btn = hasMore
      ? `<button class="debt-more" onclick="DebtUI.expand('${debt.cif}')">ดูสัญญาทั้งหมด (${debt.contracts.length} สัญญา) ▾</button>`
      : '';
    return `<div class="debt-contracts">${rows}${btn}</div>`;
  },

  escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  },
};

window.DebtDB = DebtDB;

// ===== DebtUI — ตัวช่วย UI สำหรับการ์ดหนี้ =====
const DebtUI = {
  KEY_ZOOM: 'bfr_debt_zoom',

  // สถานะซูมตัวอักษรการ์ดหนี้ (จำข้ามการเปิด/ปิดแอป)
  isZoomOn() {
    try { return localStorage.getItem(this.KEY_ZOOM) === '1'; } catch (e) { return false; }
  },

  // แถบปุ่ม 🔍 ในการ์ดหนี้ — ใช้ร่วมกันทั้ง popup บนแผนที่และหน้าจัดการข้อมูลลูกค้า
  zoomBarHTML() {
    return `<div class="debt-zoom-bar"><button type="button" class="debt-zoom-btn" onclick="DebtUI.toggleZoom(this)">${this.isZoomOn() ? '🔎 ย่อตัวอักษร' : '🔍 ขยายตัวอักษร'}</button></div>`;
  },

  // ติดคลาส debt-zoom ที่ body → CSS ขยายตัวอักษรทุกการ์ดหนี้ที่เปิดอยู่
  _paint(on) {
    if (document.body) document.body.classList.toggle('debt-zoom', on);
    document.querySelectorAll('.debt-zoom-btn').forEach((b) => {
      b.textContent = on ? '🔎 ย่อตัวอักษร' : '🔍 ขยายตัวอักษร';
    });
  },

  toggleZoom(btn) {
    const on = !this.isZoomOn();
    try { localStorage.setItem(this.KEY_ZOOM, on ? '1' : '0'); } catch (e) {}
    this._paint(on);
    if (btn && btn.blur) btn.blur();
  },

  // เรียกตอนโหลดหน้า — ถ้าเคยเปิดซูมไว้ ให้การ์ดหนี้ใหญ่ทันที
  init() { this._paint(this.isZoomOn()); },

  // ขยาย/ย่อรายการสัญญาในการ์ด popup
  expand(cif) {
    const detail = document.getElementById('debt-contracts-' + cif);
    if (!detail) return;
    const debt = DebtDB.getByCif(cif);
    if (!debt) return;
    detail.innerHTML = DebtDB.contractsHTML(debt, true);
  },
};
window.DebtUI = DebtUI;

// เปิดหน้าแล้วใช้สถานะซูมที่จำไว้ (ตัวอักษรการ์ดหนี้ใหญ่/ปรกติ)
if (document.body) {
  DebtUI.init();
} else {
  document.addEventListener('DOMContentLoaded', () => DebtUI.init());
}
