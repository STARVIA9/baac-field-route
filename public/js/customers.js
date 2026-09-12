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
    const hasGps = Number.isFinite(c.lat) && Number.isFinite(c.lng);
    const gpsStatus = hasGps
      ? `<div class="popup-addr">📍 มีพิกัดแล้ว</div>`
      : `<div class="popup-addr">⚪ ยังไม่มีพิกัด</div>`;
    return `
      <div class="popup-name">${this.escapeHTML(c.name)}</div>
      ${c.cif ? `<div class="popup-addr">CIF: ${this.escapeHTML(c.cif)}</div>` : ''}
      ${metaHTML}
      ${debtHTML}
      ${c.address ? `<div class="popup-addr">${this.escapeHTML(c.address)}</div>` : ''}
      ${c.phone ? `<div class="popup-addr">📞 ${this.escapeHTML(c.phone)}</div>` : ''}
      ${gpsStatus}
      <div class="popup-actions">
        ${hasGps ? `<button class="popup-nav" onclick="Customers.navigate(${Number(c.lat)},${Number(c.lng)})">🧭 นำทาง</button>` : `<button class="popup-nav" onclick="Customers.saveQuickGps('${this.escapeAttr(c.id)}')">📍 เก็บพิกัดตรงนี้</button>`}
        <button class="popup-edit" onclick="Customers.edit('${this.escapeAttr(c.id)}')">✏️ แก้ไข</button>
        <button class="popup-del" onclick="Customers.del('${this.escapeAttr(c.id)}')">🗑️ ลบ</button>
      </div>
    `;
  },

  // 📍 เซฟพิกัดด่วนในหน้าเดียวกับดูข้อมูล — กดปุ๊บเก็บพิกัดมือถือทันที ไม่ต้องเปิดฟอร์มแก้ไข
  saveQuickGps(id) {
    const c = Storage.getCustomers().find(x => x.id === id);
    if (!c) return;
    if (!navigator.geolocation) {
      Utils.toast('เครื่องนี้ไม่รองรับ GPS', 'error');
      return;
    }
    Utils.toast('📍 กำลังจับพิกัด...', 'info');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      const r = await Storage.updateCustomer(id, { lat, lng });
      Customers.renderAll();
      Utils.toast(r && r.synced ? `📍 เซฟพิกัด ${c.name} แล้ว` : `📍 เซฟพิกัดแล้ว (รอเน็ตส่งขึ้นเว็บ)`, r && r.synced ? 'success' : 'warn');
    }, () => {
      Utils.toast('จับพิกัดไม่สำเร็จ — เปิด GPS แล้วลองใหม่', 'error');
    }, { enableHighAccuracy: true, timeout: 15000 });
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
    document.getElementById('add-modal-title').textContent = `✏️ แก้ไขลูกค้า: ${c.name || ''}`;
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
    App._renderAddGpsDisplay();
    // Phase 4: pre-fill risk + debt note
    form.elements.riskLevel.value = c.riskLevel || 'unclassified';
    if ('debtNote' in form.elements) form.elements.debtNote.value = c.debtNote || '';
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
        Utils.toast('คนนี้ยังไม่มีพิกัด กด 📍 เก็บก่อน', 'error');
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
