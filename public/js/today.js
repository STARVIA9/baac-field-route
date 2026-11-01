// ===== งานวันนี้ — คิวเก็บพิกัดตามเขต (1 พ.ย.69) =====
// ใช้ข้อมูลเดิมทั้งหมด: Storage.getActiveCustomers() + Customers.debtInfo()
// ตัวกรองด้านบนสุด = กรองคิวเก็บพิกัด (ยังไม่มีพิกัด/มีแล้ว/เขต/สาขา/ความด่วน)

const TodayUI = {
  PAGE_SIZE: 10,       // แสดงหน้าละ 10 ราย
  _page: 1,            // หน้าปัจจุบันของคิวเก็บพิกัด
  _filterTimer: null,
  _gpsWired: false,

  todayStr(base) {
    const d = base ? new Date(base) : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  // +n วันจากวันฐาน (base = 'YYYY-MM-DD' หรือว่าง = วันนี้)
  promiseDateOffset(days, base) {
    const d = base ? new Date(base + 'T00:00:00') : new Date();
    d.setDate(d.getDate() + days);
    return this.todayStr(d);
  },

  // วันสุดท้ายของเดือนเดียวกับวันฐาน
  monthEndStr(base) {
    const d = base ? new Date(base + 'T00:00:00') : new Date();
    return this.todayStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  },

  // ===== ปีบัญชี เม.ย. - มี.ค. (ใช้กับตัวกรอง "ถึงกำหนดเดือน") =====
  accountingRange(base) {
    const d = base ? new Date(base + 'T00:00:00') : new Date();
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const startYear = m >= 4 ? y : y - 1;   // เม.ย. เริ่มปีบัญชีใหม่
    return { startYear, endYear: startYear + 1 };
  },

  // 12 เดือนของปีบัญชีปัจจุบัน: 04/2026 ... 03/2027
  accountingMonths(base) {
    const { startYear } = this.accountingRange(base);
    const names = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const out = [];
    for (let i = 0; i < 12; i++) {
      const mm = ((3 + i) % 12) + 1;       // 4,5,...,12,1,2,3
      const yy = mm >= 4 ? startYear : startYear + 1;
      const be = (yy + 543) % 100;
      out.push({
        value: String(mm).padStart(2, '0') + '/' + yy,
        label: names[mm - 1] + ' ' + be,
      });
    }
    return out;
  },

  currentAccountingMonth(base) {
    const d = base ? new Date(base + 'T00:00:00') : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getMonth() + 1) + '/' + d.getFullYear();
  },

  // นับพิกัดแบบ pure (รับ array ลูกค้า) — เทสง่าย ไม่แตะ Storage ตรงนี้
  coverageStats(customers) {
    const list = Array.isArray(customers) ? customers : [];
    const ok = (c) => Number.isFinite(c.lat) && Number.isFinite(c.lng);
    const missing = list.filter((c) => !ok(c));
    missing.sort((a, b) => String(a.zone || '9').localeCompare(String(b.zone || '9'), 'th')
      || String(a.name || '').localeCompare(String(b.name || ''), 'th'));
    return { total: list.length, with: list.length - missing.length, missing };
  },

  // นับแบบไม่เรียง — ใช้กับ 9k รายทุกครั้งที่รีเฟรช (เบากว่า coverageStats)
  coverageCounts(customers) {
    const list = Array.isArray(customers) ? customers : [];
    let withGps = 0;
    for (const c of list) {
      if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) withGps++;
    }
    return { total: list.length, with: withGps, missing: list.length - withGps };
  },

  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  },

  // ===== ตัวกรองคิวเก็บพิกัด =====
  readGpsFilter() {
    const v = (id) => { const el = typeof document !== 'undefined' ? document.getElementById(id) : null; return el ? el.value : ''; };
    return {
      status: v('gps-status') || 'missing',
      urgency: v('gps-urgency') || 'all',
      dueMonth: v('gps-due-month'),
      zone: v('gps-zone'),
      branch: v('gps-branch'),
      q: (v('gps-search') || '').trim().toLowerCase(),
    };
  },

  ensureGpsOptions() {
    if (typeof document === 'undefined') return;
    // เติมสาขาจากตัวกรองแผนที่ (ที่เดียวกัน ตรรกะเดียวกัน)
    const dst = document.getElementById('gps-branch');
    const src = document.getElementById('map-branch-filter');
    if (dst && src && dst.options.length <= 1 && src.options.length > 1) dst.innerHTML = src.innerHTML;
    if (dst) {
      const isAdmin = (typeof Auth !== 'undefined' && Auth.isAdmin) ? Auth.isAdmin() : false;
      dst.classList.toggle('hidden', !isAdmin);
    }
    this._populateBranchOptions();
    this._populateDueMonthOptions();
    this._populateZoneOptions();
    if (!this._gpsWired) {
      this._gpsWired = true;
      ['gps-status', 'gps-urgency', 'gps-zone', 'gps-branch'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => this._debouncedRefresh());
      });
      // เลือกเดือนถึงกำหนด → สลับโหมดเป็น "ถึงกำหนดเดือน" อัตโนมัติ
      const dueSel = document.getElementById('gps-due-month');
      if (dueSel) dueSel.addEventListener('change', () => {
        const u = document.getElementById('gps-urgency');
        if (u) u.value = 'due';
        this._debouncedRefresh();
      });
      // เปลี่ยนสาขา → เขตที่เลือกได้ต้องเหลือเฉพาะเขตของสาขานั้น
      const brSel = document.getElementById('gps-branch');
      if (brSel) brSel.addEventListener('change', () => this._populateZoneOptions());
      const search = document.getElementById('gps-search');
      if (search) search.addEventListener('input', () => this._debouncedRefresh());
      const golden = document.getElementById('today-golden-btn');
      if (golden) golden.addEventListener('click', () => this.openGoldenRoute());
    }
  },

  // รายชื่อสาขาที่มีจริงในเครื่อง + ชื่อจากทะเบียน (map filter / admin branches)
  _populateBranchOptions() {
    if (typeof document === 'undefined') return;
    const sel = document.getElementById('gps-branch');
    if (!sel) return;
    const prev = sel.value;
    const labels = new Map();
    const mapSel = document.getElementById('map-branch-filter');
    if (mapSel) {
      [...mapSel.options].forEach((o) => { if (o.value) labels.set(String(o.value), o.textContent.trim()); });
    }
    if (Array.isArray(window._adminBranches)) {
      window._adminBranches.forEach((b) => { if (b && b.code) labels.set(String(b.code), b.name || String(b.code)); });
    }
    const all = (typeof Storage !== 'undefined' && Storage.getActiveCustomers) ? Storage.getActiveCustomers() : [];
    const codes = new Set();
    for (const c of all) {
      const code = String(c.branch || '').trim();
      if (code) codes.add(code);
    }
    labels.forEach((_, code) => codes.add(code));
    const scope = this._scopeBranch();
    const list = scope ? [scope] : [...codes].sort();
    sel.innerHTML = '<option value="">ทุกสาขา</option>' +
      list.map((code) => '<option value="' + this.esc(code) + '">' + this.esc(labels.get(code) || code) + '</option>').join('');
    sel.value = prev && list.includes(prev) ? prev : '';
  },

  // เดือน 12 เดือนของปีบัญชีปัจจุบัน (เม.ย. - มี.ค.) — ตั้งค่าเริ่มต้นเป็นเดือนนี้
  _populateDueMonthOptions() {
    const sel = typeof document !== 'undefined' ? document.getElementById('gps-due-month') : null;
    if (!sel) return;
    const had = sel.dataset.filled === '1';
    const prev = sel.value;
    const months = this.accountingMonths();
    sel.innerHTML = '<option value="">ทุกเดือนในปีบัญชี</option>' +
      months.map((m) => '<option value="' + this.esc(m.value) + '">' + this.esc(m.label) + '</option>').join('');
    if (had && (prev === '' || months.some((m) => m.value === prev))) {
      sel.value = prev;
    } else {
      // เปิดครั้งแรก: ตั้งเดือนปัจจุบันของปีบัญชีนี้
      const cur = this.currentAccountingMonth();
      sel.value = months.some((m) => m.value === cur) ? cur : '';
    }
    sel.dataset.filled = '1';
  },

  // เขตที่เลือกได้ = เขตที่มีจริงในลูกค้าของสาขาที่เลือก (ไม่ hardcode 1-5)
  _populateZoneOptions() {
    if (typeof document === 'undefined') return;
    const sel = document.getElementById('gps-zone');
    if (!sel) return;
    const branch = this._scopeBranch() || ((document.getElementById('gps-branch') || {}).value || '');
    const all = (typeof Storage !== 'undefined' && Storage.getActiveCustomers) ? Storage.getActiveCustomers() : [];
    const zones = new Set();
    for (const c of all) {
      if (branch && String(c.branch || '') !== String(branch)) continue;
      const z = c.zone == null ? '' : String(c.zone).trim();
      if (z) zones.add(z);
    }
    const prev = sel.value;
    const list = [...zones].sort((a, b) => (parseInt(a, 10) || 99) - (parseInt(b, 10) || 99) || a.localeCompare(b, 'th'));
    sel.innerHTML = '<option value="">ทุกเขต</option>' +
      list.map((z) => '<option value="' + this.esc(z) + '">เขต ' + this.esc(z) + '</option>').join('');
    sel.value = prev && list.includes(prev) ? prev : '';
  },

  _debouncedRefresh() {
    this._page = 1;
    clearTimeout(this._filterTimer);
    this._filterTimer = setTimeout(() => { try { this.refresh(); } catch (e) {} }, 120);
  },

  _updateFilterBadge(f, count) {
    const el = typeof document !== 'undefined' ? document.getElementById('today-filter-count') : null;
    if (!el) return;
    const parts = [];
    parts.push(f.status === 'has' ? 'มีพิกัดแล้ว' : f.status === 'all' ? 'ทั้งหมด' : 'ยังไม่มีพิกัด');
    if (f.urgency === 'npl') parts.push('NPL');
    else if (f.urgency === 'm15') parts.push('15 เดือน');
    else if (f.urgency === 'due') parts.push('ถึงกำหนด ' + this._dueMonthLabel(f.dueMonth));
    if (f.zone) parts.push('เขต ' + f.zone);
    if (f.q) parts.push('ค้นหา');
    el.textContent = parts.join(' · ') + (typeof count === 'number' ? ' · ' + count + ' ราย' : '');
  },

  _dueMonthLabel(value) {
    if (!value) return 'ทุกเดือน';
    const hit = this.accountingMonths().find((m) => m.value === value);
    return hit ? hit.label : value;
  },

  _info(c) {
    return (typeof Customers !== 'undefined' && Customers.debtInfo)
      ? Customers.debtInfo(c)
      : { due: '', maxTier: 0, has15: false, reserves: [], zone: null, branch: c.branch || '' };
  },

  // สาขาของผู้ใช้ที่ล็อกไว้ (non-admin) — admin คืน '' เพื่อเลือกดูได้ทุกสาขา
  _scopeBranch() {
    try {
      if (typeof Auth !== 'undefined' && Auth.isAdmin && Auth.isAdmin()) return '';
      const u = (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser() : null;
      return String((u && u.branch) || '').trim();
    } catch { return ''; }
  },

  _effectiveBranch(f) {
    return this._scopeBranch() || (f && f.branch) || '';
  },

  currentMonthKey(base) {
    const s = this.todayStr(base); // YYYY-MM-DD
    return s.slice(5, 7) + '/' + s.slice(0, 4);
  },

  _matchGps(c, f) {
    const hasGps = Number.isFinite(c.lat) && Number.isFinite(c.lng);
    if (f.status === 'missing' && hasGps) return false;
    if (f.status === 'has' && !hasGps) return false;
    if (f.zone && String(c.zone == null ? '' : c.zone) !== String(f.zone)) return false;
    const branch = this._effectiveBranch(f);
    if (branch) {
      const cb = String(c.branch || '').trim() || String(this._info(c).branch || '').trim();
      if (cb !== String(branch)) return false;
    }
    if (f.q) {
      const hay = [c.name, c.nickname, c.cif, c.phone].join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    if (f.urgency !== 'all') {
      const info = this._info(c);
      if (f.urgency === 'npl' && !(info.maxTier >= 3)) return false;
      if (f.urgency === 'm15' && !info.has15) return false;
      if (f.urgency === 'due') {
        if (f.dueMonth) {
          if (info.due !== f.dueMonth) return false;
        } else {
          // "ทุกเดือนในปีบัญชี" = เฉพาะเดือน เม.ย. - มี.ค. ของปีบัญชีนี้
          const months = this.accountingMonths().map((m) => m.value);
          if (!info.due || !months.includes(info.due)) return false;
        }
      }
    }
    return true;
  },

  // ลำดับความด่วน: NPL → 15 เดือน → ถึงกำหนดเดือนนี้ → ที่เหลือ
  _urgencyRank(c) {
    const info = this._info(c);
    if (info.maxTier >= 3) return 0;
    if (info.has15) return 1;
    if (info.due && info.due === this.currentMonthKey()) return 2;
    return 3;
  },

  _sortQueue(list) {
    const decorated = list.map((c) => ({ c, rank: this._urgencyRank(c) }));
    decorated.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const za = parseInt(a.c.zone, 10) || 99;
      const zb = parseInt(b.c.zone, 10) || 99;
      if (za !== zb) return za - zb;
      return String(a.c.name || '').localeCompare(String(b.c.name || ''), 'th');
    });
    return decorated.map((x) => x.c);
  },

  _rowHTML(c, missing) {
    const info = this._info(c);
    const meta = [];
    if (info.maxTier) meta.push('🏷️ ชั้น ' + info.maxTier);
    if (info.has15) meta.push('⏳ 15 เดือน');
    if (info.due && typeof DebtDB !== 'undefined' && DebtDB.fmtDate) meta.push('📅 ' + DebtDB.fmtDate('01/' + info.due));
    const zone = (info.zone != null ? info.zone : c.zone) || '';
    if (zone) meta.push('เขต ' + zone);
    const addr = [c.address, c.tambon].filter(Boolean).join(' ');
    return '<div class="gps-row">' +
      '<div class="gps-row-info">' +
        '<div class="gps-row-name">' + this.esc(c.name || 'ไม่ระบุชื่อ') +
          (c.cif ? ' <span class="gps-row-cif">CIF ' + this.esc(c.cif) + '</span>' : '') + '</div>' +
        (meta.length ? '<div class="gps-row-meta">' + meta.map((m) => this.esc(m)).join(' · ') + '</div>' : '') +
        (addr ? '<div class="gps-row-addr">' + this.esc(addr) + '</div>' : '') +
      '</div>' +
      (missing
        ? '<button type="button" class="btn-primary gps-row-btn" data-gps-capture="' + this.esc(c.id || '') + '">📍 เก็บพิกัด</button>'
        : '<span class="gps-row-ok">✅ มีพิกัด</span>') +
    '</div>';
  },

  refreshCollect() {
    const box = typeof document !== 'undefined' ? document.getElementById('gps-collect') : null;
    if (!box) return;
    this.ensureGpsOptions();
    const f = this.readGpsFilter();
    const scope = this._scopeBranch();
    const raw = (typeof Storage !== 'undefined' && Storage.getActiveCustomers) ? Storage.getActiveCustomers() : [];
    const all = scope ? raw.filter((c) => String(c.branch || '') === String(scope)) : raw;
    const counts = this.coverageCounts(all);
    const filtered = this._sortQueue(all.filter((c) => this._matchGps(c, f)));
    this._updateFilterBadge(f, filtered.length);
    if (!filtered.length) {
      box.innerHTML = '<div class="gps-collect-card"><h3>✅ ไม่มีรายการตรงตัวกรอง</h3>' +
        '<p class="gps-collect-desc">ลองเปลี่ยนเขต/สถานะ หรือล้างตัวกรองด้านบน</p></div>';
      return;
    }
    const pct = counts.total ? Math.round((counts.with / counts.total) * 100) : 0;
    const info = this.pageInfo(filtered.length, this._page, this.PAGE_SIZE);
    this._page = info.page;
    const start = info.start;
    const shown = filtered.slice(start, start + this.PAGE_SIZE);
    const pages = info.pages;
    const rows = shown.map((c) => this._rowHTML(c, f.status !== 'has')).join('');
    const pager = filtered.length > this.PAGE_SIZE
      ? '<div class="gps-pager">' +
          '<button type="button" class="gps-page-btn" data-gps-page="' + (this._page - 1) + '"' + (this._page <= 1 ? ' disabled' : '') + '>‹ ก่อนหน้า</button>' +
          '<span class="gps-pager-info">หน้า ' + this._page + '/' + pages + '<br>แสดง ' + (start + 1) + '–' + (start + shown.length) + ' จาก ' + filtered.length + ' ราย</span>' +
          '<button type="button" class="gps-page-btn" data-gps-page="' + (this._page + 1) + '"' + (this._page >= pages ? ' disabled' : '') + '>ถัดไป ›</button>' +
        '</div>'
      : '<p class="gps-more">แสดงทั้งหมด ' + filtered.length + ' ราย</p>';
    box.innerHTML = '<div class="gps-collect-card">' +
      '<h3>📍 คิวเก็บพิกัด <span class="gps-count">เหลือ ' + filtered.length + ' ราย</span></h3>' +
      '<p class="gps-collect-desc">เก็บแล้ว ' + counts.with + '/' + counts.total + ' (' + pct + '%) · เรียงด่วนก่อน NPL → 15 เดือน → ถึงกำหนด</p>' +
      '<div class="gps-progress"><div class="gps-progress-fill" style="width:' + pct + '%"></div></div>' +
      rows + pager +
      '</div>';
    box.querySelectorAll('[data-gps-capture]').forEach((btn) => {
      btn.addEventListener('click', () => this.collectGps(btn.dataset.gpsCapture, btn));
    });
    box.querySelectorAll('[data-gps-page]').forEach((btn) => {
      btn.addEventListener('click', () => this.gotoPage(parseInt(btn.dataset.gpsPage, 10)));
    });
  },

  // คำนวณช่วงรายการของหน้านั้น (pure — ใช้ในเทสด้วย)
  pageInfo(total, page, size) {
    const per = Math.max(1, parseInt(size, 10) || this.PAGE_SIZE || 10);
    const pages = Math.max(1, Math.ceil((parseInt(total, 10) || 0) / per));
    const p = Math.min(Math.max(1, parseInt(page, 10) || 1), pages);
    const start = (p - 1) * per;
    return { page: p, pages, start, end: Math.min(start + per, parseInt(total, 10) || 0) };
  },

  // เปลี่ยนหน้าคิว (1-based)
  gotoPage(n) {
    if (!Number.isFinite(n)) return;
    this._page = n;
    this.refreshCollect();
    const box = typeof document !== 'undefined' ? document.getElementById('gps-collect') : null;
    if (box && box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  // เก็บพิกัดผ่านของเดิม (Customers.saveQuickGps) แล้วรอจนพิกัดเข้าค่อยรีเฟรช
  collectGps(customerId, btn) {
    if (!customerId || typeof Customers === 'undefined' || !Customers.saveQuickGps) return;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังจับพิกัด...'; }
    const before = this._withCount();
    try { Customers.saveQuickGps(customerId); } catch (e) { if (btn) { btn.disabled = false; btn.textContent = '📍 เก็บพิกัด'; } return; }
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (this._withCount() > before || tries >= 8) {
        clearInterval(timer);
        try { this.refresh(); } catch (e) {}
        try { if (typeof Visit !== 'undefined' && Visit.render) Visit.render(); } catch (e) {}
      }
    }, 2000);
  },

  _withCount() {
    try {
      const scope = this._scopeBranch();
      return Storage.getActiveCustomers()
        .filter((c) => (!scope || String(c.branch || '') === String(scope)) && Number.isFinite(c.lat) && Number.isFinite(c.lng))
        .length;
    } catch { return -1; }
  },

  // เปิดตัวกรองแผนที่ + หุบแผงล่าง แล้วกระพริบปุ่ม Golden Route
  openGoldenRoute() {
    try { if (typeof FilterPanel !== 'undefined' && FilterPanel.expand) FilterPanel.expand(); } catch (e) {}
    const btn = typeof document !== 'undefined' ? document.getElementById('btn-auto-plan') : null;
    if (btn) {
      btn.classList.add('flash');
      setTimeout(() => btn.classList.remove('flash'), 1800);
    }
  },

  // นัดชำระวันนี้ + เลยกำหนด — ใช้การ์ดเดียวกับปฏิทิน (ปุ่ม ✅/📅/📝 ครบ)
  refreshPromise() {
    const box = typeof document !== 'undefined' ? document.getElementById('today-promise') : null;
    if (!box || typeof WorkCalendar === 'undefined') return;
    const list = WorkCalendar.entries().filter((e) => e.cls === 'due' || e.cls === 'overdue');
    if (!list.length) {
      box.innerHTML = '<p class="empty-state">ไม่มีนัดชำระวันนี้ 🎉</p>';
      return;
    }
    box.innerHTML = list.map((e) => WorkCalendar._entryHTML(e, true)).join('');
    WorkCalendar._bindEntryButtons(box);
  },

  refresh() {
    try { this.refreshCollect(); } catch (e) { console.warn('[today] collect:', e); }
    try { this.refreshPromise(); } catch (e) { console.warn('[today] promise:', e); }
    try { if (typeof App !== 'undefined' && App.renderTodayRoute) App.renderTodayRoute(); } catch (e) {}
  },
};

if (typeof window !== 'undefined') window.TodayUI = TodayUI;
if (typeof module !== 'undefined' && module.exports) module.exports = TodayUI;
