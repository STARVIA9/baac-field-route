// ===== Customers management + Map rendering =====

const Customers = {
  map: null,
  markers: {},
  currentFilter: 'all',
  // Debt filters (ข้อมูลหนี้ Customer Indicator)
  debtMonth: '',       // เดือนที่ถึงกำหนด (เช่น '08/2026') — ว่าง = ทุกเดือน
  debtTier: '',        // ชั้นหนี้ (''=ทุกชั้น, '1'..'5')
  omsomMode: '',       // ''=รวม, 'exclude'=กรอง อสม.ออก, 'only'=เฉพาะ อสม.
  m15Mode: '',         // ''=ทุก 15เดือน, 'Y'=มี 15เดือน, 'none'=ไม่มี 15เดือน
  _baseLayers: {},
  _currentBaseLayer: 'roadmap',

  // Init map
  initMap() {
    if (this.map) return;
    // Default view: จังหวัดปราจีนบุรี (zoom 12 — เห็นภาพรวมทั้งจังหวัด)
    // Q1: เปิดมาที่ ต.วังท่าช้าง (บริเวณสาขา BAAC) zoom 13 — เห็นทั้งตำบล
    const office0 = window.OFFICE_LOCATION || { lat: 13.7760801, lng: 101.8907475 };
    this.map = L.map('map', {
      preferCanvas: true,  // Render vector layers on <canvas> — GPU accelerated, NO DOM per marker
      maxZoom: 20,
      zoomControl: false,  // B: ปิด topleft (โดนแผงตัวกรองบัง) → custom zoom control ล่างขวา
    }).setView([office0.lat, office0.lng], 13);

    // Define 2 base layers: roadmap + satellite
    this._baseLayers = {
      roadmap: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 20,
        maxNativeZoom: 19,   // 19+ = stretch tiles (ภาพเบลอนิดแต่ยังพอดูได้)
      }),
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri World Imagery',
        maxZoom: 20,
        maxNativeZoom: 19,
      }),
    };
    this._baseLayers.roadmap.addTo(this.map);
    this._currentBaseLayer = 'roadmap';

    // Add layer toggle control (top-right)
    this._addLayerControl();

    // T1.1: แจ้งเตือนเมื่อซูมถึงระดับละเอียดสุด (tile ถูกยืดจาก level 19)
    let _maxZoomNotified = false;
    this.map.on('zoomend', () => {
      const z = this.map.getZoom();
      if (z >= 20) {
        if (!_maxZoomNotified) {
          Utils.toast('🔍 ซูมละเอียดสุดแล้ว (ภาพจากระดับ 19 ถูกขยาย)', '', 2500);
          _maxZoomNotified = true;
          setTimeout(() => { _maxZoomNotified = false; }, 10000);
        }
      }
    });

    // Map long-press to add customer (ต้องจิ้มค้าง ~600ms ถึงจะขึ้นเพิ่มพิกัด)
    const LONG_PRESS_MS = 600;
    let pressTimer = null;
    let pressLatLng = null;
    const handleLongPress = (latlng) => {
      if (!latlng) return;
      if (window._pickMode) {
        window._pickMode = false;
        const draft = sessionStorage.getItem('add-customer-draft');
        const draftData = draft ? JSON.parse(draft) : {};
        draftData.lat = latlng.lat.toFixed(6);
        draftData.lng = latlng.lng.toFixed(6);
        sessionStorage.setItem('add-customer-draft', JSON.stringify(draftData));
        App.restoreAddCustomerModal();
        return;
      }
      // แสดงตัวเลือก: ปักหมุดลูกค้าเดิม หรือ เพิ่มลูกค้าใหม่
      this._showPinOptions(latlng.lat, latlng.lng);
    };
    const startPress = (latlng) => {
      pressLatLng = latlng;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => { pressTimer = null; handleLongPress(pressLatLng); }, LONG_PRESS_MS);
    };
    const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
    // Desktop: กดค้างเมาส์ซ้าย
    this.map.on('mousedown', (e) => { if (e.originalEvent && e.originalEvent.button !== 0) return; startPress(e.latlng); });
    this.map.on('mouseup', cancelPress);
    this.map.on('mousemove', (e) => { if (pressTimer && pressLatLng && e.latlng && e.latlng.distanceTo(pressLatLng) > 12) cancelPress(); });
    this.map.on('mouseout', cancelPress);
    // Mobile: จิ้มค้าง
    this.map.on('touchstart', (e) => { if (e.latlng) startPress(e.latlng); });
    this.map.on('touchend', cancelPress);
    this.map.on('touchmove', cancelPress);
    // Fallback: คลิกขวา (desktop) / long-press ระบบ (mobile บางรุ่นยิง contextmenu)
    this.map.on('contextmenu', (e) => { clearTimeout(pressTimer); pressTimer = null; handleLongPress(e.latlng); });
  },

  // ===== Color scheme for circleMarker (no DOM elements) =====
  _riskColors: {
    unclassified: { fill: '#e0e0e0', stroke: '#bbbbbb' },
    good:         { fill: '#16a34a', stroke: '#16a34a' },
    warning:      { fill: '#d97706', stroke: '#d97706' },
    bad:          { fill: '#dc2626', stroke: '#dc2626' },
  },

  // Render all markers on map — L.circleMarker + Canvas (ZERO DOM per marker)
  // Clustered so zoomed-out mobile doesn't render/overlap 178 dots.
  // Smart rebuild: skips full teardown if data hasn't changed.
  _lastMarkerHash: null,
  renderMarkers(routeOrder, opts = {}) {
    if (!this.map) return;

    // Compute hash of current state to skip unnecessary rebuilds
    const customers = Storage.getActiveCustomers();
    const visits = Storage.getVisits();
    let hash = '';
    for (const c of customers) {
      if (Number.isFinite(c.lat)) {
        hash += c.id + ':' + c.lat.toFixed(4) + ',' + c.lng.toFixed(4) + ':' + (visits[c.id] ? '1' : '0') + ';';
      }
    }
    if (routeOrder) hash += '|route:' + routeOrder.join(',');
    if (this.debtMonth) hash += '|dm:' + this.debtMonth;
    if (this.debtTier) hash += '|dt:' + this.debtTier;
    if (this.omsomMode) hash += '|om:' + this.omsomMode;
    if (this.m15Mode) hash += '|m15:' + this.m15Mode;
    this._zoneFilter = document.getElementById('customer-zone')?.value || '';
    if (this._zoneFilter) hash += '|zone:' + this._zoneFilter;

    // Skip rebuild if nothing changed (saves ~200-500ms on polling)
    if (!opts.force && hash === this._lastMarkerHash) return;
    this._lastMarkerHash = hash;

    // Clear existing
    Object.values(this.markers).forEach(m => this.map.removeLayer(m));
    this.markers = {};
    // Remove old cluster layer
    if (this._cluster) {
      this.map.removeLayer(this._cluster);
      this._cluster = null;
    }
    // Clear route-number overlays if any
    if (this._routeNumLayer) {
      this.map.removeLayer(this._routeNumLayer);
      this._routeNumLayer = null;
    }

    // Build order map: id -> order number (1-based)
    const orderMap = {};
    if (routeOrder && routeOrder.length) {
      routeOrder.forEach((id, idx) => { orderMap[id] = idx + 1; });
    }

    // === Display-only jitter for exactly-overlapping pins ===
    // Deterministic hash-based jitter: same CIF always gets same offset (stable across renders)
    const jitter = (v, seed) => {
      // Simple hash: multiply seed by prime, take fractional part
      const h = ((seed * 2654435761) >>> 0) / 4294967296; // 0..1
      return v + (h - 0.5) * 0.00006;
    };
    const coordKeys = {};   // "lat,lng" -> จำนวนหมุดที่ซ้อนกัน ณ จุดนั้น
    for (const c of customers) {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
      const key = c.lat.toFixed(6) + ',' + c.lng.toFixed(6);
      coordKeys[key] = (coordKeys[key] || 0) + 1;
    }

    // Cluster layer (only if leaflet.markercluster loaded); circleMarkers go here on canvas.
    const clusterable = typeof L.markerClusterGroup === 'function';
    const cluster = clusterable
      ? L.markerClusterGroup({
          maxClusterRadius: 45,          // merge points within ~45px
          disableClusteringAtZoom: 16,   // below 16, show individual dots (village level)
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          zoomToBoundsOnClick: true,
          iconCreateFunction: (cc) => {
            const n = cc.getChildCount();
            // Color ramp: 2-9 green, 10-49 orange, 50+ red
            const cls = n >= 50 ? 'mc-red' : n >= 10 ? 'mc-orange' : 'mc-green';
            return L.divIcon({
              html: `<div class="marker-cluster-icon ${cls}">${n}</div>`,
              className: '', iconSize: [40, 40], iconAnchor: [20, 20],
            });
          },
        })
      : null;

    customers.forEach((c) => {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
      // === Debt filters (ข้อมูลหนี้ Customer Indicator) ===
      if (this.debtMonth || this.debtTier || this.omsomMode || this.m15Mode) {
        const debt = c.cif && typeof DebtDB !== 'undefined' && DebtDB._loaded ? DebtDB.getByCif(c.cif) : null;
        if (this.debtMonth) {
          // กรองเดือนที่ถึงกำหนด: เทียบ debt.earliest_due กับเดือนที่เลือก
          const due = debt ? DebtDB.dueMonthKey(debt.earliest_due) : '';
          if (due !== this.debtMonth) return;
        }
        if (this.debtTier) {
          const maxTier = debt ? (parseInt(debt.max_tier) || 0) : 0;
          if (maxTier !== parseInt(this.debtTier)) return;
        }
        if (this.omsomMode) {
          const isOmsom = debt ? debt.is_omsom : false;
          if (this.omsomMode === 'exclude' && isOmsom) return;
          if (this.omsomMode === 'only' && !isOmsom) return;
        }
        if (this.m15Mode) {
          const has15 = debt && debt.contracts && debt.contracts.some(c=>c.m15==='Y' || (c.m15_amt||0)>0);
          if (this.m15Mode === 'Y' && !has15) return;
          if (this.m15Mode === 'none' && has15) return;
        }
      }

      // Zone filter (T3): ซ่อน marker นอกเขตที่เลือก
      if (this._zoneFilter) {
        const dbz = c.cif && typeof CustomerDB !== 'undefined' ? CustomerDB.getByCif(c.cif) : null;
        if (!dbz || String(dbz.zone) !== String(this._zoneFilter)) return;
      }

      const visited = !!visits[c.id];
      const riskClass = c.riskLevel || 'unclassified';
      const inRoute = orderMap[c.id] != null;
      const colors = this._riskColors[riskClass] || this._riskColors.unclassified;
      // Visited = override to green
      const fill = visited ? '#16a34a' : colors.fill;
      const stroke = visited ? '#16a34a' : colors.stroke;

      // แยกหมุดที่ซ้อนกันพอดี: ถ้าจุดนี้มีหมุดซ้อน >1 → ขยับหมุดตัวถัดๆ ไปด้วย jitter
      // เฉพาะตอนแสดงผล (jitter แบบ deterministic ตามคิว) เพื่อให้เห็นหมุดครบทุกตัว
      let mLat = c.lat, mLng = c.lng;
      if (coordKeys[c.lat.toFixed(6) + ',' + c.lng.toFixed(6)] > 1) {
        // Use CIF numeric value as seed for deterministic jitter
        const seed = parseInt(c.cif, 10) || parseInt(c.id.replace(/\D/g, ''), 10) || 0;
        mLat = jitter(c.lat, seed);
        mLng = jitter(c.lng, seed + 7919); // different prime offset for lng
      }

      const marker = L.circleMarker([mLat, mLng], {
        radius: inRoute ? 11 : 8,
        fillColor: fill,
        color: stroke,
        weight: inRoute ? 3 : 1.5,
        opacity: riskClass === 'unclassified' ? 0.6 : 0.9,
        fillOpacity: riskClass === 'unclassified' ? 0.3 : 0.85,
        pane: 'markerPane',
      });

      marker.bindPopup(() => this.popupHTML(c));
      marker.on('click', () => {
        if (typeof App !== 'undefined' && App.setSheetState) App.setSheetState('peek');
      });

      if (cluster) cluster.addLayer(marker);
      else marker.addTo(this.map);
      this.markers[c.id] = marker;
    });

    // Add cluster layer to map (fast canvas underneath, cluster icons on overlay)
    if (cluster) {
      cluster.addTo(this.map);
      this._cluster = cluster;
    }

    // ===== Route number overlays (max 10 — negligible DOM) =====
    // Show a little white pill with the order number for customers in
    // today's planned route.  Only ~10 elements instead of 3800.
    const inRouteCusts = customers.filter(c => orderMap[c.id] != null);
    if (inRouteCusts.length > 0) {
      this._routeNumLayer = L.layerGroup(inRouteCusts.map(c => {
        return L.marker([c.lat, c.lng], {
          icon: L.divIcon({
            className: '',
            html: `<div class="marker-route-num">${orderMap[c.id]}</div>`,
            iconSize: [22, 22],
            iconAnchor: [11, -12],  // float above the circleMarker
          }),
          interactive: false,  // don't steal clicks
          pane: 'overlayPane',
        });
      })).addTo(this.map);
    }

    // Fit bounds only when caller explicitly requests it (e.g. initial load).
    // Only GPS customers have coords — skip null coords to avoid LatLng(null).
    if (opts.fitBounds && customers.length > 0) {
      const gps = customers.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng));
      if (gps.length > 0) {
        const bounds = L.latLngBounds(gps.map(c => [c.lat, c.lng]));
        this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
      }
    }
  },

  // ===== Debt filter bar: เติมเดือน + ผูก event + re-render =====
  initDebtFilter() {
    const monthSel = document.getElementById('debt-month-filter');
    const tierSel = document.getElementById('debt-tier-filter');
    const omSel = document.getElementById('debt-omsom-filter');
    const m15Sel = document.getElementById('debt-15m-filter');
    const resetBtn = document.getElementById('debt-filter-reset');
    if (!monthSel || typeof DebtDB === 'undefined') return;

    // เติม dropdown เดือนจากข้อมูลหนี้ (เรียงตามเวลา — แสดงทุกเดือนที่มีข้อมูล)
    if (DebtDB._loaded && monthSel.options.length <= 1) {
      const months = new Set();
      DebtDB._byCif.forEach(r => {
        const k = DebtDB.dueMonthKey(r.earliest_due);
        if (k) months.add(k);
      });
      // เรียงตาม key ตัวเลข YYYYMM (ปี*100+เดือน) เพื่อให้เรียงตามเวลาจริง
      const sortKey = (mmyy) => {
        const p = String(mmyy).split('/');
        return (+p[1]) * 100 + (+p[0]);   // 'MM/YYYY' -> YYYY*100+MM
      };
      const sorted = [...months].sort((a, b) => sortKey(a) - sortKey(b));
      sorted.forEach(k => {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = DebtDB.fmtDate('01/' + k);
        monthSel.appendChild(o);
      });
    }

    // T3: zone filter บนแผนที่ (sync กับ dropdown ในแท็บลูกค้า)
    const mapZoneSel = document.getElementById('map-zone-filter');
    const tabZoneSel = document.getElementById('customer-zone');
    if (mapZoneSel && tabZoneSel) {
      // เปิดหน้า: sync ค่าจาก tab → map
      mapZoneSel.value = tabZoneSel.value || '';
      mapZoneSel.addEventListener('change', () => {
        tabZoneSel.value = mapZoneSel.value;   // ให้สองฝั่งตรงกัน
        this._lastMarkerHash = null;            // force rebuild
        this.renderAll();                       // renderMarkers + list
      });
      // ฝั่งแท็บลูกค้าเปลี่ยน → อัพเดต map dropdown ด้วย
      tabZoneSel.addEventListener('change', () => {
        mapZoneSel.value = tabZoneSel.value || '';
      });
    }

    const apply = () => {
      this.debtMonth = monthSel.value;
      this.debtTier = tierSel.value;
      this.omsomMode = omSel.value;
      this.m15Mode = m15Sel ? m15Sel.value : '';
      this._zoneFilter = document.getElementById('customer-zone')?.value || '';
      this._lastMarkerHash = null;   // force rebuild
      this.renderAll();
    };
    monthSel.addEventListener('change', apply);
    tierSel.addEventListener('change', apply);
    omSel.addEventListener('change', apply);
    if (m15Sel) m15Sel.addEventListener('change', apply);
    if (resetBtn) resetBtn.addEventListener('click', () => {
      monthSel.value = ''; tierSel.value = ''; omSel.value = ''; if(m15Sel) m15Sel.value='';
      if (mapZoneSel) mapZoneSel.value = '';
      if (tabZoneSel) tabZoneSel.value = '';
      this.debtMonth = ''; this.debtTier = ''; this.omsomMode = ''; this.m15Mode='';
      this._zoneFilter = '';
      this._lastMarkerHash = null;
      this.renderAll();
    });
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
    // Debt summary + contracts (หลายสัญญา) — แสดงทุกสัญญาเต็ม
    let debtHTML = '';
    if (c.cif && typeof DebtDB !== 'undefined') {
      if (!DebtDB._loaded) {
        // ยังโหลดข้อมูลหนี้ไม่เสร็จ — โชว์สถานะ ไม่ใช่ "ไม่มีข้อมูล"
        const label = DebtDB._loading ? '⏳ กำลังโหลดข้อมูลหนี้...' : 'ข้อมูลหนี้โหลดไม่สำเร็จ';
        debtHTML = `<div class="popup-debt"><div class="debt-nodata">${label}</div></div>`;
      } else {
        const debt = DebtDB.getByCif(c.cif);
        if (debt) {
          debtHTML = `
          <div class="popup-debt">
            ${DebtDB.summaryHTML(debt)}
            ${DebtDB.contractsHTML(debt, true)}
          </div>
        `;
        } else {
          debtHTML = `<div class="popup-debt"><div class="debt-nodata">ไม่มีข้อมูลหนี้</div></div>`;
        }
      }
    }
    return `
      <div class="popup-name">${this.escapeHTML(c.name)}</div>
      ${c.cif ? `<div class="popup-addr" style="font-size:11px;">CIF: ${this.escapeHTML(c.cif)}</div>` : ''}
      ${metaHTML}
      ${debtHTML}
      ${c.address ? `<div class="popup-addr">${this.escapeHTML(c.address)}</div>` : ''}
      ${c.phone ? `<div class="popup-addr">📞 ${this.escapeHTML(c.phone)}</div>` : ''}
      <div class="popup-actions">
        <button class="popup-nav" onclick="Customers.navigate(${Number(c.lat)},${Number(c.lng)})">🧭 นำทาง</button>
        <button class="popup-edit" onclick="Customers.edit('${this.escapeAttr(c.id)}')">✏️ แก้ไข</button>
        <button class="popup-del" onclick="Customers.del('${this.escapeAttr(c.id)}')">🗑️</button>
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
    form.elements.lat.value = c.lat || '';
    form.elements.lng.value = c.lng || '';
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

  // ===== Pin existing customer on map (fast GPS update) =====
  _showPinOptions(lat, lng) {
    // ลบ panel เดิมถ้ามี
    const old = document.getElementById('pin-options-panel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = 'pin-options-panel';
    panel.className = 'pin-options-panel';
    panel.innerHTML = `
      <div class="pin-options-header">
        📍 ปักหมุดที่ ${lat.toFixed(5)}, ${lng.toFixed(5)}
        <button class="pin-close" onclick="document.getElementById('pin-options-panel').remove()">×</button>
      </div>
      <div class="pin-options-body">
        <button class="pin-btn pin-btn-existing" onclick="Customers._startPinExisting(${lat}, ${lng})">
          🔍 ค้นหาลูกค้าเดิม → ปักหมุด
        </button>
        <button class="pin-btn pin-btn-new" onclick="Customers._addNewAtLocation(${lat}, ${lng})">
          ➕ เพิ่มลูกค้าใหม่
        </button>
      </div>
    `;
    document.body.appendChild(panel);
  },

  // เพิ่มลูกค้าใหม่ ณ ตำแหน่งที่เลือก (เปิด modal เดิม)
  _addNewAtLocation(lat, lng) {
    document.getElementById('pin-options-panel')?.remove();
    const latEl = document.getElementById('new-lat');
    const lngEl = document.getElementById('new-lng');
    if (latEl) latEl.value = lat.toFixed(6);
    if (lngEl) lngEl.value = lng.toFixed(6);
    App.openAddCustomerModal();
  },

  // ค้นหาลูกค้าเดิม → ปักหมุดตรงๆ
  _startPinExisting(lat, lng) {
    document.getElementById('pin-options-panel')?.remove();

    const old = document.getElementById('pin-search-panel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = 'pin-search-panel';
    panel.className = 'pin-options-panel';
    panel.innerHTML = `
      <div class="pin-options-header">
        🔍 เลือกลูกค้าที่ต้องการปักหมุด
        <button class="pin-close" onclick="document.getElementById('pin-search-panel').remove()">×</button>
      </div>
      <div class="pin-search-input-wrap">
        <input type="text" id="pin-search-input" placeholder="พิมพ์ CIF หรือ ชื่อ..." autocomplete="off">
      </div>
      <div id="pin-search-results" class="pin-search-results"></div>
    `;
    document.body.appendChild(panel);

    const input = document.getElementById('pin-search-input');
    const results = document.getElementById('pin-search-results');
    input.focus();

    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const q = input.value.trim().toLowerCase();
        if (q.length < 2) { results.innerHTML = ''; return; }

        const customers = Storage.getActiveCustomers();
        const matches = customers.filter(c => {
          const name = (c.name || '').toLowerCase();
          const cif = (c.cif || '').toLowerCase();
          const nick = (c.nickname || '').toLowerCase();
          return name.includes(q) || cif.includes(q) || nick.includes(q);
        }).slice(0, 20);

        if (matches.length === 0) {
          results.innerHTML = '<div class="pin-search-hint">❌ ไม่พบ</div>';
          return;
        }

        results.innerHTML = matches.map(c => {
          const hasGps = c.lat && c.lng;
          return `
            <div class="pin-search-item" data-id="${this.escapeAttr(c.id)}" data-cif="${this.escapeAttr(c.cif || '')}">
              <div class="pin-search-name">${this.escapeHTML(c.name)}</div>
              <div class="pin-search-meta">
                CIF: ${this.escapeHTML(c.cif || '-')}
                ${hasGps ? ' · 📍 มีพิกัด' : ' · ⚠️ ไม่มีพิกัด'}
              </div>
            </div>
          `;
        }).join('');

        results.querySelectorAll('.pin-search-item').forEach(el => {
          el.addEventListener('click', () => {
            const id = el.dataset.id;
            const cif = el.dataset.cif;
            this._confirmPin(id, cif, lat, lng);
          });
        });
      }, 200);
    });
  },

  // ยืนยันการปักหมุด → ยิง PUT ตรง
  async _confirmPin(id, cif, lat, lng) {
    const c = Storage.getCustomers().find(x => x.id === id);
    if (!c) return Utils.toast('ไม่พบลูกค้า', 'error');

    const oldGps = c.lat && c.lng ? `(${Number(c.lat).toFixed(5)}, ${Number(c.lng).toFixed(5)})` : 'ยังไม่มี';
    // ใช้ custom dialog — iOS Safari confirm() ไม่แสดงตอนแป้นพิมพ์ค้างเปิด
    const ok = await Utils.confirmDialog({
      title: '📍 ปักหมุดลูกค้า',
      message: `"${c.name}"\n\nพิกัดเดิม: ${oldGps}\nพิกัดใหม่: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      confirmText: 'ปักหมุดเลย',
    });
    if (!ok) return;

    // ปิด panel ค้นหา
    document.getElementById('pin-search-panel')?.remove();

    Utils.toast('⏳ กำลังบันทึกพิกัด...');

    try {
      // ยิง PUT ตรงไปที่ /api/customers/:cif (ไม่ต้อง sync ทั้งหมด)
      const token = Auth.getToken();
      const res = await fetch(`/api/customers/${encodeURIComponent(c.cif)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ lat, lng }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      // อัปเดต local storage
      c.lat = lat;
      c.lng = lng;
      c.updatedAt = new Date().toISOString();
      Storage.saveCustomers(Storage.getCustomers());
      if (c.cif && Storage.markDirty) Storage.markDirty(c.cif);

      // อัปเดต marker บนแผนที่
      this._lastMarkerHash = null;   // force rebuild — marker hash ยังไม่เห็น lat/lng ใหม่
      this.renderAll();

      // Push ทันที → เครื่องอื่นเห็นภายใน poll cycle (ไม่ต้องรอ 15วิ + delta miss)
      if (typeof Storage !== 'undefined' && Storage.push) Storage.push();

      Utils.toast(`📍 ปักหมุด "${c.name}" สำเร็จ!`);
    } catch (err) {
      Utils.toast('❌ บันทึกไม่สำเร็จ: ' + err.message, 'error');
    }
  },

  // Render customer list (Customers tab) — with infinite scroll
  _filteredCustomers: [],
  _renderedListOffset: 0,
  _listScrollHandler: null,

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

    // Zone filter (เขตสินเชื่อ — T3)
    const zoneSel = document.getElementById('customer-zone');
    const zoneVal = zoneSel?.value || '';
    if (zoneVal && typeof CustomerDB !== 'undefined' && CustomerDB._loaded) {
      customers = customers.filter(c => {
        const db = c.cif ? CustomerDB.getByCif(c.cif) : null;
        return db && String(db.zone) === String(zoneVal);
      });
    }

    // Search filter
    const searchQuery = (document.getElementById('customer-search')?.value || '').trim().toLowerCase();
    if (searchQuery) {
      customers = customers.filter(c => {
        const haystack = `${c.cif || ''} ${c.name || ''} ${c.phone || ''} ${c.address || ''} ${c.note || ''}`.toLowerCase();
        return haystack.includes(searchQuery);
      });
    }

    // Sort
    const sortBy = document.getElementById('customer-sort')?.value || 'name';
    customers = this._sortCustomers(customers, sortBy);

    document.getElementById('customer-count').textContent = customers.length;

    if (customers.length === 0) {
      const msg = searchQuery
        ? `ไม่พบลูกค้าที่ตรงกับ "${searchQuery}"`
        : 'ยังไม่มีลูกค้า กดปุ่ม <strong>＋</strong> มุมขวาล่างเพื่อเพิ่ม';
      list.innerHTML = `<p class="empty-state">${msg}</p>`;
      return;
    }

    // Store filtered list and reset offset
    this._filteredCustomers = customers;
    this._renderedListOffset = 0;
    list.innerHTML = '';

    // Render first batch
    this._appendCustomerBatch(list, 30);

    // Set up infinite scroll (remove old handler first)
    if (this._listScrollHandler) list.removeEventListener('scroll', this._listScrollHandler);
    this._listScrollHandler = Utils.debounce(() => {
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 300) {
        this._appendCustomerBatch(list, 20);
      }
    }, 80);
    list.addEventListener('scroll', this._listScrollHandler, { passive: true });
  },

  _appendCustomerBatch(container, count) {
    const customers = this._filteredCustomers;
    const start = this._renderedListOffset;
    const end = Math.min(start + count, customers.length);
    if (start >= end) return;

    const visits = Storage.getVisits();
    const route = Storage.getRoute();
    const frag = document.createDocumentFragment();
    const tmp = document.createElement('div');

    for (let i = start; i < end; i++) {
      const c = customers[i];
      const visited = !!visits[c.id];
      const inRoute = route.includes(c.id);
      const hasCoords = Number.isFinite(c.lat) && Number.isFinite(c.lng);
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
      let debtMini = '';
      if (c.cif && typeof DebtDB !== 'undefined') {
        if (!DebtDB._loaded) {
          debtMini = `<div class="customer-debt debt-loading"><span>⏳ กำลังโหลดข้อมูลหนี้...</span></div>`;
        } else {
          const debt = DebtDB.getByCif(c.cif);
          if (debt) {
            const urgent = debt.max_tier >= 2;
            debtMini = `<div class="customer-debt ${urgent ? 'debt-urgent' : ''}" style="border-left-color:${DebtDB.tierColor(debt.max_tier)}">
            <span>💰 ${DebtDB.fmtMoney(debt.total_debt)}</span>
            <span>${debt.num_contracts} สัญญา</span>
            <span>📅 ${DebtDB.fmtDate(debt.earliest_due) || '-'}</span>
          </div>`;
          }
        }
      }
      tmp.innerHTML = `<div class="customer-card ${visited ? 'visited' : ''}">
          <div class="customer-avatar">${visited ? '✓' : '👤'}</div>
          <div class="customer-info">
            <div class="customer-name">${this.escapeHTML(c.name)}</div>
            ${c.cif ? `<div class="customer-cif">CIF: ${this.escapeHTML(c.cif)}</div>` : ''}
            <div class="customer-address">${this.escapeHTML(c.address || 'ไม่มีที่อยู่')}</div>
            ${metaBadges.length ? `<div class="customer-meta">${metaBadges.join('')}</div>` : ''}
            ${debtMini}
          </div>
          <div class="customer-actions">
            ${hasCoords ? `<button class="btn-small btn-locate" onclick="Customers.locateCustomer('${c.id}')" title="ไปพิกัดบนแผนที่">📍</button>` : ''}
            <button class="btn-small ${inRoute ? 'btn-route-active' : ''}" onclick="Customers.toggleRoute('${c.id}')" title="เพิ่มในเส้นทาง">
              ${inRoute ? '✓' : '➕'}
            </button>
            <button class="btn-small" onclick="Customers.edit('${c.id}')" title="แก้ไข">✏️</button>
            <button class="btn-small btn-danger" onclick="Customers.del('${c.id}')" title="ลบลูกค้า">🗑️</button>
          </div>
        </div>`;
      frag.appendChild(tmp.firstChild);
    }
    container.appendChild(frag);
    this._renderedListOffset = end;
  },

  // T2: พาไปพิกัดลูกค้าบนแผนที่ (ปุ่ม 📍 ในการ์ด)
  locateCustomer(id) {
    const c = this._filteredCustomers.find(x => x.id === id) ||
              Storage.getActiveCustomers().find(x => x.id === id);
    if (!c) return;
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) {
      Utils.toast('⚠️ ลูกค้านี้ยังไม่มีพิกัด', 'error');
      return;
    }
    // พับ bottom sheet ลง → เห็นแผนที่เต็มจอ
    if (typeof App !== 'undefined' && App.setSheetState) App.setSheetState('peek');
    // เดินทางไปพิกัด + เปิด popup marker
    if (this.map) {
      this.map.flyTo([c.lat, c.lng], 17, { duration: 0.8 });
      setTimeout(() => {
        const m = this.markers[c.id];
        if (m) this.map.openPopup(m);
      }, 900);
    }
  },

  // Toggle customer in today's route
  toggleRoute(id) {
    const route = Storage.getRoute();
    if (route.includes(id)) {
      Storage.removeFromRoute(id);
      Utils.toast('เอาออกจากเส้นทาง');
    } else {
      if (!Storage.addToRoute(id)) {
        Utils.toast('⚠️ ลูกค้านี้ยังไม่มีพิกัด — เพิ่มพิกัดก่อนจึงจะวางเส้นทางได้', 'error');
        return;
      }
      Utils.toast('เพิ่มในเส้นทางวันนี้ ✓');
    }
    this.renderList();
    App.updateRouteUI();
  },

  // Sort customers by different criteria
  _sortCustomers(customers, sortBy) {
    const sorted = [...customers];
    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th'));
        break;
      case 'cif':
        sorted.sort((a, b) => (a.cif || '').localeCompare(b.cif || ''));
        break;
      case 'risk':
        const riskOrder = { bad: 0, warning: 1, good: 2, unclassified: 3 };
        sorted.sort((a, b) => (riskOrder[a.riskLevel] ?? 3) - (riskOrder[b.riskLevel] ?? 3));
        break;
      case 'recent':
        sorted.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
        break;
    }
    return sorted;
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
            const layer = btn.dataset.layer;
            Customers.switchBaseLayer(layer);
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
    const customersTab = document.getElementById('tab-customers');
    if (customersTab && customersTab.classList.contains('active')) {
      this.renderList();
    }
  },

  escapeHTML(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  },

  // Escape for use inside HTML attribute values (single/double quotes + ampersand)
  escapeAttr(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },
};

window.Customers = Customers;
// ===== TSP (Travelling Salesman) — open path with start + optional end =====
// Algorithm: Nearest-Neighbor heuristic + 2-opt improvement
// Supports: round trip (start == end) OR open path (different end)

const TSP = {
  // Nearest-neighbor TSP heuristic
  // If end is provided: open path (start → ... → end, don't return)
  // If end is null: round trip (return to start)
  nearestNeighbor(start, customers, end) {
    if (customers.length === 0) return [];
    if (customers.length === 1) return [customers[0].id];

    const remaining = [...customers];
    const order = [];
    let current = { lat: start.lat, lng: start.lng, id: 'start' };

    while (remaining.length > 0) {
      let nearestIdx = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = Utils.haversine(current.lat, current.lng, remaining[i].lat, remaining[i].lng);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }
      const next = remaining.splice(nearestIdx, 1)[0];
      order.push({ id: next.id, dist: nearestDist });
      current = next;
    }

    return order.map(o => o.id);
  },

  // 2-opt improvement (swap to reduce total distance)
  // end: optional endpoint to consider
  twoOpt(route, start, end) {
    if (route.length < 3) return route;
    const customers = Storage.getActiveCustomers();
    const custMap = new Map(customers.map(c => [c.id, c]));

    function totalDistance(order) {
      let total = 0;
      let prev = { lat: start.lat, lng: start.lng };
      for (const id of order) {
        const c = custMap.get(id);
        if (!c) continue;
        total += Utils.haversine(prev.lat, prev.lng, c.lat, c.lng);
        prev = c;
      }
      // Add distance to endpoint
      const finalPoint = end || start;
      total += Utils.haversine(prev.lat, prev.lng, finalPoint.lat, finalPoint.lng);
      return total;
    }

    let best = [...route];
    let bestDist = totalDistance(best);
    let improved = true;
    let iter = 0;
    const maxIter = 50;

    while (improved && iter < maxIter) {
      improved = false;
      iter++;
      for (let i = 0; i < best.length - 1; i++) {
        for (let j = i + 1; j < best.length; j++) {
          const newRoute = [
            ...best.slice(0, i),
            ...best.slice(i, j + 1).reverse(),
            ...best.slice(j + 1),
          ];
          const newDist = totalDistance(newRoute);
          if (newDist < bestDist * 0.999) {
            best = newRoute;
            bestDist = newDist;
            improved = true;
          }
        }
      }
    }
    return best;
  },

  // Plan route: nearest-neighbor + 2-opt
  // start: {lat, lng} — required
  // customerIds: array of customer IDs to visit
  // end: {lat, lng} — optional endpoint (default: return to start = round trip)
  plan(start, customerIds, end) {
    const allCustomers = Storage.getActiveCustomers();
    const selectedCustomers = customerIds
      .map(id => allCustomers.find(c => c.id === id))
      .filter(Boolean);
    if (selectedCustomers.length === 0) return [];

    // Step 1: nearest-neighbor
    const nnOrder = this.nearestNeighbor(start, selectedCustomers, end);
    // Step 2: improve with 2-opt
    const optimized = this.twoOpt(nnOrder, start, end);
    return optimized;
  },
};

window.TSP = TSP;
// ===== Route planning — merged with Quick (search + chips + drag/drop) =====
//
// Single source of truth for the "เส้นทาง" tab. Replaces the old Quick tab.
// Flow:
//   1. Customer tab → click "+เพิ่มในเส้นทางวันนี้" → Storage.addToRoute(id)
//   2. Route tab search → click + button → Route.toggle(id) → Storage.addToRoute(id)
//   3. App.updateRouteUI() re-renders chips (drag&drop + ▲▼ + ×)
//   4. "Calculate" = uses manual order (default), "Optimize" = TSP opt-in
//
// All state lives in Storage.getRoute() — no separate Quick state.

const Route = {
  MAX_SELECT: 10,
  routeLine: null,
  endMarker: null,
  currentResult: null,
  eventsAttached: false,

  // ===== Event attachment (called once) =====
  attachEvents() {
    if (this.eventsAttached) return;
    this.eventsAttached = true;

    const search = document.getElementById('route-search');
    if (search) {
      search.addEventListener('input', () => this.search(search.value));
      search.addEventListener('focus', () => {
        if (search.value.trim()) this.search(search.value);
      });
      // Close dropdown on outside click
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.route-search-box')) {
          const el = document.getElementById('route-search-results');
          if (el) el.classList.remove('active');
        }
      });
    }
    const btnClear = document.getElementById('btn-clear-route');
    if (btnClear) btnClear.addEventListener('click', () => this.clear());
    const btnOptimize = document.getElementById('btn-optimize-route');
    if (btnOptimize) btnOptimize.addEventListener('click', () => App.calculateRoute(true));
  },

  // ===== Search customers by CIF, name, phone, address =====
  search(query) {
    const q = (query || '').trim().toLowerCase();
    const resultsEl = document.getElementById('route-search-results');
    if (!resultsEl) return;

    if (q.length < 1) {
      resultsEl.classList.remove('active');
      resultsEl.innerHTML = '';
      return;
    }

    const customers = Storage.getActiveCustomers();
    const route = Storage.getRoute();
    const matches = customers.filter(c => {
      const haystack = `${c.cif || ''} ${c.name || ''} ${c.phone || ''} ${c.address || ''}`.toLowerCase();
      return haystack.includes(q);
    }).slice(0, 10); // limit results

    if (matches.length === 0) {
      resultsEl.innerHTML = `<div style="padding:16px;text-align:center;color:#5a655a;font-size:13px">ไม่พบลูกค้าที่ตรงกับ "${this.escapeHTML(query)}"</div>`;
      resultsEl.classList.add('active');
      return;
    }

    resultsEl.innerHTML = matches.map(c => {
      const isSelected = route.includes(c.id);
      const disabled = isSelected ? 'disabled' : '';
      return `
        <div class="route-search-result-item">
          <div class="route-search-result-info">
            <div class="route-search-result-name">${this.escapeHTML(c.name)}</div>
            <div class="route-search-result-meta">${c.address ? this.escapeHTML(c.address) : 'ไม่มีที่อยู่'}${c.phone ? ' · ' + this.escapeHTML(c.phone) : ''}</div>
          </div>
          <span class="route-search-result-cif">${this.escapeHTML(c.cif || '-')}</span>
          <button class="route-search-result-add" ${disabled} onclick="Route.toggle('${c.id}')" title="${isSelected ? 'เลือกแล้ว' : 'เพิ่ม'}">
            ${isSelected ? '✓' : '+'}
          </button>
        </div>
      `;
    }).join('');
    resultsEl.classList.add('active');
  },

  // ===== Toggle customer in route (add or remove) =====
  toggle(id) {
    const route = Storage.getRoute();
    const idx = route.indexOf(id);
    if (idx >= 0) {
      Storage.removeFromRoute(id);
    } else {
      if (route.length >= this.MAX_SELECT) {
        Utils.toast(`เลือกได้สูงสุด ${this.MAX_SELECT} คน`, 'error');
        return;
      }
      if (!Storage.addToRoute(id)) {
        Utils.toast('⚠️ ลูกค้านี้ยังไม่มีพิกัด — เพิ่มพิกัดก่อนจึงจะวางเส้นทางได้', 'error');
        return;
      }
    }
    // Re-search to update + button states (✓/disabled)
    const search = document.getElementById('route-search');
    if (search && search.value) this.search(search.value);
    // Re-render chips
    App.updateRouteUI();
  },

  // ===== Clear all selected customers =====
  clear() {
    Storage.saveRoute([]);
    App.updateRouteUI();
    const resultEl = document.getElementById('route-result');
    if (resultEl) resultEl.classList.add('hidden');
    Utils.toast('ล้างรายการแล้ว');
  },

  // ===== Move chip up/down (▲▼ buttons) =====
  move(idx, dir) {
    const route = Storage.getRoute();
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= route.length) return;
    [route[idx], route[newIdx]] = [route[newIdx], route[idx]];
    Storage.saveRoute(route);
    App.updateRouteUI();
    // Re-search to refresh + button states
    const search = document.getElementById('route-search');
    if (search && search.value) this.search(search.value);
  },

  // ===== Drag & drop reordering =====
  dragStart(e, idx) {
    e.dataTransfer.setData('text/plain', idx.toString());
    e.dataTransfer.effectAllowed = 'move';
    e.target.classList.add('dragging');
  },
  dragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  },
  drop(e, targetIdx) {
    e.preventDefault();
    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (fromIdx === targetIdx) return;
    const route = Storage.getRoute();
    if (fromIdx < 0 || fromIdx >= route.length) return;
    [route[fromIdx], route[targetIdx]] = [route[targetIdx], route[fromIdx]];
    Storage.saveRoute(route);
    App.updateRouteUI();
    const search = document.getElementById('route-search');
    if (search && search.value) this.search(search.value);
  },
  dragEnd(e) {
    e.target.classList.remove('dragging');
  },

  // ===== Calculate route using OSRM =====
  // start: {lat, lng} — required start point
  // orderedCustomerIds: array of customer IDs in visit order (already sorted)
  // end: {lat, lng} — optional endpoint (default: return to start)
  async calculate(start, orderedCustomerIds, end) {
    const customers = Storage.getActiveCustomers();
    const stops = orderedCustomerIds
      .map(id => customers.find(c => c.id === id))
      .filter(Boolean);

    if (stops.length === 0) {
      Utils.toast('กรุณาเพิ่มลูกค้าในเส้นทางก่อน', 'error');
      return null;
    }

    Utils.toast('🧮 กำลังคำนวณเส้นทาง...');

    const isOpenPath = end && (end.lat !== start.lat || end.lng !== start.lng);

    // Build coordinates: start → stops → [end] or back to start
    const coordList = [
      { lat: start.lat, lng: start.lng },
      ...stops.map(c => ({ lat: c.lat, lng: c.lng })),
    ];
    if (isOpenPath) {
      coordList.push({ lat: end.lat, lng: end.lng });
    } else {
      // Round trip: เพิ่มจุดเริ่มต้นต่อท้าย (รวมขากลับ)
      coordList.push({ lat: start.lat, lng: start.lng });
    }

    const coords = coordList.map(p => `${p.lng},${p.lat}`).join(';');

    try {
      // OSRM public API
      const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error('OSRM ไม่สามารถคำนวณเส้นทางได้');
      }

      const route = data.routes[0];
      const result = {
        distance: route.distance, // meters
        duration: route.duration, // seconds
        stops,
        geometry: route.geometry,
        order: orderedCustomerIds,
        start: { ...start },
        end: isOpenPath ? { ...end } : null,  // null = round trip
        isOpenPath: !!isOpenPath,
        // Fuel calculation
        fuel: Utils.calcFuel(route.distance),
      };
      this.currentResult = result;
      return result;
    } catch (err) {
      console.warn('OSRM failed, using haversine fallback:', err);
      // Fallback: use haversine + estimate 40 km/h average speed
      let totalDist = 0;
      let prev = start;
      for (const c of stops) {
        totalDist += Utils.haversine(prev.lat, prev.lng, c.lat, c.lng);
        prev = c;
      }
      // Add distance to endpoint
      if (isOpenPath) {
        totalDist += Utils.haversine(prev.lat, prev.lng, end.lat, end.lng);
      }
      // Add 30% detour factor for road vs straight-line
      const estDist = totalDist * 1.3;
      
      // Calculate duration based on vehicle type and road classification
      const vehicleType = Utils.getVehicle();
      const roadClassification = document.getElementById('road-classification')?.value || 'auto';
      const vehicleProfile = Utils.VEHICLE_PROFILES[vehicleType];
      
      let speed = 40; // Default speed
      if (vehicleProfile) {
        if (roadClassification !== 'auto') {
          speed = vehicleProfile.speed[roadClassification] || vehicleProfile.speed.road || 40;
        } else {
          // Use average speed based on vehicle type
          speed = (vehicleProfile.speed.highway + vehicleProfile.speed.road + vehicleProfile.speed.village + vehicleProfile.speed.dirt) / 4;
        }
      }
      const estDuration = (estDist / 1000) / speed * 3600; // Convert to seconds
      
      const result = {
        distance: estDist,
        duration: estDuration,
        stops,
        geometry: null,
        order: orderedCustomerIds,
        start: { ...start },
        end: isOpenPath ? { ...end } : null,
        isOpenPath: !!isOpenPath,
        fuel: Utils.calcFuel(estDist),
        estimated: true,
        // Vehicle and road info
        vehicleType: vehicleType,
        roadClassification: roadClassification,
        vehicleProfile: vehicleProfile,
      };
      this.currentResult = result;
      Utils.toast('⚠️ ใช้การประมาณ (OSRM ไม่ตอบสนอง)');
      return result;
    }
  },

  // ===== Show result on UI =====
  showResult(result) {
    const resultEl = document.getElementById('route-result');
    resultEl.classList.remove('hidden');

    document.getElementById('result-distance').textContent = Utils.formatKm(result.distance);
    document.getElementById('result-duration').textContent = Math.round(result.duration / 60);
    document.getElementById('result-stops').textContent = result.stops.length;

    // Show route type + fuel info
    const routeTypeEl = document.getElementById('result-route-type');
    if (routeTypeEl) {
      routeTypeEl.textContent = result.isOpenPath
        ? '🔀 เปิด (มีจุดสิ้นสุด)'
        : '🔄 ไป-กลับ';
    }
    
    // Show vehicle and road info
    if (result.vehicleProfile) {
      const vehicleInfo = document.getElementById('result-vehicle-info');
      if (vehicleInfo) {
        vehicleInfo.textContent = `${result.vehicleProfile.name} · ${result.roadClassification}`;
      }
    }
    // Fuel display
    const fuelEl = document.getElementById('result-fuel');
    if (fuelEl && result.fuel) {
      const v = result.fuel.vehicle;
      const fuelName = v.fuelName || '';
      const fuelPrice = v.fuelPrice || '?';
      const fuelDiff = v.fuelDiff != null ? v.fuelDiff : 0;
      const fuelUpdated = Utils.getFuelUpdated();
      const diffBadge = fuelDiff > 0
        ? `<span class="fuel-diff up">▲ ${fuelDiff.toFixed(2)}</span>`
        : fuelDiff < 0
          ? `<span class="fuel-diff down">▼ ${Math.abs(fuelDiff).toFixed(2)}</span>`
          : '';
      fuelEl.innerHTML = `
        <div class="fuel-card">
          <div class="fuel-icon">⛽</div>
          <div class="fuel-info">
            <div class="fuel-amount">~${result.fuel.liters.toFixed(2)} ลิตร</div>
            <div class="fuel-cost">~${Utils.formatBaht(result.fuel.baht)} บาท</div>
            <div class="fuel-meta">${v.name} · ${v.kmPerLiter} กม./ลิตร · ${fuelName} ${fuelPrice} บาท/ล ${diffBadge}</div>
            ${fuelUpdated ? `<div class="fuel-date">📅 อัปเดตราคา ${fuelUpdated}</div>` : ''}
          </div>
        </div>
      `;
    }

    // Build order list
    const orderEl = document.getElementById('route-order');
    orderEl.innerHTML = result.stops.map((c, idx) => {
      let distFromPrev = 0;
      if (idx === 0) {
        const start = this.getStartCoords();
        distFromPrev = Utils.haversine(start.lat, start.lng, c.lat, c.lng);
      } else {
        const prev = result.stops[idx - 1];
        distFromPrev = Utils.haversine(prev.lat, prev.lng, c.lat, c.lng);
      }
      return `
        <li>
          <div class="order-num">${idx + 1}</div>
          <div class="order-info">
            <div class="order-name">${this.escapeHTML(c.name)}</div>
            <div class="order-distance">📍 ${Utils.formatKm(distFromPrev)} กม.</div>
          </div>
        </li>
      `;
    }).join('');

    // Draw on map
    this.drawOnMap(result);
  },

  // ===== Get start coordinates =====
  getStartCoords() {
    const mode = document.getElementById('route-start-mode').value;
    if (mode === 'custom') {
      return {
        lat: parseFloat(document.getElementById('start-lat').value),
        lng: parseFloat(document.getElementById('start-lng').value),
      };
    } else if (mode === 'office') {
      // BAAC สาขาวังท่าช้าง (single source of truth in app.js)
      return { lat: window.OFFICE_LOCATION.lat, lng: window.OFFICE_LOCATION.lng };
    } else if (mode === 'last-stop') {
      // End of last leg — use the last customer in the route
      return window._routeEnd || { lat: window.OFFICE_LOCATION.lat, lng: window.OFFICE_LOCATION.lng };
    }
    // current — use last known GPS
    return window._lastGPS || { lat: window.OFFICE_LOCATION.lat, lng: window.OFFICE_LOCATION.lng };
  },

  // ===== Get end coordinates (for open-path route) =====
  getEndCoords() {
    const mode = document.getElementById('route-end-mode')?.value || 'none';
    if (mode === 'none') return null; // round trip
    if (mode === 'current') {
      return window._lastGPS || { lat: window.OFFICE_LOCATION.lat, lng: window.OFFICE_LOCATION.lng };
    }
    if (mode === 'office') {
      return { lat: window.OFFICE_LOCATION.lat, lng: window.OFFICE_LOCATION.lng };
    }
    if (mode === 'customer') {
      const sel = document.getElementById('route-end-customer');
      if (sel && sel.value) {
        const c = Storage.getCustomers().find(x => x.id === sel.value);
        if (c) return { lat: c.lat, lng: c.lng, name: c.name };
      }
    }
    return null;
  },

  // ===== Draw route on map =====
  drawOnMap(result) {
    if (this.routeLine && Customers.map) {
      Customers.map.removeLayer(this.routeLine);
      this.routeLine = null;
    }
    // Remove old end marker
    if (this.endMarker && Customers.map) {
      Customers.map.removeLayer(this.endMarker);
      this.endMarker = null;
    }

    if (result.geometry && Customers.map) {
      const coords = result.geometry.coordinates.map(c => [c[1], c[0]]);
      this.routeLine = L.polyline(coords, {
        color: '#0a8f3c',
        weight: 5,
        opacity: 0.8,
      }).addTo(Customers.map);
    }
    // Re-render markers with route order numbers
    Customers.renderMarkers(result.order);
    // Add end marker (if open path)
    if (result.isOpenPath && result.end && Customers.map) {
      this.endMarker = L.marker([result.end.lat, result.end.lng], {
        icon: L.divIcon({
          className: 'end-marker',
          html: '<div class="end-pin">🏁</div>',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        }),
      }).addTo(Customers.map).bindPopup(
        `<b>🏁 จุดสิ้นสุด</b><br>${this.escapeHTML(result.end.name || 'ปลายทาง')}`
      );
    }
    // Fit bounds to entire route (or markers)
    if (this.routeLine) {
      Customers.map.fitBounds(this.routeLine.getBounds(), { padding: [50, 50] });
    }
  },

  // ===== Open in Google Maps =====
  // Uses ?api=1 + waypoints= query params (iOS-compatible)
  openGoogleMaps() {
    if (!this.currentResult) return;
    const start = this.getStartCoords();
    const end = this.currentResult.end;
    const dest = end || start;
    const waypoints = this.currentResult.stops
      .map(c => `${c.lat},${c.lng}`)
      .join('|');
    const url = `https://www.google.com/maps/dir/?api=1` +
      `&origin=${start.lat},${start.lng}` +
      `&destination=${dest.lat},${dest.lng}` +
      `&waypoints=${waypoints}` +
      `&travelmode=driving`;
    window.open(url, '_blank');
  },

  // ===== Save route snapshot =====
  saveRoute() {
    if (!this.currentResult) return;
    const route = {
      ...this.currentResult,
      savedAt: new Date().toISOString(),
      savedBy: Auth.getUser()?.name,
    };
    // Save to cloud via Storage (auto-sync)
    Storage.saveSavedRoute(route);
    Utils.toast('💾 บันทึกเส้นทางแล้ว — sync ทุกเครื่อง');
  },

  // ===== Route Templates =====
  // Save current route as a reusable template
  saveAsTemplate(name) {
    const routeIds = Storage.getRoute();
    if (!routeIds.length) {
      Utils.toast('⚠️ ไม่มีเส้นทางให้บันทึกเป็นเทมเพลต', 'error');
      return;
    }
    const templates = this._getTemplates();
    templates.push({
      id: Utils.uuid(),
      name: name || `เส้นทาง ${new Date().toLocaleDateString('th-TH')}`,
      routeIds: [...routeIds],
      createdAt: new Date().toISOString(),
      createdBy: Auth.getUser()?.name,
    });
    localStorage.setItem('bfr_route_templates', JSON.stringify(templates));
    Utils.toast(`📋 บันทึกเทมเพลต "${name}" แล้ว`);
  },

  // Load a template into current route
  loadTemplate(templateId) {
    const templates = this._getTemplates();
    const template = templates.find(t => t.id === templateId);
    if (!template) {
      Utils.toast('❌ ไม่พบเทมเพลต', 'error');
      return;
    }
    Storage.saveRoute(template.routeIds);
    App.updateRouteUI();
    Utils.toast(`📋 โหลดเทมเพลต "${template.name}" แล้ว`);
  },

  // Get all templates
  _getTemplates() {
    try {
      return JSON.parse(localStorage.getItem('bfr_route_templates') || '[]');
    } catch {
      return [];
    }
  },

  // Delete a template
  deleteTemplate(templateId) {
    let templates = this._getTemplates();
    templates = templates.filter(t => t.id !== templateId);
    localStorage.setItem('bfr_route_templates', JSON.stringify(templates));
    Utils.toast('🗑️ ลบเทมเพลตแล้ว');
  },

  // ===== Route History =====
  // Save completed route to history
  saveToHistory(result) {
    if (!result) return;
    const history = this._getHistory();
    history.unshift({
      id: Utils.uuid(),
      distance: result.distance,
      duration: result.duration,
      stops: result.stops.map(c => ({ id: c.id, name: c.name, cif: c.cif })),
      fuel: result.fuel,
      completedAt: new Date().toISOString(),
      completedBy: Auth.getUser()?.name,
    });
    // Keep only last 20 routes
    if (history.length > 20) history.length = 20;
    localStorage.setItem('bfr_route_history', JSON.stringify(history));
  },

  // Get route history
  _getHistory() {
    try {
      return JSON.parse(localStorage.getItem('bfr_route_history') || '[]');
    } catch {
      return [];
    }
  },

  // Load a historical route
  loadFromHistory(historyId) {
    const history = this._getHistory();
    const entry = history.find(h => h.id === historyId);
    if (!entry) {
      Utils.toast('❌ ไม่พบเส้นทางในประวัติ', 'error');
      return;
    }
    const routeIds = entry.stops.map(s => s.id);
    Storage.saveRoute(routeIds);
    App.updateRouteUI();
    Utils.toast(`📋 โหลดเส้นทางจากประวัติแล้ว`);
  },

  escapeHTML(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  },
};
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
    
    // Set quick status buttons
    const status = existing?.status || 'visited';
    this.setQuickStatus(status);
    
    form.elements.note.value = existing?.note || '';
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
    const data = {
      status: document.getElementById('visit-status-select').value,
      note: form.elements.note.value,
    };
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
// ===== Report: generate + export follow-up report =====
// Phase 7-9: BAAC debt follow-up report
// - Per day breakdown (visits + GPS + ค่าน้ำมัน)
// - เบี้ยเลี้ยง 160฿/วัน เมื่อ ≥10 upcoming OR ≥5 overdue
// - Export: HTML print, CSV, Share text

const Report = {
  // ===== Constants =====
  ALLOWANCE_PER_DAY: 160,
  THRESHOLD_UPCOMING: 10,  // หนี้ถึงกำหนด ≥ 10 ราย → ได้เบี้ยเลี้ยง
  THRESHOLD_OVERDUE: 5,    // หนี้ค้าง ≥ 5 ราย → ได้เบี้ยเลี้ยง

  // ===== Open report modal =====
  open() {
    document.getElementById('report-modal').classList.remove('hidden');
    // Set default range to "this week"
    this.setRange('week');
  },

  close() {
    document.getElementById('report-modal').classList.add('hidden');
  },

  // ===== Render simple bar chart =====
  _renderBarChart(days) {
    if (!days.length) return '';
    
    const maxVisits = Math.max(...days.map(d => d.visits.length), 1);
    
    let html = '<div class="bar-chart">';
    for (const day of days) {
      const pct = (day.visits.length / maxVisits) * 100;
      const color = day.qualifies ? '#16a34a' : '#d32f2f';
      const shortDate = day.dateLabel.split(' ').slice(0, 2).join(' ');
      html += `
        <div class="bar-item">
          <div class="bar-fill" style="height:${pct}%;background:${color}"></div>
          <div class="bar-label">${shortDate}</div>
          <div class="bar-value">${day.visits.length}</div>
        </div>
      `;
    }
    html += '</div>';
    return html;
  },

  // ===== Status badge =====
  setRange(range) {
    const today = new Date();
    let from, to = new Date(today);
    to.setHours(23, 59, 59, 999);
    if (range === 'today') {
      from = new Date(today);
      from.setHours(0, 0, 0, 0);
    } else if (range === 'week') {
      from = new Date(today);
      from.setDate(today.getDate() - today.getDay()); // start of week (Sunday)
      from.setHours(0, 0, 0, 0);
    } else if (range === 'month') {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (range === 'custom') {
      // Use the input fields
      const fromEl = document.getElementById('report-from');
      const toEl = document.getElementById('report-to');
      from = fromEl.value ? new Date(fromEl.value + 'T00:00:00') : new Date(today);
      to = toEl.value ? new Date(toEl.value + 'T23:59:59') : new Date(today);
    }
    document.getElementById('report-range-label').textContent =
      `${Utils.formatThaiDate(from)} – ${Utils.formatThaiDate(to)}`;
    document.getElementById('report-from').value = from.toISOString().slice(0, 10);
    document.getElementById('report-to').value = to.toISOString().slice(0, 10);
    // Show/hide custom inputs
    document.getElementById('custom-range').classList.toggle('hidden', range !== 'custom');
    return { from, to };
  },

  // ===== Generate report =====
  generate() {
    const range = this.setRange(document.getElementById('report-range').value);
    const vehicleId = document.getElementById('report-vehicle').value;
    const from = range.from;
    const to = range.to;
    const customers = Storage.getActiveCustomers();
    const visits = Storage.getVisits();

    // Group visits by day (using timestamp)
    const byDay = {};
    for (const [cid, visit] of Object.entries(visits)) {
      const ts = new Date(visit.timestamp);
      if (ts < from || ts > to) continue;
      const dayKey = ts.toISOString().slice(0, 10); // YYYY-MM-DD
      if (!byDay[dayKey]) byDay[dayKey] = [];
      const customer = customers.find(c => c.id === cid);
      if (customer) {
        byDay[dayKey].push({ customer, visit });
      }
    }
    const dayKeys = Object.keys(byDay).sort();

    // Build report
    const reportData = {
      from, to, vehicleId,
      vehicleLabel: Fuel.getVehicle(vehicleId).label,
      fuelType: Fuel.getVehicle(vehicleId).fuelType,
      fuelPrice: Fuel.getPrice(Fuel.getVehicle(vehicleId).fuelType),
      kmPerLiter: Fuel.getVehicle(vehicleId).kmPerLiter,
      days: [],
      totals: {
        days: 0,
        totalVisits: 0,
        totalUpcoming: 0,
        totalOverdue: 0,
        totalDistance: 0,
        totalFuelBaht: 0,
        totalAllowance: 0,
        qualifyingDays: 0,
      },
    };

    for (const dayKey of dayKeys) {
      const dayVisits = byDay[dayKey];
      const upcoming = dayVisits.filter(v => v.customer.debtType === 'current').length;
      const overdue = dayVisits.filter(v => v.customer.debtType === 'overdue').length;
      const qualifies = upcoming >= this.THRESHOLD_UPCOMING || overdue >= this.THRESHOLD_OVERDUE;
      const allowance = qualifies ? this.ALLOWANCE_PER_DAY : 0;
      // Distance estimate: avg 8 km between visits (rough — actual OSRM would need route)
      const distance = dayVisits.length * 8;
      const fuel = Fuel.calculate(distance, vehicleId);
      reportData.days.push({
        date: dayKey,
        dateLabel: Utils.formatThaiDate(new Date(dayKey)),
        visits: dayVisits,
        upcoming, overdue, qualifies, allowance,
        distance, fuel,
      });
      reportData.totals.days++;
      reportData.totals.totalVisits += dayVisits.length;
      reportData.totals.totalUpcoming += upcoming;
      reportData.totals.totalOverdue += overdue;
      reportData.totals.totalDistance += distance;
      reportData.totals.totalFuelBaht += fuel.baht;
      reportData.totals.totalAllowance += allowance;
      if (qualifies) reportData.totals.qualifyingDays++;
    }

    this._currentReport = reportData;
    this._renderPreview(reportData);
  },

  // ===== Render preview in modal =====
  _renderPreview(data) {
    const preview = document.getElementById('report-preview');
    const exportBtns = document.getElementById('export-buttons');
    if (data.days.length === 0) {
      preview.innerHTML = '<p class="empty-state">ไม่พบ visit ในช่วงวันที่เลือก</p>';
      exportBtns.classList.add('hidden');
      return;
    }
    exportBtns.classList.remove('hidden');

    const t = data.totals;
    let html = `
      <div class="report-summary">
        <h3>📊 สรุปภาพรวม</h3>
        <div class="report-summary-grid">
          <div class="summary-item"><span class="summary-num">${t.days}</span><span class="summary-label">วันทำงาน</span></div>
          <div class="summary-item"><span class="summary-num">${t.totalVisits}</span><span class="summary-label">ครั้งที่ติดตาม</span></div>
          <div class="summary-item"><span class="summary-num">${t.totalUpcoming}</span><span class="summary-label">หนี้ถึงกำหนด</span></div>
          <div class="summary-item"><span class="summary-num">${t.totalOverdue}</span><span class="summary-label">หนี้ค้าง</span></div>
          <div class="summary-item"><span class="summary-num">${t.qualifyingDays}</span><span class="summary-label">วันที่เบิกได้</span></div>
          <div class="summary-item highlight"><span class="summary-num">${Utils.formatBaht(t.totalAllowance)}</span><span class="summary-label">เบี้ยเลี้ยงรวม</span></div>
        </div>
        <div class="report-fuel-cost">
          <span>⛽ ${data.vehicleLabel} · ${data.kmPerLiter} กม./ลิตร · ${Utils.formatBaht(data.fuelPrice)}/ลิตร</span>
          <span>📏 ระยะทางประมาณการ: ${Utils.formatKm(t.totalDistance)} กม.</span>
          <span>💰 ค่าน้ำมันประมาณการ: ${Utils.formatBaht(t.totalFuelBaht)}</span>
        </div>
      </div>
      
      <!-- Simple bar chart -->
      <div class="report-chart">
        <h3>📈 สรุปรายวัน</h3>
        <div class="chart-container">
          ${this._renderBarChart(data.days)}
        </div>
      </div>
      
      <div class="report-days">
        <h3>📅 รายละเอียดรายวัน</h3>
    `;
    for (const day of data.days) {
      const dayClass = day.qualifies ? 'day-qualifies' : 'day-no-qualify';
      const allowanceBadge = day.qualifies
        ? `<span class="badge-yes">✅ เบิกได้ ${Utils.formatBaht(day.allowance)}</span>`
        : `<span class="badge-no">❌ ไม่ถึงเกณฑ์</span>`;
      html += `
        <div class="report-day ${dayClass}">
          <div class="report-day-header">
            <strong>${day.dateLabel}</strong>
            ${allowanceBadge}
            <span class="day-stats">📅 ${day.upcoming} ถึงกำหนด · ⚠️ ${day.overdue} ค้าง · 👥 ${day.visits.length} ราย</span>
          </div>
          <table class="report-day-table">
            <thead><tr><th>ลูกค้า</th><th>สถานะ</th><th>เวลา</th><th>พิกัด</th><th>หมายเหตุ</th></tr></thead>
            <tbody>
      `;
      for (const v of day.visits) {
        const c = v.customer;
        const status = this._statusBadge(v.visit.status);
        const time = v.visit.timestamp ? new Date(v.visit.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-';
        const coords = v.visit.lat && v.visit.lng
          ? `<a href="https://www.google.com/maps?q=${v.visit.lat},${v.visit.lng}" target="_blank">📍 ${v.visit.lat.toFixed(4)}, ${v.visit.lng.toFixed(4)}</a>`
          : '-';
        const note = v.visit.note ? this._escapeHTML(v.visit.note) : '-';
        html += `
          <tr>
            <td>
              <div class="td-name">${this._escapeHTML(c.name)}</div>
              <div class="td-sub">${c.phone || ''}</div>
            </td>
            <td>${status}</td>
            <td>${time}</td>
            <td>${coords}</td>
            <td>${note}</td>
          </tr>
        `;
      }
      html += `</tbody></table></div>`;
    }
    html += '</div>';
    preview.innerHTML = html;
  },

  // ===== Export: HTML (printable) =====
  exportHTML() {
    if (!this._currentReport) return;
    const data = this._currentReport;
    const officer = Auth.getUser()?.name || 'ไม่ระบุ';
    const t = data.totals;
    const html = this._buildPrintHTML(data, officer, false);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    Utils.toast('📄 เปิดรายงาน HTML แล้ว');
  },

  // ===== Export: PDF (auto-print) =====
  exportPDF() {
    if (!this._currentReport) return;
    const data = this._currentReport;
    const officer = Auth.getUser()?.name || 'ไม่ระบุ';
    const t = data.totals;
    const html = this._buildPrintHTML(data, officer, true);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    Utils.toast('📑 เปิดหน้าพิมพ์ PDF แล้ว — เลือก "Save as PDF"');
  },

  // ===== Build print-friendly HTML =====
  _buildPrintHTML(data, officer, autoPrint) {
    const t = data.totals;
    return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>รายงานติดตามหนี้ - ${officer}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap');
  body { font-family: 'Sarabun', sans-serif; padding: 24px; max-width: 900px; margin: 0 auto; color: #1a202c; }
  h1 { color: #0a8f3c; border-bottom: 3px solid #0a8f3c; padding-bottom: 8px; font-size: 22px; }
  h2 { color: #076b2d; margin-top: 32px; border-left: 4px solid #0a8f3c; padding-left: 8px; font-size: 18px; }
  h3 { color: #334155; margin-top: 20px; font-size: 15px; }
  .meta { background: #f1f5f9; padding: 12px; border-radius: 6px; margin-bottom: 16px; font-size: 14px; }
  .meta strong { color: #0a8f3c; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  th { background: #0a8f3c; color: white; padding: 8px; text-align: left; }
  td { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 12px 0; }
  .summary-card { background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 10px; text-align: center; }
  .summary-card.highlight { background: #fef3c7; border-color: #fcd34d; }
  .summary-num { display: block; font-size: 24px; font-weight: 700; color: #0a8f3c; }
  .summary-card.highlight .summary-num { color: #b45309; }
  .summary-label { display: block; font-size: 11px; color: #64748b; }
  .day-qualifies { border-left: 4px solid #10b981; padding-left: 8px; margin: 12px 0; }
  .day-no-qualify { border-left: 4px solid #cbd5e1; padding-left: 8px; margin: 12px 0; opacity: 0.85; }
  .badge-yes { background: #10b981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
  .badge-no { background: #94a3b8; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
  .signature { margin-top: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .signature-box { text-align: center; padding-top: 60px; border-top: 1px solid #64748b; }
  @media print { body { padding: 0; } .no-print { display: none; } }
  .no-print { text-align: center; margin: 20px 0; }
  .no-print button { padding: 10px 24px; background: #0a8f3c; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; margin: 0 4px; }
</style>
</head>
<body>
  <h1>📋 รายงานการติดตามหนี้</h1>
  <div class="meta">
    <div><strong>เจ้าหน้าที่:</strong> ${this._escapeHTML(officer)}</div>
    <div><strong>ช่วงวันที่:</strong> ${Utils.formatThaiDate(data.from)} – ${Utils.formatThaiDate(data.to)}</div>
    <div><strong>ยานพาหนะ:</strong> ${this._escapeHTML(data.vehicleLabel)} (${data.kmPerLiter} กม./ลิตร, ${Utils.formatBaht(data.fuelPrice)}/ลิตร)</div>
    <div><strong>วันที่ออกรายงาน:</strong> ${Utils.formatThaiDate(new Date())}</div>
  </div>

  <h2>📊 สรุปภาพรวม</h2>
  <div class="summary-grid">
    <div class="summary-card"><span class="summary-num">${t.days}</span><span class="summary-label">วันทำงาน</span></div>
    <div class="summary-card"><span class="summary-num">${t.totalVisits}</span><span class="summary-label">ครั้งที่ติดตาม</span></div>
    <div class="summary-card"><span class="summary-num">${t.totalUpcoming}</span><span class="summary-label">หนี้ถึงกำหนด</span></div>
    <div class="summary-card"><span class="summary-num">${t.totalOverdue}</span><span class="summary-label">หนี้ค้าง</span></div>
    <div class="summary-card"><span class="summary-num">${t.qualifyingDays}</span><span class="summary-label">วันที่เบิกได้</span></div>
    <div class="summary-card highlight"><span class="summary-num">${Utils.formatBaht(t.totalAllowance)}</span><span class="summary-label">เบี้ยเลี้ยงรวม</span></div>
  </div>
  <p>⛽ ค่าน้ำมันประมาณการ: ${Utils.formatBaht(t.totalFuelBaht)} (ระยะทาง ${Utils.formatKm(t.totalDistance)} กม.)</p>

  <h2>📅 รายละเอียดรายวัน</h2>
  ${data.days.map(day => `
    <div class="${day.qualifies ? 'day-qualifies' : 'day-no-qualify'}">
      <h3>${day.dateLabel} ${day.qualifies ? '<span class="badge-yes">✅ เบิกได้ ' + Utils.formatBaht(day.allowance) + '</span>' : '<span class="badge-no">❌ ไม่ถึงเกณฑ์</span>'}</h3>
      <p>📅 ${day.upcoming} ถึงกำหนด · ⚠️ ${day.overdue} ค้าง · 👥 ${day.visits.length} ราย</p>
      <table>
        <thead><tr><th>ลูกค้า</th><th>สถานะ</th><th>เวลา</th><th>พิกัด</th><th>หมายเหตุ</th></tr></thead>
        <tbody>
          ${day.visits.map(v => `
            <tr>
              <td>${this._escapeHTML(v.customer.name)}<br><small>${this._escapeHTML(v.customer.phone || '')}</small></td>
              <td>${this._statusLabel(v.visit.status)}</td>
              <td>${v.visit.timestamp ? new Date(v.visit.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
              <td>${v.visit.lat && v.visit.lng ? v.visit.lat.toFixed(4) + ', ' + v.visit.lng.toFixed(4) : '-'}</td>
              <td>${this._escapeHTML(v.visit.note || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `).join('')}

  <div class="signature">
    <div class="signature-box">ลงชื่อ .....................................<br><small>ผู้ติดตาม (${this._escapeHTML(officer)})</small></div>
    <div class="signature-box">ลงชื่อ .....................................<br><small>หัวหน้างาน</small></div>
  </div>

  <div class="no-print">
    <button onclick="window.print()">🖨️ พิมพ์ / Save PDF</button>
    <button onclick="window.close()">✖️ ปิด</button>
  </div>
  ${autoPrint ? '<script>window.onload = () => setTimeout(() => window.print(), 500);</script>' : ''}
</body>
</html>`;
  },

  // ===== Export: CSV =====
  exportCSV() {
    if (!this._currentReport) return;
    const data = this._currentReport;
    const t = data.totals;
    const rows = [
      ['รายงานการติดตามหนี้'],
      ['เจ้าหน้าที่', Auth.getUser()?.name || ''],
      ['ช่วงวันที่', `${Utils.formatThaiDate(data.from)} – ${Utils.formatThaiDate(data.to)}`],
      ['ยานพาหนะ', `${data.vehicleLabel} (${data.kmPerLiter} กม./ลิตร, ${data.fuelPrice}฿/ลิตร)`],
      [],
      ['สรุปภาพรวม'],
      ['วันทำงาน', t.days],
      ['ครั้งที่ติดตาม', t.totalVisits],
      ['หนี้ถึงกำหนด', t.totalUpcoming],
      ['หนี้ค้าง', t.totalOverdue],
      ['วันที่เบิกได้', t.qualifyingDays],
      ['เบี้ยเลี้ยงรวม (฿)', t.totalAllowance],
      ['ค่าน้ำมันประมาณการ (฿)', Math.round(t.totalFuelBaht)],
      ['ระยะทางประมาณการ (กม.)', Math.round(t.totalDistance)],
      [],
      ['รายละเอียดรายวัน'],
      ['วันที่', 'ชื่อลูกค้า', 'เบอร์โทร', 'ประเภทหนี้', 'ระดับความเสี่ยง', 'สถานะเข้าพบ', 'เวลา', 'ละติจูด', 'ลองจิจูด', 'หมายเหตุ', 'เบิกเบี้ยเลี้ยงได้'],
    ];
    for (const day of data.days) {
      for (const v of day.visits) {
        const c = v.customer;
        rows.push([
          day.dateLabel,
          c.name || '',
          c.phone || '',
          c.debtType === 'current' ? 'หนี้ถึงกำหนด' : (c.debtType === 'overdue' ? 'หนี้ค้าง' : '-'),
          this._riskLabel(c.riskLevel),
          this._statusLabel(v.visit.status),
          v.visit.timestamp ? new Date(v.visit.timestamp).toLocaleTimeString('th-TH') : '',
          v.visit.lat || '',
          v.visit.lng || '',
          v.visit.note || '',
          day.qualifies ? 'ได้ ' + Utils.formatBaht(day.allowance) : 'ไม่ได้',
        ]);
      }
    }
    // Add UTF-8 BOM for Excel
    const csv = '\ufeff' + rows.map(r => r.map(cell => {
      const s = String(cell);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    Utils.toast('📊 ดาวน์โหลด CSV แล้ว');
  },

  // ===== Export: Share text =====
  shareText() {
    if (!this._currentReport) return;
    const data = this._currentReport;
    const t = data.totals;
    const officer = Auth.getUser()?.name || '';
    const lines = [
      `📋 *รายงานติดตามหนี้*`,
      `👤 เจ้าหน้าที่: ${officer}`,
      `📅 ช่วง: ${Utils.formatThaiDate(data.from)} – ${Utils.formatThaiDate(data.to)}`,
      `🚗 ${data.vehicleLabel}`,
      ``,
      `📊 *สรุป*`,
      `• ${t.days} วันทำงาน · ${t.totalVisits} ครั้ง`,
      `• หนี้ถึงกำหนด: ${t.totalUpcoming} ราย`,
      `• หนี้ค้าง: ${t.totalOverdue} ราย`,
      `• วันที่เบิกได้: ${t.qualifyingDays}/${t.days}`,
      `• *เบี้ยเลี้ยงรวม: ${Utils.formatBaht(t.totalAllowance)}*`,
      `• ค่าน้ำมันประมาณการ: ${Utils.formatBaht(t.totalFuelBaht)}`,
      ``,
    ];
    for (const day of data.days) {
      lines.push(`📅 *${day.dateLabel}* ${day.qualifies ? '✅ เบิกได้' : '❌'}`);
      lines.push(`  ถึงกำหนด: ${day.upcoming} · ค้าง: ${day.overdue} · ราย: ${day.visits.length}`);
      for (const v of day.visits.slice(0, 5)) {
        const status = this._statusEmoji(v.visit.status);
        const coords = v.visit.lat ? ` 📍${v.visit.lat.toFixed(3)},${v.visit.lng.toFixed(3)}` : '';
        lines.push(`  ${status} ${v.customer.name}${coords}`);
      }
      if (day.visits.length > 5) lines.push(`  ... +${day.visits.length - 5} ราย`);
    }
    const text = lines.join('\n');
    if (navigator.share) {
      navigator.share({ title: 'รายงานติดตามหนี้', text }).catch(() => {
        this._copyToClipboard(text);
      });
    } else {
      this._copyToClipboard(text);
    }
  },

  _copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => Utils.toast('📋 คัดลอกรายงานแล้ว'));
    } else {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      Utils.toast('📋 คัดลอกรายงานแล้ว');
    }
  },

  // ===== Helpers =====
  _statusBadge(status) {
    const label = this._statusLabel(status);
    const cls = {
      visited: 'badge-yes',
      interested: 'badge-yes',
      no_answer: 'badge-no',
      not_home: 'badge-no',
      not_interested: 'badge-no',
      reschedule: 'badge-warn',
    }[status] || 'badge-warn';
    return `<span class="${cls}">${label}</span>`;
  },
  _statusLabel(status) {
    return {
      visited: '✅ เยี่ยมสำเร็จ',
      no_answer: '❌ ไม่พบลูกค้า',
      not_home: '🚪 ไม่อยู่บ้าน',
      reschedule: '📅 นัดใหม่',
      interested: '💚 สนใจ',
      not_interested: '🚫 ไม่สนใจ',
      pending: '⏳ รอ',
    }[status] || status || '-';
  },
  _statusEmoji(status) {
    return {
      visited: '✅', no_answer: '❌', not_home: '🚪',
      reschedule: '📅', interested: '💚', not_interested: '🚫', pending: '⏳',
    }[status] || '•';
  },
  _riskLabel(level) {
    return {
      good: '🟢 ดี',
      warning: '🟡 เริ่มมีปัญหา',
      bad: '🔴 มีปัญหามาก',
      unclassified: '❓ ยังไม่จัด',
    }[level] || '-';
  },
  _escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },
};

window.Report = Report;
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
    // attachEvents + version watcher MUST bind even before login resolves.
    // afterLogin is async (network/sync) and can be slow or throw — if we await
    // it first, header/panel buttons (help/report/change-password/refresh/logout)
    // never get their listeners until login fully settles. Bind early instead.
    this.attachEvents();
    this.startVersionWatcher();
    // ยก panel/modal พ้นแป้นพิมพ์มือถือ (iOS keyboard guardian)
    if (typeof Utils !== 'undefined' && Utils.initKeyboardGuard) Utils.initKeyboardGuard();
    // แจ้งเตือนถ้าเพิ่งกดปุ่มอัปเดตแล้ว reload เสร็จ
    this._notifyUpdateCompleted();
    try {
      if (Auth.isLoggedIn()) {
        Auth.showApp();
        await this.afterLogin();
      } else {
        Auth.showLogin();
      }
    } catch (e) {
      console.warn('[App.init] afterLogin error:', e?.message);
    }
  },

  // ===== แจ้งเตือน "อัปเดตเสร็จแล้ว" หลัง reload จากปุ่ม 🔄 =====
  _notifyUpdateCompleted() {
    const flag = sessionStorage.getItem('bfr_update_done');
    if (!flag) return;
    sessionStorage.removeItem('bfr_update_done');
    if (typeof Utils !== 'undefined' && Utils.toast) {
      setTimeout(() => {
        Utils.toast('✅ อัปเดตเว็บเป็นเวอร์ชันใหม่เรียบร้อย', 'success');
      }, 800);
    }
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

  // ===== Show current version in header label =====
  _renderVersionLabel(ver) {
    const el = document.getElementById('version-label');
    if (!el) return;
    el.textContent = `v${ver}`;
    // กดที่ label = อัปเดตเป็นเวอร์ชันล่าสุดทันที
    if (!el.dataset.bound) {
      el.dataset.bound = '1';
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => App.applyUpdate());
    }
  },

  // ===== Initialize header components =====
  _initHeader() {
    // Set user avatar initial
    const user = Auth.getUser();
    if (user && user.name) {
      const initial = user.name.charAt(0).toUpperCase();
      const avatarEl = document.getElementById('avatar-initial');
      if (avatarEl) avatarEl.textContent = initial;
    }

    // More menu toggle
    const moreBtn = document.getElementById('more-menu-btn');
    const moreDropdown = document.getElementById('more-menu-dropdown');
    if (moreBtn && moreDropdown) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moreDropdown.classList.toggle('active');
      });
      
      // Close on outside click
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.header-more-menu')) {
          moreDropdown.classList.remove('active');
        }
      });
      
      // Close on item click
      moreDropdown.querySelectorAll('.more-menu-item').forEach(item => {
        item.addEventListener('click', () => {
          moreDropdown.classList.remove('active');
        });
      });
    }

    // Sync badge click
    const syncBadge = document.getElementById('sync-badge-header');
    if (syncBadge) {
      syncBadge.addEventListener('click', () => {
        if (typeof Storage !== 'undefined' && Storage.retrySync) {
          Storage.retrySync();
        }
      });
    }
  },

  async checkForUpdate() {
    const serverVer = await this.fetchServerVersion();
    if (!serverVer) return false;
    const stored = localStorage.getItem('app_version') || '0';
    const btn = document.getElementById('refresh-btn');
    const label = document.getElementById('version-label');
    if (serverVer !== stored && this._knownVersion !== null) {
      // New version detected (don't show on first load)
      if (btn) {
        btn.classList.add('has-update');
        btn.title = `เวอร์ชันใหม่ ${serverVer} พร้อมใช้งาน! (กดเพื่ออัพเดท)`;
      }
      if (label) {
        label.textContent = `v${serverVer}`;
        label.classList.add('has-update');
        label.title = 'เวอร์ชันใหม่พร้อมใช้งาน — กดเพื่ออัปเดต';
      }
      // ===== AUTO-UPDATE: สั่ง SW ใหม่เข้าควบคุมทันที =====
      // ไม่ต้องรอให้ผู้ใช้กดปุ่ม — เว็บอัปเดตตัวเองอัตโนมัติ
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
          if (reg.waiting) {
            // SW ใหม่กำลังรอ → สั่งเข้าควบคุมทันที
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          } else {
            // ตรวจหา SW ใหม่
            reg.update();
          }
        });
      }
      // Auto-notify with banner (auto-reload after 8 seconds — fallback ถ้า SW ไม่ reload)
      if (!this._updateNotified && typeof Utils !== 'undefined') {
        this._updateNotified = true;
        this._showUpdateToast(serverVer);
      }
      return true;
    }
    if (btn) {
      btn.classList.remove('has-update');
      btn.title = 'กดเพื่ออัปเดตเว็บเป็นเวอร์ชันล่าสุด (เคลียร์ cache)';
    }
    if (label) {
      label.classList.remove('has-update');
      label.textContent = `v${stored}`;
      label.title = 'เวอร์ชันปัจจุบันของเว็บ';
    }
    return false;
  },

  _showUpdateToast(newVer) {
    // Build a persistent toast banner at top of screen
    const existing = document.getElementById('update-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
      background: #0a8f3c; color: #fff; text-align: center;
      padding: 12px 16px; font-size: 15px; font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      cursor: pointer; display: flex; align-items: center;
      justify-content: center; gap: 10px;
    `;
    banner.innerHTML = `
      <span>🔄 อัปเดตเวอร์ชัน ${newVer} — กดเพื่อโหลดใหม่ทันที</span>
      <span style="background:rgba(255,255,255,0.2);padding:4px 10px;border-radius:4px;font-size:13px" id="update-countdown">⏳ 8 วิ</span>
    `;
    banner.addEventListener('click', () => {
      if (typeof App !== 'undefined') App.applyUpdate();
    });
    document.body.prepend(banner);

    // Countdown then auto-reload
    let sec = 8;
    const countEl = document.getElementById('update-countdown');
    this._updateTimer = setInterval(() => {
      sec--;
      if (countEl) countEl.textContent = `⏳ ${sec} วิ`;
      if (sec <= 0) {
        clearInterval(this._updateTimer);
        if (typeof App !== 'undefined') App.applyUpdate();
      }
    }, 1000);
  },

  startVersionWatcher() {
    // Set known version on first load
    this.fetchServerVersion().then(v => {
      if (v) {
        this._knownVersion = v;
        localStorage.setItem('app_version', v);
        this._renderVersionLabel(v);
      }
    });
    // Check every 60 seconds (เร็วขึ้นจาก 5 นาที)
    if (this._versionCheckTimer) clearInterval(this._versionCheckTimer);
    this._versionCheckTimer = setInterval(() => this.checkForUpdate(), 60 * 1000);
    // Also re-check when tab regains focus
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.checkForUpdate();
    });
    // ===== AUTO-UPDATE: เมื่อ SW ใหม่เข้าควบคุม → reload อัตโนมัติ =====
    // ไม่ต้องรอให้ผู้ใช้กดปุ่ม — เว็บอัปเดตตัวเองทันที
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // SW ใหม่เข้าควบคุมแล้ว → reload หน้า (ใช้ flag กัน reload ซ้ำ)
        if (!this._swReloading) {
          this._swReloading = true;
          sessionStorage.setItem('bfr_update_done', '1');
          window.location.reload();
        }
      });
    }
  },

  // After login — load data
  async afterLogin() {
    // Phase 1: Migrate old customers to new schema (riskLevel + debtType)
    Storage.migrateCustomers();

    // Initialize header components (avatar, more menu, sync badge)
    this._initHeader();

    Customers.initMap();
    // Initial load: NO fitBounds — เปิดมาเห็นจังหวัดปราจีนบุรี zoom 12 ตาม default
    // (fitBounds ดัน view ไปยึด marker GPS ทั้งหมด ทำให้ไม่เห็นภาพรวมจังหวัด)
    Customers.renderAll();
    Visit.render();
    Route.attachEvents();
    this.updateRouteUI();
    this.updateAdminUI();
    // Init bottom sheet (map-as-canvas mode)
    this.initBottomSheet();
    this.renderTodayRoute();

    // Load customer database (async, non-blocking)
    CustomerDB.load();
    // Load debt database (ข้อมูลหนี้ Customer Indicator) — async, non-blocking
    if (typeof DebtDB !== 'undefined') {
      DebtDB.load().then(() => {
        if (Customers.initDebtFilter) Customers.initDebtFilter();
        // re-render ให้ popup/รายชื่อที่โชว์ "กำลังโหลด..." อัปเดตเป็นข้อมูลจริง
        if (Customers.renderAll) Customers.renderAll();
      }).catch(() => {});
    }

    // Init floating map search bar (Google Maps-style)
    if (typeof MapSearch !== 'undefined') MapSearch.init();

    // Auto-import static DB on first run (empty localStorage — new device / cleared cache)
    if (Storage.getCustomers().length === 0) {
      try {
        const r = await Storage.importFromStaticDB();
        if (r && r.imported > 0) {
          Customers.renderAll(undefined, { fitBounds: true });
          Utils.toast(`📥 โหลดลูกค้า ${r.imported} รายการจากฐานข้อมูลกลาง (${r.withGPS} มีพิกัด)`);
        }
      } catch (e) {
        console.warn('[afterLogin] auto-import failed:', e.message);
      }
    } else {
      // Existing device: re-apply server GPS overlay so coords match the web
      // (server-authoritative — uploaded coords overwrite this device's copy)
      try {
        const n = await Storage.applyGpsOverlay();
        if (n > 0) {
          Customers.renderAll();
          Utils.toast(`📍 อัพเดทพิกัดจากเว็บ ${n} รายการ`);
        }
      } catch (e) {
        console.warn('[afterLogin] gps-overlay apply failed:', e.message);
      }
    }

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

    // Start real-time polling (every 15s — reduced from 3s to avoid Worker CPU limit)
    this._wireSyncEvents();
    Storage.startPolling(15000);
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

  // Attach all event handlers (null-safe — missing elements won't crash the rest)
  attachEvents() {
    const $ = (id) => document.getElementById(id);
    const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };

    // Login form (username/password)
    on('login-form', 'submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      const errEl = document.getElementById('login-error');
      errEl.textContent = '';
      const btn = document.getElementById('login-btn');
      
      // Show loading state
      setLoginLoading(btn, true);
      
      const ok = await Auth.login(username, password);
      if (ok) {
        // Save remember me preference
        saveRememberMe(username);
        await this.afterLogin();
      } else {
        errEl.textContent = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
      }
      
      // Hide loading state
      setLoginLoading(btn, false);
      btn.textContent = 'เข้าสู่ระบบ';
    });

    // PIN fallback toggle
    on('toggle-pin-login', 'click', () => {
      const pinForm = document.getElementById('pin-form');
      const toggleBtn = document.getElementById('toggle-pin-login');
      if (!pinForm || !toggleBtn) return;
      pinForm.classList.toggle('hidden');
      toggleBtn.textContent = pinForm.classList.contains('hidden') ? 'เข้าสู่ระบบด้วย PIN' : 'ซ่อน PIN';
      if (!pinForm.classList.contains('hidden')) {
        setTimeout(() => { const pi = document.getElementById('pin-input'); if (pi) pi.focus(); }, 100);
      }
    });

    // PIN form (legacy fallback)
    on('pin-form', 'submit', async (e) => {
      e.preventDefault();
      const pin = document.getElementById('pin-input').value;
      const errEl = document.getElementById('pin-error');
      errEl.textContent = '';
      const btn = document.getElementById('pin-btn');
      setLoginLoading(btn, true);
      const ok = await Auth.loginPIN(pin);
      if (ok) { await this.afterLogin(); } else { errEl.textContent = 'PIN ไม่ถูกต้อง'; }
      setLoginLoading(btn, false);
      btn.textContent = 'เข้าสู่ระบบ (PIN)';
    });

    // Logout
    on('logout-btn', 'click', () => { if (confirm('ออกจากระบบ?')) Auth.logout(); });

    // Admin buttons
    on('admin-users-btn', 'click', () => this.openAdminUsers());
    on('admin-data-btn', 'click', () => { window.location.href = '/admin.html'; });

    // Change password
    on('change-password-btn', 'click', () => this.openChangePassword());
    on('close-change-password', 'click', () => { const m = document.getElementById('change-password-modal'); if (m) m.classList.add('hidden'); });
    on('change-password-modal', 'click', (e) => { if (e.target.id === 'change-password-modal') e.target.classList.add('hidden'); });
    on('change-password-form-standalone', 'submit', (e) => { e.preventDefault(); this.submitChangePasswordStandalone(); });
    on('change-password-form', 'submit', (e) => { e.preventDefault(); this.submitChangePassword(); });

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

    // Customer sort
    const customerSort = document.getElementById('customer-sort');
    if (customerSort) {
      customerSort.addEventListener('change', () => Customers.renderList());
    }

    // Zone filter (เขตสินเชื่อ — T3)
    const customerZone = document.getElementById('customer-zone');
    if (customerZone) {
      customerZone.addEventListener('change', () => Customers.renderList());
    }

    // FAB buttons
    on('fab-add-customer', 'click', () => this.openAddCustomerModal());
    on('fab-my-location', 'click', () => this.useGPS());

    // Zoom controls (custom — replaces hidden top-left Leaflet control)
    on('fab-zoom-in', 'click', () => Customers.map && Customers.map.zoomIn());
    on('fab-zoom-out', 'click', () => Customers.map && Customers.map.zoomOut());

    // Modal close
    on('close-add-modal', 'click', () => this.closeAddCustomerModal());
    on('add-customer-modal', 'click', (e) => { if (e.target.id === 'add-customer-modal') this.closeAddCustomerModal(); });

    // GPS button
    on('btn-use-gps', 'click', () => this.useGPS(true));

    // Pick on main map
    on('btn-pick-on-main-map', 'click', () => this.pickOnMainMap());

    // Add customer form
    on('add-customer-form', 'submit', (e) => {
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
    on('close-visit-modal', 'click', () => Visit.closeLog());
    on('btn-cancel-visit', 'click', () => Visit.closeLog());
    on('visit-log-form', 'submit', (e) => { e.preventDefault(); Visit.submit(e.target); });
    on('visit-log-modal', 'click', (e) => { if (e.target.id === 'visit-log-modal') Visit.closeLog(); });
    on('btn-capture-gps', 'click', () => Visit.captureGPS());

    // Route: start mode
    on('route-start-mode', 'change', (e) => { const cs = document.getElementById('custom-start'); if (cs) cs.classList.toggle('hidden', e.target.value !== 'custom'); });

    // Calculate route
    on('btn-calculate-route', 'click', () => this.calculateRoute());

    // Open Google Maps
    on('btn-open-gmaps', 'click', () => Route.openGoogleMaps());

    // Save route
    on('btn-save-route', 'click', () => Route.saveRoute());

    // Report + Help modals
    on('report-btn', 'click', () => Report.open());
    on('help-btn', 'click', () => App.openHelp());
    on('close-help-modal', 'click', () => App.closeHelp());
    on('btn-close-help', 'click', () => App.closeHelp());
    on('close-report-modal', 'click', () => Report.close());
    on('report-modal', 'click', (e) => { if (e.target.id === 'report-modal') Report.close(); });
    on('report-range', 'change', () => { const rr = document.getElementById('report-range'); if (rr) Report.setRange(rr.value); });
    on('btn-generate-report', 'click', () => Report.generate());
    on('btn-export-html', 'click', () => Report.exportHTML());
    on('btn-export-pdf', 'click', () => Report.exportPDF());
    on('btn-export-csv', 'click', () => Report.exportCSV());
    on('btn-export-share', 'click', () => Report.shareText());
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
      // ลากได้ทั้งแถบ handle (ส่วนหัวปัจจุบัน) — คลิกตรงไหนก็ลากได้ ไม่แน่นเกินไป
      if (!e.target.closest('.sheet-handle')) return;
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
    // Q2 FIX: ไม่ซ่อน FAB — CSS ยกตำแหน่งขึ้นตามความสูง sheet (body:has selector)
    
    // Haptic feedback on state change (if supported)
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  },

  // Legacy switchTab — adapts to new map-as-canvas layout
  switchTab(name) {
    if (name === 'map') {
      this.setSheetState('peek');
      this.switchSheetTab('route');
      setTimeout(() => Customers.map && Customers.map.invalidateSize(), 50);
      return;
    }
    const sheetNames = { customers: 'customers', route: 'route', visit: 'visit' };
    this.switchSheetTab(sheetNames[name] || name);
    this.setSheetState('half');
  },

  // Switch bottom sheet content tab
  switchSheetTab(name) {
    document.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sheet-content').forEach(p => p.classList.remove('active'));
    const tab = document.querySelector(`.sheet-tab[data-sheet="${name}"]`);
    if (tab) tab.classList.add('active');
    const idMap = { route: 'sheet-route', customers: 'tab-customers', plan: 'tab-route', visit: 'tab-visit', debtsummary: 'sheet-debtsummary' };
    const pane = document.getElementById(idMap[name] || 'sheet-route');
    if (pane) pane.classList.add('active');
    if (name !== 'route') this.setSheetState('half');
    // Render debt summary เมื่อเปิดแท็บสรุปหนี้
    if (name === 'debtsummary' && typeof DebtDB !== 'undefined' && DebtDB._loaded && window.DebtSummary) {
      DebtSummary.render();
    }
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
    const isAdmin = Auth.isAdmin();
    const userBtn = document.getElementById('admin-users-btn');
    const dataBtn = document.getElementById('admin-data-btn');
    if (userBtn) userBtn.style.display = isAdmin ? '' : 'none';
    if (dataBtn) dataBtn.style.display = isAdmin ? '' : 'none';
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
          successEl.textContent = `✅ นำเข้า ${result.imported} รายการ · ${result.withGPS} มีพิกัด · ข้าม ${result.skipped} ที่ซ้ำ`;
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

    // ===== Data Export (CSV) =====
    const exportBtn = document.getElementById('btn-export-customers');
    if (exportBtn) {
      exportBtn.onclick = () => this.exportCustomersCSV();
    }

    // ===== Debt Import: อัปโหลด Customer Indicator =====
    this.initDebtImport();
  },

  // ===== Debt Import: อัปโหลด Customer Indicator =====
  initDebtImport() {
    const uploadBtn = document.getElementById('debt-upload-btn');
    const fileInput = document.getElementById('debt-file-input');
    const fileName = document.getElementById('debt-file-name');
    const progress = document.getElementById('debt-progress');
    const progressText = document.getElementById('debt-progress-text');
    const result = document.getElementById('debt-result');
    const resultStats = document.getElementById('debt-result-stats');
    const resultTime = document.getElementById('debt-result-time');
    const lastUpdate = document.getElementById('debt-last-update-time');

    if (!uploadBtn || !fileInput) return;

    // โหลดวันที่อัปเดตหนี้ล่าสุด
    this.loadDebtLastUpdate();

    // ปุ่มเลือกไฟล์
    uploadBtn.onclick = () => fileInput.click();
    
    // เมื่อเลือกไฟล์
    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      if (!file) return;
      
      fileName.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
      
      // ซ่อนผลลัพธ์เก่า + แสดง progress
      result.style.display = 'none';
      progress.style.display = 'block';
      progressText.textContent = 'กำลังอัปโหลดไฟล์...';
      uploadBtn.disabled = true;
      uploadBtn.textContent = '⏳ กำลังประมวลผล...';
      
      try {
        // สร้าง FormData
        const formData = new FormData();
        formData.append('file', file);
        
        progressText.textContent = 'กำลังอัปโหลดและประมวลผลข้อมูลหนี้...';
        
        // ส่งไปยัง API
        const token = Auth.getToken();
        const res = await fetch('/api/debt-import', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData,
        });
        
        const data = await res.json();
        
        if (!res.ok) {
          throw new Error(data.error || 'อัปโหลดไม่สำเร็จ');
        }
        
        // แสดงผลลัพธ์
        progress.style.display = 'none';
        result.style.display = 'block';
        
        resultStats.innerHTML = `
          📋 สัญญาทั้งหมด: <strong>${data.total_contracts.toLocaleString()}</strong> รายการ<br>
          👥 CIF ไม่ซ้ำ: <strong>${data.unique_cifs.toLocaleString()}</strong> ราย<br>
          ✅ อัปเดตสำเร็จ: <strong>${data.updated.toLocaleString()}</strong> ราย<br>
          ${data.added > 0 ? `🆕 สร้างใหม่: <strong>${data.added.toLocaleString()}</strong> ราย<br>` : ''}
          ${data.not_found > 0 ? `⚠️ ไม่พบ CIF ในระบบ: <strong>${data.not_found.toLocaleString()}</strong> ราย` : ''}
        `;
        
        resultTime.textContent = `อัปเดตเมื่อ: ${new Date(data.debt_updated_at).toLocaleString('th-TH')}`;
        
        // อัปเดตวันที่ล่าสุด
        if (lastUpdate) {
          lastUpdate.textContent = new Date(data.debt_updated_at).toLocaleString('th-TH');
        }
        
        Utils.toast(`📊 อัปเดตหนี้สำเร็จ ${data.updated} ราย${data.added > 0 ? ` +${data.added} ใหม่` : ''}`);
        
        // รีเฟรชข้อมูลลูกค้าบนแผนที่
        if (typeof Customers !== 'undefined' && Customers.renderAll) {
          setTimeout(() => Customers.renderAll(), 500);
        }
        
      } catch (err) {
        progress.style.display = 'none';
        result.style.display = 'block';
        resultStats.innerHTML = `<span style="color:var(--danger)">❌ ${err.message}</span>`;
        resultTime.textContent = '';
        Utils.toast('❌ อัปเดตหนี้ไม่สำเร็จ', 'error');
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = '📂 เลือกไฟล์ Customer Indicator';
        fileInput.value = ''; // reset file input
      }
    };
  },

  // ===== Debt Import: โหลดวันที่อัปเดตหนี้ล่าสุด =====
  async loadDebtLastUpdate() {
    const lastUpdate = document.getElementById('debt-last-update-time');
    if (!lastUpdate) return;
    
    try {
      // ดึงข้อมูลลูกค้า 1 รายเพื่อเช็ค debt_updated_at
      const token = Auth.getToken();
      const res = await fetch('/api/customers?limit=1', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      
      if (data.success && data.customers && data.customers.length > 0) {
        const debtUpdated = data.customers[0].debt_updated_at;
        if (debtUpdated) {
          lastUpdate.textContent = new Date(debtUpdated).toLocaleString('th-TH');
        } else {
          lastUpdate.textContent = 'ยังไม่เคยอัปเดต';
        }
      }
    } catch (err) {
      console.warn('Failed to load debt last update:', err);
      lastUpdate.textContent = '-';
    }
  },

  // ===== Export Customers as CSV =====
  exportCustomersCSV() {
    const customers = Storage.getActiveCustomers();
    if (!customers.length) {
      Utils.toast('⚠️ ไม่มีข้อมูลลูกค้าให้ export', 'error');
      return;
    }

    // Build CSV
    const headers = ['CIF', 'ชื่อ', 'ชื่อเล่น', 'เบอร์โทร', 'ที่อยู่', 'Latitude', 'Longitude', 'ระดับความเสี่ยง', 'ประเภทหนี้', 'สร้างโดย', 'วันที่สร้าง'];
    const rows = customers.map(c => [
      c.cif || '',
      c.name || '',
      c.nickname || '',
      c.phone || '',
      c.address || '',
      c.lat || '',
      c.lng || '',
      c.riskLevel || '',
      c.debtType || '',
      c.createdBy || '',
      c.createdAt || '',
    ]);

    // Escape CSV values
    const escapeCSV = (val) => {
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(escapeCSV).join(','))
    ].join('\n');

    // Download
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `baac-customers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    Utils.toast(`📊 Export ${customers.length} ลูกค้าเป็น CSV แล้ว`);
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
    document.getElementById('change-password-form-standalone').reset();
    document.getElementById('cp-error-standalone').textContent = '';
    document.getElementById('cp-success-standalone').style.display = 'none';
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

  // Standalone change password (for non-admin users via header button)
  async submitChangePasswordStandalone() {
    const errEl = document.getElementById('cp-error-standalone');
    const successEl = document.getElementById('cp-success-standalone');
    errEl.textContent = '';
    successEl.style.display = 'none';

    const currentPassword = document.getElementById('cp-current-standalone').value;
    const newPassword = document.getElementById('cp-new-standalone').value;
    const confirmPassword = document.getElementById('cp-confirm-standalone').value;

    if (newPassword !== confirmPassword) {
      errEl.textContent = 'รหัสผ่านใหม่ไม่ตรงกัน';
      return;
    }
    if (newPassword.length < 4) {
      errEl.textContent = 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร';
      return;
    }

    try {
      const res = await API.post('/api/change-password', { currentPassword, newPassword });
      if (res.success) {
        successEl.textContent = 'เปลี่ยนรหัสผ่านสำเร็จ ✅';
        successEl.style.display = 'block';
        document.getElementById('cp-current-standalone').value = '';
        document.getElementById('cp-new-standalone').value = '';
        document.getElementById('cp-confirm-standalone').value = '';
        Utils.toast('🔑 เปลี่ยนรหัสผ่านสำเร็จ');
      } else {
        errEl.textContent = res.error || 'เปลี่ยนรหัสไม่สำเร็จ';
      }
    } catch (err) {
      errEl.textContent = err.message || 'เปลี่ยนรหัสไม่สำเร็จ';
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
    return String(str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
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
      // ตั้ง flag ให้หน้าใหม่รู้ว่าเพิ่งอัปเดตเสร็จ — จะได้แจ้งเตือนหลัง reload
      sessionStorage.setItem('bfr_update_done', newVer || '1');

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
    // Cancel any pending update notification
    if (this._updateTimer) {
      clearInterval(this._updateTimer);
      this._updateTimer = null;
    }
    const banner = document.getElementById('update-banner');
    if (banner) banner.remove();
    this._updateNotified = false;

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

  // ===== Refresh button binding — กดเดียว = อัปเดตเป็นเวอร์ชันล่าสุดจริง =====
  const btn = document.getElementById('refresh-btn');
  if (btn) {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      btn.classList.add('spinning');
      try {
        if (btn.classList.contains('has-update')) {
          // มีเวอร์ชันใหม่จาก watcher → อัปเดตทันที (ล้าง SW/cache + reload)
          App.applyUpdate();
          return;
        }
        // ยังไม่มี has-update: กดปุ๊บ = ดึงเวอร์ชันล่าสุดเสมอ
        // 1) push ข้อมูลเครื่องขึ้นเว็บก่อน (กันข้อมูลหายตอน reload)
        try {
          const result = await Storage.retrySync();
          if (result && result.success) {
            const c = result.counts || {};
            if (typeof Utils !== 'undefined') {
              Utils.toast(`🔄 Sync สำเร็จ — ${c.customers ?? '?'} ลูกค้า, ${c.visits ?? '?'} visits`);
            }
          } else if (result && result.error) {
            if (typeof Utils !== 'undefined') {
              Utils.toast(`⚠️ Sync ล้มเหลว: ${result.error} — ข้อมูลยังอยู่ในเครื่องนี้`, 'error');
            }
          }
        } catch (err) {
          console.warn('retrySync failed, continuing to refresh:', err);
        }
        // 2) hard refresh — เคลียร์ service worker + cache แล้วโหลดเวอร์ชันใหม่ล่าสุด
        App.hardRefresh();
      } finally {
        btn.classList.remove('spinning');
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

// ===== Global error handler — show user-friendly message instead of silent failure =====
(function() {
  const originalHandler = window.onerror;
  window.onerror = function(msg, source, line, col, error) {
    // Log to console for debugging
    console.error('[Global Error]', msg, 'at', source, line, col, error);
    // Show user-friendly toast if Utils loaded
    try {
      if (typeof Utils !== 'undefined' && Utils.toast) {
        // Check if it's a known non-critical error we can auto-recover from
        const errStr = String(msg || error?.message || '');
        const warnOnly = errStr.includes('ResizeObserver') ||
                         errStr.includes('Cancelled') ||
                         errStr.includes('AbortError');
        if (!warnOnly) {
          Utils.toast('⚠️ เกิดข้อผิดพลาดเล็กน้อย — กด 🔄 เพื่อรีเฟรชถ้าใช้งานไม่ได้', 'error');
        }
      }
    } catch (_) {}
    // Call original handler if exists
    if (typeof originalHandler === 'function') {
      return originalHandler.call(window, msg, source, line, col, error);
    }
    return true; // Prevent default browser error display
  };

  // Also catch unhandled promise rejections
  window.addEventListener('unhandledrejection', function(e) {
    console.error('[Unhandled Promise]', e.reason);
    try {
      if (typeof Utils !== 'undefined' && Utils.toast) {
        const errStr = String(e.reason?.message || e.reason || '');
        if (!errStr.includes('AbortError') && !errStr.includes('Cancelled')) {
          Utils.toast('⚠️ เกิดข้อผิดพลาด — ถ้าใช้ไม่ได้ลองกด 🔄 รีเฟรช', 'error');
        }
      }
    } catch (_) {}
  });
})();

// ===== Floating Map Search Bar (Google Maps-style) =====
// ค้นหาลูกค้าบนแผนที่ด้วยชื่อ/CIF/เบอร์ — flyTo + open popup
const MapSearch = {
  _input: null,
  _results: null,
  _clearBtn: null,
  _allCustomersCache: null,
  _refreshTimer: null,

  init() {
    this._input = document.getElementById('map-search');
    this._results = document.getElementById('msb-results');
    this._clearBtn = document.getElementById('msb-clear');
    if (!this._input || !this._results) return;

    this._input.addEventListener('input', () => this._onInput());
    this._input.addEventListener('focus', () => { if (this._input.value) this._onInput(); });
    this._clearBtn.addEventListener('click', () => this._clear());

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
      const bar = document.getElementById('map-debt-filter');
      if (bar && !bar.contains(e.target)) this._hideResults();
    });

    // Refresh cache every 30s (customers may change via sync/import)
    this._refreshTimer = setInterval(() => { this._allCustomersCache = null; }, 30000);
  },

  _getCustomers() {
    if (this._allCustomersCache) return this._allCustomersCache;
    if (typeof Storage !== 'undefined' && Storage.getActiveCustomers) {
      this._allCustomersCache = Storage.getActiveCustomers();
    } else {
      this._allCustomersCache = [];
    }
    return this._allCustomersCache;
  },

  _onInput() {
    const q = this._input.value.trim();
    this._clearBtn.classList.toggle('hidden', !q);

    if (!q || q.length < 1) { this._hideResults(); return; }

    const query = q.toLowerCase();
    const customers = this._getCustomers();

    // Match: name, nickname, CIF, phone (exact + partial)
    const matches = customers.filter(c => {
      const name = (c.name || '').toLowerCase();
      const nick = (c.nickname || '').toLowerCase();
      const cif = String(c.cif || '');
      const phone = String(c.phone || '');
      return name.includes(query) || nick.includes(query) || cif.includes(query) || phone.includes(query);
    });
    const top = matches.slice(0, 6);

    if (top.length === 0) {
      this._results.innerHTML = '<div class="msb-no-results">ไม่พบลูกค้าที่ตรงกับ "<strong>' + this._esc(q) + '</strong>"</div>';
      this._results.classList.remove('hidden');
      return;
    }

    const riskColors = { 'แดง': '#d32f2f', 'เหลือง': '#e6a817', 'เขียว': '#16a34a' };
    this._results.innerHTML = top.map(c => {
      const color = riskColors[c.riskLevel] || '#9e9e9e';
      const sub = [c.cif ? 'CIF:' + c.cif : '', c.phone, c.nickname].filter(Boolean).join(' · ');
      const id = c.id || c.cif;
      return '<div class="msb-result-item" data-id="' + this._escAttr(id) + '" role="option">' +
        '<span class="msb-result-dot" style="background:' + color + '"></span>' +
        '<div class="msb-result-info">' +
          '<div class="msb-result-name">' + this._esc(c.name || 'ไม่มีชื่อ') + '</div>' +
          '<div class="msb-result-meta">' + this._esc(sub || '-') + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    // Bind clicks
    const self = this;
    this._results.querySelectorAll('.msb-result-item').forEach(el => {
      el.addEventListener('click', () => self._select(el.dataset.id));
    });

    this._results.classList.remove('hidden');
  },

  _select(id) {
    const customers = this._getCustomers();
    const c = customers.find(x => (x.id === id) || String(x.cif) === id);
    if (!c) return;

    if (!c.lat || !c.lng) {
      if (typeof Utils !== 'undefined') Utils.toast('⚠️ ลูกค้านี้ไม่มีพิกัดบนแผนที่', 'warn');
      this._clear();
      this._hideResults();
      return;
    }

    // Collapse bottom sheet to show full map
    if (typeof App !== 'undefined' && App.setSheetState) App.setSheetState('peek');

    // Fly to marker + open popup (reuse Customers pattern)
    if (typeof Customers !== 'undefined' && Customers.map) {
      Customers.map.flyTo([c.lat, c.lng], 17, { duration: 0.8 });
      setTimeout(() => {
        if (Customers.markers && Customers.markers[c.id]) {
          Customers.map.openPopup(Customers.markers[c.id]);
        } else if (Customers.markers) {
          // Try by cif
          for (const [mid, m] of Object.entries(Customers.markers)) {
            if (mid === c.id || String(mid) === String(c.id || c.cif)) {
              Customers.map.openPopup(m);
              break;
            }
          }
        }
      }, 900);
    }

    this._clear();
    this._hideResults();
    this._input.blur(); // hide mobile keyboard
  },

  _clear() {
    if (this._input) this._input.value = '';
    if (this._clearBtn) this._clearBtn.classList.add('hidden');
    this._hideResults();
  },

  _hideResults() {
    if (this._results) this._results.classList.add('hidden');
  },

  _esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },

  _escAttr(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  },
};
