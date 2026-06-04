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
    Customers.initMap();
    Customers.renderAll();
    Visit.render();
    Quick.init();
    Quick.renderSelected();
    this.updateRouteUI();

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
    // Init mini-map after modal visible
    setTimeout(() => this.initMiniMap(), 100);
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
    const customers = Storage.getCustomers();
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

    // Plan optimal order
    const ordered = TSP.plan(start, route);

    // Get real route from OSRM
    const result = await Route.calculate(start, ordered);
    if (result) {
      Route.showResult(result);
      this.switchTab('map'); // show route on map
      Utils.toast(`✅ เส้นทางพร้อม: ${Utils.formatKm(result.distance)} กม.`);
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
  // Keyboard shortcut: Ctrl/Cmd + Shift + R also works, but add Ctrl+R safety net
  document.addEventListener('keydown', (e) => {
    // F5 or Ctrl+R triggers hard refresh
    if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'r')) {
      e.preventDefault();
      App.hardRefresh();
    }
  });
});
