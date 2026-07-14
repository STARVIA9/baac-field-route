// ===== Main App — orchestration + event handlers =====

// ===== Office location (single source of truth) =====
// Used as: initial map view, mini-map default, quick-route / route-planner
// start point. Update here and every screen picks it up automatically.
// Was previously hardcoded as Bangkok coords [13.7563, 100.5018] in 7 places
// — that's why the map kept centering on Bangkok even though the comment
// said "BAAC Wang Tha Chang".
const OFFICE_LOCATION = {
  lat: 13.7760801,
  lng: 101.8907475,
  name: 'BAAC สาขาวังท่าช้าง',
  accuracy: 50, // meters — used for the GPS pin accuracy circle
};
window.OFFICE_LOCATION = OFFICE_LOCATION;

const App = {
  // Known server version (updated on every fetch from version.json)
  _knownVersion: null,
  _versionCheckTimer: null,

  // Init
  async init() {
    if (Auth.isLoggedIn()) {
      Auth.showApp();
      await this.afterLogin();
    } else {
      Auth.showLogin();
    }
    this.attachEvents();
    this.startVersionWatcher();
  },

  // ===== Version watcher (auto-detect new deploys) =====
  async fetchServerVersion() {
    try {
      const res = await fetch('/version.json?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.version || null;
    } catch (e) {
      return null;
    }
  },

  async checkForUpdate() {
    const serverVer = await this.fetchServerVersion();
    if (!serverVer) return false;
    const stored = localStorage.getItem('app_version') || '0';
    const btn = document.getElementById('refresh-btn');
    if (serverVer !== stored && this._knownVersion !== null) {
      // New version detected (don't show on first load)
      if (btn) {
        btn.classList.add('has-update');
        btn.title = `เวอร์ชันใหม่พร้อมใช้งาน! (กดเพื่ออัพเดท)`;
      }
      return true;
    }
    if (btn) {
      btn.classList.remove('has-update');
      btn.title = 'รีเฟรชข้อมูล + เคลียร์ cache';
    }
    return false;
  },

  startVersionWatcher() {
    // Set known version on first load
    this.fetchServerVersion().then(v => {
      if (v) {
        this._knownVersion = v;
        localStorage.setItem('app_version', v);
      }
    });
    // Check every 5 minutes
    if (this._versionCheckTimer) clearInterval(this._versionCheckTimer);
    this._versionCheckTimer = setInterval(() => this.checkForUpdate(), 5 * 60 * 1000);
    // Also re-check when tab regains focus
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.checkForUpdate();
    });
  },

  // After login — load data
  async afterLogin() {
    // Phase 1: Migrate old customers to new schema (riskLevel + debtType)
    Storage.migrateCustomers();

    Customers.initMap();
    // Initial load: fit bounds to all customers so the user sees the full picture
    Customers.renderAll(undefined, { fitBounds: true });
    Visit.render();
    Route.attachEvents();
    this.updateRouteUI();
    this.updateAdminUI();
    // Init bottom sheet (map-as-canvas mode)
    this.initBottomSheet();
    this.renderTodayRoute();

    // Load customer database (async, non-blocking)
    CustomerDB.load();

    // Initial sync (push local + pull remote)
    const sync = await Storage.sync();
    if (sync && sync.success) {
      const c = sync.counts || {};
      Utils.toast(`☁️ Sync: ${c.customers ?? 0} ลูกค้า, ${c.visits ?? 0} visits, ${c.savedRoutes ?? 0} เส้นทาง`);
      Customers.renderAll();
      this.updateRouteUI();
    } else if (sync && sync.error) {
      Utils.toast('⚠️ Sync ไม่สำเร็จ — ใช้ข้อมูล local', 'warn');
    }

    // Start real-time polling
    this._wireSyncEvents();
    Storage.startPolling(3000);
  },

  // Listen for sync events to update UI badge
  _wireSyncEvents() {
    this._unsubSync = Storage.onSyncEvent((evt) => {
      this._updateSyncBadge(evt);
      if (evt.status === 'synced' && evt.counts) {
        // Re-render to show new data
        Customers.renderAll();
        if (typeof Visit !== 'undefined') Visit.render();
        this.updateRouteUI();
      }
    });
  },

  _updateSyncBadge(evt) {
    let badge = document.getElementById('sync-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'sync-badge';
      badge.style.cssText = 'position:fixed;bottom:8px;right:8px;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600;z-index:9999;background:#4caf50;color:white;box-shadow:0 2px 6px rgba(0,0,0,0.2);transition:opacity 0.3s;cursor:pointer;';
      badge.title = 'กดเพื่อ retry sync';
      badge.addEventListener('click', () => Storage.retrySync());
      document.body.appendChild(badge);
    }
    if (evt.status === 'syncing') {
      badge.textContent = evt.action === 'retry' ? '🔄 กำลัง sync ใหม่...' : '🔄 Syncing...';
      badge.style.background = '#ff9800';
      badge.style.cursor = 'wait';
    } else if (evt.status === 'synced' && evt.counts) {
      const c = evt.counts;
      badge.textContent = `☁️ Sync: ${c.customers ?? 0} คน, ${c.visits ?? 0} visits`;
      badge.style.background = '#4caf50';
      badge.style.cursor = 'pointer';
    } else if (evt.status === 'error') {
      badge.textContent = '⚠️ Sync ล้มเหลว — กดเพื่อลองใหม่';
      badge.style.background = '#f44336';
      badge.style.cursor = 'pointer';
    }
  },

  // Called by Storage when remote data changes — re-render
  _onRemoteUpdate(remote) {
    Customers.renderAll();
    if (typeof Visit !== 'undefined') Visit.render();
    this.updateRouteUI();
  },

  // Attach all event handlers
  attachEvents() {
    // Login form (username/password)
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      const errEl = document.getElementById('login-error');
      errEl.textContent = '';
      const btn = document.getElementById('login-btn');
      btn.disabled = true;
      btn.textContent = 'กำลังเข้าสู่ระบบ...';
      const ok = await Auth.login(username, password);
      if (ok) {
        await this.afterLogin();
      } else {
        errEl.textContent = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
      }
      btn.disabled = false;
      btn.textContent = 'เข้าสู่ระบบ';
    });

    // PIN fallback toggle
    document.getElementById('toggle-pin-login').addEventListener('click', () => {
      const pinForm = document.getElementById('pin-form');
      const toggleBtn = document.getElementById('toggle-pin-login');
      pinForm.classList.toggle('hidden');
      toggleBtn.textContent = pinForm.classList.contains('hidden') ? 'เข้าสู่ระบบด้วย PIN' : 'ซ่อน PIN';
    });

    // PIN form (legacy fallback)
    document.getElementById('pin-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = document.getElementById('pin-input').value;
      const errEl = document.getElementById('pin-error');
      errEl.textContent = '';
      const btn = document.getElementById('pin-btn');
      btn.disabled = true;
      btn.textContent = 'กำลังเข้าสู่ระบบ...';
      const ok = await Auth.loginPIN(pin);
      if (ok) {
        await this.afterLogin();
      } else {
        errEl.textContent = 'PIN ไม่ถูกต้อง';
      }
      btn.disabled = false;
      btn.textContent = 'เข้าสู่ระบบ (PIN)';
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
      if (confirm('ออกจากระบบ?')) Auth.logout();
    });

    // Admin: User management button
    document.getElementById('admin-users-btn').addEventListener('click', () => {
      this.openAdminUsers();
    });

    // Change password button
    document.getElementById('change-password-btn').addEventListener('click', () => {
      this.openChangePassword();
    });
    document.getElementById('close-change-password').addEventListener('click', () => {
      document.getElementById('change-password-modal').classList.add('hidden');
    });
    document.getElementById('change-password-modal').addEventListener('click', (e) => {
      if (e.target.id === 'change-password-modal') e.target.classList.add('hidden');
    });
    document.getElementById('change-password-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitChangePassword();
    });

    // === Sheet tabs ===
    document.querySelectorAll('.sheet-tab').forEach(t => {
      t.addEventListener('click', () => this.switchSheetTab(t.dataset.sheet));
    });

    // Filters
    document.querySelectorAll('.filter').forEach(f => {
      f.addEventListener('click', () => {
        document.querySelectorAll('.filter').forEach(x => x.classList.remove('active'));
        f.classList.add('active');
        Customers.currentFilter = f.dataset.filter;
        Customers.renderList();
      });
    });

    // Customer search
    const customerSearch = document.getElementById('customer-search');
    if (customerSearch) {
      customerSearch.addEventListener('input', Utils.debounce(() => Customers.renderList(), 150));
    }

    // FAB buttons
    document.getElementById('fab-add-customer').addEventListener('click', () => this.openAddCustomerModal());
    document.getElementById('fab-my-location').addEventListener('click', () => this.useGPS());

    // Modal close
    document.getElementById('close-add-modal').addEventListener('click', () => this.closeAddCustomerModal());
    document.getElementById('add-customer-modal').addEventListener('click', (e) => {
      if (e.target.id === 'add-customer-modal') this.closeAddCustomerModal();
    });

    // GPS button
    document.getElementById('btn-use-gps').addEventListener('click', () => this.useGPS(true));

    // Pick on main map
    const pickBtn = document.getElementById('btn-pick-on-main-map');
    if (pickBtn) pickBtn.addEventListener('click', () => this.pickOnMainMap());

    // Add customer form
    document.getElementById('add-customer-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveCustomer(e.target);
    });
    // Photo upload (capture or file)
    const photoInput = document.getElementById('photo-input');
    if (photoInput) {
      photoInput.addEventListener('change', (e) => this.handlePhotoUpload(e.target.files[0]));
    }

    // Customer DB search
    this._initDBSearch();

    // Visit modal
    document.getElementById('close-visit-modal').addEventListener('click', () => Visit.closeLog());
    document.getElementById('btn-cancel-visit').addEventListener('click', () => Visit.closeLog());
    document.getElementById('visit-log-form').addEventListener('submit', (e) => {
      e.preventDefault();
      Visit.submit(e.target);
    });
    document.getElementById('visit-log-modal').addEventListener('click', (e) => {
      if (e.target.id === 'visit-log-modal') Visit.closeLog();
    });
    // Phase 5: GPS capture button
    const gpsBtn = document.getElementById('btn-capture-gps');
    if (gpsBtn) gpsBtn.addEventListener('click', () => Visit.captureGPS());

    // Route: start mode
    document.getElementById('route-start-mode').addEventListener('change', (e) => {
      document.getElementById('custom-start').classList.toggle('hidden', e.target.value !== 'custom');
    });

    // Calculate route
    document.getElementById('btn-calculate-route').addEventListener('click', () => this.calculateRoute());

    // Open Google Maps
    document.getElementById('btn-open-gmaps').addEventListener('click', () => Route.openGoogleMaps());

    // Save route
    document.getElementById('btn-save-route').addEventListener('click', () => Route.saveRoute());

    // Phase 7-9: Report modal
    document.getElementById('report-btn').addEventListener('click', () => Report.open());
    // Help modal — show user how to use the app
    document.getElementById('help-btn').addEventListener('click', () => App.openHelp());
    document.getElementById('close-help-modal').addEventListener('click', () => App.closeHelp());
    document.getElementById('btn-close-help').addEventListener('click', () => App.closeHelp());
    document.getElementById('close-report-modal').addEventListener('click', () => Report.close());
    document.getElementById('report-modal').addEventListener('click', (e) => {
      if (e.target.id === 'report-modal') Report.close();
    });
    document.getElementById('report-range').addEventListener('change', () => Report.setRange(document.getElementById('report-range').value));
    document.getElementById('btn-generate-report').addEventListener('click', () => Report.generate());
    document.getElementById('btn-export-html').addEventListener('click', () => Report.exportHTML());
    document.getElementById('btn-export-csv').addEventListener('click', () => Report.exportCSV());
    document.getElementById('btn-export-share').addEventListener('click', () => Report.shareText());
  },

  // ===== Bottom Sheet (Map-as-Canvas) =====

  // Init sheet interaction (drag + click handle)
  initBottomSheet() {
    const sheet = document.getElementById('bottom-sheet');
    if (!sheet) return;

    // Click handle to toggle peek/half
    document.getElementById('sheet-handle').addEventListener('click', (e) => {
      e.stopPropagation();
      if (sheet.classList.contains('sheet-half') || sheet.classList.contains('sheet-full')) {
        this.setSheetState('peek');
      } else {
        this.setSheetState('half');
      }
    });

    // Drag interaction — handle ONLY. Content always scrolls freely.
    let startY = 0, startTranslate = 0, isDragging = false;
    const handle = document.getElementById('sheet-handle');

    const _readTransform = (el) => {
      const m = window.getComputedStyle(el).transform;
      if (m && m !== 'none') {
        const vals = m.split(/[(),\s]+/).filter(v => v !== '');
        const idx = m.startsWith('matrix3d') ? 13 : 5;
        return parseFloat(vals[idx]) || 0;
      }
      return 0;
    };

    const onStart = (e) => {
      // Only handle can start drag — content never drags the sheet
      if (!e.target.closest('#sheet-handle')) return;
      isDragging = true;
      startY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
      startTranslate = _readTransform(sheet);
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${startTranslate}px)`;
      ['sheet-collapsed','sheet-peek','sheet-half','sheet-full'].forEach(c => sheet.classList.remove(c));
    };

    const onMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const y = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
      const dy = y - startY;
      const newT = Math.max(0, startTranslate + dy);
      sheet.style.transform = `translateY(${newT}px)`;
    };

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      sheet.style.transition = '';
      const t = _readTransform(sheet);
      sheet.style.transform = '';
      const sheetH = sheet.offsetHeight;
      const pct = t / sheetH;
      if (pct < 0.15) this.setSheetState('full');
      else if (pct < 0.55) this.setSheetState('half');
      else if (pct < 0.85) this.setSheetState('peek');
      else this.setSheetState('collapsed');
    };

    handle.addEventListener('touchstart', onStart, {passive: true});
    handle.addEventListener('touchmove', onMove, {passive: false});
    handle.addEventListener('touchend', onEnd);
    handle.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
  },

  // Set bottom sheet state
  setSheetState(state) {
    const sheet = document.getElementById('bottom-sheet');
    if (!sheet) return;
    ['sheet-collapsed','sheet-peek','sheet-half','sheet-full'].forEach(c => sheet.classList.remove(c));
    if (state && state !== 'default') sheet.classList.add('sheet-' + state);
    // Hide FABs when sheet is full
    const fab = document.querySelector('.map-fab');
    if (fab) fab.style.display = (state === 'full') ? 'none' : '';
  },

  // Legacy switchTab — adapts to new map-as-canvas layout
  switchTab(name) {
    if (name === 'map') {
      this.setSheetState('peek');
      this.switchSheetTab('route');
      setTimeout(() => Customers.map && Customers.map.invalidateSize(), 50);
      return;
    }
    const sheetNames = { customers: 'customers', route: 'plan', visit: 'visit' };
    this.switchSheetTab(sheetNames[name] || name);
    this.setSheetState('half');
  },

  // Switch bottom sheet content tab
  switchSheetTab(name) {
    document.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sheet-content').forEach(p => p.classList.remove('active'));
    const tab = document.querySelector(`.sheet-tab[data-sheet="${name}"]`);
    if (tab) tab.classList.add('active');
    const idMap = { route: 'sheet-route', customers: 'tab-customers', plan: 'tab-route', visit: 'tab-visit' };
    const pane = document.getElementById(idMap[name] || 'sheet-route');
    if (pane) pane.classList.add('active');
    if (name !== 'route') this.setSheetState('half');
  },

  // Render today's visits in the route pane
  renderTodayRoute() {
    const container = document.getElementById('today-visits');
    if (!container) return;

    const customers = Storage.getActiveCustomers();
    const routeIds = Storage.getRoute();
    const routeCusts = routeIds.map(id => customers.find(c => c.id === id)).filter(Boolean);

    if (!routeCusts.length) {
      container.innerHTML = '<p class="empty-state">ไม่มีเส้นทางวันนี้ — ไปที่ <strong>วางแผน</strong> เพื่อสร้างเส้นทาง</p>';
      this._updateRouteProgress(null);
      return;
    }

    // Use calculated result order if available
    const result = Route.currentResult;
    let ordered = routeCusts;
    if (result && result.stops && result.stops.length > 0) {
      ordered = result.stops;
    }

    // Check visits for pending/completed status
    const visits = Storage.getVisits();
    const visitedCifs = new Set(Object.keys(visits));
    const pending = ordered.filter(c => !visitedCifs.has(c.cif || c.id));

    let html = '<div class="visits-list">';
    ordered.forEach((c, i) => html += this._visitCard(c, i + 1));
    html += '</div>';

    container.innerHTML = html;

    // Click on visit card → open visit modal
    container.querySelectorAll('.visit-card').forEach(card => {
      card.addEventListener('click', () => {
        const cif = card.dataset.cif;
        const id = card.dataset.id;
        if (window.Visit && typeof Visit.openForCustomer === 'function') {
          Visit.openForCustomer(cif || id);
        }
      });
    });

    // Update header progress
    const done = ordered.length - pending.length;
    if (result && result.distance) {
      document.getElementById('route-progress').textContent = `${done}/${ordered.length} · ${Utils.formatKm(result.distance)}`;
    } else {
      document.getElementById('route-progress').textContent = `${done}/${ordered.length} ✅`;
    }
  },

  // Render a single visit card (used by renderTodayRoute)
  _visitCard(c, order) {
    const name = c.name || c.customerName || 'ไม่ระบุชื่อ';
    const branch = c.branch || '';
    // Check if visited
    const visits = Storage.getVisits();
    const visited = visits[c.cif || c.id];
    const debtType = c.debtType || '';
    let badge = '';
    if (visited) {
      badge = '<span class="visit-badge" style="background:#d1fae5;color:#065f46">✅ เยี่ยมแล้ว</span>';
    } else if (debtType === 'overdue') {
      badge = '<span class="visit-badge badge-overdue">⚠️ ค้าง</span>';
    } else if (debtType === 'current') {
      badge = '<span class="visit-badge badge-current">📅 ถึงกำหนด</span>';
    }
    const lat = c.lat || c.latitude || '';
    const lng = c.lng || c.longitude || '';
    const dist = (lat && lng) ? '' : '';
    return `<div class="visit-card" data-cif="${this.escapeHTML(c.cif || '')}" data-id="${this.escapeHTML(c.id || '')}">
      <div class="visit-order">${order}</div>
      <div class="visit-info">
        <div class="visit-name">${this.escapeHTML(name)}</div>
        <div class="visit-branch">${this.escapeHTML(branch)}</div>
      </div>
      <div class="visit-meta">
        ${badge}
      </div>
    </div>`;
  },

  // Update route progress badge in overlay header
  _updateRouteProgress(stats) {
    const el = document.getElementById('route-progress');
    if (!el) return;
    if (!stats) { el.textContent = ''; return; }
    el.textContent = `${stats.completed || 0}/${stats.total} ✅`;
  },

  // Open add customer modal
  openAddCustomerModal() {
    document.getElementById('add-customer-modal').classList.remove('hidden');
    document.getElementById('add-customer-form').dataset.editId = '';
    document.getElementById('add-customer-form').reset();
    this._resetPhotoPreview();
    // Reset DB search
    const dbInput = document.getElementById('db-search-input');
    const dbResults = document.getElementById('db-search-results');
    const dbInfo = document.getElementById('db-filled-info');
    if (dbInput) dbInput.value = '';
    if (dbResults) { dbResults.innerHTML = ''; dbResults.classList.remove('active'); }
    if (dbInfo) { dbInfo.innerHTML = ''; dbInfo.classList.remove('active'); }
    // Init mini-map after modal visible
    setTimeout(() => this.initMiniMap(), 100);
  },

  // ===== Photo upload (capture/file → resize → base64) =====
  _resetPhotoPreview() {
    const preview = document.getElementById('photo-preview');
    const dataInput = document.getElementById('photo-data');
    const removeBtn = document.getElementById('btn-remove-photo');
    if (preview) preview.innerHTML = '<div class="photo-empty">📷 ยังไม่มีรูป — แตะเพื่อเลือก/ถ่าย</div>';
    if (dataInput) dataInput.value = '';
    if (removeBtn) removeBtn.classList.add('hidden');
  },

  _showPhotoPreview(dataUrl) {
    const preview = document.getElementById('photo-preview');
    const dataInput = document.getElementById('photo-data');
    const removeBtn = document.getElementById('btn-remove-photo');
    if (preview) {
      preview.innerHTML = `<img src="${dataUrl}" alt="customer photo" class="photo-img">`;
    }
    if (dataInput) dataInput.value = dataUrl;
    if (removeBtn) removeBtn.classList.remove('hidden');
  },

  // Resize image to max 800px, JPEG quality 0.7 → base64 dataURL
  async _resizeImage(file, maxSize = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = Math.round(height * (maxSize / width));
              width = maxSize;
            } else {
              width = Math.round(width * (maxSize / height));
              height = maxSize;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          // Always output JPEG to keep size small
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  async handlePhotoUpload(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      Utils.toast('กรุณาเลือกไฟล์รูปภาพ', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      Utils.toast('รูปใหญ่เกิน 10MB — กรุณาเลือกรูปอื่น', 'error');
      return;
    }
    Utils.toast('📷 กำลังย่อรูป...');
    try {
      const dataUrl = await this._resizeImage(file, 800, 0.7);
      const sizeKB = Math.round(dataUrl.length * 0.75 / 1024);
      this._showPhotoPreview(dataUrl);
      Utils.toast(`✅ ย่อรูปเสร็จ (~${sizeKB} KB)`);
    } catch (err) {
      Utils.toast('ไม่สามารถประมวลผลรูปได้: ' + err.message, 'error');
    }
  },

  removePhoto() {
    this._resetPhotoPreview();
    const fileInput = document.getElementById('photo-input');
    if (fileInput) fileInput.value = '';
    Utils.toast('🗑️ ลบรูปแล้ว');
  },

  // ===== Help modal — explain how to use the app =====
  openHelp() {
    document.getElementById('help-modal').classList.remove('hidden');
  },
  closeHelp() {
    document.getElementById('help-modal').classList.add('hidden');
  },

  // ===== Customer DB Search (auto-fill from imported data) =====
  _initDBSearch() {
    const input = document.getElementById('db-search-input');
    const results = document.getElementById('db-search-results');
    if (!input || !results) return;

    let debounceTimer = null;
    let highlightIdx = -1;

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const q = input.value.trim();
        if (q.length < 2) {
          results.classList.remove('active');
          results.innerHTML = '';
          return;
        }
        const matches = CustomerDB.search(q, 15);
        if (matches.length === 0) {
          results.innerHTML = '<div class="db-search-hint">❌ ไม่พบข้อมูล</div>';
          results.classList.add('active');
          return;
        }
        highlightIdx = -1;
        results.innerHTML = matches.map((r, i) => `
          <div class="db-search-item" data-idx="${i}" data-cif="${r.cif}">
            <div class="db-name">${this._esc(r.name)}</div>
            <div class="db-meta">
              <span>CIF: ${r.cif}</span>
              ${r.customer_class ? `<span class="badge badge-blue">${r.customer_class}</span>` : ''}
              ${r.potential ? `<span class="badge ${r.potential === 'แดง' ? 'badge-red' : r.potential === 'เหลือง' ? 'badge-yellow' : 'badge-green'}">${r.potential}</span>` : ''}
              ${r.zone ? `<span class="badge badge-gray">เขต ${r.zone}</span>` : ''}
              ${r.tambon ? `<span>${r.tambon}</span>` : ''}
              ${r.lat ? `<span class="badge badge-green">📍</span>` : ''}
            </div>
          </div>
        `).join('');
        results.classList.add('active');

        // Click handlers
        results.querySelectorAll('.db-search-item').forEach(el => {
          el.addEventListener('click', () => {
            const cif = el.dataset.cif;
            const rec = CustomerDB.getByCif(cif);
            if (rec) this._fillFromDB(rec);
          });
        });
      }, 200);
    });

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
      const items = results.querySelectorAll('.db-search-item');
      if (!items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightIdx = Math.min(highlightIdx + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle('highlighted', i === highlightIdx));
        items[highlightIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightIdx = Math.max(highlightIdx - 1, 0);
        items.forEach((el, i) => el.classList.toggle('highlighted', i === highlightIdx));
        items[highlightIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && highlightIdx >= 0) {
        e.preventDefault();
        const cif = items[highlightIdx]?.dataset.cif;
        const rec = cif && CustomerDB.getByCif(cif);
        if (rec) this._fillFromDB(rec);
      } else if (e.key === 'Escape') {
        results.classList.remove('active');
      }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.db-search-container')) {
        results.classList.remove('active');
      }
    });
  },

  _fillFromDB(rec) {
    // CLOSE search results FIRST — before any form changes, so even if
    // something below throws, the dropdown is already gone.
    const results = document.getElementById('db-search-results');
    if (results) {
      results.classList.remove('active');
      results.innerHTML = '';          // clear DOM for safety
    }

    // Set search input to show selected customer name
    const searchInput = document.getElementById('db-search-input');
    if (searchInput) {
      searchInput.value = `${rec.name} (CIF: ${rec.cif})`;
    }

    const form = document.getElementById('add-customer-form');
    if (!form) return;

    try {
      // Auto-fill form fields
      if (rec.cif) form.elements.cif.value = rec.cif;
      if (rec.name) form.elements.name.value = rec.name;
      if (rec.phone) form.elements.phone.value = rec.phone.replace(/\s/g, '');
      // Build full address
      const addr = CustomerDB.fullAddress(rec);
      if (addr) form.elements.address.value = addr;

      // Auto-fill coordinates from DB (Nominatim geocoded)
      if (rec.lat && rec.lng) {
        document.getElementById('new-lat').value = rec.lat;
        document.getElementById('new-lng').value = rec.lng;
        // Update mini-map with the location
        setTimeout(() => this.initMiniMap(rec.lat, rec.lng), 150);
      }
    } catch (e) {
      console.warn('[App] _fillFromDB field-fill error:', e);
    }

    // Show filled info
    const info = document.getElementById('db-filled-info');
    if (info) {
      const badges = [];
      if (rec.zone) badges.push(`เขต ${rec.zone}`);
      if (rec.customer_class) badges.push(`ชั้น ${rec.customer_class}`);
      if (rec.potential) badges.push(`ศักยภาพ ${rec.potential}`);
      if (rec.dob) badges.push(`เกิด ${rec.dob}`);
      if (rec.lat) badges.push(`📍 มีพิกัดแล้ว`);
      info.innerHTML = `✅ <strong>${this._esc(rec.name)}</strong> · CIF ${rec.cif}${badges.length ? ' · ' + badges.join(' · ') : ''}`;
      info.classList.add('active');
    }

    Utils.toast('📋 กรอกข้อมูลอัตโนมัติจากฐานข้อมูลแล้ว' + (rec.lat ? ' (มีพิกัด 📍)' : ''));
  },

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  },

  // ===== Confirm Delete (custom modal with customer details) =====
  confirmDelete(customer) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirm-delete-modal');
      const nameEl = document.getElementById('confirm-del-name');
      const detailsEl = document.getElementById('confirm-del-details');
      const photoEl = document.getElementById('confirm-del-photo');
      const btnYes = document.getElementById('btn-confirm-del-yes');
      const btnNo = document.getElementById('btn-confirm-del-no');
      const btnX = document.getElementById('close-confirm-del');

      nameEl.textContent = customer.name || '(ไม่มีชื่อ)';

      // Build details line
      const details = [];
      if (customer.cif) details.push('CIF: ' + customer.cif);
      if (customer.phone) details.push('📞 ' + customer.phone);
      if (customer.nickname) details.push('🏷️ ' + customer.nickname);
      detailsEl.textContent = details.length ? details.join(' · ') : '—';

      // Show photo if exists
      if (customer.photo) {
        photoEl.innerHTML = `<img src="${customer.photo}" alt="photo" class="confirm-del-photo-img">`;
        photoEl.style.display = 'block';
      } else {
        photoEl.innerHTML = '';
        photoEl.style.display = 'none';
      }

      // Show modal
      modal.classList.remove('hidden');

      // Cleanup function
      const cleanup = (result) => {
        modal.classList.add('hidden');
        btnYes.removeEventListener('click', yesHandler);
        btnNo.removeEventListener('click', noHandler);
        btnX.removeEventListener('click', noHandler);
        modal.removeEventListener('click', backdropHandler);
        resolve(result);
      };
      const yesHandler = () => cleanup(true);
      const noHandler = () => cleanup(false);
      const backdropHandler = (e) => { if (e.target.id === 'confirm-delete-modal') cleanup(false); };

      btnYes.addEventListener('click', yesHandler);
      btnNo.addEventListener('click', noHandler);
      btnX.addEventListener('click', noHandler);
      modal.addEventListener('click', backdropHandler);
    });
  },

  // Init mini-map in add customer modal
  initMiniMap(prefillLat, prefillLng) {
    const container = document.getElementById('mini-map');
    if (!container) return;
    // Remove existing if any
    if (this._miniMap) {
      this._miniMap.remove();
      this._miniMap = null;
      this._miniMarker = null;
    }
    // Default to office location if no prefilled coords
    const lat = prefillLat ?? OFFICE_LOCATION.lat;
    const lng = prefillLng ?? OFFICE_LOCATION.lng;
    this._miniMap = L.map('mini-map', {
      zoomControl: true,
      // Mobile fix: explicit touch gestures
      tap: true,
      bounceAtZoomLimits: false,
      // iOS Safari sometimes needs this
      worldCopyJump: false,
      // Use CSS-driven sizing (important for invalidateSize)
      preferCanvas: false,
    }).setView([lat, lng], 14);

    // 2 base layers: roadmap (default) + satellite
    this._miniBaseLayers = {
      roadmap: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM',
        maxZoom: 19,
      }),
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri',
        maxZoom: 19,
      }),
    };
    this._miniBaseLayers.roadmap.addTo(this._miniMap);
    this._miniCurrentLayer = 'roadmap';
    this._addMiniLayerToggle();

    // Click to set location
    this._miniMap.on('click', (e) => {
      this.setMiniMapLocation(e.latlng.lat, e.latlng.lng);
    });

    // Mobile: disable text selection while dragging
    this._miniMap.getContainer().style.webkitUserSelect = 'none';
    this._miniMap.getContainer().style.userSelect = 'none';

    // If prefilled, add marker immediately
    if (prefillLat !== undefined && prefillLng !== undefined) {
      this.setMiniMapLocation(prefillLat, prefillLng);
    }

    // Force size recalc (modal may have just shown)
    setTimeout(() => this._miniMap.invalidateSize(), 200);
  },

  // ===== Mini-map layer toggle (roadmap ↔ satellite) =====
  _addMiniLayerToggle() {
    const LayerToggle = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'layer-toggle layer-toggle-mini leaflet-bar');
        div.innerHTML = `
          <button class="layer-btn active" data-layer="roadmap" title="แผนที่ถนน">🗺️</button>
          <button class="layer-btn" data-layer="satellite" title="ภาพดาวเทียม">🛰️</button>
        `;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        div.querySelectorAll('.layer-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            L.DomEvent.stop(e);
            App.switchMiniBaseLayer(btn.dataset.layer);
          });
        });
        return div;
      },
    });
    new LayerToggle({ position: 'topright' }).addTo(this._miniMap);
  },

  switchMiniBaseLayer(layerName) {
    if (!this._miniBaseLayers[layerName] || layerName === this._miniCurrentLayer) return;
    this._miniMap.removeLayer(this._miniBaseLayers[this._miniCurrentLayer]);
    this._miniBaseLayers[layerName].addTo(this._miniMap);
    this._miniCurrentLayer = layerName;
    const buttons = document.querySelectorAll('.layer-toggle-mini .layer-btn');
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layer === layerName);
    });
  },

  // Set location on mini-map (add/move marker)
  setMiniMapLocation(lat, lng) {
    document.getElementById('new-lat').value = lat.toFixed(6);
    document.getElementById('new-lng').value = lng.toFixed(6);
    if (this._miniMarker) {
      this._miniMarker.setLatLng([lat, lng]);
    } else {
      this._miniMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: '<div class="mini-map-pin">📍</div>',
          iconSize: [32, 32],
          iconAnchor: [16, 32],
        }),
      }).addTo(this._miniMap);
    }
    this._miniMap.panTo([lat, lng]);
  },

  // Pick location on main map (close modal temporarily)
  pickOnMainMap() {
    // Save form data
    const form = document.getElementById('add-customer-form');
    const draft = Object.fromEntries(new FormData(form));
    sessionStorage.setItem('add-customer-draft', JSON.stringify(draft));
    this.closeAddCustomerModal();
    // Switch to map tab
    this.switchTab('map');
    Utils.toast('🗺️ คลิกบนแผนที่หลักเพื่อเลือกตำแหน่ง → กด "กลับมาเพิ่มลูกค้า"');
    // Set flag to re-open modal on next map click
    window._pickMode = true;
  },

  // Restore draft and re-open modal
  restoreAddCustomerModal() {
    const draft = sessionStorage.getItem('add-customer-draft');
    if (!draft) {
      this.openAddCustomerModal();
      return;
    }
    const data = JSON.parse(draft);
    const form = document.getElementById('add-customer-form');
    Object.entries(data).forEach(([k, v]) => {
      const el = form.elements[k];
      if (el) el.value = v;
    });
    document.getElementById('add-customer-modal').classList.remove('hidden');
    sessionStorage.removeItem('add-customer-draft');
    setTimeout(() => {
      const lat = parseFloat(data.lat);
      const lng = parseFloat(data.lng);
      if (!isNaN(lat) && !isNaN(lng)) {
        this.initMiniMap(lat, lng);
      } else {
        this.initMiniMap();
      }
    }, 100);
  },

  closeAddCustomerModal() {
    document.getElementById('add-customer-modal').classList.add('hidden');
  },

  // Save customer (add or edit) — Server-first: await sync, show real result
  async saveCustomer(form) {
    const data = Object.fromEntries(new FormData(form));
    const editId = form.dataset.editId;
    let savedCustomer;
    let syncResult;
    if (editId) {
      syncResult = await Storage.updateCustomer(editId, data);
      savedCustomer = Storage.getCustomers().find(c => c.id === editId);
      if (syncResult.synced) {
        Utils.toast('✅ แก้ไขลูกค้าแล้ว · บันทึกเข้าเซิร์ฟเวอร์เรียบร้อย');
      } else {
        Utils.toast('⚠️ แก้ไขแล้วแต่ sync ไม่สำเร็จ (ข้อมูลอยู่แค่ในเครื่องนี้) · กด 🔄 เพื่อลองใหม่', 'error');
      }
    } else {
      syncResult = await Storage.addCustomer(data);
      savedCustomer = syncResult.customer;
      if (syncResult.synced) {
        Utils.toast('✅ เพิ่มลูกค้าแล้ว · บันทึกเข้าเซิร์ฟเวอร์เรียบร้อย');
      } else {
        Utils.toast('⚠️ เพิ่มแล้วแต่ sync ไม่สำเร็จ (ข้อมูลอยู่แค่ในเครื่องนี้) · กด 🔄 เพื่อลองใหม่', 'error');
      }
    }
    this.closeAddCustomerModal();
    // Re-render markers WITHOUT fitBounds — preserve whatever view the user
    // was on. This stops the map from yanking away after every save.
    Customers.renderAll();
    // Gentle flyTo the saved customer so the user can see where it landed
    // without a jarring full-bounds reset.
    if (savedCustomer && savedCustomer.lat && savedCustomer.lng && Customers.map) {
      const newLatLng = L.latLng(parseFloat(savedCustomer.lat), parseFloat(savedCustomer.lng));
      const currentCenter = Customers.map.getCenter();
      // Only fly if the new pin is off-screen or way off-center
      const isVisible = Customers.map.getBounds().contains(newLatLng);
      if (!isVisible || currentCenter.distanceTo(newLatLng) > 500) {
        Customers.map.flyTo(newLatLng, Math.max(Customers.map.getZoom(), 15), { duration: 0.6 });
      }
    }
  },

  // Use GPS
  useGPS(forForm = false) {
    if (!navigator.geolocation) {
      Utils.toast('เบราว์เซอร์ไม่รองรับ GPS', 'error');
      return;
    }

    // ===== Form mode: just set lat/lng inputs (no map pin needed) =====
    if (forForm) {
      Utils.toast('📍 กำลังค้นหาตำแหน่ง...');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          window._lastGPS = { lat, lng };
          document.getElementById('new-lat').value = lat.toFixed(6);
          document.getElementById('new-lng').value = lng.toFixed(6);
          Utils.toast('📍 ใช้ตำแหน่งปัจจุบันแล้ว');
        },
        (err) => {
          Utils.toast('ไม่สามารถเข้าถึง GPS: ' + err.message, 'error');
        },
        { enableHighAccuracy: true, timeout: 10000 },
      );
      return;
    }

    // ===== Main-map mode: Google-Maps style "My Location" =====
    // Toggle: first click starts tracking, click again stops it
    if (this._gpsWatchId !== null) {
      this._stopGPS();
      return;
    }

    if (!Customers.map) {
      Utils.toast('แผนที่ยังไม่พร้อม', 'error');
      return;
    }

    Utils.toast('📍 กำลังค้นหาตำแหน่ง...');

    // Initial fix to position the camera quickly
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this._updateGPSMarker(pos.coords);
        Customers.map.setView([pos.coords.latitude, pos.coords.longitude], 16);
      },
      (err) => {
        // ignore — watchPosition will keep trying
        console.warn('GPS initial fix failed:', err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );

    // Live tracking — pin follows user like Google Maps
    this._gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => this._updateGPSMarker(pos.coords),
      (err) => Utils.toast('GPS ผิดพลาด: ' + err.message, 'error'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );

    // Visual feedback: pulse the FAB while tracking
    const fab = document.getElementById('fab-my-location');
    if (fab) fab.classList.add('tracking');
  },

  // Update or create the single GPS pin + accuracy circle (Google-Maps style)
  _updateGPSMarker(coords) {
    const lat = coords.latitude;
    const lng = coords.longitude;
    const acc = coords.accuracy || 0; // meters

    window._lastGPS = { lat, lng, accuracy: acc };

    if (!Customers.map) return;

    if (!this._gpsMarker) {
      // First time — create pin + circle
      this._gpsMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: '<div class="gps-dot">'
              + '<div class="gps-arrow-wrap"><div class="gps-arrow"></div></div>'
              + '<div class="gps-dot-inner"></div>'
              + '</div>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        zIndexOffset: 1000,
        interactive: false,
      }).addTo(Customers.map);
      this._gpsCircle = L.circle([lat, lng], {
        radius: acc,
        color: '#4285F4',
        fillColor: '#4285F4',
        fillOpacity: 0.15,
        weight: 1,
        interactive: false,
      }).addTo(Customers.map);
    } else {
      // Subsequent updates — move pin + resize circle
      this._gpsMarker.setLatLng([lat, lng]);
      this._gpsCircle.setLatLng([lat, lng]);
      if (acc > 0) this._gpsCircle.setRadius(acc);
    }

    // Heading arrow (Google-Maps style). Only visible when device reports
    // a real heading (mobile w/ compass). On desktop coords.heading is null.
    const el = this._gpsMarker.getElement();
    if (el) {
      const wrap = el.querySelector('.gps-arrow-wrap');
      const hasHeading = coords.heading !== null && coords.heading !== undefined
                         && !isNaN(coords.heading);
      if (wrap) {
        if (hasHeading) {
          wrap.style.transform = `rotate(${coords.heading}deg)`;
          el.classList.add('has-heading');
        } else {
          el.classList.remove('has-heading');
        }
      }
    }

    // First-fix only: zoom in. Don't auto-pan on every watch tick —
    // that would yank the map while the user is exploring.
    if (this._gpsFirstFix === undefined) {
      this._gpsFirstFix = false;
      Customers.map.setView([lat, lng], 16);
    }
  },

  // Stop tracking + clean up pin + circle
  _stopGPS() {
    if (this._gpsWatchId !== null && this._gpsWatchId !== undefined) {
      navigator.geolocation.clearWatch(this._gpsWatchId);
    }
    this._gpsWatchId = null;
    this._gpsFirstFix = undefined;

    if (this._gpsMarker) { Customers.map.removeLayer(this._gpsMarker); this._gpsMarker = null; }
    if (this._gpsCircle) { Customers.map.removeLayer(this._gpsCircle); this._gpsCircle = null; }

    const fab = document.getElementById('fab-my-location');
    if (fab) fab.classList.remove('tracking');
    Utils.toast('ปิดติดตาม GPS แล้ว');
  },

  // Update route tab UI — render selected chips with drag&drop + ▲▼ reorder
  updateRouteUI() {
    const route = Storage.getRoute();
    const customers = Storage.getActiveCustomers();
    const routeCustomers = route.map(id => customers.find(c => c.id === id)).filter(Boolean);
    const el = document.getElementById('route-chips');
    const countEl = document.getElementById('route-count');
    const btnCalculate = document.getElementById('btn-calculate-route');
    const btnOptimize = document.getElementById('btn-optimize-route');

    if (countEl) countEl.textContent = routeCustomers.length;

    if (routeCustomers.length === 0) {
      if (el) el.innerHTML = '<p class="empty-state">เลือกลูกค้าจากช่องค้นหาด้านบน หรือกด "เพิ่มในเส้นทางวันนี้" จากแท็บลูกค้า</p>';
      if (btnCalculate) btnCalculate.disabled = true;
      if (btnOptimize) btnOptimize.disabled = true;
      return;
    }

    if (el) {
      el.innerHTML = routeCustomers.map((c, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === routeCustomers.length - 1;
        return `
          <span class="route-chip" draggable="true" data-id="${this.escapeHTML(c.id)}" data-idx="${idx}"
                ondragstart="Route.dragStart(event, ${idx})"
                ondragover="Route.dragOver(event)"
                ondrop="Route.drop(event, ${idx})"
                ondragend="Route.dragEnd(event)">
            <span class="route-chip-num">${idx + 1}</span>
            <span class="route-chip-cif">${this.escapeHTML(c.cif || '-')}</span>
            ${this.escapeHTML(c.name)}
            <span class="route-chip-order">
              <button onclick="Route.move(${idx}, -1)" ${isFirst ? 'disabled' : ''} title="เลื่อนขึ้น">▲</button>
              <button onclick="Route.move(${idx}, 1)" ${isLast ? 'disabled' : ''} title="เลื่อนลง">▼</button>
            </span>
            <button class="route-chip-remove" onclick="Route.toggle('${this.escapeHTML(c.id)}')" title="เอาออก">×</button>
          </span>
        `;
      }).join('');
    }

    if (btnCalculate) btnCalculate.disabled = false;
    if (btnOptimize) btnOptimize.disabled = false;
    this.renderTodayRoute();
  },

  // Calculate route
  // useTSP = false (default) = use the manual order from chips
  // useTSP = true = call TSP.plan() to auto-optimize (opt-in)
  async calculateRoute(useTSP = false) {
    const route = Storage.getRoute();
    if (route.length === 0) return;
    const start = Route.getStartCoords();
    const end = Route.getEndCoords();

    // Manual order (default) or TSP optimize (opt-in)
    const ordered = useTSP ? TSP.plan(start, route, end) : route;

    // Get real route from OSRM
    const result = await Route.calculate(start, ordered, end);
    if (result) {
      Route.showResult(result);
      this.switchTab('map'); // show route on map
      const routeType = result.isOpenPath ? ' (เปิด)' : '';
      const tspNote = useTSP ? ' (TSP)' : '';
      Utils.toast(`✅ เส้นทาง${routeType}${tspNote}พร้อม: ${Utils.formatKm(result.distance)} กม. / ${result.fuel ? Utils.formatBaht(result.fuel.baht) : '?'} บาท`);
    }
  },

  // ===== Admin: Show/hide admin button based on role =====
  updateAdminUI() {
    const btn = document.getElementById('admin-users-btn');
    if (btn) btn.style.display = Auth.isAdmin() ? '' : 'none';
  },

  // ===== Admin: Open management modal =====
  async openAdminUsers() {
    const modal = document.getElementById('admin-users-modal');
    modal.classList.remove('hidden');

    // Tab switching
    modal.querySelectorAll('.admin-tab').forEach(tab => {
      tab.onclick = () => {
        modal.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        modal.querySelectorAll('.admin-tab-pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('admin-tab-' + tab.dataset.adminTab).classList.add('active');
      };
    });

    // Load branches into select (always refresh)
    const branchSelect = document.getElementById('new-branch');
    branchSelect.innerHTML = '<option value="">— เลือกสาขา —</option>';
    try {
      const res = await API.get('/api/branches');
      if (res.success && res.branches) {
        window._adminBranches = res.branches;
        res.branches.forEach(b => {
          const opt = document.createElement('option');
          opt.value = b.code;
          opt.textContent = b.name;
          branchSelect.appendChild(opt);
        });
      }
    } catch (e) {
      console.warn('Failed to load branches:', e);
    }

    // Load data
    await this.loadAdminUsers();
    await this.loadAdminBranches();

    // Close handler
    document.getElementById('close-admin-users').onclick = () => modal.classList.add('hidden');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };

    // Add user form
    document.getElementById('admin-add-user-form').onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('admin-user-error');
      errEl.textContent = '';
      const username = document.getElementById('new-username').value.trim();
      const password = document.getElementById('new-password').value;
      const displayName = document.getElementById('new-display-name').value.trim();
      const branch = document.getElementById('new-branch').value;

      try {
        const res = await API.post('/api/admin/users', { username, password, displayName, branch });
        if (res.success) {
          Utils.toast(`✅ สร้างผู้ใช้ "${displayName}" สำเร็จ`);
          document.getElementById('admin-add-user-form').reset();
          await this.loadAdminUsers();
        }
      } catch (err) {
        errEl.textContent = err.message || 'สร้างผู้ใช้ไม่สำเร็จ';
      }
    };

    // Bulk import customers from static DB
    const importBtn = document.getElementById('btn-import-static-db');
    if (importBtn) {
      importBtn.onclick = async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('import-static-error');
        const successEl = document.getElementById('import-static-success');
        errEl.style.display = 'none';
        successEl.style.display = 'none';
        errEl.textContent = '';
        importBtn.disabled = true;
        const originalText = importBtn.textContent;
        importBtn.textContent = '⏳ กำลังนำเข้า...';
        try {
          if (typeof Storage === 'undefined' || !Storage.importFromStaticDB) {
            throw new Error('ฟังก์ชันนำเข้ายังโหลดไม่เสร็จ');
          }
          const result = await Storage.importFromStaticDB();
          successEl.textContent = `✅ นำเข้า ${result.imported} รายการ · ข้าม ${result.skipped} ที่ซ้ำ · ทั้งหมด ${result.validGPS} รายการมีพิกัด`;
          successEl.style.display = 'block';
          Utils.toast(`📥 นำเข้า ${result.imported} ลูกค้าแล้ว`);
          // Re-render map to show new markers
          if (typeof Customers !== 'undefined' && Customers.renderAll) {
            setTimeout(() => Customers.renderAll(), 500);
          }
        } catch (err) {
          errEl.textContent = err.message || 'นำเข้าไม่สำเร็จ';
          errEl.style.display = 'block';
          Utils.toast('❌ นำเข้าไม่สำเร็จ', 'error');
        } finally {
          importBtn.disabled = false;
          importBtn.textContent = originalText;
        }
      };
    }

    // Add branch form
    document.getElementById('admin-add-branch-form').onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('admin-branch-error');
      errEl.textContent = '';
      const code = document.getElementById('new-branch-code').value.trim().toUpperCase();
      const name = document.getElementById('new-branch-name').value.trim();

      try {
        const res = await API.post('/api/admin/branches', { code, name });
        if (res.success) {
          Utils.toast(`✅ เพิ่มสาขา "${name}" สำเร็จ`);
          document.getElementById('admin-add-branch-form').reset();
          await this.loadAdminBranches();
          // Refresh branch selects
          const branchSelect = document.getElementById('new-branch');
          const opt = document.createElement('option');
          opt.value = code;
          opt.textContent = name;
          branchSelect.appendChild(opt);
        }
      } catch (err) {
        errEl.textContent = err.message || 'เพิ่มสาขาไม่สำเร็จ';
      }
    };

    // Change PIN form
    document.getElementById('admin-change-pin-form').onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('admin-pin-error');
      const successEl = document.getElementById('admin-pin-success');
      errEl.textContent = '';
      successEl.style.display = 'none';

      const currentPin = document.getElementById('current-pin').value;
      const newPin = document.getElementById('new-pin').value;
      const confirmPin = document.getElementById('confirm-pin').value;

      if (newPin !== confirmPin) {
        errEl.textContent = 'PIN ใหม่ไม่ตรงกัน';
        return;
      }
      if (newPin.length < 4) {
        errEl.textContent = 'PIN ใหม่ต้องมีอย่างน้อย 4 หลัก';
        return;
      }

      try {
        const res = await API.post('/api/admin/pin', { currentPin, newPin });
        if (res.success) {
          Utils.toast('🔐 เปลี่ยน PIN สำเร็จ');
          successEl.textContent = '✅ เปลี่ยน PIN สำเร็จแล้ว';
          successEl.style.display = 'block';
          document.getElementById('admin-change-pin-form').reset();
        }
      } catch (err) {
        errEl.textContent = err.message || 'เปลี่ยน PIN ไม่สำเร็จ';
      }
    };
  },

  // ===== Admin: Load user list =====
  async loadAdminUsers() {
    const listEl = document.getElementById('admin-users-list');
    try {
      const res = await API.get('/api/admin/users');
      if (!res.success || !res.users.length) {
        listEl.innerHTML = '<p class="text-muted">ยังไม่มีผู้ใช้ — เพิ่มคนแรกด้านล่างเลย</p>';
        return;
      }
      listEl.innerHTML = res.users.map(u => `
        <div class="admin-user-card">
          <div class="admin-user-info">
            <span class="admin-user-name">${this.escapeHTML(u.displayName)}</span>
            <span class="admin-user-meta">${this.escapeHTML(u.username)} · ${this.escapeHTML(u.branchName)} · ${u.role === 'admin' ? '👑 Admin' : '👤 User'}</span>
          </div>
          <button class="btn-danger-sm" onclick="App.deleteAdminUser('${u.id}', '${this.escapeHTML(u.displayName)}')">🗑️</button>
        </div>
      `).join('');
    } catch (err) {
      listEl.innerHTML = `<p class="login-error">โหลดรายชื่อไม่สำเร็จ: ${err.message}</p>`;
    }
  },

  // ===== Admin: Delete user =====
  async deleteAdminUser(id, name) {
    if (!confirm(`ลบผู้ใช้ "${name}"?`)) return;
    try {
      const token = Auth.getToken();
      const res = await fetch(API.baseUrl() + '/api/admin/users', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) {
        Utils.toast(`🗑️ ลบผู้ใช้ "${name}" แล้ว`);
        await this.loadAdminUsers();
      } else {
        Utils.toast(data.error || 'ลบไม่สำเร็จ', 'error');
      }
    } catch (err) {
      Utils.toast('ลบไม่สำเร็จ: ' + err.message, 'error');
    }
  },

  // ===== Change Password (self-service for all users) =====
  openChangePassword() {
    const modal = document.getElementById('change-password-modal');
    document.getElementById('change-password-form').reset();
    document.getElementById('cp-error').textContent = '';
    document.getElementById('cp-success').style.display = 'none';
    modal.classList.remove('hidden');
  },

  async submitChangePassword() {
    const errEl = document.getElementById('cp-error');
    const successEl = document.getElementById('cp-success');
    errEl.textContent = '';
    successEl.style.display = 'none';

    const currentPassword = document.getElementById('cp-current').value;
    const newPassword = document.getElementById('cp-new').value;
    const confirmPassword = document.getElementById('cp-confirm').value;

    if (newPassword !== confirmPassword) {
      errEl.textContent = 'รหัสผ่านใหม่ไม่ตรงกัน';
      return;
    }
    if (newPassword.length < 4) {
      errEl.textContent = 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร';
      return;
    }

    const btn = document.getElementById('btn-change-password');
    btn.disabled = true;
    btn.textContent = 'กำลังเปลี่ยน...';

    try {
      const res = await API.post('/api/change-password', { currentPassword, newPassword });
      if (res.success) {
        successEl.textContent = 'เปลี่ยนรหัสผ่านสำเร็จ ✅';
        successEl.style.display = 'block';
        document.getElementById('cp-current').value = '';
        document.getElementById('cp-new').value = '';
        document.getElementById('cp-confirm').value = '';
        Utils.toast('🔑 เปลี่ยนรหัสผ่านสำเร็จ');
      } else {
        errEl.textContent = res.error || 'เปลี่ยนรหัสไม่สำเร็จ';
      }
    } catch (err) {
      errEl.textContent = err.message || 'เปลี่ยนรหัสไม่สำเร็จ';
    } finally {
      btn.disabled = false;
      btn.textContent = 'เปลี่ยนรหัสผ่าน';
    }
  },

  // ===== Admin: Load branch list =====
  async loadAdminBranches() {
    const listEl = document.getElementById('admin-branches-list');
    try {
      const res = await API.get('/api/admin/branches');
      if (!res.success || !res.branches.length) {
        listEl.innerHTML = '<p class="text-muted">ยังไม่มีสาขา</p>';
        return;
      }
      listEl.innerHTML = res.branches.map(b => `
        <div class="admin-user-card">
          <div class="admin-user-info">
            <span class="admin-user-name">${this.escapeHTML(b.name)}</span>
            <span class="admin-user-meta">${this.escapeHTML(b.code)}</span>
          </div>
          <button class="btn-danger-sm" onclick="App.deleteAdminBranch('${this.escapeHTML(b.code)}', '${this.escapeHTML(b.name)}')">🗑️</button>
        </div>
      `).join('');
    } catch (err) {
      listEl.innerHTML = `<p class="login-error">โหลดสาขาไม่สำเร็จ: ${err.message}</p>`;
    }
  },

  // ===== Admin: Delete branch =====
  async deleteAdminBranch(code, name) {
    if (!confirm(`ลบสาขา "${name}" (${code})?`)) return;
    try {
      const token = Auth.getToken();
      const res = await fetch(API.baseUrl() + '/api/admin/branches', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.success) {
        Utils.toast(`🗑️ ลบสาขา "${name}" แล้ว`);
        await this.loadAdminBranches();
        // Remove from user form select
        const sel = document.getElementById('new-branch');
        const opt = sel.querySelector(`option[value="${code}"]`);
        if (opt) opt.remove();
      } else {
        Utils.toast(data.error || 'ลบไม่สำเร็จ', 'error');
      }
    } catch (err) {
      Utils.toast('ลบไม่สำเร็จ: ' + err.message, 'error');
    }
  },

  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },

  // ===== Hard refresh — bypass HTTP cache + unregister SW + clear caches =====
  async hardRefresh() {
    const btn = document.getElementById('refresh-btn');
    if (btn) {
      btn.classList.add('spinning');
      btn.disabled = true;
    }

    try {
      // 1) Unregister service worker (PWA) so next load fetches fresh
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          try { await r.unregister(); } catch (e) {}
        }
      }

      // 2) Clear all Cache Storage entries
      if ('caches' in window) {
        const names = await caches.keys();
        for (const n of names) {
          try { await caches.delete(n); } catch (e) {}
        }
      }

      // 3) Pull fresh server version before reload
      const newVer = await this.fetchServerVersion();
      if (newVer) localStorage.setItem('app_version', newVer);

      // 4) Show toast + reload bypassing HTTP cache
      if (typeof Utils !== 'undefined' && Utils.toast) {
        Utils.toast('🔄 กำลังรีเฟรช...');
      }
      setTimeout(() => {
        // Bypass HTTP cache with query string + reload
        const url = new URL(window.location.href);
        url.searchParams.set('_v', Date.now());
        window.location.replace(url.toString());
      }, 400);
    } catch (e) {
      console.error('Hard refresh failed:', e);
      // Fallback: simple reload with cache buster
      window.location.reload();
    }
  },

  // ===== Update available — prompt user =====
  async applyUpdate() {
    const newVer = await this.fetchServerVersion();
    if (newVer) {
      if (typeof Utils !== 'undefined' && Utils.toast) {
        Utils.toast('✨ อัพเดทเป็นเวอร์ชัน ' + newVer);
      }
    }
    this.hardRefresh();
  },
};

// ===== Service Worker registration (PWA) =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  });
}

// ===== Boot =====
document.addEventListener('DOMContentLoaded', () => App.init());

// ===== Refresh button binding (early, before login too) =====
document.addEventListener('DOMContentLoaded', () => {
  // Restore saved vehicle (route + report)
  const savedVehicle = Utils.getVehicle();
  const routeVehicle = document.getElementById('route-vehicle');
  if (routeVehicle) routeVehicle.value = savedVehicle;
  if (routeVehicle) {
    routeVehicle.addEventListener('change', () => Utils.setVehicle(routeVehicle.value));
  }
  const reportVehicle = document.getElementById('report-vehicle');
  if (reportVehicle) reportVehicle.value = savedVehicle;

  // Load live fuel prices from Bangchak (non-blocking)
  Utils.loadFuelPrices();

  // End mode → show customer dropdown if 'customer' selected
  const endMode = document.getElementById('route-end-mode');
  const endCustomer = document.getElementById('route-end-customer');
  if (endMode && endCustomer) {
    // Populate customer dropdown
    const populateEndCustomers = () => {
      const customers = Storage.getActiveCustomers();
      endCustomer.innerHTML = '<option value="">-- เลือกลูกค้า --</option>' +
        customers.map(c => `<option value="${c.id}">${this.escapeHTML(c.name)} (${this.escapeHTML(c.cif || '-')})</option>`).join('');
    };
    populateEndCustomers();
    // Refresh list when customers change
    document.addEventListener('customersUpdated', populateEndCustomers);

    endMode.addEventListener('change', () => {
      if (endMode.value === 'customer') {
        endCustomer.classList.remove('hidden');
      } else {
        endCustomer.classList.add('hidden');
      }
    });
  }

  // ===== Refresh button binding (sync retry + hard refresh) =====
  const btn = document.getElementById('refresh-btn');
  if (btn) {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (btn.classList.contains('has-update')) {
        App.applyUpdate();
      } else {
        // Try sync first (fast) — if data is stuck locally, this pushes to server
        btn.classList.add('spinning');
        const result = await Storage.retrySync();
        btn.classList.remove('spinning');
        if (result && result.success) {
          const c = result.counts || {};
          if (typeof Utils !== 'undefined') {
            Utils.toast(`🔄 Sync สำเร็จ — ${c.customers ?? '?'} ลูกค้า, ${c.visits ?? '?'} visits`);
          }
        } else if (result && result.error) {
          if (typeof Utils !== 'undefined') {
            Utils.toast(`⚠️ Sync ล้มเหลว: ${result.error} — ข้อมูลยังอยู่ในเครื่องนี้`, 'error');
          }
        } else {
          if (typeof Utils !== 'undefined') {
            Utils.toast('🔁 รีเฟรชข้อมูลจากเซิร์ฟเวอร์...');
          }
        }
        Customers.renderAll();
        if (typeof Visit !== 'undefined') Visit.render();
        if (typeof App !== 'undefined') App.updateRouteUI();
      }
    });
    // Long-press (or hold 1s) = full hard refresh
    let longPressTimer;
    btn.addEventListener('pointerdown', () => {
      longPressTimer = setTimeout(() => {
        App.hardRefresh();
      }, 1200);
    });
    btn.addEventListener('pointerup', () => clearTimeout(longPressTimer));
    btn.addEventListener('pointerleave', () => clearTimeout(longPressTimer));
  }

  // ===== Update DB button — reload customer data from static DB =====
  const updateBtn = document.getElementById('update-db-btn');
  if (updateBtn) {
    updateBtn.addEventListener('click', async () => {
      updateBtn.classList.add('spinning');
      updateBtn.disabled = true;
      try {
        if (typeof Storage === 'undefined' || !Storage.reloadStaticDB) {
          throw new Error('ฟังก์ชันอัพเดทยังไม่พร้อม');
        }
        const result = await Storage.reloadStaticDB();
        if (typeof Utils !== 'undefined') {
          Utils.toast(`✅ อัพเดทแล้ว: ลบ ${result.removed} รายการเก่า, นำเข้า ${result.imported} รายการใหม่ (${result.total} ในระบบ)`);
        }
        // Re-render everything
        if (typeof Customers !== 'undefined') Customers.renderAll();
        if (typeof Visit !== 'undefined') Visit.render();
        if (typeof App !== 'undefined') App.updateRouteUI();
      } catch (err) {
        if (typeof Utils !== 'undefined') {
          Utils.toast(`❌ อัพเดทล้มเหลว: ${err.message}`, 'error');
        }
        console.error('[UpdateDB]', err);
      } finally {
        updateBtn.classList.remove('spinning');
        updateBtn.disabled = false;
      }
    });
  }

  // Keyboard shortcut: F5 or Ctrl/Cmd+R triggers hard refresh
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'r')) {
      e.preventDefault();
      App.hardRefresh();
    }
  });
});
