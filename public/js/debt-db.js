// ===== Debt Database — imported BAAC Customer Indicator (หนี้) data =====
// ข้อมูล: จำนวนสัญญา, หนี้รวม, ชั้นหนี้สูงสุด, Next Due เร็วสุด + รายการสัญญาแต่ละตัว

const DebtDB = {
  _byCif: null,
  _loaded: false,
  _loading: false,
  _fromCache: false,   // true = รอบนี้ใช้แคชในเครื่อง ไม่ได้โหลดใหม่ (ดูในแท็บสุขภาพได้)

  KEY_DEBT_UPDATED: 'bfr_debt_updated',
  CACHE_STORE: 'bfr-debt-v1',

  // ขอบเขตแคชรายคน (staff คนละสาขาเห็นข้อมูลคนละชุด — ห้ามใช้แคชข้ามกัน)
  _cacheScope() {
    try {
      if (typeof Auth !== 'undefined' && Auth.getUser) {
        const u = Auth.getUser();
        return String((u && (u.id || u.username)) || 'anon');
      }
    } catch {}
    return 'anon';
  },
  _cacheKey(branch) {
    const base = API.baseUrl() + '/api/debt-data?scope=' + encodeURIComponent(this._cacheScope());
    return branch ? base + '&branch=' + encodeURIComponent(branch) : base;
  },
  _stamp() { try { return localStorage.getItem(this.KEY_DEBT_UPDATED) || ''; } catch { return ''; } },
  _saveStamp(v) { try { if (v) localStorage.setItem(this.KEY_DEBT_UPDATED, v); } catch {} },

  // ถามเวอร์ชันเซิร์ฟเวอร์อย่างเดียว (เบามาก — ไม่โหลดข้อมูล 7MB)
  async _serverVersion() {
    try {
      const res = await fetch(API.baseUrl() + '/api/debt-data?v=1', { headers: API.headers() });
      if (!res.ok) return null;
      const j = await res.json();
      return (j && j.success) ? (j.updated || null) : null;
    } catch { return null; }
  },

  async _readCache(key) {
    try {
      if (typeof caches === 'undefined') return null;
      const hit = await (await caches.open(this.CACHE_STORE)).match(key);
      if (!hit) return null;
      const data = await hit.json();
      return Array.isArray(data) ? data : null;
    } catch { return null; }
  },

  // เก็บสำเนาลงเครื่อง + ลบของคนอื่นในเครื่องนี้ (กันแคชบวม + กันหยิบข้ามสาขา)
  // หมายเหตุ: เรียกด้วย res.clone() ก่อน res.json() เสมอ (body อ่านได้ครั้งเดียว)
  async _writeCache(key, copy) {
    try {
      if (typeof caches === 'undefined' || !copy) return;
      const c = await caches.open(this.CACHE_STORE);
      // 17 พ.ย.69: เก็บแยกตามสาขาได้ (scope เดียวกันหลายคีย์) — ลบเฉพาะของ scope/สาขาที่เก่าซ้ำ
      const scopeTag = key.split('?scope=')[1] || '';
      for (const r of await c.keys()) {
        if (r.url === key) continue;
        if (scopeTag && r.url.indexOf('?scope=' + scopeTag.split('&')[0]) >= 0) await c.delete(r);
      }
      await c.put(key, copy);
    } catch {}
  },

  _fill(data, tag) {
    // ชั้นป้องกันสุดท้าย: คนที่ไม่ใช่แอดมินกลาง ต้องเห็นเฉพาะสาขาตัวเองเท่านั้น
    // (ข้อมูลอาจมาจากแคช/คลังรวม — กรองซ้ำฝั่งเครื่องก่อนใช้เสมอ)
    let rows = Array.isArray(data) ? data : [];
    try {
      const isSuper = (typeof Auth !== 'undefined' && Auth.isAdmin) ? Auth.isAdmin() : false;
      const own = (typeof Auth !== 'undefined' && Auth.getUser) ? String((Auth.getUser() || {}).branch || '').trim() : '';
      if (!isSuper && own) {
        const before = rows.length;
        rows = rows.filter(r => String((r && r.branch) || '').trim() === own);
        if (before !== rows.length) console.warn(`[DebtDB] กรองข้อมูลต่างสาขาออก ${before - rows.length} ราย`);
      }
    } catch { /* ถ้า Auth อ่านไม่ได้ ใช้ข้อมูลเดิม */ }
    this._byCif = new Map();
    for (const r of rows) this._byCif.set(r.cif, r);
    this._loaded = true;
    this._loadedAt = Date.now();
    console.log(`[DebtDB] Loaded ${rows.length} customers` + tag);
  },

  async load() {
    if (this._loaded) return true;
    if (this._loading) return false;
    this._loading = true;
    try {
      const isSuper = (typeof Auth !== 'undefined' && Auth.isAdmin) ? Auth.isAdmin() : false;
      // 17 พ.ย.69: แอดมินกลางโหลดทีละสาขา (เริ่มจากสาขาของตัวเอง) แทนการโหลดทุกสาขา ~10MB
      if (isSuper && typeof Auth !== 'undefined' && Auth.getUser && Auth.getUser()) {
        await this._loadAdminPrimary();
      } else {
        await this._loadScope('', '/api/debt-data', {});
      }
    } catch (err) {
      console.warn('[DebtDB] Load failed:', err.message);
      this._byCif = new Map();
    }
    this._loading = false;
    return this._loaded;
  },

  // โหลดชุดเดียว (ไม่ระบุสาขา = ตามสิทธิ์ผู้ใช้) — ใช้ทั้งผู้ใช้ทั่วไปและแอดมินกรณีโหลดรวม
  async _loadScope(branch, url, headers, force) {
    const key = this._cacheKey(branch);
    const want = this._cacheScope() + '|' + (await this._serverVersion());
    if (!force && want && this._stamp() === want) {
      const cached = await this._readCache(key);
      if (cached) {
        this._fromCache = true;
        this._fill(cached, ' (จากแคชในเครื่อง — ข้อมูลหนี้ไม่เปลี่ยน)');
        return true;
      }
    }
    this._fromCache = false;
    const res = await fetch(url, { headers: API.headers() });
    if (!res.ok) throw new Error('Failed to load debt data');
    const copy = res.clone();
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('debt data not array');
    const up = res.headers.get('X-Debt-Updated');
    if (up) this._saveStamp(this._cacheScope() + '|' + up);
    await this._writeCache(key, copy);
    this._fill(data, res.headers.get('X-Debt-Source') === 'kv' ? ' (from KV)' : '');
    return true;
  },

  // แอดมิน: โหลดเฉพาะสาขาหลักก่อน (เร็ว) แล้วค่อยโหลดสาขาอื่นเมื่อจำเป็น
  async _loadAdminPrimary() {
    let stats = null;
    try {
      const r = await fetch(API.baseUrl() + '/api/customers/stats', { headers: API.headers() });
      const j = await r.json();
      if (j && j.success) stats = j;
    } catch { /* ไม่ได้ stats ก็ใช้ค่าเริ่มต้น */ }
    this._stats = stats;
    if (!stats) {
      // อ่าน stats ไม่ได้ (เน็ต/สิทธิ์) → ถอยไปโหลดแบบเดิมทั้งก้อน ดีกว่าหน้าว่าง
      return this._loadScope('', API.baseUrl() + '/api/debt-data', {});
    }
    const rowsB = (stats && stats.by_branch) || [];
    this._branchesAll = rowsB.filter(b => (+b.with_debt || 0) > 0).map(b => String(b.branch));
    this._branchesLoaded = new Set();
    const own = String((Auth.getUser() || {}).branch || '').trim();
    // สาขาหลัก = สาขาของผู้ใช้ (ถ้ามีข้อมูล) ไม่งั้นสาขาที่มีลูกค้าหนี้มากสุด
    let primary = this._branchesAll.indexOf(own) >= 0 ? own : '';
    if (!primary) {
      let best = -1;
      for (const b of rowsB) {
        const n = +b.with_debt || 0;
        if (n > best) { best = n; primary = String(b.branch); }
      }
    }
    this._primaryBranch = primary;
    this._partial = this._branchesAll.length > (primary ? 1 : 0);
    if (!primary) {
      this._byCif = new Map();
      this._loaded = true;
      this._loadedAt = Date.now();
      return;
    }
    await this._loadScope(primary, API.baseUrl() + '/api/debt-data?branch=' + encodeURIComponent(primary));
    this._branchesLoaded = new Set([primary]);
  },

  // โหลดสาขาเพิ่ม (เมื่อผู้ใช้เลือกสาขาที่ยังไม่มีในเครื่อง) — รวมเข้าคลังเดิม
  async ensureBranch(branch, force) {
    const b = String(branch || '').trim();
    if (!b || b === 'ALL') return false;
    if (!this._branchesLoaded) this._branchesLoaded = new Set();
    if (!force && this._branchesLoaded.has(b)) return true;
    try {
      const res = await fetch(API.baseUrl() + '/api/debt-data?branch=' + encodeURIComponent(b), { headers: API.headers() });
      if (!res.ok) return false;
      const rows = await res.json();
      if (!Array.isArray(rows)) return false;
      if (!this._byCif) this._byCif = new Map();
      for (const r of rows) this._byCif.set(r.cif, r);
      this._branchesLoaded.add(b);
      this._loadedAt = Date.now();
      this._partial = (this._branchesAll || []).some(x => !this._branchesLoaded.has(x));
      return true;
    } catch { return false; }
  },

  // โหลดทุกสาขาที่ยังขาด (ผู้ใช้เลือก "ทุกสาขา")
  async loadAllBranches() {
    const all = this._branchesAll || [];
    for (const b of all) {
      if (!this._branchesLoaded || !this._branchesLoaded.has(b)) await this.ensureBranch(b);
    }
    this._partial = false;
    return true;
  },

  // re-fetch ข้อมูลล่าสุด (หลังแอดมินอัพหนี้ใหม่ → หน้าสรุปเห็นเลขใหม่
  // โดยไม่ต้องรีเฟรชหน้า) — ไม่บล็อก ล้มเหลวเงียบ
  async refresh() {
    try {
      // 17 พ.ย.69: รีเฟรชเฉพาะสาขาที่โหลดอยู่ (แอดมินไม่ต้องดึงทุกสาขาใหม่ทั้งก้อน)
      if (this._branchesLoaded && this._branchesLoaded.size) {
        const list = [...this._branchesLoaded];
        // ล้างเฉพาะสาขาเหล่านี้จาก memory แล้วโหลดใหม่ (สาขาอื่นที่โหลดไว้ก่อนหน้าคงอยู่)
        this._branchesLoaded = new Set();
        for (const b of list) {
          if (this._byCif) {
            const rows = [...this._byCif.values()].filter(r => String(r.branch || '').trim() !== b);
            this._byCif = new Map(rows.map(r => [r.cif, r]));
          }
          await this.ensureBranch(b, true);
        }
        this._loadedAt = Date.now();
        return true;
      }
      return await this._loadScope('', API.baseUrl() + '/api/debt-data', {}, true);
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

  // พับ/ขยายรายการสัญญาในการ์ด popup (เริ่มพับไว้ — จอเล็กไม่ล้น)
  // กดครั้งแรกค่อยวาดรายการ (lazy) แล้วสลับซ่อน/โชว์
  toggleContracts(cif, btn) {
    const box = document.getElementById('debt-contracts-' + cif);
    if (!box) return;
    if (!box.dataset.filled) {
      const debt = DebtDB.getByCif(cif);
      if (!debt) return;
      box.innerHTML = DebtDB.contractsHTML(debt, true);
      box.dataset.filled = '1';
    }
    const opening = box.classList.contains('hidden');
    box.classList.toggle('hidden');
    if (btn) {
      const n = box.querySelectorAll('.debt-contract').length || ((DebtDB.getByCif(cif) || {}).contracts || []).length;
      btn.innerHTML = opening ? `📄 ซ่อนสัญญา (${n} สัญญา) ▴` : `📄 ดูสัญญา (${n} สัญญา) ▾`;
      if (btn.blur) btn.blur();
    }
  },

  // ชื่อเก่า (ปุ่มใน contractsHTML แบบย่อเรียกใช้) — ชี้มาที่ตัวใหม่
  expand(cif) { this.toggleContracts(cif, null); },
};
window.DebtUI = DebtUI;

// เปิดหน้าแล้วใช้สถานะซูมที่จำไว้ (ตัวอักษรการ์ดหนี้ใหญ่/ปรกติ)
if (document.body) {
  DebtUI.init();
} else {
  document.addEventListener('DOMContentLoaded', () => DebtUI.init());
}
