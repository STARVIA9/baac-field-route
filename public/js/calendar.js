// ===== ปฏิทินงาน — นัดรับปากชำระจากบันทึกการเข้าพบเดิม =====
// ไม่สร้างระบบบันทึกใหม่: อ่าน/เขียนผ่าน Storage.getVisits() + Storage.saveVisit()
// (เรคอร์ดเข้าพบเดิมที่ซิงค์ตามผู้ใช้อยู่แล้ว) โดยใช้ฟิลด์เพิ่มในเรคอร์ดเดียวกัน:
//   promiseDate (YYYY-MM-DD), promiseAmount, promiseStatus (pending|paid),
//   promiseResolvedAt, promiseHistory [{date, result, newDate, at}]

const WorkCalendar = {
  _month: null,      // Date ของเดือนที่กำลังดู (วันที่ 1)
  _selected: null,   // YYYY-MM-DD วันที่เลือก
  _rescheduleId: null,

  // วันที่แบบ local (ห้ามใช้ toISOString ตัดวัน — เวลาไทยจะเพี้ยนเป็นเมื่อวาน)
  todayStr(now) {
    const d = now ? new Date(now) : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  isValidDateStr(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime());
  },

  // สถานะนัดจากวันที่ + ผลที่บันทึก: paid | due | overdue | upcoming
  classify(promiseDate, promiseStatus, today) {
    if (promiseStatus === 'paid') return 'paid';
    if (!this.isValidDateStr(promiseDate)) return 'upcoming';
    const t = today || this.todayStr();
    if (promiseDate < t) return 'overdue';
    if (promiseDate === t) return 'due';
    return 'upcoming';
  },

  statusLabel(cls) {
    return { paid: '✅ ชำระแล้ว', due: '🔔 ถึงกำหนดวันนี้', overdue: '🔴 เลยกำหนด', upcoming: '📅 รอถึงกำหนด' }[cls] || cls;
  },

  // นัดทั้งหมดจากบันทึกเข้าพบเดิม (เฉพาะเรคอร์ดที่มีวันนัด)
  entries() {
    if (typeof Storage === 'undefined') return [];
    const visits = Storage.getVisits ? Storage.getVisits() : {};
    const customers = Storage.getActiveCustomers ? Storage.getActiveCustomers() : [];
    const byId = new Map(customers.map(c => [c.id, c]));
    const out = [];
    for (const [customerId, v] of Object.entries(visits || {})) {
      if (!v || !this.isValidDateStr(v.promiseDate)) continue;
      const c = byId.get(customerId);
      out.push({
        customerId,
        name: (c && c.name) || '(ลูกค้าถูกลบ/ไม่พบชื่อ)',
        cif: (c && c.cif) || '',
        phone: (c && c.phone) || '',
        lat: c ? c.lat : null,
        lng: c ? c.lng : null,
        promiseDate: v.promiseDate,
        promiseAmount: (v.promiseAmount === '' || v.promiseAmount == null) ? null : Number(v.promiseAmount),
        promiseStatus: v.promiseStatus === 'paid' ? 'paid' : 'pending',
        visitStatus: v.status || '',
        note: v.note || '',
        timestamp: v.timestamp || '',
        history: Array.isArray(v.promiseHistory) ? v.promiseHistory : [],
        cls: this.classify(v.promiseDate, v.promiseStatus),
      });
    }
    out.sort((a, b) => a.promiseDate === b.promiseDate ? a.name.localeCompare(b.name, 'th') : (a.promiseDate < b.promiseDate ? -1 : 1));
    return out;
  },

  dueCounts(list) {
    const all = list || this.entries();
    return {
      due: all.filter(e => e.cls === 'due').length,
      overdue: all.filter(e => e.cls === 'overdue').length,
      upcoming: all.filter(e => e.cls === 'upcoming').length,
      paid: all.filter(e => e.cls === 'paid').length,
    };
  },

  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  },

  fmtDate(dateStr) {
    try {
      return new Date(dateStr + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return dateStr; }
  },

  fmtAmount(n) {
    return n == null || !Number.isFinite(n) ? '' : Number(n).toLocaleString('th-TH') + ' บาท';
  },

  // ===== แถบแจ้งเตือนใต้หัวเว็บ + ตัวเลขบนแท็บปฏิทิน =====
  refreshAlert() {
    const counts = this.dueCounts();
    const total = counts.due + counts.overdue;
    const banner = typeof document !== 'undefined' ? document.getElementById('promise-alert') : null;
    if (banner) {
      if (total > 0) {
        banner.classList.remove('hidden');
        banner.innerHTML = '🔔 วันนี้มีนัดชำระ ' + counts.due + ' ราย · เลยกำหนด ' + counts.overdue + ' ราย <span class="promise-alert-go">เปิดปฏิทิน ›</span> <button type="button" class="promise-alert-close" aria-label="ปิด">×</button>';
      } else {
        banner.classList.add('hidden');
        banner.innerHTML = '';
      }
    }
    const badge = typeof document !== 'undefined' ? document.getElementById('cal-tab-badge') : null;
    if (badge) {
      badge.textContent = total;
      badge.classList.toggle('hidden', total === 0);
    }
    return counts;
  },

  // ===== บันทึกผลติดตาม (เขียนกลับเรคอร์ดเข้าพบเดิม) =====
  async _savePromise(customerId, patch) {
    const visits = Storage.getVisits();
    const existing = visits[customerId];
    if (!existing) return { synced: false, error: 'ไม่พบบันทึกเข้าพบ' };
    const result = await Storage.saveVisit(customerId, { ...existing, ...patch });
    this.refreshAlert();
    if (typeof Visit !== 'undefined' && Visit.render) Visit.render();
    this.render();
    return result;
  },

  async markPaid(customerId) {
    const visits = Storage.getVisits();
    const existing = visits[customerId];
    if (!existing) return;
    const history = [...(Array.isArray(existing.promiseHistory) ? existing.promiseHistory : []),
      { date: existing.promiseDate || '', result: 'paid', at: new Date().toISOString() }];
    const r = await this._savePromise(customerId, { promiseStatus: 'paid', promiseResolvedAt: new Date().toISOString(), promiseHistory: history });
    if (typeof Utils !== 'undefined') Utils.toast(r && r.synced ? '✅ บันทึกว่าชำระแล้ว · sync สำเร็จ' : '⚠️ บันทึกว่าชำระแล้ว (ยัง sync ไม่สำเร็จ)', r && r.synced ? undefined : 'error');
  },

  async reschedule(customerId, newDate) {
    if (!this.isValidDateStr(newDate)) {
      if (typeof Utils !== 'undefined') Utils.toast('กรุณาเลือกวันนัดใหม่ก่อนบันทึก', 'error');
      return;
    }
    const visits = Storage.getVisits();
    const existing = visits[customerId];
    if (!existing) return;
    const history = [...(Array.isArray(existing.promiseHistory) ? existing.promiseHistory : []),
      { date: existing.promiseDate || '', result: 'rescheduled', newDate, at: new Date().toISOString() }];
    this._rescheduleId = null;
    const r = await this._savePromise(customerId, {
      promiseDate: newDate, promiseStatus: 'pending', promiseResolvedAt: null,
      status: 'reschedule', promiseHistory: history,
    });
    if (typeof Utils !== 'undefined') Utils.toast(r && r.synced ? '📅 เลื่อนนัดเป็น ' + this.fmtDate(newDate) + ' แล้ว' : '⚠️ เลื่อนนัดแล้ว (ยัง sync ไม่สำเร็จ)', r && r.synced ? undefined : 'error');
  },

  openVisit(customerId) {
    if (typeof Visit !== 'undefined' && Visit.openLog) Visit.openLog(customerId);
  },

  // ===== วาดปฏิทิน =====
  render() {
    const grid = document.getElementById('cal-grid');
    if (!grid) return;
    if (!this._month) { const n = new Date(); this._month = new Date(n.getFullYear(), n.getMonth(), 1); }
    if (!this._selected) this._selected = this.todayStr();

    const all = this.entries();
    const counts = this.dueCounts(all);
    const byDate = new Map();
    for (const e of all) {
      if (!byDate.has(e.promiseDate)) byDate.set(e.promiseDate, []);
      byDate.get(e.promiseDate).push(e);
    }

    const title = document.getElementById('cal-title');
    if (title) title.textContent = this._month.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

    const summary = document.getElementById('cal-summary');
    if (summary) {
      summary.innerHTML =
        '<span class="cal-chip cal-chip-due">🔔 วันนี้ ' + counts.due + ' ราย</span>' +
        '<span class="cal-chip cal-chip-over">🔴 เลยกำหนด ' + counts.overdue + ' ราย</span>' +
        '<span class="cal-chip">📅 รอถึงกำหนด ' + counts.upcoming + ' ราย</span>' +
        '<span class="cal-chip cal-chip-paid">✅ ชำระแล้ว ' + counts.paid + ' ราย</span>';
    }

    // ตารางเดือน (สัปดาห์เริ่มวันจันทร์)
    const y = this._month.getFullYear(), m = this._month.getMonth();
    const first = new Date(y, m, 1);
    const startOffset = (first.getDay() + 6) % 7; // จันทร์ = 0
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = this.todayStr();
    let html = '';
    for (let i = 0; i < startOffset; i++) html += '<div class="cal-cell cal-empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const dayEntries = byDate.get(ds) || [];
      const hasOver = dayEntries.some(e => e.cls === 'overdue' || e.cls === 'due');
      const hasPaid = dayEntries.length > 0 && dayEntries.every(e => e.cls === 'paid');
      const cls = ['cal-cell', ds === today ? 'cal-today' : '', ds === this._selected ? 'cal-selected' : ''].join(' ');
      html += '<button type="button" class="' + cls + '" data-cal-date="' + ds + '">' +
        '<span class="cal-daynum">' + d + '</span>' +
        (dayEntries.length ? '<span class="cal-dot ' + (hasPaid ? 'cal-dot-paid' : hasOver ? 'cal-dot-due' : 'cal-dot-wait') + '">' + dayEntries.length + '</span>' : '') +
        '</button>';
    }
    grid.innerHTML = html;
    grid.querySelectorAll('[data-cal-date]').forEach(btn => {
      btn.addEventListener('click', () => { this._selected = btn.dataset.calDate; this.render(); });
    });

    // ค้างติดตาม (เลยกำหนด + วันนี้) เรียงเลยมานานสุดก่อน
    const followWrap = document.getElementById('cal-follow-list');
    if (followWrap) {
      const follow = all.filter(e => e.cls === 'overdue' || e.cls === 'due');
      followWrap.innerHTML = follow.length
        ? follow.map(e => this._entryHTML(e, true)).join('')
        : '<p class="empty-state">ไม่มีนัดค้างติดตาม 🎉</p>';
      this._bindEntryButtons(followWrap);
    }

    // รายการของวันที่เลือก
    const agendaTitle = document.getElementById('cal-agenda-title');
    if (agendaTitle) agendaTitle.textContent = 'นัดวันที่ ' + this.fmtDate(this._selected);
    const agenda = document.getElementById('cal-agenda');
    if (agenda) {
      const dayEntries = byDate.get(this._selected) || [];
      agenda.innerHTML = dayEntries.length
        ? dayEntries.map(e => this._entryHTML(e, false)).join('')
        : '<p class="empty-state">ไม่มีนัดชำระวันนี้</p>';
      this._bindEntryButtons(agenda);
    }
    this.refreshAlert();
  },

  _entryHTML(e, showDate) {
    const amt = this.fmtAmount(e.promiseAmount);
    const hist = e.history.length ? '<div class="cal-hist">↩️ เคยนัด/เลื่อนมาแล้ว ' + e.history.length + ' ครั้ง</div>' : '';
    const rescheduling = this._rescheduleId === e.customerId;
    return '<div class="cal-entry cal-entry-' + e.cls + '">' +
      '<div class="cal-entry-main">' +
        '<div class="cal-entry-name">' + this.esc(e.name) + (e.cif ? ' <span class="cal-cif">CIF ' + this.esc(e.cif) + '</span>' : '') + '</div>' +
        '<div class="cal-entry-meta">' + (showDate ? '📅 นัด ' + this.fmtDate(e.promiseDate) + ' · ' : '') + this.statusLabel(e.cls) + (amt ? ' · ' + amt : '') + '</div>' +
        (e.note ? '<div class="cal-entry-note">' + this.esc(e.note) + '</div>' : '') + hist +
      '</div>' +
      '<div class="cal-entry-actions">' +
        (e.cls !== 'paid' ? '<button type="button" class="cal-btn cal-btn-paid" data-cal-paid="' + this.esc(e.customerId) + '">✅ ชำระแล้ว</button>' : '') +
        (e.cls !== 'paid' ? '<button type="button" class="cal-btn" data-cal-resched="' + this.esc(e.customerId) + '">📅 เลื่อนนัด</button>' : '') +
        '<button type="button" class="cal-btn" data-cal-open="' + this.esc(e.customerId) + '">📝 บันทึกเข้าพบ</button>' +
      '</div>' +
      (rescheduling
        ? '<div class="cal-resched"><label>วันนัดใหม่ <input type="date" id="cal-resched-date" value="' + this.esc(e.promiseDate) + '"></label>' +
          '<button type="button" class="cal-btn cal-btn-paid" data-cal-resched-save="' + this.esc(e.customerId) + '">บันทึกวันนัดใหม่</button>' +
          '<button type="button" class="cal-btn" data-cal-resched-cancel="1">ยกเลิก</button></div>'
        : '') +
      '</div>';
  },

  _bindEntryButtons(root) {
    root.querySelectorAll('[data-cal-paid]').forEach(b => b.addEventListener('click', () => this.markPaid(b.dataset.calPaid)));
    root.querySelectorAll('[data-cal-open]').forEach(b => b.addEventListener('click', () => this.openVisit(b.dataset.calOpen)));
    root.querySelectorAll('[data-cal-resched]').forEach(b => b.addEventListener('click', () => { this._rescheduleId = b.dataset.calResched; this.render(); }));
    root.querySelectorAll('[data-cal-resched-cancel]').forEach(b => b.addEventListener('click', () => { this._rescheduleId = null; this.render(); }));
    root.querySelectorAll('[data-cal-resched-save]').forEach(b => b.addEventListener('click', () => {
      const input = document.getElementById('cal-resched-date');
      this.reschedule(b.dataset.calReschedSave, input ? input.value : '');
    }));
  },

  shiftMonth(delta) {
    if (!this._month) { const n = new Date(); this._month = new Date(n.getFullYear(), n.getMonth(), 1); }
    this._month = new Date(this._month.getFullYear(), this._month.getMonth() + delta, 1);
    this.render();
  },

  goToday() {
    const n = new Date();
    this._month = new Date(n.getFullYear(), n.getMonth(), 1);
    this._selected = this.todayStr();
    this.render();
  },

  init() {
    const prev = document.getElementById('cal-prev');
    const next = document.getElementById('cal-next');
    const todayBtn = document.getElementById('cal-today-btn');
    if (prev) prev.addEventListener('click', () => this.shiftMonth(-1));
    if (next) next.addEventListener('click', () => this.shiftMonth(1));
    if (todayBtn) todayBtn.addEventListener('click', () => this.goToday());
    const banner = document.getElementById('promise-alert');
    if (banner) {
      banner.addEventListener('click', (e) => {
        if (e.target.closest('.promise-alert-close')) {
          e.stopPropagation();
          banner.classList.add('hidden');
          return;
        }
        if (typeof App !== 'undefined' && App.switchSheetTab) App.switchSheetTab('calendar');
      });
    }
    this.refreshAlert();
  },
};

if (typeof window !== 'undefined') window.WorkCalendar = WorkCalendar;
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('DOMContentLoaded', () => { try { WorkCalendar.init(); } catch (e) { /* ยังไม่ login */ } });
}
if (typeof module !== 'undefined' && module.exports) module.exports = WorkCalendar;
