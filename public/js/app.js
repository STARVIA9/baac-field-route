// ===== Main App — orchestration + event handlers =====

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
    Customers.renderAll();
    Visit.render();
    Quick.init();
    Quick.renderSelected();
    this.updateRouteUI();

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
        if (typeof Quick !== 'undefined' && Quick.renderSelected) Quick.renderSelected();
      }
    });
  },

  _updateSyncBadge(evt) {
    let badge = document.getElementById('sync-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'sync-badge';
      badge.style.cssText = 'position:fixed;bottom:8px;right:8px;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600;z-index:9999;background:#4caf50;color:white;box-shadow:0 2px 6px rgba(0,0,0,0.2);transition:opacity 0.3s;';
      document.body.appendChild(badge);
    }
    if (evt.status === 'syncing') {
      badge.textContent = '🔄 Syncing...';
      badge.style.background = '#ff9800';
    } else if (evt.status === 'synced') {
      const time = evt.serverTime ? new Date(evt.serverTime).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      badge.textContent = `☁️ Synced ${time}`;
      badge.style.background = '#4caf50';
    } else if (evt.status === 'error') {
      badge.textContent = '⚠️ Sync error';
      badge.style.background = '#f44336';
    }
  },

  // Called by Storage when remote data changes — re-render
  _onRemoteUpdate(remote) {
    Customers.renderAll();
    if (typeof Visit !== 'undefined') Visit.render();
    this.updateRouteUI();
    if (typeof Quick !== 'undefined' && Quick.renderSelected) Quick.renderSelected();
  },

  // Attach all event handlers
  attachEvents() {
    // Login form
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = document.getElementById('pin-input').value;
      const errEl = document.getElementById('login-error');
      errEl.textContent = '';
      const btn = document.getElementById('login-btn');
      btn.disabled = true;
      btn.textContent = 'กำลังเข้าสู่ระบบ...';
      const ok = await Auth.login(pin);
      if (ok) {
        await this.afterLogin();
      } else {
        errEl.textContent = 'PIN ไม่ถูกต้อง';
      }
      btn.disabled = false;
      btn.textContent = 'เข้าสู่ระบบ';
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
      if (confirm('ออกจากระบบ?')) Auth.logout();
    });

    // Tabs
    document.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => this.switchTab(t.dataset.tab));
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

  // Switch tab
  switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
    document.getElementById(`tab-${name}`).classList.add('active');
    if (name === 'map') {
      // Re-render map size after showing
      setTimeout(() => Customers.map && Customers.map.invalidateSize(), 100);
    }
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
    const form = document.getElementById('add-customer-form');
    if (!form) return;

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

    // Close search results
    const results = document.getElementById('db-search-results');
    if (results) results.classList.remove('active');

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

    // Update search input
    const input = document.getElementById('db-search-input');
    if (input) input.value = `${rec.name} (CIF: ${rec.cif})`;

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
    // Default to BAAC Wang Tha Chang or prefilled
    const lat = prefillLat || 13.7563;
    const lng = prefillLng || 100.5018;
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

  // Save customer (add or edit)
  async saveCustomer(form) {
    const data = Object.fromEntries(new FormData(form));
    const editId = form.dataset.editId;
    if (editId) {
      Storage.updateCustomer(editId, data);
      Utils.toast('แก้ไขลูกค้าแล้ว');
    } else {
      Storage.addCustomer(data);
      Utils.toast('เพิ่มลูกค้าแล้ว ✓');
    }
    this.closeAddCustomerModal();
    Customers.renderAll();
    await Storage.sync();
  },

  // Use GPS
  useGPS(forForm = false) {
    if (!navigator.geolocation) {
      Utils.toast('เบราว์เซอร์ไม่รองรับ GPS', 'error');
      return;
    }
    Utils.toast('📍 กำลังค้นหาตำแหน่ง...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        window._lastGPS = { lat, lng };
        if (forForm) {
          document.getElementById('new-lat').value = lat.toFixed(6);
          document.getElementById('new-lng').value = lng.toFixed(6);
          Utils.toast('📍 ใช้ตำแหน่งปัจจุบันแล้ว');
        } else {
          if (Customers.map) {
            Customers.map.setView([lat, lng], 15);
            L.marker([lat, lng], {
              icon: L.divIcon({
                className: '',
                html: '<div class="customer-marker current">📍</div>',
                iconSize: [32, 32],
                iconAnchor: [16, 16],
              }),
            }).addTo(Customers.map).bindPopup('📍 ตำแหน่งปัจจุบัน');
          }
        }
      },
      (err) => {
        Utils.toast('ไม่สามารถเข้าถึง GPS: ' + err.message, 'error');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  },

  // Update route tab UI
  updateRouteUI() {
    const route = Storage.getRoute();
    const customers = Storage.getActiveCustomers();
    const routeCustomers = route.map(id => customers.find(c => c.id === id)).filter(Boolean);
    const el = document.getElementById('route-customers');
    const btn = document.getElementById('btn-calculate-route');

    if (routeCustomers.length === 0) {
      el.innerHTML = `<p class="empty-state">เลือกลูกค้าจากแท็บ "ลูกค้า" → กด "เพิ่มในเส้นทางวันนี้"</p>`;
      btn.disabled = true;
      return;
    }

    el.innerHTML = routeCustomers.map(c => `
      <div class="route-customer-chip">
        <div class="customer-avatar">${c.name[0]}</div>
        <div class="customer-info" style="flex:1;min-width:0">
          <div class="customer-name">${this.escapeHTML(c.name)}</div>
          <div class="customer-address">${this.escapeHTML(c.address || '')}</div>
        </div>
        <button class="chip-remove" onclick="Customers.toggleRoute('${c.id}')" title="เอาออก">×</button>
      </div>
    `).join('');

    btn.disabled = false;
  },

  // Calculate route
  async calculateRoute() {
    const route = Storage.getRoute();
    if (route.length === 0) return;
    const start = Route.getStartCoords();
    const end = Route.getEndCoords();

    // Plan optimal order (TSP with optional end)
    const ordered = TSP.plan(start, route, end);

    // Get real route from OSRM
    const result = await Route.calculate(start, ordered, end);
    if (result) {
      Route.showResult(result);
      this.switchTab('map'); // show route on map
      const routeType = result.isOpenPath ? ' (เปิด)' : '';
      Utils.toast(`✅ เส้นทาง${routeType}พร้อม: ${Utils.formatKm(result.distance)} กม. / ${result.fuel ? Utils.formatBaht(result.fuel.baht) : '?'} บาท`);
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
  // Restore saved vehicle
  const savedVehicle = Utils.getVehicle();
  const routeVehicle = document.getElementById('route-vehicle');
  const quickVehicle = document.getElementById('quick-vehicle');
  if (routeVehicle) routeVehicle.value = savedVehicle;
  if (quickVehicle) quickVehicle.value = savedVehicle;
  // Sync vehicle selectors + persist
  [routeVehicle, quickVehicle].forEach(sel => {
    if (!sel) return;
    sel.addEventListener('change', () => {
      Utils.setVehicle(sel.value);
      // Sync the other one
      if (sel === routeVehicle && quickVehicle) quickVehicle.value = sel.value;
      if (sel === quickVehicle && routeVehicle) routeVehicle.value = sel.value;
    });
  });

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

  // ===== Refresh button binding =====
  const btn = document.getElementById('refresh-btn');
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (btn.classList.contains('has-update')) {
        App.applyUpdate();
      } else {
        App.hardRefresh();
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
