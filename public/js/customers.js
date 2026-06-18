// ===== Customers management + Map rendering =====

const Customers = {
  map: null,
  markers: {},
  currentFilter: 'all',
  _baseLayers: {},
  _currentBaseLayer: 'roadmap',

  // Init map
  initMap() {
    if (this.map) return;
    // Default: BAAC สาขาวังท่าช้าง (single source of truth in app.js)
    const office = window.OFFICE_LOCATION || { lat: 13.7563, lng: 100.5018 };
    this.map = L.map('map').setView([office.lat, office.lng], 12);

    // Define 2 base layers: roadmap + satellite
    this._baseLayers = {
      roadmap: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }),
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri World Imagery',
        maxZoom: 19,
      }),
    };
    this._baseLayers.roadmap.addTo(this.map);
    this._currentBaseLayer = 'roadmap';

    // Add layer toggle control (top-right)
    this._addLayerControl();

    // Map click to add customer
    this.map.on('click', (e) => {
      // Pick mode: re-open modal with prefilled lat/lng
      if (window._pickMode) {
        window._pickMode = false;
        // Pre-fill draft if any
        const draft = sessionStorage.getItem('add-customer-draft');
        const draftData = draft ? JSON.parse(draft) : {};
        draftData.lat = e.latlng.lat.toFixed(6);
        draftData.lng = e.latlng.lng.toFixed(6);
        sessionStorage.setItem('add-customer-draft', JSON.stringify(draftData));
        App.restoreAddCustomerModal();
        return;
      }
      document.getElementById('new-lat').value = e.latlng.lat.toFixed(6);
      document.getElementById('new-lng').value = e.latlng.lng.toFixed(6);
      App.openAddCustomerModal();
    });
  },

  // Render all markers on map
  renderMarkers(routeOrder, opts = {}) {
    if (!this.map) return;
    // Clear existing
    Object.values(this.markers).forEach(m => this.map.removeLayer(m));
    this.markers = {};

    const customers = Storage.getActiveCustomers();
    const visits = Storage.getVisits();
    // Build order map: id -> order number (1-based)
    const orderMap = {};
    if (routeOrder && routeOrder.length) {
      routeOrder.forEach((id, idx) => { orderMap[id] = idx + 1; });
    }
    customers.forEach((c, idx) => {
      const visited = !!visits[c.id];
      const orderNum = orderMap[c.id] || (idx + 1);
      // Risk-based class drives the color
      const riskClass = c.riskLevel || 'unclassified';
      // ===== Center content = route order number when in today's route.
      // Off-route customers get an empty colored circle (no letter).
      // Cleaner than the old "first letter of name" which didn't help
      // field officers identify customers any faster than the color did.
      const inRoute = orderMap[c.id] != null;
      const centerHTML = inRoute ? orderNum : '';
      const icon = L.divIcon({
        className: '',
        html: `<div class="customer-marker ${riskClass}${visited ? ' visited' : ''}">${centerHTML}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      const marker = L.marker([c.lat, c.lng], { icon }).addTo(this.map);
      marker.bindPopup(this.popupHTML(c));
      // Collapse bottom sheet when tapping a marker so the map + popup are visible
      marker.on('click', () => {
        if (typeof App !== 'undefined' \&\& App.setSheetState) App.setSheetState('peek');
      });
      this.markers[c.id] = marker;
    });

    // Fit bounds only when caller explicitly requests it (e.g. initial load).
    // Auto-fitting on every re-render would yank the map away from wherever
    // the user has panned/zoomed to.
    if (opts.fitBounds && customers.length > 0) {
      const bounds = L.latLngBounds(customers.map(c => [c.lat, c.lng]));
      this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }
  },

  // Popup HTML
  popupHTML(c) {
    const db = c.cif && typeof CustomerDB !== 'undefined' ? CustomerDB.getByCif(c.cif) : null;
    let metaHTML = '';
    if (db) {
      const parts = [];
      if (db.zone) parts.push(`เขต ${db.zone}`);
      if (db.customer_class) parts.push(`ชั้น ${db.customer_class}`);
      if (db.potential) parts.push(`ศักยภาพ ${db.potential}`);
      if (parts.length) metaHTML = `<div class="popup-addr" style="font-size:11px;color:#0a8f3c;">${this.escapeHTML(parts.join(' · '))}</div>`;
    }
    return `
      <div class="popup-name">${this.escapeHTML(c.name)}</div>
      ${c.cif ? `<div class="popup-addr" style="font-size:11px;">CIF: ${this.escapeHTML(c.cif)}</div>` : ''}
      ${metaHTML}
      ${c.address ? `<div class="popup-addr">${this.escapeHTML(c.address)}</div>` : ''}
      ${c.phone ? `<div class="popup-addr">📞 ${this.escapeHTML(c.phone)}</div>` : ''}
      <div class="popup-actions">
        <button class="popup-nav" onclick="Customers.navigate('${c.lat}','${c.lng}')">🧭 นำทาง</button>
        <button class="popup-edit" onclick="Customers.edit('${c.id}')">✏️ แก้ไข</button>
        <button class="popup-del" onclick="Customers.del('${c.id}')">🗑️</button>
      </div>
    `;
  },

  // Navigate to customer (Google Maps)
  navigate(lat, lng) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`, '_blank');
  },

  // Edit customer
  edit(id) {
    const c = Storage.getCustomers().find(x => x.id === id);
    if (!c) return;
    // Open modal FIRST (it clears form + reset editId)
    App.openAddCustomerModal();
    // Then set editId AFTER, so the modal reset doesn't wipe it
    const form = document.getElementById('add-customer-form');
    form.dataset.editId = id;
    form.elements.cif.value = c.cif || '';
    form.elements.name.value = c.name;
    form.elements.nickname.value = c.nickname || '';
    form.elements.phone.value = c.phone || '';
    form.elements.address.value = c.address || '';
    form.elements.lat.value = c.lat;
    form.elements.lng.value = c.lng;
    // Phase 4: pre-fill risk + debt dropdowns
    form.elements.riskLevel.value = c.riskLevel || 'unclassified';
    form.elements.debtType.value = c.debtType || '';
    // Phase 2: pre-fill photo
    if (c.photo) {
      App._showPhotoPreview(c.photo);
    }
    // Re-init mini-map with customer location
    setTimeout(() => App.initMiniMap(c.lat, c.lng), 150);

    // Show DB info badge (matches popup HTML for the same customer)
    const dbInfo = document.getElementById('db-filled-info');
    if (dbInfo) {
      const db = c.cif && typeof CustomerDB !== 'undefined' ? CustomerDB.getByCif(c.cif) : null;
      if (db) {
        const badges = [];
        if (db.zone) badges.push(`เขต ${db.zone}`);
        if (db.customer_class) badges.push(`ชั้น ${db.customer_class}`);
        if (db.potential) badges.push(`ศักยภาพ ${db.potential}`);
        if (db.dob) badges.push(`เกิด ${db.dob}`);
        if (db.lat) badges.push(`📍 มีพิกัดแล้ว`);
        dbInfo.innerHTML = `✅ <strong>${this.escapeHTML(c.name)}</strong> · CIF ${this.escapeHTML(c.cif)}${badges.length ? ' · ' + badges.map(b => this.escapeHTML(b)).join(' · ') : ''}`;
        dbInfo.classList.add('active');
      }
    }
  },

  // Delete customer
  async del(id) {
    const c = Storage.getCustomers().find(x => x.id === id);
    if (!c) return;
    const confirmed = await App.confirmDelete(c);
    if (!confirmed) return;
    const delResult = await Storage.deleteCustomer(id);
    Storage.removeFromRoute(id);
    this.renderAll();
    if (delResult && delResult.synced) {
      Utils.toast('🗑️ ลบ "' + (c.name || 'ลูกค้า') + '" แล้ว · sync สำเร็จ');
    } else {
      Utils.toast('⚠️ ลบแล้วแต่ sync ไม่สำเร็จ — กด 🔄 เพื่อลองใหม่', 'error');
    }
  },

  // Render customer list (Customers tab)
  renderList() {
    const list = document.getElementById('customers-list');
    let customers = Storage.getActiveCustomers();
    const visits = Storage.getVisits();
    const route = Storage.getRoute();

    // Filter
    if (this.currentFilter === 'pending') {
      customers = customers.filter(c => !visits[c.id]);
    } else if (this.currentFilter === 'visited') {
      customers = customers.filter(c => visits[c.id]);
    } else if (this.currentFilter === 'today') {
      // For now: same as all. Can be filtered by route later.
    }

    // Search filter
    const searchQuery = (document.getElementById('customer-search')?.value || '').trim().toLowerCase();
    if (searchQuery) {
      customers = customers.filter(c => {
        const haystack = `${c.cif || ''} ${c.name || ''} ${c.phone || ''} ${c.address || ''} ${c.note || ''}`.toLowerCase();
        return haystack.includes(searchQuery);
      });
    }

    document.getElementById('customer-count').textContent = customers.length;

    if (customers.length === 0) {
      const msg = searchQuery
        ? `ไม่พบลูกค้าที่ตรงกับ "${searchQuery}"`
        : 'ยังไม่มีลูกค้า กดปุ่ม <strong>＋</strong> มุมขวาล่างเพื่อเพิ่ม';
      list.innerHTML = `<p class="empty-state">${msg}</p>`;
      return;
    }

    list.innerHTML = customers.map(c => {
      const visited = !!visits[c.id];
      const inRoute = route.includes(c.id);
      // Look up DB data for additional fields
      const db = c.cif && typeof CustomerDB !== 'undefined' ? CustomerDB.getByCif(c.cif) : null;
      const metaBadges = [];
      if (db) {
        if (db.zone) metaBadges.push(`<span class="meta-badge gray">เขต ${this.escapeHTML(db.zone)}</span>`);
        if (db.customer_class) metaBadges.push(`<span class="meta-badge blue">${this.escapeHTML(db.customer_class)}</span>`);
        if (db.potential) {
          const pClass = db.potential === 'แดง' ? 'red' : db.potential === 'เหลือง' ? 'yellow' : 'green';
          metaBadges.push(`<span class="meta-badge ${pClass}">${this.escapeHTML(db.potential)}</span>`);
        }
      }
      return `
        <div class="customer-card ${visited ? 'visited' : ''}">
          <div class="customer-avatar">${visited ? '✓' : '👤'}</div>
          <div class="customer-info">
            <div class="customer-name">${this.escapeHTML(c.name)}</div>
            ${c.cif ? `<div class="customer-cif">CIF: ${this.escapeHTML(c.cif)}</div>` : ''}
            <div class="customer-address">${this.escapeHTML(c.address || 'ไม่มีที่อยู่')}</div>
            ${metaBadges.length ? `<div class="customer-meta">${metaBadges.join('')}</div>` : ''}
          </div>
          <div class="customer-actions">
            <button class="btn-small ${inRoute ? 'btn-route-active' : ''}" onclick="Customers.toggleRoute('${c.id}')" title="เพิ่มในเส้นทาง">
              ${inRoute ? '✓' : '➕'}
            </button>
            <button class="btn-small" onclick="Customers.edit('${c.id}')" title="แก้ไข">✏️</button>
            <button class="btn-small btn-danger" onclick="Customers.del('${c.id}')" title="ลบลูกค้า">🗑️</button>
          </div>
        </div>
      `;
    }).join('');
  },

  // Toggle customer in today's route
  toggleRoute(id) {
    const route = Storage.getRoute();
    if (route.includes(id)) {
      Storage.removeFromRoute(id);
      Utils.toast('เอาออกจากเส้นทาง');
    } else {
      Storage.addToRoute(id);
      Utils.toast('เพิ่มในเส้นทางวันนี้ ✓');
    }
    this.renderList();
    App.updateRouteUI();
  },

  // ===== Base layer toggle (roadmap ↔ satellite) =====
  _addLayerControl() {
    // Custom control as a DOM element (Leaflet way)
    const LayerToggle = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'layer-toggle leaflet-bar');
        div.innerHTML = `
          <button class="layer-btn active" data-layer="roadmap" title="แผนที่ถนน">🗺️</button>
          <button class="layer-btn" data-layer="satellite" title="ภาพดาวเทียม">🛰️</button>
        `;
        L.DomEvent.disableClickPropagation(div);
        div.querySelectorAll('.layer-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            L.DomEvent.stop(e);
            Customers.switchBaseLayer(btn.dataset.layer);
          });
        });
        return div;
      },
    });
    new LayerToggle({ position: 'topright' }).addTo(this.map);

    // Fullscreen toggle button
    const FsToggle = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'fs-toggle leaflet-bar');
        const btn = L.DomUtil.create('button', 'fs-btn', div);
        btn.innerHTML = '⛶';
        btn.title = 'ขยายเต็มจอ';
        btn.setAttribute('aria-label', 'Toggle fullscreen');
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        btn.addEventListener('click', (e) => {
          L.DomEvent.stop(e);
          Customers.toggleFullscreen();
        });
        return div;
      },
    });
    new FsToggle({ position: 'topright' }).addTo(this.map);

    // Update icon when fullscreen state changes (handles ESC key + iOS quirks)
    const updateFsIcon = () => {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement
        || document.querySelector('#map.map-fs-fake'));
      const btn = document.querySelector('.fs-btn');
      if (btn) {
        btn.innerHTML = isFs ? '✕' : '⛶';
        btn.title = isFs ? 'ออกจากเต็มจอ' : 'ขยายเต็มจอ';
        btn.classList.toggle('active', isFs);
      }
      // Trigger map resize after layout change
      setTimeout(() => this.map && this.map.invalidateSize(), 200);
    };
    ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach(ev => {
      document.addEventListener(ev, updateFsIcon);
    });
  },

  // ===== Fullscreen toggle =====
  toggleFullscreen() {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;
    const isFs = document.fullscreenElement || document.webkitFullscreenElement;
    if (!isFs) {
      // Enter fullscreen — try real API first, fallback to fake fullscreen
      // Find first actually-defined function
      const candidates = [
        mapEl.requestFullscreen,
        mapEl.webkitRequestFullscreen,
        mapEl.msRequestFullscreen,
      ];
      const req = candidates.find(fn => typeof fn === 'function') || null;
      if (req) {
        let result;
        try {
          result = req.call(mapEl);
        } catch (err) {
          // Synchronous error (e.g. some iOS WebViews)
          console.warn('Fullscreen call threw, using fallback:', err);
          this._useFakeFullscreen(mapEl);
          return;
        }
        // Some browsers return undefined (no promise); only chain .catch if it's a Promise
        if (result && typeof result.then === 'function') {
          result.catch(err => {
            console.warn('Fullscreen API blocked, using fallback:', err);
            this._useFakeFullscreen(mapEl);
          });
        }
      } else {
        // No Fullscreen API support at all
        console.warn('No Fullscreen API, using CSS fallback');
        this._useFakeFullscreen(mapEl);
      }
    } else {
      // Exit fullscreen
      const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (exit) exit.call(document);
      mapEl.classList.remove('map-fs-fake');
    }
    },
    _useFakeFullscreen(mapEl) {
    mapEl.classList.add('map-fs-fake');
    const btn = document.querySelector('.fs-btn');
    if (btn) { btn.innerHTML = '✕'; btn.classList.add('active'); btn.title = 'ออกจากเต็มจอ'; }
    this.map.invalidateSize();
    },

  switchBaseLayer(layerName) {
    if (!this._baseLayers[layerName] || layerName === this._currentBaseLayer) return;
    // Remove current
    this.map.removeLayer(this._baseLayers[this._currentBaseLayer]);
    // Add new
    this._baseLayers[layerName].addTo(this.map);
    this._currentBaseLayer = layerName;
    // Update button states
    const buttons = document.querySelectorAll('.layer-toggle .layer-btn');
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layer === layerName);
    });
  },

  // Render everything
  renderAll(routeOrder, opts) {
    this.renderMarkers(routeOrder, opts);
    this.renderList();
  },

  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },
};

window.Customers = Customers;
