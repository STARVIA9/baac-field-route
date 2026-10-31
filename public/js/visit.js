// ===== Visit log management =====

const Visit = {
  currentCustomerId: null,

  // Render visit list
  render() {
    const list = document.getElementById('visit-list');
    const route = Storage.getRoute();
    const customers = Storage.getActiveCustomers();
    const visits = Storage.getVisits();
    const routeCustomers = route.map(id => customers.find(c => c.id === id)).filter(Boolean);

    const counts = { pending: 0, visited: 0, skipped: 0 };
    list.innerHTML = '';

    if (routeCustomers.length === 0) {
      list.innerHTML = `<p class="empty-state">ไม่มีลูกค้าในเส้นทางวันนี้<br><small>ไปที่แท็บ "ลูกค้า" เพื่อเพิ่ม</small></p>`;
      document.getElementById('visit-pending').textContent = 0;
      document.getElementById('visit-completed').textContent = 0;
      document.getElementById('visit-skipped').textContent = 0;
      if (typeof WorkCalendar !== 'undefined' && WorkCalendar.refreshAlert) WorkCalendar.refreshAlert();
      return;
    }

    routeCustomers.forEach((c, idx) => {
      const visit = visits[c.id];
      const status = visit?.status || 'pending';
      if (status === 'visited' || status === 'interested' || status === 'wait_income') counts.visited++;
      else if (status === 'no_answer' || status === 'not_home' || status === 'reschedule' || status === 'not_interested') counts.skipped++;
      else counts.pending++;

      const statusIcon = this.statusIcon(status);
      const statusClass = ['visited', 'interested', 'wait_income', 'no_answer', 'not_home', 'reschedule', 'not_interested'].includes(status) ? status : '';
      const itemClass = (status === 'visited' || status === 'interested' || status === 'wait_income') ? 'visited' : (status !== 'pending' ? 'skipped' : '');
      // Debt badge (ย้ายมาจากแท็บเส้นทาง): บอกว่าเป็นหนี้ถึงกำหนดหรือค้าง
      const debtBadge = c.debtType === 'overdue' ? '⚠️ ค้าง' : (c.debtType === 'current' ? '📅 ถึงกำหนด' : '');

      // นัดชำระจากบันทึกเดิม (ถ้ามี) — โชว์ในรายการเข้าพบให้เห็นระหว่างออกพื้นที่
      let promiseMeta = '';
      if (visit && visit.promiseDate && typeof WorkCalendar !== 'undefined') {
        const cls = WorkCalendar.classify(visit.promiseDate, visit.promiseStatus);
        promiseMeta = ' · 📅 นัดชำระ ' + WorkCalendar.fmtDate(visit.promiseDate) + ' (' + WorkCalendar.statusLabel(cls) + ')';
      }

      const item = document.createElement('div');
      item.className = `visit-item ${itemClass}`;
      const goLabel = status === 'pending' ? '📝 บันทึก' : '✏️ แก้ไข';
      item.innerHTML = `
        <div class="visit-order">${idx + 1}</div>
        <div class="visit-status ${statusClass}" title="คลิกเพื่อบันทึก">
          ${statusIcon}
        </div>
        <div class="visit-info">
          <div class="visit-name">${this.escapeHTML(c.name)}${debtBadge ? ` <span class="visit-debt">${debtBadge}</span>` : ''}</div>
          <div class="visit-meta">${visit ? this.statusLabel(status) + ' · ' + this.timeAgo(visit.timestamp) + promiseMeta : '⏳ รอเยี่ยม — แตะเพื่อบันทึก'}</div>
        </div>
        <button type="button" class="visit-go-btn">${goLabel}</button>
      `;
      item.onclick = () => this.openLog(c.id);
      list.appendChild(item);
    });

    document.getElementById('visit-pending').textContent = counts.pending;
    document.getElementById('visit-completed').textContent = counts.visited;
    document.getElementById('visit-skipped').textContent = counts.skipped;
    // อัปเดตแถบแจ้งเตือนนัดชำระ + ตัวเลขแท็บปฏิทินทุกครั้งที่รายการเข้าพบเปลี่ยน
    if (typeof WorkCalendar !== 'undefined' && WorkCalendar.refreshAlert) WorkCalendar.refreshAlert();
  },

  statusIcon(status) {
    return {
      pending: '⏳',
      visited: '✅',
      no_answer: '❌',
      not_home: '🚪',
      reschedule: '📅',
      interested: '🤝',
      wait_income: '⏳',
      not_interested: '🚫',
    }[status] || '⏳';
  },

  statusLabel(status) {
    return {
      visited: '✅ พบลูกค้า',
      no_answer: '❌ ไม่พบลูกค้า',
      not_home: '🚪 ไม่อยู่บ้าน',
      reschedule: '📅 นัดใหม่',
      interested: '🤝 รับปากจ่าย',
      wait_income: '⏳ รอรายได้',
      not_interested: '🚫 ไม่จ่าย',
    }[status] || status;
  },

  openLog(customerId) {
    this.currentCustomerId = customerId;
    const c = Storage.getCustomers().find(x => x.id === customerId);
    if (!c) return;
    document.getElementById('visit-modal-title').textContent = `📋 บันทึกการเข้าพบ: ${c.name}`;
    const visits = Storage.getVisits();
    const existing = visits[customerId];
    const form = document.getElementById('visit-log-form');
    
    // Set quick status buttons
    const status = existing?.status || 'visited';
    this.setQuickStatus(status);
    
    form.elements.note.value = existing?.note || '';
    // นัดชำระเดิม (ถ้ามี) — เติมให้แก้ต่อได้ ไม่ต้องกรอกใหม่
    const pDate = document.getElementById('visit-promise-date');
    const pAmt = document.getElementById('visit-promise-amount');
    if (pDate) pDate.value = existing?.promiseDate || '';
    if (pAmt) pAmt.value = existing?.promiseAmount ?? '';
    this._renderPromiseStatus(existing);
    this._updatePromiseVisibility(status);
    // Phase 5: pre-fill GPS if previously recorded
    form.elements.lat.value = existing?.lat || '';
    form.elements.lng.value = existing?.lng || '';
    form.elements.accuracy.value = existing?.accuracy || '';
    this._renderGpsDisplay(existing?.lat, existing?.lng, existing?.accuracy);
    document.getElementById('visit-log-modal').classList.remove('hidden');
  },

  // Set quick status (called by quick status buttons)
  setQuickStatus(status) {
    // Update hidden select
    const select = document.getElementById('visit-status-select');
    if (select) select.value = status;

    // Update button states
    document.querySelectorAll('.quick-status-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === status);
    });
    this._updatePromiseVisibility(status);
  },

  // ช่องนัดชำระโผล่เฉพาะผล "รับปากจ่าย/นัดใหม่" — สถานะอื่นไม่ต้องใส่วันนัด
  _updatePromiseVisibility(status) {
    const sec = document.getElementById('visit-promise-section');
    if (!sec) return;
    sec.classList.toggle('hidden', !(status === 'interested' || status === 'reschedule'));
  },

  _renderPromiseStatus(existing) {
    const el = document.getElementById('visit-promise-status');
    if (!el) return;
    if (existing && existing.promiseDate && typeof WorkCalendar !== 'undefined') {
      const cls = WorkCalendar.classify(existing.promiseDate, existing.promiseStatus);
      const hist = Array.isArray(existing.promiseHistory) && existing.promiseHistory.length
        ? ' · เคยนัด/เลื่อน ' + existing.promiseHistory.length + ' ครั้ง' : '';
      el.textContent = '📌 นัดเดิม: ' + WorkCalendar.fmtDate(existing.promiseDate) + ' — ' + WorkCalendar.statusLabel(cls) + hist;
      el.classList.remove('hidden');
    } else {
      el.textContent = '';
      el.classList.add('hidden');
    }
  },

  // Phase 5: Render GPS display in visit modal
  _renderGpsDisplay(lat, lng, accuracy) {
    const el = document.getElementById('gps-display');
    if (!el) return;
    if (lat && lng) {
      const accText = accuracy ? `±${Math.round(accuracy)} ม.` : '';
      el.innerHTML = `
        <div class="gps-captured">
          <span class="gps-coord">📍 ${parseFloat(lat).toFixed(6)}, ${parseFloat(lng).toFixed(6)}</span>
          <span class="gps-accuracy">${accText}</span>
        </div>
      `;
    } else {
      el.innerHTML = '<span class="gps-empty">ยังไม่ได้บันทึก</span>';
    }
  },

  // Phase 5: Capture current GPS
  captureGPS() {
    if (!navigator.geolocation) {
      Utils.toast('เบราว์เซอร์ไม่รองรับ GPS', 'error');
      return;
    }
    Utils.toast('📍 กำลังค้นหาตำแหน่ง...');
    const btn = document.getElementById('btn-capture-gps');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังค้นหา...'; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = pos.coords.accuracy;
        document.getElementById('visit-lat').value = lat.toFixed(6);
        document.getElementById('visit-lng').value = lng.toFixed(6);
        document.getElementById('visit-accuracy').value = Math.round(acc);
        this._renderGpsDisplay(lat, lng, acc);
        Utils.toast('📍 บันทึกพิกัดแล้ว');
        if (btn) { btn.disabled = false; btn.textContent = '📍 บันทึกพิกัดปัจจุบัน'; }
      },
      (err) => {
        Utils.toast('ไม่สามารถเข้าถึง GPS: ' + err.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = '📍 บันทึกพิกัดปัจจุบัน'; }
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  },

  closeLog() {
    this.currentCustomerId = null;
    document.getElementById('visit-log-modal').classList.add('hidden');
  },

  async submit(form) {
    if (!this.currentCustomerId) return;
    const status = document.getElementById('visit-status-select').value;
    const data = {
      status,
      note: form.elements.note.value,
    };
    // นัดชำระ: บังคับใส่วันที่เมื่อผลเป็นรับปากจ่าย/นัดใหม่ กันนัดหลุดจากปฏิทิน
    if (status === 'interested' || status === 'reschedule') {
      const pDateEl = document.getElementById('visit-promise-date');
      const pAmtEl = document.getElementById('visit-promise-amount');
      const promiseDate = pDateEl ? pDateEl.value : '';
      if (!promiseDate) {
        Utils.toast('กรุณาใส่วันที่รับปากชำระ/วันนัดใหม่ก่อนบันทึก', 'error');
        if (pDateEl) pDateEl.focus();
        return;
      }
      const existing = Storage.getVisits()[this.currentCustomerId] || {};
      const history = Array.isArray(existing.promiseHistory) ? [...existing.promiseHistory] : [];
      if (existing.promiseDate && existing.promiseDate !== promiseDate) {
        history.push({ date: existing.promiseDate, result: 'rescheduled', newDate: promiseDate, at: new Date().toISOString() });
      }
      data.promiseDate = promiseDate;
      data.promiseAmount = pAmtEl && pAmtEl.value !== '' ? Number(pAmtEl.value) : '';
      // วันนัดเดิม + ผลเดิมค้างอยู่ = คงสถานะชำระแล้วไว้; วันใหม่/นัดใหม่ = กลับเป็นรอติดตาม
      data.promiseStatus = (existing.promiseDate === promiseDate && existing.promiseStatus === 'paid') ? 'paid' : 'pending';
      data.promiseHistory = history;
    }
    // Phase 5: GPS coordinates (if captured)
    const lat = form.elements.lat.value;
    const lng = form.elements.lng.value;
    const accuracy = form.elements.accuracy.value;
    if (lat && lng) {
      data.lat = parseFloat(lat);
      data.lng = parseFloat(lng);
      if (accuracy) data.accuracy = parseFloat(accuracy);
    }
    const result = await Storage.saveVisit(this.currentCustomerId, data);
    this.closeLog();
    this.render();
    Customers.renderMarkers(); // update marker colors
    if (result && result.synced) {
      Utils.toast('💾 บันทึกการเข้าพบแล้ว · sync สำเร็จ');
    } else {
      Utils.toast('⚠️ บันทึกแล้วแต่ sync ไม่สำเร็จ — กด 🔄 เพื่อลองใหม่', 'error');
    }
  },

  timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'เมื่อกี้';
    if (mins < 60) return `${mins} นาทีที่แล้ว`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ชม.ที่แล้ว`;
    const days = Math.floor(hours / 24);
    return `${days} วันที่แล้ว`;
  },

  escapeHTML(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  },
};

window.Visit = Visit;
