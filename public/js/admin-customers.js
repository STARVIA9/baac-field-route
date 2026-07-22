// ===== Admin Customer Manager — CRUD UI =====

const Admin = {
  customers: [],
  filtered: [],
  recycle: [],
  page: 1,
  pageSize: 50,
  pollingTimer: null,

  // ===== Init =====
  async init() {
    // Check existing session — try API first to verify token isn't stale
    if (Auth.isLoggedIn()) {
      if (Auth.isAdmin()) {
        // Try API; if 401, fall back to login
        try {
          const data = await API.get('/api/admin/customers-crud');
          if (data.success) {
            this.customers = data.customers || [];
            this.showApp();
            this.applyFilters();
            this.updateTagFilter();
            this.updateSyncBadge('ok');
            this.startPolling();
            this.bindEvents();
            return;
          }
        } catch (e) {
          // fall through to login
        }
        Auth.logout();
      } else {
        Utils.toast('ต้องเป็น Admin เท่านั้น', 'error');
        setTimeout(() => location.href = '/', 1500);
        return;
      }
    }
    this.showLogin();
    this.bindEvents();
  },

  showLogin() {
    document.getElementById('login-screen').style.display = '';
    document.getElementById('app').classList.remove('visible');
  },

  showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').classList.add('visible');
    const user = Auth.getUser();
    if (user) document.getElementById('user-name').textContent = `👤 ${user.name || user.username}`;

    this.loadAll();
    this.startPolling();
  },

  bindEvents() {
    document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
    document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());
    document.getElementById('btn-back').addEventListener('click', () => location.href = '/');

    document.getElementById('btn-add').addEventListener('click', () => this.openAdd());
    document.getElementById('btn-import').addEventListener('click', () => this.openImport());
    document.getElementById('btn-export').addEventListener('click', () => this.openExport());
    document.getElementById('btn-recycle').addEventListener('click', () => this.openRecycle());

    document.getElementById('search').addEventListener('input', () => { this.page = 1; this.applyFilters(); });
    document.getElementById('filter-gps').addEventListener('change', () => { this.page = 1; this.applyFilters(); });
    document.getElementById('filter-risk').addEventListener('change', () => { this.page = 1; this.applyFilters(); });
    document.getElementById('filter-tag').addEventListener('change', () => { this.page = 1; this.applyFilters(); });

    document.getElementById('prev-page').addEventListener('click', () => this.changePage(-1));
    document.getElementById('next-page').addEventListener('click', () => this.changePage(1));
    document.getElementById('page-size').addEventListener('change', (e) => { this.pageSize = +e.target.value; this.page = 1; this.renderTable(); });

    document.getElementById('select-all').addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));

    document.getElementById('close-edit').addEventListener('click', () => this.closeEdit());
    document.getElementById('cancel-edit').addEventListener('click', () => this.closeEdit());
    document.getElementById('save-edit').addEventListener('click', () => this.saveEdit());

    document.getElementById('close-recycle').addEventListener('click', () => this.closeRecycle());
  },

  async handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';

    const ok = await Auth.login(username, password);
    if (ok) {
      if (Auth.isAdmin()) this.showApp();
      else {
        errEl.textContent = 'ต้องเป็น Admin เท่านั้น';
        Auth.logout();
      }
    } else {
      errEl.textContent = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
    }
  },

  // ===== Data =====
  async loadAll() {
    try {
      const data = await API.get('/api/admin/customers-crud');
      if (data.success) {
        this.customers = data.customers || [];
        this.applyFilters();
        this.updateTagFilter();
        this.updateSyncBadge('ok');
      }
    } catch (err) {
      console.error('loadAll failed:', err);
      this.updateSyncBadge('offline');
    }
  },

  startPolling() {
    if (this.pollingTimer) clearInterval(this.pollingTimer);
    this.pollingTimer = setInterval(() => this.loadAll(), 5000);
  },

  updateSyncBadge(status) {
    const badge = document.getElementById('sync-badge');
    badge.classList.remove('stale', 'offline');
    if (status === 'ok') {
      badge.textContent = `🟢 ซิงค์เมื่อ ${new Date().toLocaleTimeString('th-TH')}`;
    } else if (status === 'stale') {
      badge.classList.add('stale');
      badge.textContent = '🟡 กำลังซิงค์...';
    } else {
      badge.classList.add('offline');
      badge.textContent = '🔴 ออฟไลน์';
    }
  },

  applyFilters() {
    const q = document.getElementById('search').value.toLowerCase().trim();
    const gps = document.getElementById('filter-gps').value;
    const risk = document.getElementById('filter-risk').value;
    const tag = document.getElementById('filter-tag').value;

    this.filtered = this.customers.filter(c => {
      if (q) {
        const hay = `${c.cif || ''} ${c.name || ''} ${c.nickname || ''} ${c.phone || ''} ${c.address || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (gps === 'yes' && !(c.lat && c.lng && Number.isFinite(c.lat) && Number.isFinite(c.lng))) return false;
      if (gps === 'no' && c.lat && c.lng && Number.isFinite(c.lat) && Number.isFinite(c.lng)) return false;
      if (risk !== 'all' && (c.riskLevel || 'unclassified') !== risk) return false;
      if (tag !== 'all' && !(c.tags || []).includes(tag)) return false;
      return true;
    });

    this.renderTable();
  },

  updateTagFilter() {
    const sel = document.getElementById('filter-tag');
    const current = sel.value;
    const allTags = new Set();
    this.customers.forEach(c => (c.tags || []).forEach(t => allTags.add(t)));
    const sorted = Array.from(allTags).sort();
    sel.innerHTML = '<option value="all">ทุก Tag</option>' +
      sorted.map(t => `<option value="${this.escapeAttr(t)}">${this.escapeHtml(t)}</option>`).join('');
    sel.value = sorted.includes(current) ? current : 'all';
  },

  // ===== Table render =====
  renderTable() {
    const tbody = document.getElementById('data-tbody');
    const total = this.filtered.length;
    const start = (this.page - 1) * this.pageSize;
    const slice = this.filtered.slice(start, start + this.pageSize);
    const totalPages = Math.max(1, Math.ceil(total / this.pageSize));

    document.getElementById('count-display').textContent = `${total.toLocaleString()} คน`;
    document.getElementById('page-info').textContent = `หน้า ${this.page} / ${totalPages} (${total.toLocaleString()} คน)`;
    document.getElementById('prev-page').disabled = this.page <= 1;
    document.getElementById('next-page').disabled = this.page >= totalPages;

    if (slice.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-state"><h3>ไม่พบข้อมูล</h3><p>ลองเปลี่ยน filter หรือคำค้นหา</p></td></tr>`;
      return;
    }

    tbody.innerHTML = slice.map(c => this.renderRow(c)).join('');

    tbody.querySelectorAll('[data-action="edit"]').forEach(b => b.addEventListener('click', () => this.openEdit(b.dataset.id)));
    tbody.querySelectorAll('[data-action="delete"]').forEach(b => b.addEventListener('click', () => this.handleDelete(b.dataset.id)));
  },

  renderRow(c) {
    const hasGps = c.lat && c.lng && Number.isFinite(c.lat) && Number.isFinite(c.lng);
    const district = this.extractDistrict(c.address);
    const risk = c.riskLevel || 'unclassified';
    const riskLabel = { good: '🟢 ดี', warning: '🟡 เริ่มมีปัญหา', bad: '🔴 มีปัญหามาก', unclassified: '❓ ยังไม่จัด' }[risk];
    const tagsHtml = (c.tags || []).map(t => `<span class="tag">${this.escapeHtml(t)}</span>`).join('');
    const updatedAt = c.updatedAt ? new Date(c.updatedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '-';

    return `
      <tr>
        <td><input type="checkbox" class="row-check" value="${c.id}"></td>
        <td><code>${this.escapeHtml(c.cif || '')}</code></td>
        <td><strong>${this.escapeHtml(c.name || '')}</strong>${c.nickname ? `<br><small style="color:#94a3b8">(${this.escapeHtml(c.nickname)})</small>` : ''}</td>
        <td>${this.escapeHtml(c.phone || '-')}</td>
        <td>${this.escapeHtml(district || '-')}</td>
        <td>${hasGps ? `<span class="gps-yes">✓ ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}</span>` : '<span class="gps-no">—</span>'}</td>
        <td><span class="risk-${risk}">${riskLabel}</span></td>
        <td>${tagsHtml || '<span style="color:#cbd5e1">—</span>'}</td>
        <td><small>${updatedAt}</small></td>
        <td>
          <div class="row-actions">
            <button data-action="edit" data-id="${c.id}">✏️</button>
            <button data-action="delete" data-id="${c.id}" class="danger">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  },

  extractDistrict(addr) {
    if (!addr) return '';
    const m = addr.match(/(ตำบล|ต\.|อำเภอ|อ\.|จังหวัด|จ\.)[^,]*/g);
    return m ? m.slice(0, 2).join(' ') : addr.slice(0, 30);
  },

  changePage(delta) {
    const totalPages = Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
    this.page = Math.max(1, Math.min(totalPages, this.page + delta));
    this.renderTable();
  },

  toggleSelectAll(checked) {
    document.querySelectorAll('.row-check').forEach(cb => cb.checked = checked);
  },

  getSelected() {
    return Array.from(document.querySelectorAll('.row-check:checked')).map(cb => cb.value);
  },

  // ===== Edit/Add modal =====
  openAdd() {
    document.getElementById('modal-title').textContent = '➕ เพิ่มลูกค้าใหม่';
    document.getElementById('edit-id').value = '';
    document.getElementById('edit-cif').value = '';
    document.getElementById('edit-cif').disabled = false;
    document.getElementById('edit-name').value = '';
    document.getElementById('edit-nickname').value = '';
    document.getElementById('edit-phone').value = '';
    document.getElementById('edit-address').value = '';
    document.getElementById('edit-lat').value = '';
    document.getElementById('edit-lng').value = '';
    document.getElementById('edit-risk').value = 'unclassified';
    document.getElementById('edit-debt').value = '';
    document.getElementById('edit-tags').value = '';
    document.getElementById('edit-modal').classList.add('visible');
  },

  openEdit(id) {
    const c = this.customers.find(x => x.id === id);
    if (!c) return Utils.toast('ไม่พบลูกค้า', 'error');

    document.getElementById('modal-title').textContent = '✏️ แก้ไขลูกค้า';
    document.getElementById('edit-id').value = c.id;
    document.getElementById('edit-cif').value = c.cif || '';
    document.getElementById('edit-cif').disabled = true;  // CIF เปลี่ยนไม่ได้
    document.getElementById('edit-name').value = c.name || '';
    document.getElementById('edit-nickname').value = c.nickname || '';
    document.getElementById('edit-phone').value = c.phone || '';
    document.getElementById('edit-address').value = c.address || '';
    document.getElementById('edit-lat').value = c.lat || '';
    document.getElementById('edit-lng').value = c.lng || '';
    document.getElementById('edit-risk').value = c.riskLevel || 'unclassified';
    document.getElementById('edit-debt').value = c.debtType || '';
    document.getElementById('edit-tags').value = (c.tags || []).join(', ');
    document.getElementById('edit-modal').classList.add('visible');
  },

  closeEdit() {
    document.getElementById('edit-modal').classList.remove('visible');
  },

  async saveEdit() {
    const id = document.getElementById('edit-id').value;
    const payload = {
      cif: document.getElementById('edit-cif').value.trim(),
      name: document.getElementById('edit-name').value.trim(),
      nickname: document.getElementById('edit-nickname').value.trim(),
      phone: document.getElementById('edit-phone').value.trim(),
      address: document.getElementById('edit-address').value.trim(),
      lat: parseFloat(document.getElementById('edit-lat').value) || null,
      lng: parseFloat(document.getElementById('edit-lng').value) || null,
      riskLevel: document.getElementById('edit-risk').value,
      debtType: document.getElementById('edit-debt').value,
      tags: document.getElementById('edit-tags').value.split(',').map(s => s.trim()).filter(Boolean),
    };

    if (!payload.cif || !payload.name) return Utils.toast('ต้องระบุ CIF และ ชื่อ-นามสกุล', 'error');

    try {
      let result;
      if (id) {
        result = await API.put('/api/admin/customers-crud', { id, ...payload });
      } else {
        result = await API.post('/api/admin/customers-crud', payload);
      }
      if (result.success) {
        Utils.toast(id ? 'แก้ไขสำเร็จ' : 'เพิ่มสำเร็จ', 'success');
        this.closeEdit();
        this.loadAll();
      } else {
        Utils.toast(result.error || 'บันทึกไม่สำเร็จ', 'error');
      }
    } catch (err) {
      Utils.toast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
    }
  },

  // ===== Delete =====
  async handleDelete(id) {
    const c = this.customers.find(x => x.id === id);
    if (!c) return;
    if (!confirm(`ลบ "${c.name}" ?\n(จะเก็บไว้ในถังขยะ 30 วัน กู้คืนได้)`)) return;

    try {
      const result = await API.del('/api/admin/customers-crud?id=' + encodeURIComponent(id));
      if (result.success) {
        Utils.toast('ลบแล้ว (เก็บในถังขยะ 30 วัน)', 'success');
        this.loadAll();
      } else {
        Utils.toast(result.error || 'ลบไม่สำเร็จ', 'error');
      }
    } catch (err) {
      Utils.toast('ลบไม่สำเร็จ: ' + err.message, 'error');
    }
  },

  // ===== Recycle bin =====
  async openRecycle() {
    try {
      const data = await API.get('/api/admin/customers-crud?includeRecycle=true');
      if (!data.success) return Utils.toast('โหลดถังขยะไม่สำเร็จ', 'error');
      this.recycle = data.recycle || [];
      this.renderRecycle();
      document.getElementById('recycle-modal').classList.add('visible');
    } catch (err) {
      Utils.toast('โหลดถังขยะไม่สำเร็จ: ' + err.message, 'error');
    }
  },

  closeRecycle() {
    document.getElementById('recycle-modal').classList.remove('visible');
  },

  renderRecycle() {
    const el = document.getElementById('recycle-list');
    if (this.recycle.length === 0) {
      el.innerHTML = '<div class="empty-state"><h3>ถังขยะว่าง</h3></div>';
      return;
    }

    el.innerHTML = `
      <table class="data-table" style="margin-top:0;">
        <thead><tr><th>ชื่อ</th><th>CIF</th><th>ลบเมื่อ</th><th>เหลือ</th><th>กู้คืน</th><th>ลบถาวร</th></tr></thead>
        <tbody>
        ${this.recycle.map(c => {
          const deleted = new Date(c.deletedAt);
          const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - deleted.getTime()) / 86400000));
          return `
            <tr>
              <td>${this.escapeHtml(c.name)}</td>
              <td><code>${this.escapeHtml(c.cif || '')}</code></td>
              <td><small>${deleted.toLocaleDateString('th-TH')}</small></td>
              <td>${daysLeft} วัน</td>
              <td><button class="restore-btn" data-id="${c.id}">↩️ กู้คืน</button></td>
              <td><button class="danger purge-btn" data-id="${c.id}">ลบถาวร</button></td>
            </tr>`;
        }).join('')}
        </tbody>
      </table>
    `;

    el.querySelectorAll('.restore-btn').forEach(b => b.addEventListener('click', () => this.handleRestore(b.dataset.id)));
    el.querySelectorAll('.purge-btn').forEach(b => b.addEventListener('click', () => this.handlePurge(b.dataset.id)));
  },

  async handleRestore(id) {
    if (!confirm('กู้คืนลูกค้ารายนี้กลับมา?')) return;
    try {
      const result = await API.post('/api/admin/customers-crud?action=restore', { id });
      if (result.success) {
        Utils.toast('กู้คืนแล้ว', 'success');
        this.openRecycle();
        this.loadAll();
      } else {
        Utils.toast(result.error || 'กู้คืนไม่สำเร็จ', 'error');
      }
    } catch (err) {
      Utils.toast('กู้คืนไม่สำเร็จ: ' + err.message, 'error');
    }
  },

  async handlePurge(id) {
    if (!confirm('ลบถาวร? ไม่สามารถกู้คืนได้อีก')) return;
    try {
      const result = await API.del('/api/admin/customers-crud?action=purge&id=' + encodeURIComponent(id));
      if (result.success) {
        Utils.toast('ลบถาวรแล้ว', 'success');
        this.openRecycle();
      } else {
        Utils.toast(result.error || 'ลบไม่สำเร็จ', 'error');
      }
    } catch (err) {
      Utils.toast('ลบไม่สำเร็จ: ' + err.message, 'error');
    }
  },

  // ===== Import =====
  openImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.json,.xlsx,.xls';
    input.onchange = (e) => this.handleImportFile(e.target.files[0]);
    input.click();
  },

  async handleImportFile(file) {
    if (!file) return;

    const mode = prompt('โหมดการ Import:\n1 = append (ข้ามซ้ำ)\n2 = upsert (อัพเดทของเดิม)\n3 = replace (ลบทั้งหมดแล้วใส่ใหม่)\n\nพิมพ์ 1, 2 หรือ 3:', '1');
    if (!mode) return;
    const modeMap = { '1': 'append', '2': 'upsert', '3': 'replace' };
    const m = modeMap[mode];
    if (!m) return Utils.toast('โหมดไม่ถูกต้อง', 'error');

    try {
      let customers;
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        customers = JSON.parse(text);
        if (!Array.isArray(customers)) throw new Error('JSON ต้องเป็น array');
      } else {
        // CSV (basic parser)
        const text = await file.text();
        customers = this.parseCSV(text);
      }

      if (!confirm(`จะ Import ${customers.length} รายการ (โหมด: ${m})\n\nยืนยัน?`)) return;

      const result = await API.post('/api/admin/customers-io', { mode: m, customers });
      if (result.success) {
        Utils.toast(
          `✅ เสร็จ: +${result.added} ใหม่, ↻${result.updated} อัพเดท, ⊘${result.skipped} ข้าม${result.errors?.length ? `, ⚠️${result.errors.length} ผิดพลาด` : ''}`,
          'success'
        );
        this.loadAll();
      } else {
        Utils.toast(result.error || 'Import ไม่สำเร็จ', 'error');
      }
    } catch (err) {
      Utils.toast('Import ไม่สำเร็จ: ' + err.message, 'error');
    }
  },

  parseCSV(text) {
    // Strip BOM
    text = text.replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];

    const parseLine = (line) => {
      const out = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') { inQ = false; }
          else cur += ch;
        } else {
          if (ch === ',') { out.push(cur); cur = ''; }
          else if (ch === '"') { inQ = true; }
          else cur += ch;
        }
      }
      out.push(cur);
      return out;
    };

    const headers = parseLine(lines[0]).map(h => h.trim().toLowerCase());
    return lines.slice(1).map(line => {
      const vals = parseLine(line);
      const obj = {};
      headers.forEach((h, i) => {
        const v = vals[i] || '';
        if (['lat', 'lng', 'latitude', 'longitude'].includes(h)) {
          obj[h.includes('lat') ? 'lat' : 'lng'] = parseFloat(v) || null;
        } else if (h === 'tags') {
          obj.tags = v ? v.split('|').map(s => s.trim()).filter(Boolean) : [];
        } else {
          obj[h] = v;
        }
      });
      return obj;
    });
  },

  // ===== Export =====
  openExport() {
    const fields = prompt(
      'เลือก field ที่ต้องการ Export (คั่นด้วย ,):\n' +
      'cif, name, nickname, phone, address, lat, lng, riskLevel, debtType, tags, createdAt, updatedAt\n\n' +
      'พิมพ์ field ที่ต้องการ หรือ "all" สำหรับทั้งหมด:',
      'cif,name,phone,address,lat,lng,riskLevel,tags'
    );
    if (!fields) return;

    const format = prompt('Format:\n1 = CSV\n2 = JSON\n\nพิมพ์ 1 หรือ 2:', '1');
    if (!format) return;
    const fmt = format === '2' ? 'json' : 'csv';

    const hasGps = prompt('Filter:\n1 = ทั้งหมด\n2 = เฉพาะที่มี GPS\n3 = เฉพาะที่ไม่มี GPS\n\nพิมพ์ 1, 2 หรือ 3:', '1');
    if (!hasGps) return;
    const gpsMap = { '1': '', '2': '&hasGps=true', '3': '&hasGps=false' };
    const q = document.getElementById('search').value.trim();

    const params = new URLSearchParams({
      format: fmt,
      fields: fields === 'all' ? '' : fields,
    });
    if (gpsMap[hasGps]) params.set('hasGps', gpsMap[hasGps].replace('&hasGps=', ''));
    if (q) params.set('q', q);

    const url = `/api/admin/customers-io?${params}`;
    const token = Auth.getToken();
    // Fetch with auth header then download
    fetch(url, { headers: token && !token.startsWith('offline_') ? { 'Authorization': 'Bearer ' + token } : {} })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `customers-${Date.now()}.${fmt}`;
        a.click();
        URL.revokeObjectURL(a.href);
        Utils.toast('✅ Export สำเร็จ', 'success');
      })
      .catch(err => Utils.toast('Export ไม่สำเร็จ: ' + err.message, 'error'));
  },

  // ===== Utilities =====
  escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  },

  escapeAttr(s) {
    return this.escapeHtml(s);
  },
};

// ===== Utils.toast fallback =====
if (!window.Utils) {
  window.Utils = {
    toast(msg, type = '') {
      const c = document.getElementById('toast-container');
      if (!c) return alert(msg);
      const t = document.createElement('div');
      t.className = 'toast ' + type;
      t.textContent = msg;
      c.appendChild(t);
      setTimeout(() => t.remove(), 3500);
    },
  };
}

document.addEventListener('DOMContentLoaded', () => Admin.init());
