// ===== Visit log management =====

const Visit = {
  currentCustomerId: null,

  // Render visit list
  render() {
    const list = document.getElementById('visit-list');
    const route = Storage.getRoute();
    const customers = Storage.getCustomers();
    const visits = Storage.getVisits();
    const routeCustomers = route.map(id => customers.find(c => c.id === id)).filter(Boolean);

    const counts = { pending: 0, visited: 0, skipped: 0 };
    list.innerHTML = '';

    if (routeCustomers.length === 0) {
      list.innerHTML = `<p class="empty-state">ไม่มีลูกค้าในเส้นทางวันนี้<br><small>ไปที่แท็บ "ลูกค้า" เพื่อเพิ่ม</small></p>`;
      document.getElementById('visit-pending').textContent = 0;
      document.getElementById('visit-completed').textContent = 0;
      document.getElementById('visit-skipped').textContent = 0;
      return;
    }

    routeCustomers.forEach(c => {
      const visit = visits[c.id];
      const status = visit?.status || 'pending';
      if (status === 'visited') counts.visited++;
      else if (status === 'no_answer' || status === 'not_home' || status === 'reschedule' || status === 'not_interested') counts.skipped++;
      else counts.pending++;

      const statusIcon = this.statusIcon(status);
      const statusClass = ['visited', 'no_answer', 'not_home', 'reschedule', 'not_interested'].includes(status) ? status : '';
      const itemClass = status === 'visited' ? 'visited' : (status !== 'pending' ? 'skipped' : '');

      const item = document.createElement('div');
      item.className = `visit-item ${itemClass}`;
      item.innerHTML = `
        <div class="visit-status ${statusClass}" onclick="Visit.openLog('${c.id}')" title="คลิกเพื่อบันทึก">
          ${statusIcon}
        </div>
        <div class="visit-info">
          <div class="visit-name">${this.escapeHTML(c.name)}</div>
          <div class="visit-meta">${visit ? this.statusLabel(status) + ' · ' + this.timeAgo(visit.timestamp) : '⏳ รอเยี่ยม'}</div>
        </div>
      `;
      list.appendChild(item);
    });

    document.getElementById('visit-pending').textContent = counts.pending;
    document.getElementById('visit-completed').textContent = counts.visited;
    document.getElementById('visit-skipped').textContent = counts.skipped;
  },

  statusIcon(status) {
    return {
      pending: '⏳',
      visited: '✅',
      no_answer: '❌',
      not_home: '🚪',
      reschedule: '📅',
      interested: '💚',
      not_interested: '🚫',
    }[status] || '⏳';
  },

  statusLabel(status) {
    return {
      visited: '✅ เยี่ยมสำเร็จ',
      no_answer: '❌ ไม่พบลูกค้า',
      not_home: '🚪 ไม่อยู่บ้าน',
      reschedule: '📅 นัดใหม่',
      interested: '💚 ลูกค้าสนใจ',
      not_interested: '🚫 ไม่สนใจ',
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
    form.elements.status.value = existing?.status || 'visited';
    form.elements.note.value = existing?.note || '';
    document.getElementById('visit-log-modal').classList.remove('hidden');
  },

  closeLog() {
    this.currentCustomerId = null;
    document.getElementById('visit-log-modal').classList.add('hidden');
  },

  submit(form) {
    if (!this.currentCustomerId) return;
    const data = {
      status: form.elements.status.value,
      note: form.elements.note.value,
    };
    Storage.saveVisit(this.currentCustomerId, data);
    this.closeLog();
    this.render();
    Customers.renderMarkers(); // update marker colors
    Utils.toast('💾 บันทึกการเข้าพบแล้ว');
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
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },
};

window.Visit = Visit;
