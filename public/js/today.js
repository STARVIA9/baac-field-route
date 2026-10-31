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
};

if (typeof window !== 'undefined') window.TodayUI = TodayUI;
if (typeof module !== 'undefined' && module.exports) module.exports = TodayUI;
