// ===== งานวันนี้ — หน้าแรก + คิวเก็บพิกัดสาขาใหม่ =====
// ไม่สร้างโครงข้อมูลใหม่: อ่านจำนวนพิกัดจาก Storage.getActiveCustomers(),
// นัดชำระจาก WorkCalendar.entries(), เก็บพิกัดผ่าน Customers.saveQuickGps() เดิม

const TodayUI = {
  COVERAGE_OK: 0.2,  // มีพิกัดเกิน 20% ถือว่าพร้อมวางแผน — ไม่โชว์คิวเก็บพิกัด
  MAX_QUEUE: 20,     // โชว์คิวมากสุด 20 ราย กันจอค้าง

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

  // นับพิกัดแบบ pure (รับ array ลูกค้า) — เทสง่าย ไม่แตะ Storage ตรงนี้
  coverageStats(customers) {
    const list = Array.isArray(customers) ? customers : [];
    const ok = (c) => Number.isFinite(c.lat) && Number.isFinite(c.lng);
    const missing = list.filter((c) => !ok(c));
    missing.sort((a, b) => String(a.zone || '9').localeCompare(String(b.zone || '9'), 'th')
      || String(a.name || '').localeCompare(String(b.name || ''), 'th'));
    return { total: list.length, with: list.length - missing.length, missing };
  },

  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  },

  refresh() {
    try { this.refreshCollect(); } catch (e) { console.warn('[today] collect:', e); }
    try { this.refreshPromise(); } catch (e) { console.warn('[today] promise:', e); }
    try { if (typeof App !== 'undefined' && App.renderTodayRoute) App.renderTodayRoute(); } catch (e) {}
    try { this.refreshChase(); } catch (e) { console.warn('[today] chase:', e); }
  },

  // โหมดเก็บพิกัดสาขาใหม่: มีพิกัดน้อยกว่าเกณฑ์ → โชว์คิวเก็บพิกัดแทนหน้าว่าง
  refreshCollect() {
    const box = typeof document !== 'undefined' ? document.getElementById('gps-collect') : null;
    if (!box) return;
    const customers = (typeof Storage !== 'undefined' && Storage.getActiveCustomers) ? Storage.getActiveCustomers() : [];
    const st = this.coverageStats(customers);
    if (!st.total || !st.missing.length || st.with / st.total >= this.COVERAGE_OK) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    const pct = Math.round((st.with / st.total) * 100);
    const rows = st.missing.slice(0, this.MAX_QUEUE).map((c) => {
      const addr = [c.address, c.tambon].filter(Boolean).join(' ');
      return '<div class="gps-row">' +
        '<div class="gps-row-info"><div class="gps-row-name">' + this.esc(c.name || 'ไม่ระบุชื่อ') + '</div>' +
        (addr ? '<div class="gps-row-addr">' + this.esc(addr) + '</div>' : '') + '</div>' +
        '<button type="button" class="btn-primary gps-row-btn" data-gps-capture="' + this.esc(c.id || '') + '">📍 เก็บพิกัดที่นี่</button></div>';
    }).join('');
    box.classList.remove('hidden');
    box.innerHTML = '<div class="gps-collect-card"><h3>📍 สาขานี้ยังไม่มีพิกัด (' + st.with + '/' + st.total + ' · ' + pct + '%)</h3>' +
      '<p class="gps-collect-desc">ไปหาลูกค้าแล้วกดปุ่มเก็บพิกัดทีละราย ครบแล้วเมนูวางแผนจะพร้อมใช้</p>' +
      '<div class="gps-progress"><div class="gps-progress-fill" style="width:' + pct + '%"></div></div>' + rows +
      (st.missing.length > this.MAX_QUEUE ? '<p class="gps-more">…และอีก ' + (st.missing.length - this.MAX_QUEUE) + ' ราย</p>' : '') + '</div>';
    box.querySelectorAll('[data-gps-capture]').forEach((btn) => {
      btn.addEventListener('click', () => this.collectGps(btn.dataset.gpsCapture, btn));
    });
  },

  // เก็บพิกัดผ่านของเดิม (Customers.saveQuickGps) แล้วรอจนพิกัดเข้าค่อยรีเฟรช
  collectGps(customerId, btn) {
    if (!customerId || typeof Customers === 'undefined' || !Customers.saveQuickGps) return;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังจับพิกัด...'; }
    const before = this._withCount();
    try { Customers.saveQuickGps(customerId); } catch (e) { if (btn) { btn.disabled = false; btn.textContent = '📍 เก็บพิกัดที่นี่'; } return; }
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
      return Storage.getActiveCustomers().filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng)).length;
    } catch { return -1; }
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



  currentMonthKey(base) {
    const s = this.todayStr(base); // YYYY-MM-DD
    return s.slice(5, 7) + '/' + s.slice(0, 4);
  },

  readChaseFilter() {
    const v = (id) => { const el = typeof document !== 'undefined' ? document.getElementById(id) : null; return el ? el.value : ''; };
    return { month: v('today-month'), tier: v('today-tier'), omsom: '', m15: v('today-m15'), reserve: v('today-reserve'), zone: v('today-zone'), branch: v('today-branch') };
  },

  applyPreset(name) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    ['today-month', 'today-tier', 'today-m15', 'today-reserve', 'today-zone', 'today-branch'].forEach((id) => set(id, ''));
    if (name === 'due') set('today-month', this.currentMonthKey());
    else if (name === 'm15') set('today-m15', 'Y');
    else if (name === 'rsv100') set('today-reserve', '100');
    else if (name === 'npl') set('today-tier', 'npl');
    this._chaseDefaulted = true;
    this.refreshChase();
  },

  // เติมตัวเลือกเดือน/สาขาจากแผงซ้าย (ที่เดียวกัน ตรรกะเดียวกัน) — มีแล้วไม่เติมซ้ำ
  ensureChaseOptions() {
    const copyIfEmpty = (dstId, srcId) => {
      const dst = document.getElementById(dstId);
      const src = document.getElementById(srcId);
      if (dst && src && dst.options.length <= 1 && src.options.length > 1) dst.innerHTML = src.innerHTML;
    };
    copyIfEmpty('today-month', 'debt-month-filter');
    copyIfEmpty('today-branch', 'map-branch-filter');
    const brSel = document.getElementById('today-branch');
    if (brSel) {
      const isAdmin = (typeof Auth !== 'undefined' && Auth.isAdmin) ? Auth.isAdmin() : false;
      brSel.classList.toggle('hidden', !isAdmin);
    }
    if (!this._chaseWired) {
      this._chaseWired = true;
      ['today-month', 'today-tier', 'today-m15', 'today-reserve', 'today-zone', 'today-branch'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => { this._chaseDefaulted = true; this.refreshChase(); });
      });
      document.querySelectorAll('[data-preset]').forEach((b) => {
        b.addEventListener('click', () => this.applyPreset(b.dataset.preset));
      });
    }
    // เปิดครั้งแรก: ตั้งเดือนปัจจุบันให้เลย จะได้เจอรายชื่อทันที
    if (!this._chaseDefaulted) {
      this._chaseDefaulted = true;
      const m = document.getElementById('today-month');
      const hasCurrent = m && Array.from(m.options).some((o) => o.value === this.currentMonthKey());
      if (m && hasCurrent && !m.value) m.value = this.currentMonthKey();
    }
  },

  // รายชื่อตามหนี้ — การ์ดสไตล์เดียวกับปฏิทิน (ไม่ใช่กล่องธรรมดา)
  refreshChase() {
    const box = typeof document !== 'undefined' ? document.getElementById('today-chase-list') : null;
    if (!box || typeof Customers === 'undefined' || !Customers.matchDebt) return;
    this.ensureChaseOptions();
    if (typeof DebtDB === 'undefined' || !DebtDB._loaded) {
      box.innerHTML = '<p class="empty-state">⏳ กำลังโหลดข้อมูลหนี้...</p>';
      if (!this._chaseRetry) {
        this._chaseRetry = 0;
      }
      if (this._chaseRetry < 3) {
        this._chaseRetry++;
        setTimeout(() => { try { this.refreshChase(); } catch (e) {} }, 2500);
      }
      return;
    }
    this._chaseRetry = 0;
    const f = this.readChaseFilter();
    const customers = (typeof Storage !== 'undefined' && Storage.getActiveCustomers) ? Storage.getActiveCustomers() : [];
    let route = [];
    try { route = (typeof Storage !== 'undefined' && Storage.getRoute) ? Storage.getRoute() : []; } catch (e) {}
    const routeSet = new Set(route);
    const list = customers.filter((c) => {
      try { return Customers.matchDebt(f, Customers.debtInfo(c)); } catch (e) { return false; }
    });
    list.sort((a, b) => {
      const ar = routeSet.has(a.id) ? 0 : 1, br = routeSet.has(b.id) ? 0 : 1;
      if (ar !== br) return ar - br;
      return String(a.name || '').localeCompare(String(b.name || ''), 'th');
    });
    const MAX = 60;
    const shown = list.slice(0, MAX);
    let html = '<p class="chase-count">เจอ ' + list.length + ' ราย' + (routeSet.size ? ' · 🧭 ในเส้นทาง ' + list.filter((c) => routeSet.has(c.id)).length + ' ราย' : '') + '</p>';
    html += shown.length
      ? shown.map((c) => this._customerCardHTML(c, routeSet.has(c.id))).join('')
      : '<p class="empty-state">ไม่มีลูกค้าตรงตัวกรอง — ลองเปลี่ยนเดือน/ชั้นหนี้ หรือกด ✕ ล้าง</p>';
    if (list.length > MAX) html += '<p class="gps-more">…และอีก ' + (list.length - MAX) + ' ราย (ใช้ช่องค้นหาในแท็บลูกค้าเพื่อหาเพิ่ม)</p>';
    box.innerHTML = html;
    box.querySelectorAll('[data-today-visit]').forEach((b) => {
      b.addEventListener('click', () => { if (typeof Visit !== 'undefined' && Visit.openLog) Visit.openLog(b.dataset.todayVisit); });
    });
    box.querySelectorAll('[data-today-route]').forEach((b) => {
      b.addEventListener('click', () => {
        if (typeof Storage === 'undefined' || !Storage.addToRoute) return;
        const id = b.dataset.todayRoute;
        if (routeSet.has(id)) {
          if (Storage.removeFromRoute) Storage.removeFromRoute(id);
        } else {
          Storage.addToRoute(id);
        }
        try { this.refreshChase(); } catch (e) {}
        if (typeof Visit !== 'undefined' && Visit.render) { try { Visit.render(); } catch (e) {} }
      });
    });
  },

  _customerCardHTML(c, inRoute) {
    const debt = (c.cif && typeof DebtDB !== 'undefined' && DebtDB._loaded) ? DebtDB.getByCif(c.cif) : null;
    const info = (typeof Customers !== 'undefined' && Customers.debtInfo) ? Customers.debtInfo(c) : { maxTier: 0 };
    let cls = 'upcoming';
    const v = (typeof Storage !== 'undefined' && Storage.getVisits) ? (Storage.getVisits()[c.id] || null) : null;
    if (v && v.promiseDate && typeof WorkCalendar !== 'undefined') cls = WorkCalendar.classify(v.promiseDate, v.promiseStatus);
    else if ((info.maxTier || 0) >= 3) cls = 'overdue';
    const meta = [];
    if (info.maxTier) meta.push('🏷️ ชั้น ' + info.maxTier);
    if (info.due && typeof DebtDB !== 'undefined' && DebtDB.fmtDate) meta.push('📅 ถึงกำหนด ' + DebtDB.fmtDate('01/' + info.due));
    if (info.has15) meta.push('⏳ 15 เดือน');
    const rsv = (info.reserves || []).filter((x) => String(x) !== '');
    if (rsv.length) meta.push('🛡️ สำรอง ' + rsv.join('/') + '%');
    const zone = (info.zone != null ? info.zone : c.zone) || '';
    if (zone) meta.push('เขต ' + zone);
    if (c.phone) meta.push('☎️ ' + c.phone);
    if (inRoute) meta.push('🧭 ในเส้นทาง');
    return '<div class="cal-entry cal-entry-' + cls + '">' +
      '<div class="cal-entry-main">' +
        '<div class="cal-entry-name">' + this.esc(c.name || 'ไม่ระบุชื่อ') + (c.cif ? ' <span class="cal-cif">CIF ' + this.esc(c.cif) + '</span>' : '') + '</div>' +
        (meta.length ? '<div class="cal-entry-meta">' + meta.map((m) => this.esc(m)).join(' · ') + '</div>' : '') +
        (c.address ? '<div class="cal-entry-note">' + this.esc(c.address) + '</div>' : '') +
      '</div>' +
      '<div class="cal-entry-actions">' +
        '<button type="button" class="cal-btn cal-btn-paid" data-today-visit="' + this.esc(c.id || '') + '">📝 บันทึก</button>' +
        '<button type="button" class="cal-btn" data-today-route="' + this.esc(c.id || '') + '">' + (inRoute ? '✅ ในเส้นทาง' : '➕ เส้นทาง') + '</button>' +
      '</div>' +
    '</div>';
  },
};

if (typeof window !== 'undefined') window.TodayUI = TodayUI;
if (typeof module !== 'undefined' && module.exports) module.exports = TodayUI;
