var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
const Customers = {
  map: null,
  markers: {},
  currentFilter: "all",
  // Debt filters (ข้อมูลหนี้ Customer Indicator)
  debtMonth: "",
  // เดือนที่ถึงกำหนด (เช่น '08/2026') — ว่าง = ทุกเดือน
  debtTier: "",
  // ชั้นหนี้ (''=ทุกชั้น, '1'..'5')
  omsomMode: "",
  // ''=รวม, 'exclude'=กรอง อสม.ออก, 'only'=เฉพาะ อสม.
  m15Mode: "",
  // ''=ทุก 15เดือน, 'Y'=มี 15เดือน, 'none'=ไม่มี 15เดือน
  reserveMode: "",
  // ''=ทุกสำรอง, '1'=กันสำรอง 1%, '100'=กันสำรอง 100%, 'none'=ไม่มีกันสำรอง
  _baseLayers: {},
  _currentBaseLayer: "roadmap",
  // Init map
  initMap() {
    if (this.map) return;
    const office0 = window.OFFICE_LOCATION || { lat: 13.7760801, lng: 101.8907475 };
    this.map = L.map("map", {
      preferCanvas: true,
      // Render vector layers on <canvas> — GPU accelerated, NO DOM per marker
      maxZoom: 20,
      zoomControl: false,
      // B: ปิด topleft (โดนแผงตัวกรองบัง) → custom zoom control ล่างขวา
      // มือถือ: นิ้วแตะพลาดไปโดนแผนที่รอบการ์ด (นิ้วลื่น/การ์ดเกือบเต็มจอ) ทำให้การ์ดปิดเอง
      // → ปิดการปิดอัตโนมัติ ปิดการ์ดด้วยปุ่ม ✕ ในการ์ด หรือแตะหมุดตัวอื่นแทน
      closePopupOnClick: false
    }).setView([office0.lat, office0.lng], 13);
    const applyCardMaxHeight = () => {
      if (!this.map) return;
      const avail = Math.max(220, Math.round(this.map.getSize().y) - 16);
      this.map.getContainer().style.setProperty("--card-max-h", avail + "px");
    };
    applyCardMaxHeight();
    this.map.on("resize", applyCardMaxHeight);
    this.map.on("popupopen", (e) => {
      const el = e.popup && e.popup.getElement();
      if (!el) return;
      setTimeout(() => {
        if (!this.map || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const m = this.map.getContainer().getBoundingClientRect();
        let dy = 0;
        if (r.top < m.top + 4) dy = r.top - m.top - 4;
        else if (r.bottom > m.bottom - 4) dy = r.bottom - m.bottom + 4;
        if (Math.abs(dy) > 2) this.map.panBy([0, dy], { animate: true });
      }, 350);
    });
    this._baseLayers = {
      roadmap: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "\xA9 OpenStreetMap",
        maxZoom: 20,
        maxNativeZoom: 19
        // 19+ = stretch tiles (ภาพเบลอนิดแต่ยังพอดูได้)
      }),
      satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: "\xA9 Esri World Imagery",
        maxZoom: 20,
        maxNativeZoom: 19
      })
    };
    let _tileErrAt = 0;
    const _onTileErr = () => {
      const now = Date.now();
      if (now - _tileErrAt < 1e4) return;
      _tileErrAt = now;
      if (window.Utils && Utils.toast) Utils.toast("\u26A0\uFE0F \u0E42\u0E2B\u0E25\u0E14\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \u2014 \u0E15\u0E23\u0E27\u0E08\u0E2D\u0E34\u0E19\u0E40\u0E17\u0E2D\u0E23\u0E4C\u0E40\u0E19\u0E47\u0E15\u0E41\u0E25\u0E49\u0E27\u0E0B\u0E39\u0E21\u0E43\u0E2B\u0E21\u0E48", "error");
    };
    this._baseLayers.roadmap.on("tileerror", _onTileErr);
    this._baseLayers.satellite.on("tileerror", _onTileErr);
    this._baseLayers.roadmap.addTo(this.map);
    this._currentBaseLayer = "roadmap";
    this._addLayerControl();
    let _maxZoomNotified = false;
    this.map.on("zoomend", () => {
      const z = this.map.getZoom();
      if (z >= 20) {
        if (!_maxZoomNotified) {
          Utils.toast("\u{1F50D} \u0E0B\u0E39\u0E21\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E2A\u0E38\u0E14\u0E41\u0E25\u0E49\u0E27 (\u0E20\u0E32\u0E1E\u0E08\u0E32\u0E01\u0E23\u0E30\u0E14\u0E31\u0E1A 19 \u0E16\u0E39\u0E01\u0E02\u0E22\u0E32\u0E22)", "", 2500);
          _maxZoomNotified = true;
          setTimeout(() => {
            _maxZoomNotified = false;
          }, 1e4);
        }
      }
    });
    const LONG_PRESS_MS = 600;
    let pressTimer = null;
    let pressLatLng = null;
    const handleLongPress = (latlng) => {
      if (!latlng) return;
      if (window._pickMode) {
        window._pickMode = false;
        const draft = sessionStorage.getItem("add-customer-draft");
        const draftData = draft ? JSON.parse(draft) : {};
        draftData.lat = latlng.lat.toFixed(6);
        draftData.lng = latlng.lng.toFixed(6);
        sessionStorage.setItem("add-customer-draft", JSON.stringify(draftData));
        App.restoreAddCustomerModal();
        return;
      }
      this._showPinOptions(latlng.lat, latlng.lng);
    };
    const startPress = (latlng) => {
      pressLatLng = latlng;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        pressTimer = null;
        handleLongPress(pressLatLng);
      }, LONG_PRESS_MS);
    };
    const cancelPress = () => {
      clearTimeout(pressTimer);
      pressTimer = null;
    };
    this.map.on("mousedown", (e) => {
      if (e.originalEvent && e.originalEvent.button !== 0) return;
      startPress(e.latlng);
    });
    this.map.on("mouseup", cancelPress);
    this.map.on("mousemove", (e) => {
      if (pressTimer && pressLatLng && e.latlng && e.latlng.distanceTo(pressLatLng) > 12) cancelPress();
    });
    this.map.on("mouseout", cancelPress);
    this.map.on("touchstart", (e) => {
      if (e.latlng) startPress(e.latlng);
    });
    this.map.on("touchend", cancelPress);
    this.map.on("touchmove", cancelPress);
    this.map.on("contextmenu", (e) => {
      clearTimeout(pressTimer);
      pressTimer = null;
      handleLongPress(e.latlng);
    });
  },
  // ===== Color scheme for circleMarker (no DOM elements) =====
  _riskColors: {
    // ไม่ระบุความเสี่ยง → ให้เด่นขึ้น (เดิมเทาอ่อน opacity ต่ำ มองแทบไม่เห็น)
    // ม่วงเข้ม + ขอบขาว = ตัดกับทั้งแผนที่สว่างและภาพดาวเทียม
    unclassified: { fill: "#6d28d9", stroke: "#ffffff" },
    good: { fill: "#16a34a", stroke: "#16a34a" },
    warning: { fill: "#d97706", stroke: "#d97706" },
    bad: { fill: "#dc2626", stroke: "#dc2626" }
  },
  // Render all markers on map — L.circleMarker + Canvas (ZERO DOM per marker)
  // Clustered so zoomed-out mobile doesn't render/overlap 178 dots.
  // Smart rebuild: skips full teardown if data hasn't changed.
  _lastMarkerHash: null,
  // โหมดโฟกัสเส้นทาง (27 ต.ค.69 — พ่อสั่ง): กดวางแผน/จัดลำดับแล้วซ่อนเลขกลุ่ม
  // พิกัดอื่น ให้เห็นแค่เลขลำดับ 1,2,3 ชัดๆ · ออกด้วย exitRouteFocus()
  _routeFocus: null,
  renderMarkers(routeOrder, opts = {}) {
    var _a, _b;
    if (!this.map) return;
    if (routeOrder && routeOrder.length) {
      this._routeFocus = [...routeOrder];
    } else if (!routeOrder && this._routeFocus && !opts.exitFocus) {
      routeOrder = this._routeFocus;
    }
    if (opts.exitFocus) this._routeFocus = null;
    const isFocus = !!(routeOrder && routeOrder.length);
    const customers = Storage.getActiveCustomers();
    const visits = Storage.getVisits();
    let hash = "";
    for (const c of customers) {
      if (Number.isFinite(c.lat)) {
        hash += c.id + ":" + Number(c.lat).toFixed(4) + "," + Number(c.lng).toFixed(4) + ":" + (visits[c.id] ? "1" : "0") + ":" + (c.riskLevel || "u") + ";";
      }
    }
    if (routeOrder) hash += "|route:" + routeOrder.join(",");
    if (this.debtMonth) hash += "|dm:" + this.debtMonth;
    if (this.debtTier) hash += "|dt:" + this.debtTier;
    if (this.omsomMode) hash += "|om:" + this.omsomMode;
    if (this.m15Mode) hash += "|m15:" + this.m15Mode;
    this._zoneFilter = ((_a = document.getElementById("customer-zone")) == null ? void 0 : _a.value) || "";
    if (this._zoneFilter) hash += "|zone:" + this._zoneFilter;
    this._branchFilter = ((_b = document.getElementById("map-branch-filter")) == null ? void 0 : _b.value) || "";
    if (this._branchFilter) hash += "|br:" + this._branchFilter;
    if (!opts.force && hash === this._lastMarkerHash) return;
    this._lastMarkerHash = hash;
    Object.values(this.markers).forEach((m) => this.map.removeLayer(m));
    this.markers = {};
    if (this._cluster) {
      this.map.removeLayer(this._cluster);
      this._cluster = null;
    }
    if (this._routeNumLayer) {
      this.map.removeLayer(this._routeNumLayer);
      this._routeNumLayer = null;
    }
    const orderMap = {};
    if (routeOrder && routeOrder.length) {
      routeOrder.forEach((id, idx) => {
        orderMap[id] = idx + 1;
      });
    }
    const jitter = (v, seed) => {
      const h = (seed * 2654435761 >>> 0) / 4294967296;
      return v + (h - 0.5) * 6e-5;
    };
    const coordKeys = {};
    for (const c of customers) {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
      const key = c.lat.toFixed(6) + "," + c.lng.toFixed(6);
      coordKeys[key] = (coordKeys[key] || 0) + 1;
    }
    const clusterable = typeof L.markerClusterGroup === "function" && !isFocus;
    const cluster = clusterable ? L.markerClusterGroup({
      maxClusterRadius: 45,
      // merge points within ~45px
      disableClusteringAtZoom: 16,
      // below 16, show individual dots (village level)
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (cc) => {
        const n = cc.getChildCount();
        const cls = n >= 50 ? "mc-red" : n >= 10 ? "mc-orange" : "mc-green";
        return L.divIcon({
          html: `<div class="marker-cluster-icon ${cls}">${n}</div>`,
          className: "",
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        });
      }
    }) : null;
    customers.forEach((c) => {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
      if (!this._passesMapFilters(c)) return;
      const visited = !!visits[c.id];
      const riskClass = c.riskLevel || "unclassified";
      const inRoute = orderMap[c.id] != null;
      const colors = this._riskColors[riskClass] || this._riskColors.unclassified;
      const fill = visited ? "#16a34a" : colors.fill;
      const stroke = visited ? "#16a34a" : colors.stroke;
      let mLat = c.lat, mLng = c.lng;
      if (coordKeys[c.lat.toFixed(6) + "," + c.lng.toFixed(6)] > 1) {
        const seed = parseInt(c.cif, 10) || parseInt(c.id.replace(/\D/g, ""), 10) || 0;
        mLat = jitter(c.lat, seed);
        mLng = jitter(c.lng, seed + 7919);
      }
      const isUnclassified = riskClass === "unclassified";
      const marker = L.circleMarker([mLat, mLng], isFocus && !inRoute ? {
        radius: 4,
        fillColor: fill,
        color: stroke,
        weight: 1,
        opacity: 0.3,
        fillOpacity: 0.25,
        pane: "markerPane"
      } : {
        radius: inRoute ? 14 : isUnclassified ? 10 : 8,
        fillColor: fill,
        color: stroke,
        weight: inRoute ? 4 : isUnclassified ? 3 : 1.5,
        opacity: 1,
        fillOpacity: inRoute ? 1 : isUnclassified ? 0.95 : 0.85,
        pane: "markerPane"
      });
      marker.bindPopup(() => this.popupHTML(c));
      marker.on("click", () => {
        if (typeof App !== "undefined" && App.setSheetState) App.setSheetState("peek");
      });
      if (cluster) cluster.addLayer(marker);
      else marker.addTo(this.map);
      this.markers[c.id] = marker;
    });
    if (cluster) {
      cluster.addTo(this.map);
      this._cluster = cluster;
    }
    const inRouteCusts = customers.filter((c) => orderMap[c.id] != null);
    if (inRouteCusts.length > 0) {
      this._routeNumLayer = L.layerGroup(inRouteCusts.map((c) => {
        return L.marker([c.lat, c.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div class="marker-route-num${isFocus ? " focus" : ""}">${orderMap[c.id]}</div>`,
            iconSize: isFocus ? [32, 32] : [22, 22],
            iconAnchor: isFocus ? [16, -16] : [11, -12]
            // float above the circleMarker
          }),
          interactive: false,
          // don't steal clicks
          pane: "tooltipPane"
          // เหนือหมุด (markerPane) + กลุ่มเสมอ
        });
      })).addTo(this.map);
    }
    if (opts.fitBounds && customers.length > 0) {
      const gps = customers.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng) && c.lat >= 5 && c.lat <= 21 && c.lng >= 97 && c.lng <= 106);
      if (gps.length > 0) {
        const bounds = L.latLngBounds(gps.map((c) => [c.lat, c.lng]));
        this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
      }
    }
  },
  // ===== ออกจากโหมดโฟกัสเส้นทาง (โชว์หมุด+เลขกลุ่มทั้งหมดเหมือนเดิม) =====
  exitRouteFocus() {
    this._routeFocus = null;
    this._lastMarkerHash = null;
    this.renderMarkers(null, { force: true, exitFocus: true });
  },
  // ===== Debt filter bar: เติมเดือน + ผูก event + re-render =====
  initDebtFilter() {
    const monthSel = document.getElementById("debt-month-filter");
    const tierSel = document.getElementById("debt-tier-filter");
    const omSel = document.getElementById("debt-omsom-filter");
    const m15Sel = document.getElementById("debt-15m-filter");
    const rsvSel = document.getElementById("debt-reserve-filter");
    const resetBtn = document.getElementById("debt-filter-reset");
    if (!monthSel || typeof DebtDB === "undefined") return;
    if (DebtDB._loaded && monthSel.options.length <= 1) {
      const now = /* @__PURE__ */ new Date();
      const fyStartY = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
      for (let i = 0; i < 12; i++) {
        const mm = (3 + i) % 12 + 1;
        const yyyy = fyStartY + (mm < 4 ? 1 : 0);
        const k = String(mm).padStart(2, "0") + "/" + yyyy;
        const o = document.createElement("option");
        o.value = k;
        o.textContent = DebtDB.fmtDate("01/" + k);
        monthSel.appendChild(o);
      }
    }
    const mapZoneSel = document.getElementById("map-zone-filter");
    const tabZoneSel = document.getElementById("customer-zone");
    if (mapZoneSel && tabZoneSel) {
      mapZoneSel.value = tabZoneSel.value || "";
      mapZoneSel.addEventListener("change", () => {
        tabZoneSel.value = mapZoneSel.value;
        this._lastMarkerHash = null;
        this.renderAll();
      });
      tabZoneSel.addEventListener("change", () => {
        mapZoneSel.value = tabZoneSel.value || "";
      });
    }
    this.refreshBranchOptions();
    const apply = () => {
      var _a;
      this.debtMonth = monthSel.value;
      this.debtTier = tierSel.value;
      this.omsomMode = omSel.value;
      this.m15Mode = m15Sel ? m15Sel.value : "";
      this.reserveMode = rsvSel ? rsvSel.value : "";
      this._zoneFilter = ((_a = document.getElementById("customer-zone")) == null ? void 0 : _a.value) || "";
      this._lastMarkerHash = null;
      this.renderAll();
    };
    monthSel.addEventListener("change", apply);
    tierSel.addEventListener("change", apply);
    omSel.addEventListener("change", apply);
    if (m15Sel) m15Sel.addEventListener("change", apply);
    if (rsvSel) rsvSel.addEventListener("change", apply);
    if (resetBtn) resetBtn.addEventListener("click", () => {
      monthSel.value = "";
      tierSel.value = "";
      omSel.value = "";
      if (m15Sel) m15Sel.value = "";
      if (rsvSel) rsvSel.value = "";
      if (mapZoneSel) mapZoneSel.value = "";
      if (tabZoneSel) tabZoneSel.value = "";
      const mapBranchSel = document.getElementById("map-branch-filter");
      if (mapBranchSel) mapBranchSel.value = "";
      this.debtMonth = "";
      this.debtTier = "";
      this.omsomMode = "";
      this.m15Mode = "";
      this.reserveMode = "";
      this._zoneFilter = "";
      this._branchFilter = "";
      this._lastMarkerHash = null;
      this.renderAll();
    });
  },
  // ===== ตัวกรองหนี้แบบ pure — ใช้ร่วมกันทั้งแผนที่และหน้า "งานวันนี้" =====
  // f = {month, tier, omsom, m15, reserve, zone, branch} ('' = ไม่กรองข้อนั้น)
  // info มาจาก debtInfo(): {due, maxTier, omsom, has15, reserves[], zone|null, branch}
  matchDebt(f, info) {
    f = f || {};
    info = info || {};
    if (f.month || f.tier || f.omsom || f.m15 || f.reserve) {
      const isNpl = f.tier === "npl";
      if (f.month && !isNpl && (info.due || "") !== f.month) return false;
      if (f.tier) {
        const t = info.maxTier || 0;
        if (isNpl) {
          if (!(t >= 3 && t <= 5)) return false;
        } else if (t !== parseInt(f.tier, 10)) return false;
      }
      if (f.omsom) {
        if (f.omsom === "exclude" && info.omsom) return false;
        if (f.omsom === "only" && !info.omsom) return false;
      }
      if (f.m15) {
        if (f.m15 === "Y" && !info.has15) return false;
        if (f.m15 === "none" && info.has15) return false;
      }
      if (f.reserve) {
        const rsv = info.reserves || [];
        if (f.reserve === "none") {
          if (rsv.some((x) => String(x) !== "")) return false;
        } else if (!rsv.some((x) => String(x) === f.reserve)) return false;
      }
    }
    if (f.zone && (info.zone == null || String(info.zone) !== String(f.zone))) return false;
    if (f.branch && String(info.branch || "") !== String(f.branch)) return false;
    return true;
  },
  // ดึง info สำหรับ matchDebt (พฤติกรรมเดิม: ไม่มีทะเบียนกลาง = เขตไม่ผ่าน, สาขาตกไปใช้ของเครื่อง)
  debtInfo(c) {
    c = c || {};
    const debt = c.cif && typeof DebtDB !== "undefined" && DebtDB._loaded ? DebtDB.getByCif(c.cif) : null;
    const dbrec = c.cif && typeof CustomerDB !== "undefined" ? CustomerDB.getByCif(c.cif) : null;
    const ctrs = debt && debt.contracts || [];
    return {
      due: debt && typeof DebtDB !== "undefined" && DebtDB.dueMonthKey ? DebtDB.dueMonthKey(debt.earliest_due) || "" : "",
      maxTier: debt ? parseInt(debt.max_tier, 10) || 0 : 0,
      omsom: !!(debt && debt.is_omsom),
      has15: ctrs.some((x) => x.m15 === "Y" || (x.m15_amt || 0) > 0),
      reserves: ctrs.map((x) => x.reserve),
      zone: dbrec ? String(dbrec.zone == null ? "" : dbrec.zone) : null,
      branch: dbrec ? String(dbrec.branch || "") : String(c.branch || "")
    };
  },
  // ===== ตัวกรองแผนที่ (ใช้ร่วมกันทั้งหมุด + เกจพิกัด) =====
  // คืน true = ลูกค้าผ่านตัวกรองปัจจุบัน (เดือน/ชั้นหนี้/อสม./15เดือน/เขต/สาขา + คำค้น)
  _passesMapFilters(c, query) {
    var _a;
    const df = { month: this.debtMonth || "", tier: this.debtTier || "", omsom: this.omsomMode || "", m15: this.m15Mode || "", reserve: this.reserveMode || "", zone: this._zoneFilter || "", branch: this._userBranch() || this._branchFilter || "" };
    if (!Customers.matchDebt(df, Customers.debtInfo(c))) return false;
    const q = (query !== void 0 ? query : ((_a = document.getElementById("map-search")) == null ? void 0 : _a.value) || "").trim().toLowerCase();
    if (q) {
      const name = (c.name || "").toLowerCase();
      const nick = (c.nickname || "").toLowerCase();
      const cif = String(c.cif || "");
      const phone = String(c.phone || "");
      if (!(name.includes(q) || nick.includes(q) || cif.includes(q) || phone.includes(q))) return false;
    }
    return true;
  },
  // นับ {total, withGps} ตามตัวกรองปัจจุบัน (รวมรายที่ไม่มีพิกัดด้วย)
  getFilterStats(query) {
    if (typeof Storage === "undefined" || !Storage.getActiveCustomers) return { total: 0, withGps: 0 };
    let total = 0, withGps = 0;
    for (const c of Storage.getActiveCustomers()) {
      if (!this._passesMapFilters(c, query)) continue;
      total++;
      if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) withGps++;
    }
    return { total, withGps };
  },
  // อัพเดทเกจพิกัดใต้ช่องค้นหา
  updateGpsGauge() {
    const text = document.getElementById("mdf-gps-text");
    const fill = document.getElementById("mdf-gps-fill");
    if (!text || !fill) return;
    const { total, withGps } = this.getFilterStats();
    if (!total) {
      text.textContent = "\u{1F4CD} \u0E44\u0E21\u0E48\u0E21\u0E35\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E15\u0E32\u0E21\u0E15\u0E31\u0E27\u0E01\u0E23\u0E2D\u0E07";
      fill.style.width = "0%";
      return;
    }
    const pct = Math.round(withGps / total * 100);
    text.textContent = `\u{1F4CD} ${withGps.toLocaleString("th-TH")}/${total.toLocaleString("th-TH")} \u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14 (${pct}%)`;
    fill.style.width = pct + "%";
  },
  // Popup HTML
  popupHTML(c) {
    const db = c.cif && typeof CustomerDB !== "undefined" ? CustomerDB.getByCif(c.cif) : null;
    let metaHTML = "";
    if (db) {
      const parts = [];
      if (db.zone) parts.push(`\u0E40\u0E02\u0E15 ${db.zone}`);
      if (db.customer_class) parts.push(`\u0E0A\u0E31\u0E49\u0E19 ${db.customer_class}`);
      if (db.potential) parts.push(`\u0E28\u0E31\u0E01\u0E22\u0E20\u0E32\u0E1E ${db.potential}`);
      if (parts.length) metaHTML = `<div class="popup-addr" style="font-size:11px;color:#0a8f3c;">${this.escapeHTML(parts.join(" \xB7 "))}</div>`;
    }
    let debtHTML = "";
    if (c.cif && typeof DebtDB !== "undefined") {
      if (!DebtDB._loaded) {
        const label = DebtDB._loading ? "\u23F3 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E42\u0E2B\u0E25\u0E14\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2B\u0E19\u0E35\u0E49..." : "\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2B\u0E19\u0E35\u0E49\u0E42\u0E2B\u0E25\u0E14\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08";
        debtHTML = `<div class="popup-debt"><div class="debt-nodata">${label}</div></div>`;
      } else {
        const debt = DebtDB.getByCif(c.cif);
        if (debt) {
          debtHTML = `
          <div class="popup-debt">
            ${DebtDB.summaryHTML(debt)}
            <button type="button" class="debt-more" onclick="DebtUI.toggleContracts('${this.escapeAttr(debt.cif)}', this)">\u{1F4C4} \u0E14\u0E39\u0E2A\u0E31\u0E0D\u0E0D\u0E32 (${debt.contracts ? debt.contracts.length : 0} \u0E2A\u0E31\u0E0D\u0E0D\u0E32) \u25BE</button>
            <div class="debt-contracts-wrap hidden" id="debt-contracts-${this.escapeAttr(debt.cif)}"></div>
          </div>
        `;
        } else {
          debtHTML = `<div class="popup-debt"><div class="debt-nodata">\u0E44\u0E21\u0E48\u0E21\u0E35\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2B\u0E19\u0E35\u0E49</div></div>`;
        }
      }
    }
    const hasGps = Number.isFinite(c.lat) && Number.isFinite(c.lng);
    const gpsStatus = hasGps ? `<div class="popup-addr">\u{1F4CD} \u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E41\u0E25\u0E49\u0E27</div>` : `<div class="popup-addr">\u26AA \u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14</div>`;
    return `
      <div class="popup-head">
        <div class="popup-name">${this.escapeHTML(c.name)}</div>
        <button type="button" class="popup-close" onclick="Customers.closeCard()" title="\u0E1B\u0E34\u0E14\u0E01\u0E32\u0E23\u0E4C\u0E14" aria-label="\u0E1B\u0E34\u0E14\u0E01\u0E32\u0E23\u0E4C\u0E14">\u2715</button>
      </div>
      ${c.cif ? `<div class="popup-addr">CIF: ${this.escapeHTML(c.cif)}</div>` : ""}
      ${metaHTML}
      ${debtHTML}
      ${c.address ? `<div class="popup-addr">${this.escapeHTML(c.address)}</div>` : ""}
      ${c.phone ? `<div class="popup-addr">\u{1F4DE} ${this.escapeHTML(c.phone)}</div>` : ""}
      ${gpsStatus}
      <div class="popup-actions">
        ${hasGps ? `<button class="popup-nav" onclick="Customers.navigate(${Number(c.lat)},${Number(c.lng)})">\u{1F9ED} \u0E19\u0E33\u0E17\u0E32\u0E07</button>` : `<button class="popup-nav" onclick="Customers.saveQuickGps('${this.escapeAttr(c.id)}')">\u{1F4CD} \u0E40\u0E01\u0E47\u0E1A\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E15\u0E23\u0E07\u0E19\u0E35\u0E49</button>`}
        <button class="popup-edit" onclick="Customers.edit('${this.escapeAttr(c.id)}')">\u270F\uFE0F \u0E41\u0E01\u0E49\u0E44\u0E02</button>
        <button class="popup-visit" onclick="Visit.openLog('${this.escapeAttr(c.id)}')">\u{1F4DD} \u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E40\u0E02\u0E49\u0E32\u0E1E\u0E1A</button>
        <button class="popup-del" onclick="Customers.del('${this.escapeAttr(c.id)}')">\u{1F5D1}\uFE0F \u0E25\u0E1A</button>
      </div>
    `;
  },
  // ปิดการ์ดลูกค้าบนแผนที่ (ปุ่ม ✕) — จำเป็นเพราะปิดการปิดอัตโนมัติเมื่อแตะแผนที่แล้ว (กันนิ้วพลาดบนมือถือ)
  closeCard() {
    if (this.map) this.map.closePopup();
  },
  // 📍 เซฟพิกัดด่วนในหน้าเดียวกับดูข้อมูล — กดปุ๊บเก็บพิกัดมือถือทันที ไม่ต้องเปิดฟอร์มแก้ไข
  saveQuickGps(id) {
    const c = Storage.getCustomers().find((x) => x.id === id);
    if (!c) return;
    if (!navigator.geolocation) {
      Utils.toast("\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E19\u0E35\u0E49\u0E44\u0E21\u0E48\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A GPS", "error");
      return;
    }
    Utils.toast("\u{1F4CD} \u0E01\u0E33\u0E25\u0E31\u0E07\u0E08\u0E31\u0E1A\u0E1E\u0E34\u0E01\u0E31\u0E14...", "info");
    navigator.geolocation.getCurrentPosition((pos) => {
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      this.saveGpsFast(id, c.cif, lat, lng, c.name);
    }, () => {
      Utils.toast("\u0E08\u0E31\u0E1A\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \u2014 \u0E40\u0E1B\u0E34\u0E14 GPS \u0E41\u0E25\u0E49\u0E27\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48", "error");
    }, { enableHighAccuracy: true, timeout: 15e3 });
  },
  // ⚡ จุดเดียวที่ทุกปุ่มปักหมุดเรียกใช้
  // เขียนลงเครื่อง + วาดหมุดทันที (~20ms) แล้วค่อยส่งขึ้นเว็บเบื้องหลัง
  // เดิม: await เน็ตก่อน (วัดจริง 14 ก.ย.69 = รอ 1.0–2.5 วิ กว่าหมุดจะขึ้น)
  saveGpsFast(id, cif, lat, lng, label) {
    const saved = Storage.updateCustomerLocal(id, { lat, lng });
    if (!saved) {
      Utils.toast("\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32", "error");
      return;
    }
    this._lastMarkerHash = null;
    this.renderAll();
    this.focusPin(lat, lng);
    if (typeof App !== "undefined" && App.setSaveStatus) App.setSaveStatus("saving");
    Utils.toast("\u23F3 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E02\u0E36\u0E49\u0E19\u0E40\u0E27\u0E47\u0E1A...", "info");
    Storage.uploadCustomer(cif, { lat: Number(lat), lng: Number(lng) }).then((r) => {
      if (r && r.synced) {
        if (typeof App !== "undefined" && App.setSaveStatus) App.setSaveStatus("saved");
        Utils.toast(`\u2705 \u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E1E\u0E34\u0E01\u0E31\u0E14 "${label || "\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32"}" \u0E02\u0E36\u0E49\u0E19\u0E40\u0E27\u0E47\u0E1A\u0E41\u0E25\u0E49\u0E27`);
      } else {
        if (typeof App !== "undefined" && App.setSaveStatus) App.setSaveStatus("error");
        Utils.toast("\u26A0\uFE0F \u0E2B\u0E21\u0E38\u0E14\u0E02\u0E36\u0E49\u0E19\u0E43\u0E19\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E19\u0E35\u0E49\u0E41\u0E25\u0E49\u0E27 \u0E41\u0E15\u0E48\u0E22\u0E31\u0E07\u0E2A\u0E48\u0E07\u0E02\u0E36\u0E49\u0E19\u0E40\u0E27\u0E47\u0E1A\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \u2014 \u0E01\u0E14\u0E1B\u0E38\u0E48\u0E21 sync \u0E25\u0E48\u0E32\u0E07\u0E02\u0E27\u0E32\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48", "error");
      }
    });
  },
  // ซูมเข้าหาหมุดที่เพิ่งปัก (zoom 17 = หมุดไม่ถูกยัดอยู่ในกลุ่ม) + กระพริบให้เห็น
  focusPin(lat, lng) {
    if (!this.map) return;
    try {
      const target = L.latLng(lat, lng);
      const z = Math.max(this.map.getZoom(), 17);
      this.map.flyTo(target, z, { duration: 0.6 });
      this._flashPin(target);
    } catch (e) {
    }
  },
  // วงแหวนกระพริบรอบหมุดที่เพิ่งปัก — หายเองใน ~4.5 วิ
  _flashPin(latlng) {
    try {
      if (this._flashLayer) {
        this.map.removeLayer(this._flashLayer);
        this._flashLayer = null;
      }
      if (this._flashTimer) {
        clearInterval(this._flashTimer);
        this._flashTimer = null;
      }
      const halo = L.circleMarker(latlng, {
        radius: 16,
        color: "#1d4ed8",
        weight: 3,
        opacity: 0.9,
        fillColor: "#3b82f6",
        fillOpacity: 0.25,
        pane: "markerPane",
        interactive: false
      });
      this._flashLayer = L.layerGroup([halo]).addTo(this.map);
      let n = 0;
      this._flashTimer = setInterval(() => {
        n++;
        halo.setStyle({ opacity: n % 2 ? 0.2 : 0.9, fillOpacity: n % 2 ? 0.08 : 0.3 });
        if (n >= 8) {
          clearInterval(this._flashTimer);
          this._flashTimer = null;
        }
      }, 350);
      setTimeout(() => {
        if (this._flashLayer) {
          this.map.removeLayer(this._flashLayer);
          this._flashLayer = null;
        }
        if (this._flashTimer) {
          clearInterval(this._flashTimer);
          this._flashTimer = null;
        }
      }, 4500);
    } catch (e) {
    }
  },
  // Navigate to customer (Google Maps)
  navigate(lat, lng) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`, "_blank");
  },
  // Edit customer
  edit(id) {
    const c = Storage.getCustomers().find((x) => x.id === id);
    if (!c) return;
    App.openAddCustomerModal();
    document.getElementById("add-modal-title").textContent = `\u270F\uFE0F \u0E41\u0E01\u0E49\u0E44\u0E02\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32: ${c.name || ""}`;
    const form = document.getElementById("add-customer-form");
    form.dataset.editId = id;
    form.elements.cif.value = c.cif || "";
    form.elements.name.value = c.name;
    form.elements.nickname.value = c.nickname || "";
    form.elements.phone.value = c.phone || "";
    form.elements.address.value = c.address || "";
    form.elements.lat.value = c.lat || "";
    form.elements.lng.value = c.lng || "";
    App._renderAddGpsDisplay();
    form.elements.riskLevel.value = c.riskLevel || "unclassified";
    if ("debtNote" in form.elements) form.elements.debtNote.value = c.debtNote || "";
    if (c.photo) {
      App._showPhotoPreview(c.photo);
    }
    setTimeout(() => App.initMiniMap(c.lat, c.lng), 150);
    const dbInfo = document.getElementById("db-filled-info");
    if (dbInfo) {
      const db = c.cif && typeof CustomerDB !== "undefined" ? CustomerDB.getByCif(c.cif) : null;
      if (db) {
        const badges = [];
        if (db.zone) badges.push(`\u0E40\u0E02\u0E15 ${db.zone}`);
        if (db.customer_class) badges.push(`\u0E0A\u0E31\u0E49\u0E19 ${db.customer_class}`);
        if (db.potential) badges.push(`\u0E28\u0E31\u0E01\u0E22\u0E20\u0E32\u0E1E ${db.potential}`);
        if (db.dob) badges.push(`\u0E40\u0E01\u0E34\u0E14 ${db.dob}`);
        if (db.lat) badges.push(`\u{1F4CD} \u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E41\u0E25\u0E49\u0E27`);
        dbInfo.innerHTML = `\u2705 <strong>${this.escapeHTML(c.name)}</strong> \xB7 CIF ${this.escapeHTML(c.cif)}${badges.length ? " \xB7 " + badges.map((b) => this.escapeHTML(b)).join(" \xB7 ") : ""}`;
        dbInfo.classList.add("active");
      }
    }
  },
  // Delete customer
  async del(id) {
    const c = Storage.getCustomers().find((x) => x.id === id);
    if (!c) return;
    const confirmed = await App.confirmDelete(c);
    if (!confirmed) return;
    const delResult = await Storage.deleteCustomer(id);
    Storage.removeFromRoute(id);
    this.renderAll();
    if (delResult && delResult.synced) {
      Utils.toast('\u{1F5D1}\uFE0F \u0E25\u0E1A "' + (c.name || "\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32") + '" \u0E41\u0E25\u0E49\u0E27 \xB7 sync \u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08');
    } else {
      Utils.toast("\u26A0\uFE0F \u0E25\u0E1A\u0E41\u0E25\u0E49\u0E27\u0E41\u0E15\u0E48 sync \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \u2014 \u0E01\u0E14 \u{1F504} \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48", "error");
    }
  },
  // ===== Pin existing customer on map (fast GPS update) =====
  _showPinOptions(lat, lng) {
    const old = document.getElementById("pin-options-panel");
    if (old) old.remove();
    const panel = document.createElement("div");
    panel.id = "pin-options-panel";
    panel.className = "pin-options-panel";
    panel.innerHTML = `
      <div class="pin-options-header">
        \u{1F4CD} \u0E1B\u0E31\u0E01\u0E2B\u0E21\u0E38\u0E14\u0E17\u0E35\u0E48 ${lat.toFixed(5)}, ${lng.toFixed(5)}
        <button class="pin-close" onclick="document.getElementById('pin-options-panel').remove()">\xD7</button>
      </div>
      <div class="pin-options-body">
        <button class="pin-btn pin-btn-existing" onclick="Customers._startPinExisting(${lat}, ${lng})">
          \u{1F50D} \u0E04\u0E49\u0E19\u0E2B\u0E32\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E40\u0E14\u0E34\u0E21 \u2192 \u0E1B\u0E31\u0E01\u0E2B\u0E21\u0E38\u0E14
        </button>
        <button class="pin-btn pin-btn-new" onclick="Customers._addNewAtLocation(${lat}, ${lng})">
          \u2795 \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E43\u0E2B\u0E21\u0E48
        </button>
        <a class="pin-btn pin-btn-street" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}" target="_blank" rel="noopener">
          \u{1F6E3} \u0E40\u0E1B\u0E34\u0E14 Google Street View
        </a>
      </div>
    `;
    document.body.appendChild(panel);
  },
  // เพิ่มลูกค้าใหม่ ณ ตำแหน่งที่เลือก (เปิด modal เดิม)
  _addNewAtLocation(lat, lng) {
    var _a;
    (_a = document.getElementById("pin-options-panel")) == null ? void 0 : _a.remove();
    const latEl = document.getElementById("new-lat");
    const lngEl = document.getElementById("new-lng");
    if (latEl) latEl.value = lat.toFixed(6);
    if (lngEl) lngEl.value = lng.toFixed(6);
    App.openAddCustomerModal();
  },
  // ค้นหาลูกค้าเดิม → ปักหมุดตรงๆ
  _startPinExisting(lat, lng) {
    var _a;
    (_a = document.getElementById("pin-options-panel")) == null ? void 0 : _a.remove();
    const old = document.getElementById("pin-search-panel");
    if (old) old.remove();
    const panel = document.createElement("div");
    panel.id = "pin-search-panel";
    panel.className = "pin-options-panel";
    panel.innerHTML = `
      <div class="pin-options-header">
        \u{1F50D} \u0E40\u0E25\u0E37\u0E2D\u0E01\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E1B\u0E31\u0E01\u0E2B\u0E21\u0E38\u0E14
        <button class="pin-close" onclick="document.getElementById('pin-search-panel').remove()">\xD7</button>
      </div>
      <div class="pin-search-input-wrap">
        <input type="text" id="pin-search-input" placeholder="\u0E1E\u0E34\u0E21\u0E1E\u0E4C CIF \u0E2B\u0E23\u0E37\u0E2D \u0E0A\u0E37\u0E48\u0E2D..." autocomplete="off">
      </div>
      <div id="pin-search-results" class="pin-search-results"></div>
    `;
    document.body.appendChild(panel);
    const input = document.getElementById("pin-search-input");
    const results = document.getElementById("pin-search-results");
    input.focus();
    let debounce = null;
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const q = input.value.trim().toLowerCase();
        if (q.length < 2) {
          results.innerHTML = "";
          return;
        }
        const customers = Storage.getActiveCustomers();
        const matches = customers.filter((c) => {
          const name = (c.name || "").toLowerCase();
          const cif = (c.cif || "").toLowerCase();
          const nick = (c.nickname || "").toLowerCase();
          return name.includes(q) || cif.includes(q) || nick.includes(q);
        }).slice(0, 20);
        if (matches.length === 0) {
          results.innerHTML = '<div class="pin-search-hint">\u274C \u0E44\u0E21\u0E48\u0E1E\u0E1A</div>';
          return;
        }
        results.innerHTML = matches.map((c) => {
          const hasGps = c.lat && c.lng;
          return `
            <div class="pin-search-item" data-id="${this.escapeAttr(c.id)}" data-cif="${this.escapeAttr(c.cif || "")}">
              <div class="pin-search-name">${this.escapeHTML(c.name)}</div>
              <div class="pin-search-meta">
                CIF: ${this.escapeHTML(c.cif || "-")}
                ${hasGps ? " \xB7 \u{1F4CD} \u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14" : " \xB7 \u26A0\uFE0F \u0E44\u0E21\u0E48\u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14"}
              </div>
            </div>
          `;
        }).join("");
        results.querySelectorAll(".pin-search-item").forEach((el) => {
          el.addEventListener("click", () => {
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
    var _a;
    const c = Storage.getCustomers().find((x) => x.id === id);
    if (!c) return Utils.toast("\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32", "error");
    const oldGps = c.lat && c.lng ? `(${Number(c.lat).toFixed(5)}, ${Number(c.lng).toFixed(5)})` : "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35";
    const ok = await Utils.confirmDialog({
      title: "\u{1F4CD} \u0E1B\u0E31\u0E01\u0E2B\u0E21\u0E38\u0E14\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32",
      message: `"${c.name}"

\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E40\u0E14\u0E34\u0E21: ${oldGps}
\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E43\u0E2B\u0E21\u0E48: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      confirmText: "\u0E1B\u0E31\u0E01\u0E2B\u0E21\u0E38\u0E14\u0E40\u0E25\u0E22"
    });
    if (!ok) return;
    (_a = document.getElementById("pin-search-panel")) == null ? void 0 : _a.remove();
    this.saveGpsFast(id, cif || c.cif, lat, lng, c.name);
  },
  // Render customer list (Customers tab) — with infinite scroll
  _filteredCustomers: [],
  _renderedListOffset: 0,
  _listScrollHandler: null,
  renderList() {
    var _a, _b, _c;
    if (typeof CustomerDB !== "undefined" && !CustomerDB._loaded && !this._ensureTried) {
      this._ensureTried = true;
      const list0 = document.getElementById("customers-list");
      if (list0) list0.innerHTML = '<div style="padding:16px;color:#666">\u0E01\u0E33\u0E25\u0E31\u0E07\u0E42\u0E2B\u0E25\u0E14\u0E10\u0E32\u0E19\u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D...</div>';
      CustomerDB.ensure().then(() => {
        this._ensureTried = false;
        try {
          this.renderList();
        } catch (e) {
        }
      }).catch(() => {
        this._ensureTried = false;
      });
      return;
    }
    const list = document.getElementById("customers-list");
    let customers = Storage.getActiveCustomers();
    const visits = Storage.getVisits();
    const route = Storage.getRoute();
    const zoneSel = document.getElementById("customer-zone");
    const zoneVal = (zoneSel == null ? void 0 : zoneSel.value) || "";
    if (zoneVal && typeof CustomerDB !== "undefined" && CustomerDB._loaded) {
      customers = customers.filter((c) => {
        const db = c.cif ? CustomerDB.getByCif(c.cif) : null;
        return db && String(db.zone) === String(zoneVal);
      });
    }
    const branchVal = this._userBranch() || ((_a = document.getElementById("map-branch-filter")) == null ? void 0 : _a.value) || "";
    if (branchVal) {
      customers = customers.filter((c) => {
        const db = c.cif && typeof CustomerDB !== "undefined" ? CustomerDB.getByCif(c.cif) : null;
        const cb = db ? String(db.branch || "") : String(c.branch || "");
        return cb === String(branchVal);
      });
    }
    const searchQuery = (((_b = document.getElementById("customer-search")) == null ? void 0 : _b.value) || "").trim().toLowerCase();
    if (searchQuery) {
      customers = customers.filter((c) => {
        const haystack = `${c.cif || ""} ${c.name || ""} ${c.phone || ""} ${c.address || ""} ${c.note || ""}`.toLowerCase();
        return haystack.includes(searchQuery);
      });
    }
    const sortBy = ((_c = document.getElementById("customer-sort")) == null ? void 0 : _c.value) || "name";
    customers = this._sortCustomers(customers, sortBy);
    document.getElementById("customer-count").textContent = customers.length;
    if (customers.length === 0) {
      const msg = searchQuery ? `\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E17\u0E35\u0E48\u0E15\u0E23\u0E07\u0E01\u0E31\u0E1A "${searchQuery}"` : "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32 \u0E01\u0E14\u0E1B\u0E38\u0E48\u0E21 <strong>\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32</strong> \u0E21\u0E38\u0E21\u0E02\u0E27\u0E32\u0E25\u0E48\u0E32\u0E07";
      list.innerHTML = `<p class="empty-state">${msg}</p>`;
      return;
    }
    this._filteredCustomers = customers;
    this._renderedListOffset = 0;
    list.innerHTML = "";
    this._appendCustomerBatch(list, 30);
    if (this._listScrollHandler) list.removeEventListener("scroll", this._listScrollHandler);
    this._listScrollHandler = Utils.debounce(() => {
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 300) {
        this._appendCustomerBatch(list, 20);
      }
    }, 80);
    list.addEventListener("scroll", this._listScrollHandler, { passive: true });
  },
  _appendCustomerBatch(container, count) {
    const customers = this._filteredCustomers;
    const start = this._renderedListOffset;
    const end = Math.min(start + count, customers.length);
    if (start >= end) return;
    const visits = Storage.getVisits();
    const route = Storage.getRoute();
    const frag = document.createDocumentFragment();
    const tmp = document.createElement("div");
    for (let i = start; i < end; i++) {
      const c = customers[i];
      const visited = !!visits[c.id];
      const inRoute = route.includes(c.id);
      const hasCoords = Number.isFinite(c.lat) && Number.isFinite(c.lng);
      const db = c.cif && typeof CustomerDB !== "undefined" ? CustomerDB.getByCif(c.cif) : null;
      const metaBadges = [];
      if (db) {
        if (db.zone) metaBadges.push(`<span class="meta-badge gray">\u0E40\u0E02\u0E15 ${this.escapeHTML(db.zone)}</span>`);
        if (db.customer_class) metaBadges.push(`<span class="meta-badge blue">${this.escapeHTML(db.customer_class)}</span>`);
        if (db.potential) {
          const pClass = db.potential === "\u0E41\u0E14\u0E07" ? "red" : db.potential === "\u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E07" ? "yellow" : "green";
          metaBadges.push(`<span class="meta-badge ${pClass}">${this.escapeHTML(db.potential)}</span>`);
        }
      }
      let debtMini = "";
      if (c.cif && typeof DebtDB !== "undefined") {
        if (!DebtDB._loaded) {
          debtMini = `<div class="customer-debt debt-loading"><span>\u23F3 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E42\u0E2B\u0E25\u0E14\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2B\u0E19\u0E35\u0E49...</span></div>`;
        } else {
          const debt = DebtDB.getByCif(c.cif);
          if (debt) {
            const urgent = debt.max_tier >= 2;
            debtMini = `<div class="customer-debt ${urgent ? "debt-urgent" : ""}" style="border-left-color:${DebtDB.tierColor(debt.max_tier)}">
            <span>\u{1F4B0} ${DebtDB.fmtMoney(debt.total_debt)}</span>
            <span>${debt.num_contracts} \u0E2A\u0E31\u0E0D\u0E0D\u0E32</span>
            <span>\u{1F4C5} ${DebtDB.fmtDate(debt.earliest_due) || "-"}</span>
          </div>`;
          }
        }
      }
      tmp.innerHTML = `<div class="customer-card ${visited ? "visited" : ""}">
          <div class="customer-avatar">${visited ? "\u2713" : "\u{1F464}"}</div>
          <div class="customer-info">
            <div class="customer-name">${this.escapeHTML(c.name)}</div>
            ${c.cif ? `<div class="customer-cif">CIF: ${this.escapeHTML(c.cif)}</div>` : ""}
            <div class="customer-address">${this.escapeHTML(c.address || "\u0E44\u0E21\u0E48\u0E21\u0E35\u0E17\u0E35\u0E48\u0E2D\u0E22\u0E39\u0E48")}</div>
            ${metaBadges.length ? `<div class="customer-meta">${metaBadges.join("")}</div>` : ""}
            ${debtMini}
          </div>
          <div class="customer-actions">
            ${hasCoords ? `<button class="btn-small btn-locate" onclick="Customers.locateCustomer('${c.id}')" title="\u0E44\u0E1B\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E1A\u0E19\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48">\u{1F4CD}</button>` : ""}
            <button class="btn-small ${inRoute ? "btn-route-active" : ""}" onclick="Customers.toggleRoute('${c.id}')" title="\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E43\u0E19\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07">
              ${inRoute ? "\u2713" : "\u2795"}
            </button>
            <button class="btn-small" onclick="Customers.edit('${c.id}')" title="\u0E41\u0E01\u0E49\u0E44\u0E02">\u270F\uFE0F</button>
            <button class="btn-small btn-danger" onclick="Customers.del('${c.id}')" title="\u0E25\u0E1A\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32">\u{1F5D1}\uFE0F</button>
          </div>
        </div>`;
      frag.appendChild(tmp.firstChild);
    }
    container.appendChild(frag);
    this._renderedListOffset = end;
  },
  // T2: พาไปพิกัดลูกค้าบนแผนที่ (ปุ่ม 📍 ในการ์ด) — เด้งการ์ดลูกหนี้+ข้อมูลหนี้ที่จุดพิกัดด้วย
  locateCustomer(id) {
    const c = this._filteredCustomers.find((x) => x.id === id) || Storage.getActiveCustomers().find((x) => x.id === id);
    if (!c) return;
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) {
      Utils.toast("\u26A0\uFE0F \u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E19\u0E35\u0E49\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14", "error");
      return;
    }
    if (typeof App !== "undefined" && App.setSheetState) App.setSheetState("peek");
    if (!this.map) return;
    this.map.flyTo([c.lat, c.lng], 17, { duration: 0.8 });
    setTimeout(() => this.showCustomerCard(c), 900);
  },
  // เปิดการ์ดลูกหนี้ที่จุดพิกัดเสมอ — ไม่พึ่ง marker เดิม (หมุดอาจถูกตัวกรองตัด/ยังไม่ถูกวาดบนแผนที่)
  showCustomerCard(c) {
    if (!this.map || !c) return;
    const lat = Number(c.lat), lng = Number(c.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (this._tempPin) {
      try {
        this.map.removeLayer(this._tempPin);
      } catch (e) {
      }
      this._tempPin = null;
    }
    if (this._cardPopup) {
      try {
        this.map.closePopup(this._cardPopup);
      } catch (e) {
      }
      this._cardPopup = null;
    }
    const pin = L.circleMarker([lat, lng], { radius: 10, color: "#0a8f3c", weight: 3, fillColor: "#0a8f3c", fillOpacity: 0.35, interactive: false }).addTo(this.map);
    this._tempPin = pin;
    const vh = window.innerHeight || 844;
    const padTop = Math.min(260, Math.round(vh * 0.3));
    const padBottom = Math.min(160, Math.round(vh * 0.17));
    const maxH = Math.max(280, vh - padTop - padBottom - 24);
    const pop = L.popup({ maxWidth: 320, maxHeight: maxH, autoPan: true, autoPanPaddingTopLeft: [10, padTop], autoPanPaddingBottomRight: [56, padBottom], closeButton: false, className: "cust-card-popup" }).setLatLng([lat, lng]).setContent(this.popupHTML(c)).openOn(this.map);
    this._cardPopup = pop;
    try {
      document.body.classList.add("card-open");
    } catch (e) {
    }
    pop.on("remove", () => {
      this._cardPopup = null;
      try {
        document.body.classList.remove("card-open");
      } catch (e) {
      }
      if (this._tempPin === pin) {
        try {
          this.map.removeLayer(pin);
        } catch (e) {
        }
        this._tempPin = null;
      }
    });
    if (typeof DebtDB !== "undefined" && !DebtDB._loaded && DebtDB.load) {
      DebtDB.load().then(() => {
        if (this._cardPopup && this.map && this.map.hasLayer(this._cardPopup)) {
          try {
            this._cardPopup.setContent(this.popupHTML(c));
          } catch (e) {
          }
        }
      }).catch(() => {
      });
    }
  },
  // Toggle customer in today's route
  toggleRoute(id) {
    const route = Storage.getRoute();
    if (route.includes(id)) {
      Storage.removeFromRoute(id);
      Utils.toast("\u0E40\u0E2D\u0E32\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07");
    } else {
      if (!Storage.addToRoute(id)) {
        Utils.toast("\u0E04\u0E19\u0E19\u0E35\u0E49\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14 \u0E01\u0E14 \u{1F4CD} \u0E40\u0E01\u0E47\u0E1A\u0E01\u0E48\u0E2D\u0E19", "error");
        return;
      }
      Utils.toast("\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E43\u0E19\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07\u0E27\u0E31\u0E19\u0E19\u0E35\u0E49 \u2713");
    }
    this.renderList();
    App.updateRouteUI();
  },
  // Sort customers by different criteria
  _sortCustomers(customers, sortBy) {
    const sorted = [...customers];
    switch (sortBy) {
      case "name":
        sorted.sort((a, b) => (a.name || "").localeCompare(b.name || "", "th"));
        break;
      case "cif":
        sorted.sort((a, b) => (a.cif || "").localeCompare(b.cif || ""));
        break;
      case "risk":
        const riskOrder = { bad: 0, warning: 1, good: 2, unclassified: 3 };
        sorted.sort((a, b) => {
          var _a, _b;
          return ((_a = riskOrder[a.riskLevel]) != null ? _a : 3) - ((_b = riskOrder[b.riskLevel]) != null ? _b : 3);
        });
        break;
      case "recent":
        sorted.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
        break;
    }
    return sorted;
  },
  // ===== Base layer toggle (roadmap ↔ satellite) =====
  _addLayerControl() {
    const LayerToggle = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create("div", "layer-toggle leaflet-bar");
        div.innerHTML = `
          <button class="layer-btn active" data-layer="roadmap" title="\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48\u0E16\u0E19\u0E19">\u{1F5FA}\uFE0F</button>
          <button class="layer-btn" data-layer="satellite" title="\u0E20\u0E32\u0E1E\u0E14\u0E32\u0E27\u0E40\u0E17\u0E35\u0E22\u0E21">\u{1F6F0}\uFE0F</button>
        `;
        L.DomEvent.disableClickPropagation(div);
        div.querySelectorAll(".layer-btn").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            L.DomEvent.stop(e);
            const layer = btn.dataset.layer;
            Customers.switchBaseLayer(layer);
          });
        });
        return div;
      }
    });
    new LayerToggle({ position: "topright" }).addTo(this.map);
    const FsToggle = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create("div", "fs-toggle leaflet-bar");
        const btn = L.DomUtil.create("button", "fs-btn", div);
        btn.innerHTML = "\u26F6";
        btn.title = "\u0E02\u0E22\u0E32\u0E22\u0E40\u0E15\u0E47\u0E21\u0E08\u0E2D";
        btn.setAttribute("aria-label", "Toggle fullscreen");
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        btn.addEventListener("click", (e) => {
          L.DomEvent.stop(e);
          Customers.toggleFullscreen();
        });
        return div;
      }
    });
    new FsToggle({ position: "topright" }).addTo(this.map);
    const updateFsIcon = () => {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.querySelector("#map.map-fs-fake"));
      const btn = document.querySelector(".fs-btn");
      if (btn) {
        btn.innerHTML = isFs ? "\u2715" : "\u26F6";
        btn.title = isFs ? "\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E40\u0E15\u0E47\u0E21\u0E08\u0E2D" : "\u0E02\u0E22\u0E32\u0E22\u0E40\u0E15\u0E47\u0E21\u0E08\u0E2D";
        btn.classList.toggle("active", isFs);
      }
      setTimeout(() => this.map && this.map.invalidateSize(), 200);
    };
    ["fullscreenchange", "webkitfullscreenchange", "msfullscreenchange"].forEach((ev) => {
      document.addEventListener(ev, updateFsIcon);
    });
  },
  // ===== Fullscreen toggle =====
  toggleFullscreen() {
    const mapEl = document.getElementById("map");
    if (!mapEl) return;
    const isFs = document.fullscreenElement || document.webkitFullscreenElement;
    if (!isFs) {
      const candidates = [
        mapEl.requestFullscreen,
        mapEl.webkitRequestFullscreen,
        mapEl.msRequestFullscreen
      ];
      const req = candidates.find((fn) => typeof fn === "function") || null;
      if (req) {
        let result;
        try {
          result = req.call(mapEl);
        } catch (err) {
          console.warn("Fullscreen call threw, using fallback:", err);
          this._useFakeFullscreen(mapEl);
          return;
        }
        if (result && typeof result.then === "function") {
          result.catch((err) => {
            console.warn("Fullscreen API blocked, using fallback:", err);
            this._useFakeFullscreen(mapEl);
          });
        }
      } else {
        console.warn("No Fullscreen API, using CSS fallback");
        this._useFakeFullscreen(mapEl);
      }
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (exit) exit.call(document);
      mapEl.classList.remove("map-fs-fake");
    }
  },
  _useFakeFullscreen(mapEl) {
    mapEl.classList.add("map-fs-fake");
    const btn = document.querySelector(".fs-btn");
    if (btn) {
      btn.innerHTML = "\u2715";
      btn.classList.add("active");
      btn.title = "\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E40\u0E15\u0E47\u0E21\u0E08\u0E2D";
    }
    this.map.invalidateSize();
  },
  switchBaseLayer(layerName) {
    if (!this._baseLayers[layerName] || layerName === this._currentBaseLayer) return;
    this.map.removeLayer(this._baseLayers[this._currentBaseLayer]);
    this._baseLayers[layerName].addTo(this.map);
    this._currentBaseLayer = layerName;
    const buttons = document.querySelectorAll(".layer-toggle .layer-btn");
    buttons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.layer === layerName);
    });
  },
  // ===== ตัวกรองเขตตามสาขา (17 ต.ค.69 — พ่อสั่ง: แต่ละสาขาเขตไม่เหมือนกัน) =====
  // เติม option เขตจากข้อมูลจริงที่เห็น (ตามสาขา) แทน hardcode 1-5
  // non-admin เห็นสาขาเดียวอยู่แล้ว (server กรองมา) → ได้เขตสาขาตัวเองอัตโนมัติ
  // admin ตาม dropdown สาขา (ว่าง = รวมทุกสาขา)
  _zoneSig: "",
  refreshZoneOptions() {
    var _a, _b;
    const tabSel = document.getElementById("customer-zone");
    const mapSel = document.getElementById("map-zone-filter");
    if (!tabSel && !mapSel) return;
    let branchVal = ((_a = document.getElementById("map-branch-filter")) == null ? void 0 : _a.value) || "";
    const tabBranch = ((_b = document.getElementById("customer-branch")) == null ? void 0 : _b.value) || "";
    if (tabBranch) branchVal = tabBranch;
    let recs = [];
    if (typeof CustomerDB !== "undefined" && CustomerDB._loaded && Array.isArray(CustomerDB._data)) {
      recs = recs.concat(CustomerDB._data);
    }
    if (typeof Storage !== "undefined" && Storage.getActiveCustomers) {
      try {
        recs = recs.concat(Storage.getActiveCustomers());
      } catch (e) {
      }
    }
    const lock = this._userBranch();
    if (lock && recs.some((r) => String(r.branch || "").trim() === lock)) branchVal = lock;
    if (branchVal) recs = recs.filter((r) => String(r.branch || "").trim() === String(branchVal));
    const zones = [...new Set(recs.map((r) => {
      var _a2;
      return String((_a2 = r.zone) != null ? _a2 : "").trim();
    }).filter((z) => z !== ""))];
    zones.sort((a, b) => a.localeCompare(b, "th", { numeric: true }));
    const sig = branchVal + "|" + zones.join(",");
    if (sig === this._zoneSig) return;
    this._zoneSig = sig;
    for (const sel of [tabSel, mapSel]) {
      if (!sel) continue;
      const cur = sel.value;
      sel.textContent = "";
      const all = document.createElement("option");
      all.value = "";
      all.textContent = "\u0E17\u0E38\u0E01\u0E40\u0E02\u0E15";
      sel.appendChild(all);
      for (const z of zones) {
        const o = document.createElement("option");
        o.value = z;
        o.textContent = "\u0E40\u0E02\u0E15 " + z;
        sel.appendChild(o);
      }
      sel.value = zones.includes(cur) ? cur : "";
    }
  },
  // ===== ตัวเลือกสาขาตามข้อมูลจริง (17 ต.ค.69 — แก้บั๊กเลือกสาขาไม่ได้) =====
  // เติมทุก renderAll (sig-guard กัน dropdown กระพริบ) — รวม 2 ถัง (CustomerDB + เครื่อง)
  // ผูก change ครั้งเดียว (dataset.bound) กันยิงซ้ำ
  // + ล็อกสาขาตามสิทธิ์ (17 ต.ค.69 — พ่อสั่ง: ไม่ใช่แอดมินเห็นแค่สาขาตัวเอง)
  _branchSig: "",
  _userBranch() {
    try {
      if (typeof Auth !== "undefined" && Auth.isAdmin && Auth.isAdmin()) return null;
      const u = typeof Auth !== "undefined" && Auth.getUser ? Auth.getUser() : null;
      const b = String(u && u.branch || "").trim();
      return b || null;
    } catch (e) {
      return null;
    }
  },
  refreshBranchOptions() {
    const sel = document.getElementById("map-branch-filter");
    const tabSel = document.getElementById("customer-branch");
    if (!sel && !tabSel) return;
    const onChange = (e) => {
      const src = e && e.target || null;
      const v = src ? src.value : sel && sel.value || tabSel && tabSel.value || "";
      if (sel) sel.value = v;
      if (tabSel) tabSel.value = v;
      this._branchFilter = v || "";
      this._lastMarkerHash = null;
      if (v && window.DebtDB && DebtDB.ensureBranch) {
        DebtDB.ensureBranch(v).then(() => {
          this._lastMarkerHash = null;
          this.renderAll();
        }).catch(() => {
        });
      }
      this.renderAll();
    };
    for (const s of [sel, tabSel]) {
      if (s && !s.dataset.bound) {
        s.dataset.bound = "1";
        s.addEventListener("change", onChange);
      }
    }
    const names = { "854": "\u0E27\u0E31\u0E07\u0E17\u0E48\u0E32\u0E0A\u0E49\u0E32\u0E07", "145": "\u0E01\u0E1A\u0E34\u0E19\u0E17\u0E23\u0E4C\u0E1A\u0E38\u0E23\u0E35", "291": "\u0E1A\u0E49\u0E32\u0E19\u0E2A\u0E23\u0E49\u0E32\u0E07", "10": "\u0E1B\u0E23\u0E32\u0E08\u0E35\u0E19\u0E1A\u0E38\u0E23\u0E35", "327": "\u0E28\u0E23\u0E35\u0E21\u0E2B\u0E32\u0E42\u0E1E\u0E18\u0E34", "486": "\u0E1B\u0E23\u0E30\u0E08\u0E31\u0E19\u0E15\u0E04\u0E32\u0E21", "715": "\u0E19\u0E32\u0E14\u0E35" };
    const seen = /* @__PURE__ */ new Set();
    if (typeof CustomerDB !== "undefined" && CustomerDB._loaded && CustomerDB._byCif) {
      CustomerDB._byCif.forEach((r) => {
        const b = String(r.branch || "").trim();
        if (b) seen.add(b);
      });
    }
    if (typeof Storage !== "undefined" && Storage.getActiveCustomers) {
      try {
        for (const c of Storage.getActiveCustomers()) {
          const b = String(c.branch || "").trim();
          if (b) seen.add(b);
        }
      } catch (e) {
      }
    }
    const branches = [...seen].sort();
    const lock = this._userBranch();
    const locked = !!(lock && seen.has(lock));
    const sig = locked ? "lock:" + lock : branches.join(",");
    if (sig === this._branchSig) return;
    this._branchSig = sig;
    if (locked) {
      for (const s of [sel, tabSel]) {
        if (!s) continue;
        s.textContent = "";
        const o = document.createElement("option");
        o.value = lock;
        o.textContent = names[lock] || "\u0E2A\u0E32\u0E02\u0E32 " + lock;
        s.appendChild(o);
        s.value = lock;
        s.style.display = "none";
      }
      this._branchFilter = lock;
      return;
    }
    const cur = sel ? sel.value : tabSel ? tabSel.value : "";
    for (const s of [sel, tabSel]) {
      if (!s) continue;
      s.style.display = "";
      s.textContent = "";
      const all = document.createElement("option");
      all.value = "";
      all.textContent = "\u0E17\u0E38\u0E01\u0E2A\u0E32\u0E02\u0E32";
      s.appendChild(all);
      for (const b of branches) {
        const o = document.createElement("option");
        o.value = b;
        o.textContent = names[b] || "\u0E2A\u0E32\u0E02\u0E32 " + b;
        s.appendChild(o);
      }
      s.value = branches.includes(cur) ? cur : "";
    }
    if ((sel && sel.value || "") !== cur) this._branchFilter = "";
  },
  // Render everything
  renderAll(routeOrder, opts) {
    this.refreshBranchOptions();
    this.refreshZoneOptions();
    this.renderMarkers(routeOrder, opts);
    this.updateGpsGauge();
    const customersTab = document.getElementById("tab-customers");
    if (customersTab && customersTab.classList.contains("active")) {
      this.renderList();
    }
  },
  escapeHTML(str) {
    return String(str || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
  },
  // Escape for use inside HTML attribute values (single/double quotes + ampersand)
  escapeAttr(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
};
if (typeof window !== "undefined") window.Customers = Customers;
if (typeof module !== "undefined" && module.exports) module.exports = Customers;
const TSP = {
  // Nearest-neighbor TSP heuristic
  // If end is provided: open path (start → ... → end, don't return)
  // If end is null: round trip (return to start)
  nearestNeighbor(start, customers, end) {
    if (customers.length === 0) return [];
    if (customers.length === 1) return [customers[0].id];
    const remaining = [...customers];
    const order = [];
    let current = { lat: start.lat, lng: start.lng, id: "start" };
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
    return order.map((o) => o.id);
  },
  // 2-opt improvement (swap to reduce total distance)
  // end: optional endpoint to consider
  twoOpt(route, start, end) {
    if (route.length < 3) return route;
    const customers = Storage.getActiveCustomers();
    const custMap = new Map(customers.map((c) => [c.id, c]));
    function totalDistance(order) {
      let total = 0;
      let prev = { lat: start.lat, lng: start.lng };
      for (const id of order) {
        const c = custMap.get(id);
        if (!c) continue;
        total += Utils.haversine(prev.lat, prev.lng, c.lat, c.lng);
        prev = c;
      }
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
            ...best.slice(j + 1)
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
    const selectedCustomers = customerIds.map((id) => allCustomers.find((c) => c.id === id)).filter(Boolean);
    if (selectedCustomers.length === 0) return [];
    const nnOrder = this.nearestNeighbor(start, selectedCustomers, end);
    const optimized = this.twoOpt(nnOrder, start, end);
    return optimized;
  }
};
window.TSP = TSP;
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
    const search = document.getElementById("route-search");
    if (search) {
      search.addEventListener("input", () => this.search(search.value));
      search.addEventListener("focus", () => {
        if (search.value.trim()) this.search(search.value);
      });
      document.addEventListener("click", (e) => {
        if (!e.target.closest(".route-search-box")) {
          const el = document.getElementById("route-search-results");
          if (el) el.classList.remove("active");
        }
      });
    }
    const btnClear = document.getElementById("btn-clear-route");
    if (btnClear) btnClear.addEventListener("click", () => this.clear());
    const btnAutoPlan = document.getElementById("btn-auto-plan");
    if (btnAutoPlan) btnAutoPlan.addEventListener("click", () => this.autoPlanFromFilters());
    const btnOptimize = document.getElementById("btn-optimize-route");
    if (btnOptimize) btnOptimize.addEventListener("click", () => App.calculateRoute(true, { focusSummary: true }));
    const btnShowAll = document.getElementById("btn-route-show-all");
    if (btnShowAll) btnShowAll.addEventListener("click", () => {
      if (typeof Customers !== "undefined" && Customers.exitRouteFocus) Customers.exitRouteFocus();
      Utils.toast("\u{1F50D} \u0E42\u0E0A\u0E27\u0E4C\u0E2B\u0E21\u0E38\u0E14\u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14\u0E41\u0E25\u0E49\u0E27");
    });
  },
  // ===== Search customers by CIF, name, phone, address =====
  search(query) {
    const q = (query || "").trim().toLowerCase();
    const resultsEl = document.getElementById("route-search-results");
    if (!resultsEl) return;
    if (q.length < 1) {
      resultsEl.classList.remove("active");
      resultsEl.innerHTML = "";
      return;
    }
    const customers = Storage.getActiveCustomers();
    const route = Storage.getRoute();
    const matches = customers.filter((c) => {
      const haystack = `${c.cif || ""} ${c.name || ""} ${c.phone || ""} ${c.address || ""}`.toLowerCase();
      return haystack.includes(q);
    }).slice(0, 10);
    if (matches.length === 0) {
      resultsEl.innerHTML = `<div style="padding:16px;text-align:center;color:#5a655a;font-size:13px">\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E17\u0E35\u0E48\u0E15\u0E23\u0E07\u0E01\u0E31\u0E1A "${this.escapeHTML(query)}"</div>`;
      resultsEl.classList.add("active");
      return;
    }
    resultsEl.innerHTML = matches.map((c) => {
      const isSelected = route.includes(c.id);
      const hasGps = Number.isFinite(c.lat) && Number.isFinite(c.lng);
      const gpsBadge = hasGps ? "\u{1F4CD}" : "\u26AA";
      const noGps = !hasGps && !isSelected;
      const disabled = isSelected || noGps ? "disabled" : "";
      const btnTitle = isSelected ? "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E41\u0E25\u0E49\u0E27" : hasGps ? "\u0E40\u0E1E\u0E34\u0E48\u0E21" : "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14 \u2014 \u0E01\u0E14 \u{1F4CD} \u0E40\u0E01\u0E47\u0E1A\u0E01\u0E48\u0E2D\u0E19";
      const btnStyle = noGps ? ' style="opacity:0.35;cursor:not-allowed"' : "";
      return `
        <div class="route-search-result-item">
          <div class="route-search-result-info">
            <div class="route-search-result-name">${gpsBadge} ${this.escapeHTML(c.name)}</div>
            <div class="route-search-result-meta">${c.address ? this.escapeHTML(c.address) : "\u0E44\u0E21\u0E48\u0E21\u0E35\u0E17\u0E35\u0E48\u0E2D\u0E22\u0E39\u0E48"}${c.phone ? " \xB7 " + this.escapeHTML(c.phone) : ""}${hasGps ? "" : " \xB7 \u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14"}</div>
          </div>
          <span class="route-search-result-cif">${this.escapeHTML(c.cif || "-")}</span>
          <button class="route-search-result-add" ${disabled}${btnStyle} onclick="Route.toggle('${c.id}')" title="${btnTitle}">
            ${isSelected ? "\u2713" : "+"}
          </button>
        </div>
      `;
    }).join("");
    resultsEl.classList.add("active");
  },
  // ===== Toggle customer in route (add or remove) =====
  toggle(id) {
    const route = Storage.getRoute();
    const idx = route.indexOf(id);
    if (idx >= 0) {
      Storage.removeFromRoute(id);
    } else {
      if (route.length >= this.MAX_SELECT) {
        Utils.toast(`\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E14\u0E49\u0E2A\u0E39\u0E07\u0E2A\u0E38\u0E14 ${this.MAX_SELECT} \u0E04\u0E19`, "error");
        return;
      }
      if (!Storage.addToRoute(id)) {
        Utils.toast("\u0E04\u0E19\u0E19\u0E35\u0E49\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14 \u0E01\u0E14 \u{1F4CD} \u0E40\u0E01\u0E47\u0E1A\u0E01\u0E48\u0E2D\u0E19", "error");
        return;
      }
    }
    const search = document.getElementById("route-search");
    if (search && search.value) this.search(search.value);
    App.updateRouteUI();
  },
  // ===== Clear all selected customers =====
  clear() {
    Storage.saveRoute([]);
    App.updateRouteUI();
    const resultEl = document.getElementById("route-result");
    if (resultEl) resultEl.classList.add("hidden");
    this.currentResult = null;
    if (typeof Customers !== "undefined" && Customers.exitRouteFocus) Customers.exitRouteFocus();
    Utils.toast("\u0E25\u0E49\u0E32\u0E07\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E41\u0E25\u0E49\u0E27");
  },
  // ===== Move chip up/down (▲▼ buttons) =====
  move(idx, dir) {
    const route = Storage.getRoute();
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= route.length) return;
    [route[idx], route[newIdx]] = [route[newIdx], route[idx]];
    Storage.saveRoute(route);
    App.updateRouteUI();
    const search = document.getElementById("route-search");
    if (search && search.value) this.search(search.value);
  },
  // ===== Drag & drop reordering =====
  dragStart(e, idx) {
    e.dataTransfer.setData("text/plain", idx.toString());
    e.dataTransfer.effectAllowed = "move";
    e.target.classList.add("dragging");
  },
  dragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  },
  drop(e, targetIdx) {
    e.preventDefault();
    const fromIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (fromIdx === targetIdx) return;
    const route = Storage.getRoute();
    if (fromIdx < 0 || fromIdx >= route.length) return;
    [route[fromIdx], route[targetIdx]] = [route[targetIdx], route[fromIdx]];
    Storage.saveRoute(route);
    App.updateRouteUI();
    const search = document.getElementById("route-search");
    if (search && search.value) this.search(search.value);
  },
  dragEnd(e) {
    e.target.classList.remove("dragging");
  },
  // ===== จัดลำดับจุดเยี่ยมให้สั้นที่สุดบน "ระยะทางถนนจริง" =====
  // ใช้ OSRM /table (distance matrix) + Held-Karp DP (≤12 จุด) หรือ NN+2-opt (>12)
  // ต่างจาก TSP.plan เดิมที่ Uses haversine (เส้นตรง) → มักอ้อมเพราะแม่น้ำ/สะพาน/ทางเดียว
  async optimizeOrder(start, orderedIds, end) {
    const customers = Storage.getActiveCustomers();
    const stops = orderedIds.map((id) => customers.find((c) => c.id === id)).filter(Boolean);
    if (stops.length < 3) return stops.map((s) => s.id);
    const isOpen = end && (Math.abs(end.lat - start.lat) > 1e-9 || Math.abs(end.lng - start.lng) > 1e-9);
    const endPt = isOpen ? { lat: end.lat, lng: end.lng } : { lat: start.lat, lng: start.lng };
    const pts = [{ lat: start.lat, lng: start.lng }, ...stops.map((c) => ({ lat: c.lat, lng: c.lng })), endPt];
    const coords = pts.map((p) => `${p.lng},${p.lat}`).join(";");
    const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== "Ok" || !Array.isArray(data.distances)) throw new Error("OSRM table \u0E44\u0E21\u0E48\u0E1E\u0E23\u0E49\u0E2D\u0E21");
    const m = data.distances;
    const n = stops.length;
    const endIdx = n + 1;
    const orderCost = (ids) => {
      let prev = 0, total = 0;
      for (const id of ids) {
        const k = stops.findIndex((s) => s.id === id) + 1;
        total += m[prev][k];
        prev = k;
      }
      return total + m[prev][endIdx];
    };
    let best = null;
    if (n <= 12) {
      const size = 1 << n;
      const dp = Array.from({ length: size }, () => new Float64Array(n).fill(Infinity));
      const par = Array.from({ length: size }, () => new Int8Array(n).fill(-1));
      for (let j2 = 0; j2 < n; j2++) dp[1 << j2][j2] = m[0][j2 + 1];
      for (let mask2 = 1; mask2 < size; mask2++) {
        for (let j2 = 0; j2 < n; j2++) {
          if (!(mask2 & 1 << j2) || dp[mask2][j2] === Infinity) continue;
          const cur = dp[mask2][j2];
          for (let k = 0; k < n; k++) {
            if (mask2 & 1 << k) continue;
            const nm = mask2 | 1 << k;
            const cand = cur + m[j2 + 1][k + 1];
            if (cand < dp[nm][k]) {
              dp[nm][k] = cand;
              par[nm][k] = j2;
            }
          }
        }
      }
      let bestJ = -1, bestCost = Infinity;
      for (let j2 = 0; j2 < n; j2++) {
        const cand = dp[size - 1][j2] + m[j2 + 1][endIdx];
        if (cand < bestCost) {
          bestCost = cand;
          bestJ = j2;
        }
      }
      const seq = [];
      let mask = size - 1, j = bestJ;
      while (j >= 0) {
        seq.unshift(stops[j].id);
        const pj = par[mask][j];
        mask &= ~(1 << j);
        j = pj;
      }
      best = seq;
    } else {
      const left = stops.map((s, i) => i);
      const seq = [];
      let prev = 0;
      while (left.length) {
        let bi = 0, bd = Infinity;
        left.forEach((idx2, i) => {
          const d = m[prev][idx2 + 1];
          if (d < bd) {
            bd = d;
            bi = i;
          }
        });
        const idx = left.splice(bi, 1)[0];
        seq.push(stops[idx].id);
        prev = idx + 1;
      }
      const cost = (arr) => orderCost(arr);
      let bestArr = seq, bestD = cost(seq), improved = true, guard = 0;
      while (improved && guard++ < 200) {
        improved = false;
        for (let i = 0; i < bestArr.length - 1; i++) {
          for (let k = i + 1; k < bestArr.length; k++) {
            const cand = [...bestArr.slice(0, i), ...bestArr.slice(i, k + 1).reverse(), ...bestArr.slice(k + 1)];
            const d = cost(cand);
            if (d < bestD - 1) {
              bestArr = cand;
              bestD = d;
              improved = true;
            }
          }
        }
      }
      best = bestArr;
    }
    const origIds = stops.map((s) => s.id);
    if (orderCost(origIds) <= orderCost(best)) return origIds;
    return best;
  },
  // ===== Calculate route using OSRM =====
  // start: {lat, lng} — required start point
  // orderedCustomerIds: array of customer IDs in visit order (already sorted)
  // end: {lat, lng} — optional endpoint (default: return to start)
  async calculate(start, orderedCustomerIds, end) {
    var _a;
    const customers = Storage.getActiveCustomers();
    const stops = orderedCustomerIds.map((id) => customers.find((c) => c.id === id)).filter(Boolean);
    if (stops.length === 0) {
      Utils.toast("\u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E43\u0E19\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07\u0E01\u0E48\u0E2D\u0E19", "error");
      return null;
    }
    Utils.toast("\u{1F9EE} \u0E01\u0E33\u0E25\u0E31\u0E07\u0E04\u0E33\u0E19\u0E27\u0E13\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07...");
    const isOpenPath = end && (end.lat !== start.lat || end.lng !== start.lng);
    const coordList = [
      { lat: start.lat, lng: start.lng },
      ...stops.map((c) => ({ lat: c.lat, lng: c.lng }))
    ];
    if (isOpenPath) {
      coordList.push({ lat: end.lat, lng: end.lng });
    } else {
      coordList.push({ lat: start.lat, lng: start.lng });
    }
    const coords = coordList.map((p) => `${p.lng},${p.lat}`).join(";");
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&continue_straight=false`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
        throw new Error("OSRM \u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E04\u0E33\u0E19\u0E27\u0E13\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07\u0E44\u0E14\u0E49");
      }
      const route = data.routes[0];
      const result = {
        distance: route.distance,
        // meters
        duration: route.duration,
        // seconds
        stops,
        geometry: route.geometry,
        order: orderedCustomerIds,
        start: __spreadValues({}, start),
        end: isOpenPath ? __spreadValues({}, end) : null,
        // null = round trip
        isOpenPath: !!isOpenPath,
        // Fuel calculation
        fuel: Utils.calcFuel(route.distance)
      };
      this.currentResult = result;
      return result;
    } catch (err) {
      console.warn("OSRM failed, using haversine fallback:", err);
      let totalDist = 0;
      let prev = start;
      for (const c of stops) {
        totalDist += Utils.haversine(prev.lat, prev.lng, c.lat, c.lng);
        prev = c;
      }
      if (isOpenPath) {
        totalDist += Utils.haversine(prev.lat, prev.lng, end.lat, end.lng);
      }
      const estDist = totalDist * 1.3;
      const vehicleType = Utils.getVehicle();
      const roadClassification = ((_a = document.getElementById("road-classification")) == null ? void 0 : _a.value) || "auto";
      const vehicleProfile = Utils.VEHICLE_PROFILES[vehicleType];
      let speed = 40;
      if (vehicleProfile) {
        if (roadClassification !== "auto") {
          speed = vehicleProfile.speed[roadClassification] || vehicleProfile.speed.road || 40;
        } else {
          speed = (vehicleProfile.speed.highway + vehicleProfile.speed.road + vehicleProfile.speed.village + vehicleProfile.speed.dirt) / 4;
        }
      }
      const estDuration = estDist / 1e3 / speed * 3600;
      const result = {
        distance: estDist,
        duration: estDuration,
        stops,
        geometry: null,
        order: orderedCustomerIds,
        start: __spreadValues({}, start),
        end: isOpenPath ? __spreadValues({}, end) : null,
        isOpenPath: !!isOpenPath,
        fuel: Utils.calcFuel(estDist),
        estimated: true,
        // Vehicle and road info
        vehicleType,
        roadClassification,
        vehicleProfile
      };
      this.currentResult = result;
      Utils.toast("\u26A0\uFE0F \u0E43\u0E0A\u0E49\u0E01\u0E32\u0E23\u0E1B\u0E23\u0E30\u0E21\u0E32\u0E13 (OSRM \u0E44\u0E21\u0E48\u0E15\u0E2D\u0E1A\u0E2A\u0E19\u0E2D\u0E07)");
      return result;
    }
  },
  // ===== Show result on UI =====
  showResult(result) {
    const resultEl = document.getElementById("route-result");
    resultEl.classList.remove("hidden");
    document.getElementById("result-distance").textContent = Utils.formatKm(result.distance);
    document.getElementById("result-duration").textContent = Math.round(result.duration / 60);
    document.getElementById("result-stops").textContent = result.stops.length;
    const routeTypeEl = document.getElementById("result-route-type");
    if (routeTypeEl) {
      routeTypeEl.textContent = result.isOpenPath ? "\u{1F500} \u0E40\u0E1B\u0E34\u0E14 (\u0E21\u0E35\u0E08\u0E38\u0E14\u0E2A\u0E34\u0E49\u0E19\u0E2A\u0E38\u0E14)" : "\u{1F504} \u0E44\u0E1B-\u0E01\u0E25\u0E31\u0E1A";
    }
    const noteEl = document.getElementById("result-order-note");
    if (noteEl) {
      if (result.autoOrderTried) {
        noteEl.classList.remove("hidden");
        noteEl.textContent = result.autoOrdered ? "\u{1F3AF} \u0E23\u0E30\u0E1A\u0E1A\u0E08\u0E31\u0E14\u0E25\u0E33\u0E14\u0E31\u0E1A\u0E01\u0E32\u0E23\u0E40\u0E22\u0E35\u0E48\u0E22\u0E21\u0E43\u0E2B\u0E49\u0E43\u0E2B\u0E21\u0E48\u0E41\u0E25\u0E49\u0E27 \u2014 \u0E40\u0E25\u0E02 1,2,3,\u2026 \u0E43\u0E19\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07\u0E27\u0E31\u0E19\u0E19\u0E35\u0E49 \u0E40\u0E23\u0E35\u0E22\u0E07\u0E15\u0E32\u0E21\u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D\u0E14\u0E49\u0E32\u0E19\u0E25\u0E48\u0E32\u0E07\u0E19\u0E35\u0E49" : "\u{1F3AF} \u0E25\u0E33\u0E14\u0E31\u0E1A\u0E17\u0E35\u0E48\u0E04\u0E38\u0E13\u0E40\u0E23\u0E35\u0E22\u0E07\u0E44\u0E27\u0E49\u0E2A\u0E31\u0E49\u0E19\u0E17\u0E35\u0E48\u0E2A\u0E38\u0E14\u0E2D\u0E22\u0E39\u0E48\u0E41\u0E25\u0E49\u0E27 \u2014 \u0E44\u0E21\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E2A\u0E25\u0E31\u0E1A";
      } else {
        noteEl.classList.add("hidden");
        noteEl.textContent = "";
      }
    }
    if (result.vehicleProfile) {
      const vehicleInfo = document.getElementById("result-vehicle-info");
      if (vehicleInfo) {
        vehicleInfo.textContent = `${result.vehicleProfile.name} \xB7 ${result.roadClassification}`;
      }
    }
    const fuelEl = document.getElementById("result-fuel");
    if (fuelEl && result.fuel) {
      const v = result.fuel.vehicle;
      const fuelName = v.fuelName || "";
      const fuelPrice = v.fuelPrice || "?";
      const fuelDiff = v.fuelDiff != null ? v.fuelDiff : 0;
      const fuelUpdated = Utils.getFuelUpdated();
      const diffBadge = fuelDiff > 0 ? `<span class="fuel-diff up">\u25B2 ${fuelDiff.toFixed(2)}</span>` : fuelDiff < 0 ? `<span class="fuel-diff down">\u25BC ${Math.abs(fuelDiff).toFixed(2)}</span>` : "";
      fuelEl.innerHTML = `
        <div class="fuel-card">
          <div class="fuel-icon">\u26FD</div>
          <div class="fuel-info">
            <div class="fuel-amount">~${result.fuel.liters.toFixed(2)} \u0E25\u0E34\u0E15\u0E23</div>
            <div class="fuel-cost">~${Utils.formatBaht(result.fuel.baht)} \u0E1A\u0E32\u0E17</div>
            <div class="fuel-meta">${v.name} \xB7 ${v.kmPerLiter} \u0E01\u0E21./\u0E25\u0E34\u0E15\u0E23 \xB7 ${fuelName} ${fuelPrice} \u0E1A\u0E32\u0E17/\u0E25 ${diffBadge}</div>
            ${fuelUpdated ? `<div class="fuel-date">\u{1F4C5} \u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E23\u0E32\u0E04\u0E32 ${fuelUpdated}</div>` : ""}
          </div>
        </div>
      `;
    }
    const orderEl = document.getElementById("route-order");
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
            <div class="order-distance">\u{1F4CD} ${Utils.formatKm(distFromPrev)} \u0E01\u0E21.</div>
          </div>
        </li>
      `;
    }).join("");
    this.drawOnMap(result);
  },
  // ===== Get start coordinates =====
  getStartCoords() {
    const mode = document.getElementById("route-start-mode").value;
    if (mode === "custom") {
      return {
        lat: parseFloat(document.getElementById("start-lat").value),
        lng: parseFloat(document.getElementById("start-lng").value)
      };
    } else if (mode === "office") {
      return { lat: window.OFFICE_LOCATION.lat, lng: window.OFFICE_LOCATION.lng };
    } else if (mode === "last-stop") {
      return window._routeEnd || { lat: window.OFFICE_LOCATION.lat, lng: window.OFFICE_LOCATION.lng };
    }
    return window._lastGPS || { lat: window.OFFICE_LOCATION.lat, lng: window.OFFICE_LOCATION.lng };
  },
  // ===== Get end coordinates (for open-path route) =====
  getEndCoords() {
    var _a;
    const mode = ((_a = document.getElementById("route-end-mode")) == null ? void 0 : _a.value) || "none";
    if (mode === "none") return null;
    if (mode === "current") {
      return window._lastGPS || { lat: window.OFFICE_LOCATION.lat, lng: window.OFFICE_LOCATION.lng };
    }
    if (mode === "office") {
      return { lat: window.OFFICE_LOCATION.lat, lng: window.OFFICE_LOCATION.lng };
    }
    if (mode === "customer") {
      const sel = document.getElementById("route-end-customer");
      if (sel && sel.value) {
        const c = Storage.getCustomers().find((x) => x.id === sel.value);
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
    if (this.endMarker && Customers.map) {
      Customers.map.removeLayer(this.endMarker);
      this.endMarker = null;
    }
    if (result.geometry && Customers.map) {
      const coords = result.geometry.coordinates.map((c) => [c[1], c[0]]);
      this.routeLine = L.polyline(coords, {
        color: "#0a8f3c",
        weight: 5,
        opacity: 0.8
      }).addTo(Customers.map);
    }
    Customers.renderMarkers(result.order);
    if (result.isOpenPath && result.end && Customers.map) {
      this.endMarker = L.marker([result.end.lat, result.end.lng], {
        icon: L.divIcon({
          className: "end-marker",
          html: '<div class="end-pin">\u{1F3C1}</div>',
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        })
      }).addTo(Customers.map).bindPopup(
        `<b>\u{1F3C1} \u0E08\u0E38\u0E14\u0E2A\u0E34\u0E49\u0E19\u0E2A\u0E38\u0E14</b><br>${this.escapeHTML(result.end.name || "\u0E1B\u0E25\u0E32\u0E22\u0E17\u0E32\u0E07")}`
      );
    }
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
    const waypoints = this.currentResult.stops.map((c) => `${c.lat},${c.lng}`).join("|");
    const url = `https://www.google.com/maps/dir/?api=1&origin=${start.lat},${start.lng}&destination=${dest.lat},${dest.lng}&waypoints=${waypoints}&travelmode=driving`;
    window.open(url, "_blank");
  },
  // ===== Save route snapshot =====
  saveRoute() {
    var _a;
    if (!this.currentResult) return;
    const route = __spreadProps(__spreadValues({}, this.currentResult), {
      savedAt: (/* @__PURE__ */ new Date()).toISOString(),
      savedBy: (_a = Auth.getUser()) == null ? void 0 : _a.name
    });
    Storage.saveSavedRoute(route);
    Utils.toast("\u{1F4BE} \u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07\u0E41\u0E25\u0E49\u0E27 \u2014 \u0E2A\u0E48\u0E07\u0E02\u0E36\u0E49\u0E19\u0E40\u0E27\u0E47\u0E1A (\u0E02\u0E2D\u0E07\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E19\u0E35\u0E49)");
  },
  // ===== Route Templates =====
  // คีย์แยกตามผู้ใช้+เครื่อง (เดิมคีย์กลาง 'bfr_route_templates' → ใช้เครื่องร่วมกันแล้วเห็นเทมเพลตกัน)
  _templatesKey() {
    return "bfr_route_templates" + Storage._routeSuffix();
  },
  // Save current route as a reusable template
  saveAsTemplate(name) {
    var _a;
    const routeIds = Storage.getRoute();
    if (!routeIds.length) {
      Utils.toast("\u26A0\uFE0F \u0E44\u0E21\u0E48\u0E21\u0E35\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07\u0E43\u0E2B\u0E49\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E40\u0E1B\u0E47\u0E19\u0E40\u0E17\u0E21\u0E40\u0E1E\u0E25\u0E15", "error");
      return;
    }
    const templates = this._getTemplates();
    templates.push({
      id: Utils.uuid(),
      name: name || `\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07 ${(/* @__PURE__ */ new Date()).toLocaleDateString("th-TH")}`,
      routeIds: [...routeIds],
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      createdBy: (_a = Auth.getUser()) == null ? void 0 : _a.name
    });
    localStorage.setItem(this._templatesKey(), JSON.stringify(templates));
    Utils.toast(`\u{1F4CB} \u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E40\u0E17\u0E21\u0E40\u0E1E\u0E25\u0E15 "${name}" \u0E41\u0E25\u0E49\u0E27`);
  },
  // Load a template into current route
  loadTemplate(templateId) {
    const templates = this._getTemplates();
    const template = templates.find((t) => t.id === templateId);
    if (!template) {
      Utils.toast("\u274C \u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E40\u0E17\u0E21\u0E40\u0E1E\u0E25\u0E15", "error");
      return;
    }
    Storage.saveRoute(template.routeIds);
    App.updateRouteUI();
    Utils.toast(`\u{1F4CB} \u0E42\u0E2B\u0E25\u0E14\u0E40\u0E17\u0E21\u0E40\u0E1E\u0E25\u0E15 "${template.name}" \u0E41\u0E25\u0E49\u0E27`);
  },
  // Get all templates
  _getTemplates() {
    try {
      return Storage._readScoped(this._templatesKey(), ["bfr_route_templates"]);
    } catch (e) {
      return [];
    }
  },
  // Delete a template
  deleteTemplate(templateId) {
    let templates = this._getTemplates();
    templates = templates.filter((t) => t.id !== templateId);
    localStorage.setItem(this._templatesKey(), JSON.stringify(templates));
    Utils.toast("\u{1F5D1}\uFE0F \u0E25\u0E1A\u0E40\u0E17\u0E21\u0E40\u0E1E\u0E25\u0E15\u0E41\u0E25\u0E49\u0E27");
  },
  // ===== Route History =====
  // Save completed route to history
  saveToHistory(result) {
    var _a;
    if (!result) return;
    const history = this._getHistory();
    history.unshift({
      id: Utils.uuid(),
      distance: result.distance,
      duration: result.duration,
      stops: result.stops.map((c) => ({ id: c.id, name: c.name, cif: c.cif })),
      fuel: result.fuel,
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      completedBy: (_a = Auth.getUser()) == null ? void 0 : _a.name
    });
    if (history.length > 20) history.length = 20;
    localStorage.setItem(this._historyKey(), JSON.stringify(history));
  },
  // คีย์ประวัติแยกตามผู้ใช้+เครื่อง
  _historyKey() {
    return "bfr_route_history" + Storage._routeSuffix();
  },
  // Get route history
  _getHistory() {
    try {
      return Storage._readScoped(this._historyKey(), ["bfr_route_history"]);
    } catch (e) {
      return [];
    }
  },
  // Load a historical route
  loadFromHistory(historyId) {
    const history = this._getHistory();
    const entry = history.find((h) => h.id === historyId);
    if (!entry) {
      Utils.toast("\u274C \u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07\u0E43\u0E19\u0E1B\u0E23\u0E30\u0E27\u0E31\u0E15\u0E34", "error");
      return;
    }
    const routeIds = entry.stops.map((s) => s.id);
    Storage.saveRoute(routeIds);
    App.updateRouteUI();
    Utils.toast(`\u{1F4CB} \u0E42\u0E2B\u0E25\u0E14\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07\u0E08\u0E32\u0E01\u0E1B\u0E23\u0E30\u0E27\u0E31\u0E15\u0E34\u0E41\u0E25\u0E49\u0E27`);
  },
  // ===== จัดแผนอัตโนมัติจากตัวกรองซ้าย (28 ต.ค.69 — พ่อสั่ง) =====
  // เอาตัวกรองตอนนี้ → จับเฉพาะคนมีพิกัด → เอา N รายแรกยอดมากสุด → ใส่เส้นทาง + จัดลำดับสั้นสุดให้เลย
  autoPlanFromFilters() {
    var _a;
    try {
      const n = parseInt(((_a = document.getElementById("auto-plan-count")) == null ? void 0 : _a.value) || "10", 10) || 10;
      let list = Storage.getActiveCustomers();
      if (typeof Customers !== "undefined" && Customers._passesMapFilters) {
        list = list.filter((c) => Customers._passesMapFilters(c));
      }
      const withGps = list.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
      if (withGps.length === 0) {
        Utils.toast("\u0E15\u0E31\u0E27\u0E01\u0E23\u0E2D\u0E07\u0E19\u0E35\u0E49\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E04\u0E19\u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14 \u2014 \u0E25\u0E2D\u0E07\u0E25\u0E49\u0E32\u0E07\u0E15\u0E31\u0E27\u0E01\u0E23\u0E2D\u0E07\u0E14\u0E39\u0E04\u0E48\u0E30", "error");
        return;
      }
      if (typeof DebtDB !== "undefined" && DebtDB._loaded) {
        withGps.sort((a, b) => {
          const da = DebtDB.getByCif(a.cif), db = DebtDB.getByCif(b.cif);
          return (db && db.total_debt || 0) - (da && da.total_debt || 0);
        });
      }
      const picked = withGps.slice(0, Math.min(n, this.MAX_SELECT)).map((c) => c.id);
      Storage.saveRoute(picked);
      App.updateRouteUI();
      if (typeof App !== "undefined" && App.switchSheetTab) {
        try {
          App.switchSheetTab("plan");
        } catch (e) {
        }
      }
      const sheet = document.getElementById("bottom-sheet");
      if (sheet) sheet.classList.add("open");
      Utils.toast(`\u2705 \u0E2B\u0E22\u0E34\u0E1A ${picked.length} \u0E23\u0E32\u0E22\u0E08\u0E32\u0E01 ${withGps.length} \u0E2B\u0E21\u0E38\u0E14\u0E41\u0E25\u0E49\u0E27 \u2014 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E08\u0E31\u0E14\u0E25\u0E33\u0E14\u0E31\u0E1A\u0E43\u0E2B\u0E49\u0E2A\u0E31\u0E49\u0E19\u0E2A\u0E38\u0E14\u2026`);
      if (typeof App !== "undefined" && App.calculateRoute) App.calculateRoute(true, { focusSummary: true });
    } catch (e) {
      if (typeof Utils !== "undefined" && Utils.toast) Utils.toast("\u0E08\u0E31\u0E14\u0E41\u0E1C\u0E19\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49 \u0E25\u0E2D\u0E07\u0E2D\u0E35\u0E01\u0E17\u0E35\u0E04\u0E48\u0E30", "error");
    }
  },
  escapeHTML(str) {
    return String(str || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
  }
};
const Visit = {
  currentCustomerId: null,
  // Render visit list
  render() {
    const list = document.getElementById("visit-list");
    const route = Storage.getRoute();
    const customers = Storage.getActiveCustomers();
    const visits = Storage.getVisits();
    const routeCustomers = route.map((id) => customers.find((c) => c.id === id)).filter(Boolean);
    const counts = { pending: 0, visited: 0, skipped: 0 };
    list.innerHTML = "";
    if (routeCustomers.length === 0) {
      list.innerHTML = `<p class="empty-state">\u0E44\u0E21\u0E48\u0E21\u0E35\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E43\u0E19\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07\u0E27\u0E31\u0E19\u0E19\u0E35\u0E49<br><small>\u0E44\u0E1B\u0E17\u0E35\u0E48\u0E41\u0E17\u0E47\u0E1A "\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32" \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E40\u0E1E\u0E34\u0E48\u0E21</small></p>`;
      document.getElementById("visit-pending").textContent = 0;
      document.getElementById("visit-completed").textContent = 0;
      document.getElementById("visit-skipped").textContent = 0;
      if (typeof WorkCalendar !== "undefined" && WorkCalendar.refreshAlert) WorkCalendar.refreshAlert();
      return;
    }
    routeCustomers.forEach((c, idx) => {
      const visit = visits[c.id];
      const status = (visit == null ? void 0 : visit.status) || "pending";
      if (status === "visited" || status === "interested" || status === "wait_income") counts.visited++;
      else if (status === "no_answer" || status === "not_home" || status === "reschedule" || status === "not_interested") counts.skipped++;
      else counts.pending++;
      const statusIcon = this.statusIcon(status);
      const statusClass = ["visited", "interested", "wait_income", "no_answer", "not_home", "reschedule", "not_interested"].includes(status) ? status : "";
      const itemClass = status === "visited" || status === "interested" || status === "wait_income" ? "visited" : status !== "pending" ? "skipped" : "";
      const debtBadge = c.debtType === "overdue" ? "\u26A0\uFE0F \u0E04\u0E49\u0E32\u0E07" : c.debtType === "current" ? "\u{1F4C5} \u0E16\u0E36\u0E07\u0E01\u0E33\u0E2B\u0E19\u0E14" : "";
      let promiseMeta = "";
      if (visit && visit.promiseDate && typeof WorkCalendar !== "undefined") {
        const cls = WorkCalendar.classify(visit.promiseDate, visit.promiseStatus);
        promiseMeta = " \xB7 \u{1F4C5} \u0E19\u0E31\u0E14\u0E0A\u0E33\u0E23\u0E30 " + WorkCalendar.fmtDate(visit.promiseDate) + " (" + WorkCalendar.statusLabel(cls) + ")";
      }
      const item = document.createElement("div");
      item.className = `visit-item ${itemClass}`;
      const goLabel = status === "pending" ? "\u{1F4DD} \u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01" : "\u270F\uFE0F \u0E41\u0E01\u0E49\u0E44\u0E02";
      item.innerHTML = `
        <div class="visit-order">${idx + 1}</div>
        <div class="visit-status ${statusClass}" title="\u0E04\u0E25\u0E34\u0E01\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01">
          ${statusIcon}
        </div>
        <div class="visit-info">
          <div class="visit-name">${this.escapeHTML(c.name)}${debtBadge ? ` <span class="visit-debt">${debtBadge}</span>` : ""}</div>
          <div class="visit-meta">${visit ? this.statusLabel(status) + " \xB7 " + this.timeAgo(visit.timestamp) + promiseMeta : "\u23F3 \u0E23\u0E2D\u0E40\u0E22\u0E35\u0E48\u0E22\u0E21 \u2014 \u0E41\u0E15\u0E30\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01"}</div>
        </div>
        <button type="button" class="visit-go-btn">${goLabel}</button>
      `;
      item.onclick = () => this.openLog(c.id);
      list.appendChild(item);
    });
    document.getElementById("visit-pending").textContent = counts.pending;
    document.getElementById("visit-completed").textContent = counts.visited;
    document.getElementById("visit-skipped").textContent = counts.skipped;
    if (typeof WorkCalendar !== "undefined" && WorkCalendar.refreshAlert) WorkCalendar.refreshAlert();
  },
  statusIcon(status) {
    return {
      pending: "\u23F3",
      visited: "\u2705",
      no_answer: "\u274C",
      not_home: "\u{1F6AA}",
      reschedule: "\u{1F4C5}",
      interested: "\u{1F91D}",
      wait_income: "\u23F3",
      not_interested: "\u{1F6AB}"
    }[status] || "\u23F3";
  },
  statusLabel(status) {
    return {
      visited: "\u2705 \u0E1E\u0E1A\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32",
      no_answer: "\u274C \u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32",
      not_home: "\u{1F6AA} \u0E44\u0E21\u0E48\u0E2D\u0E22\u0E39\u0E48\u0E1A\u0E49\u0E32\u0E19",
      reschedule: "\u{1F4C5} \u0E19\u0E31\u0E14\u0E43\u0E2B\u0E21\u0E48",
      interested: "\u{1F91D} \u0E23\u0E31\u0E1A\u0E1B\u0E32\u0E01\u0E08\u0E48\u0E32\u0E22",
      wait_income: "\u23F3 \u0E23\u0E2D\u0E23\u0E32\u0E22\u0E44\u0E14\u0E49",
      not_interested: "\u{1F6AB} \u0E44\u0E21\u0E48\u0E08\u0E48\u0E32\u0E22"
    }[status] || status;
  },
  openLog(customerId) {
    var _a;
    this.currentCustomerId = customerId;
    const c = Storage.getCustomers().find((x) => x.id === customerId);
    if (!c) return;
    document.getElementById("visit-modal-title").textContent = `\u{1F4CB} \u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E01\u0E32\u0E23\u0E40\u0E02\u0E49\u0E32\u0E1E\u0E1A: ${c.name}`;
    const visits = Storage.getVisits();
    const existing = visits[customerId];
    const form = document.getElementById("visit-log-form");
    const status = (existing == null ? void 0 : existing.status) || "visited";
    this.setQuickStatus(status);
    form.elements.note.value = (existing == null ? void 0 : existing.note) || "";
    const pDate = document.getElementById("visit-promise-date");
    const pAmt = document.getElementById("visit-promise-amount");
    if (pDate) pDate.value = (existing == null ? void 0 : existing.promiseDate) || "";
    if (pAmt) pAmt.value = (_a = existing == null ? void 0 : existing.promiseAmount) != null ? _a : "";
    this._renderPromiseStatus(existing);
    this._updatePromiseVisibility(status);
    form.elements.lat.value = (existing == null ? void 0 : existing.lat) || "";
    form.elements.lng.value = (existing == null ? void 0 : existing.lng) || "";
    form.elements.accuracy.value = (existing == null ? void 0 : existing.accuracy) || "";
    this._renderGpsDisplay(existing == null ? void 0 : existing.lat, existing == null ? void 0 : existing.lng, existing == null ? void 0 : existing.accuracy);
    this._prefillGps();
    document.getElementById("visit-log-modal").classList.remove("hidden");
  },
  // Set quick status (called by quick status buttons)
  setQuickStatus(status) {
    const select = document.getElementById("visit-status-select");
    if (select) select.value = status;
    document.querySelectorAll(".quick-status-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.status === status);
    });
    this._updatePromiseVisibility(status);
  },
  // ช่องนัดชำระโผล่เฉพาะผล "รับปากจ่าย/นัดใหม่" — สถานะอื่นไม่ต้องใส่วันนัด
  _updatePromiseVisibility(status) {
    const sec = document.getElementById("visit-promise-section");
    if (!sec) return;
    sec.classList.toggle("hidden", !(status === "interested" || status === "reschedule"));
  },
  _renderPromiseStatus(existing) {
    const el = document.getElementById("visit-promise-status");
    if (!el) return;
    if (existing && existing.promiseDate && typeof WorkCalendar !== "undefined") {
      const cls = WorkCalendar.classify(existing.promiseDate, existing.promiseStatus);
      const hist = Array.isArray(existing.promiseHistory) && existing.promiseHistory.length ? " \xB7 \u0E40\u0E04\u0E22\u0E19\u0E31\u0E14/\u0E40\u0E25\u0E37\u0E48\u0E2D\u0E19 " + existing.promiseHistory.length + " \u0E04\u0E23\u0E31\u0E49\u0E07" : "";
      el.textContent = "\u{1F4CC} \u0E19\u0E31\u0E14\u0E40\u0E14\u0E34\u0E21: " + WorkCalendar.fmtDate(existing.promiseDate) + " \u2014 " + WorkCalendar.statusLabel(cls) + hist;
      el.classList.remove("hidden");
    } else {
      el.textContent = "";
      el.classList.add("hidden");
    }
  },
  // Phase 5: Render GPS display in visit modal
  _renderGpsDisplay(lat, lng, accuracy) {
    const el = document.getElementById("gps-display");
    if (!el) return;
    if (lat && lng) {
      const accText = accuracy ? `\xB1${Math.round(accuracy)} \u0E21.` : "";
      el.innerHTML = `
        <div class="gps-captured">
          <span class="gps-coord">\u{1F4CD} ${parseFloat(lat).toFixed(6)}, ${parseFloat(lng).toFixed(6)}</span>
          <span class="gps-accuracy">${accText}</span>
        </div>
      `;
    } else {
      el.innerHTML = '<span class="gps-empty">\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01</span>';
    }
  },
  // Phase 5: Capture current GPS
  captureGPS() {
    if (!navigator.geolocation) {
      Utils.toast("\u0E40\u0E1A\u0E23\u0E32\u0E27\u0E4C\u0E40\u0E0B\u0E2D\u0E23\u0E4C\u0E44\u0E21\u0E48\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A GPS", "error");
      return;
    }
    Utils.toast("\u{1F4CD} \u0E01\u0E33\u0E25\u0E31\u0E07\u0E04\u0E49\u0E19\u0E2B\u0E32\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07...");
    const btn = document.getElementById("btn-capture-gps");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "\u23F3 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E04\u0E49\u0E19\u0E2B\u0E32...";
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = pos.coords.accuracy;
        document.getElementById("visit-lat").value = lat.toFixed(6);
        document.getElementById("visit-lng").value = lng.toFixed(6);
        document.getElementById("visit-accuracy").value = Math.round(acc);
        this._renderGpsDisplay(lat, lng, acc);
        Utils.toast("\u{1F4CD} \u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E41\u0E25\u0E49\u0E27");
        if (btn) {
          btn.disabled = false;
          btn.textContent = "\u{1F4CD} \u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E1B\u0E31\u0E08\u0E08\u0E38\u0E1A\u0E31\u0E19";
        }
      },
      (err) => {
        Utils.toast("\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E40\u0E02\u0E49\u0E32\u0E16\u0E36\u0E07 GPS: " + err.message, "error");
        if (btn) {
          btn.disabled = false;
          btn.textContent = "\u{1F4CD} \u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E1B\u0E31\u0E08\u0E08\u0E38\u0E1A\u0E31\u0E19";
        }
      },
      { enableHighAccuracy: true, timeout: 15e3 }
    );
  },
  // พิกัดอัตโนมัติ: เปิดฟอร์มแล้วจับพิกัดเงียบๆ ไว้ก่อน — กดบันทึกได้เลยไม่ต้องกดปุ่ม GPS
  // ถ้าจับไม่ได้ (เช่น บันทึกเก่ามีพิกัดแล้ว/เครื่องไม่รองรับ) ก็ข้ามเงียบๆ ปุ่มกดมือยังอยู่
  _prefillGps() {
    try {
      const latEl = document.getElementById("visit-lat");
      if (!latEl || latEl.value || !navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition((pos) => {
        if (latEl.value) return;
        latEl.value = pos.coords.latitude.toFixed(6);
        document.getElementById("visit-lng").value = pos.coords.longitude.toFixed(6);
        document.getElementById("visit-accuracy").value = Math.round(pos.coords.accuracy);
        this._renderGpsDisplay(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      }, () => {
      }, { enableHighAccuracy: true, timeout: 8e3, maximumAge: 6e4 });
    } catch (e) {
    }
  },
  // ปุ่มลัดวันนัด (เรียก TodayUI ตรงๆ — คณิตวันที่เทสได้ใน tests/test_today.mjs)
  setPromiseOffset(days) {
    const el = document.getElementById("visit-promise-date");
    if (!el || typeof TodayUI === "undefined") return;
    el.value = TodayUI.promiseDateOffset(days);
    el.focus();
  },
  setPromiseMonthEnd() {
    const el = document.getElementById("visit-promise-date");
    if (!el || typeof TodayUI === "undefined") return;
    el.value = TodayUI.monthEndStr();
    el.focus();
  },
  closeLog() {
    this.currentCustomerId = null;
    document.getElementById("visit-log-modal").classList.add("hidden");
  },
  async submit(form) {
    if (!this.currentCustomerId) return;
    const status = document.getElementById("visit-status-select").value;
    const data = {
      status,
      note: form.elements.note.value
    };
    if (status === "interested" || status === "reschedule") {
      const pDateEl = document.getElementById("visit-promise-date");
      const pAmtEl = document.getElementById("visit-promise-amount");
      const promiseDate = pDateEl ? pDateEl.value : "";
      if (!promiseDate) {
        Utils.toast("\u0E01\u0E23\u0E38\u0E13\u0E32\u0E43\u0E2A\u0E48\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E23\u0E31\u0E1A\u0E1B\u0E32\u0E01\u0E0A\u0E33\u0E23\u0E30/\u0E27\u0E31\u0E19\u0E19\u0E31\u0E14\u0E43\u0E2B\u0E21\u0E48\u0E01\u0E48\u0E2D\u0E19\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01", "error");
        if (pDateEl) pDateEl.focus();
        return;
      }
      const existing = Storage.getVisits()[this.currentCustomerId] || {};
      const history = Array.isArray(existing.promiseHistory) ? [...existing.promiseHistory] : [];
      if (existing.promiseDate && existing.promiseDate !== promiseDate) {
        history.push({ date: existing.promiseDate, result: "rescheduled", newDate: promiseDate, at: (/* @__PURE__ */ new Date()).toISOString() });
      }
      data.promiseDate = promiseDate;
      data.promiseAmount = pAmtEl && pAmtEl.value !== "" ? Number(pAmtEl.value) : "";
      data.promiseStatus = existing.promiseDate === promiseDate && existing.promiseStatus === "paid" ? "paid" : "pending";
      data.promiseHistory = history;
    }
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
    Customers.renderMarkers();
    if (result && result.synced) {
      Utils.toast("\u{1F4BE} \u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E01\u0E32\u0E23\u0E40\u0E02\u0E49\u0E32\u0E1E\u0E1A\u0E41\u0E25\u0E49\u0E27 \xB7 sync \u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
    } else {
      Utils.toast("\u26A0\uFE0F \u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E41\u0E25\u0E49\u0E27\u0E41\u0E15\u0E48 sync \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \u2014 \u0E01\u0E14 \u{1F504} \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48", "error");
    }
  },
  timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 6e4);
    if (mins < 1) return "\u0E40\u0E21\u0E37\u0E48\u0E2D\u0E01\u0E35\u0E49";
    if (mins < 60) return `${mins} \u0E19\u0E32\u0E17\u0E35\u0E17\u0E35\u0E48\u0E41\u0E25\u0E49\u0E27`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} \u0E0A\u0E21.\u0E17\u0E35\u0E48\u0E41\u0E25\u0E49\u0E27`;
    const days = Math.floor(hours / 24);
    return `${days} \u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E41\u0E25\u0E49\u0E27`;
  },
  escapeHTML(str) {
    return String(str || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
  }
};
window.Visit = Visit;
const Report = {
  // ===== Constants =====
  ALLOWANCE_PER_DAY: 160,
  THRESHOLD_UPCOMING: 10,
  // หนี้ถึงกำหนด ≥ 10 ราย → ได้เบี้ยเลี้ยง
  THRESHOLD_OVERDUE: 5,
  // หนี้ค้าง ≥ 5 ราย → ได้เบี้ยเลี้ยง
  // ===== Open report modal =====
  open() {
    document.getElementById("report-modal").classList.remove("hidden");
    this.setRange("week");
  },
  close() {
    document.getElementById("report-modal").classList.add("hidden");
  },
  // ===== Render simple bar chart =====
  _renderBarChart(days) {
    if (!days.length) return "";
    const maxVisits = Math.max(...days.map((d) => d.visits.length), 1);
    let html = '<div class="bar-chart">';
    for (const day of days) {
      const pct = day.visits.length / maxVisits * 100;
      const color = day.qualifies ? "#16a34a" : "#d32f2f";
      const shortDate = day.dateLabel.split(" ").slice(0, 2).join(" ");
      html += `
        <div class="bar-item">
          <div class="bar-fill" style="height:${pct}%;background:${color}"></div>
          <div class="bar-label">${shortDate}</div>
          <div class="bar-value">${day.visits.length}</div>
        </div>
      `;
    }
    html += "</div>";
    return html;
  },
  // ===== Status badge =====
  setRange(range) {
    const today = /* @__PURE__ */ new Date();
    let from, to = new Date(today);
    to.setHours(23, 59, 59, 999);
    if (range === "today") {
      from = new Date(today);
      from.setHours(0, 0, 0, 0);
    } else if (range === "week") {
      from = new Date(today);
      from.setDate(today.getDate() - today.getDay());
      from.setHours(0, 0, 0, 0);
    } else if (range === "month") {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (range === "custom") {
      const fromEl = document.getElementById("report-from");
      const toEl = document.getElementById("report-to");
      from = fromEl.value ? /* @__PURE__ */ new Date(fromEl.value + "T00:00:00") : new Date(today);
      to = toEl.value ? /* @__PURE__ */ new Date(toEl.value + "T23:59:59") : new Date(today);
    }
    document.getElementById("report-range-label").textContent = `${Utils.formatThaiDate(from)} \u2013 ${Utils.formatThaiDate(to)}`;
    document.getElementById("report-from").value = from.toISOString().slice(0, 10);
    document.getElementById("report-to").value = to.toISOString().slice(0, 10);
    document.getElementById("custom-range").classList.toggle("hidden", range !== "custom");
    return { from, to };
  },
  // ===== Generate report =====
  generate() {
    const range = this.setRange(document.getElementById("report-range").value);
    const vehicleId = document.getElementById("report-vehicle").value;
    const from = range.from;
    const to = range.to;
    const customers = Storage.getActiveCustomers();
    const visits = Storage.getVisits();
    const byDay = {};
    for (const [cid, visit] of Object.entries(visits)) {
      const ts = new Date(visit.timestamp);
      if (ts < from || ts > to) continue;
      const dayKey = ts.toISOString().slice(0, 10);
      if (!byDay[dayKey]) byDay[dayKey] = [];
      const customer = customers.find((c) => c.id === cid);
      if (customer) {
        byDay[dayKey].push({ customer, visit });
      }
    }
    const dayKeys = Object.keys(byDay).sort();
    const reportData = {
      from,
      to,
      vehicleId,
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
        qualifyingDays: 0
      }
    };
    for (const dayKey of dayKeys) {
      const dayVisits = byDay[dayKey];
      const upcoming = dayVisits.filter((v) => v.customer.debtType === "current").length;
      const overdue = dayVisits.filter((v) => v.customer.debtType === "overdue").length;
      const qualifies = upcoming >= this.THRESHOLD_UPCOMING || overdue >= this.THRESHOLD_OVERDUE;
      const allowance = qualifies ? this.ALLOWANCE_PER_DAY : 0;
      const distance = dayVisits.length * 8;
      const fuel = Fuel.calculate(distance, vehicleId);
      reportData.days.push({
        date: dayKey,
        dateLabel: Utils.formatThaiDate(new Date(dayKey)),
        visits: dayVisits,
        upcoming,
        overdue,
        qualifies,
        allowance,
        distance,
        fuel
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
    const preview = document.getElementById("report-preview");
    const exportBtns = document.getElementById("export-buttons");
    if (data.days.length === 0) {
      preview.innerHTML = '<p class="empty-state">\u0E44\u0E21\u0E48\u0E1E\u0E1A visit \u0E43\u0E19\u0E0A\u0E48\u0E27\u0E07\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01</p>';
      exportBtns.classList.add("hidden");
      return;
    }
    exportBtns.classList.remove("hidden");
    const t = data.totals;
    let html = `
      <div class="report-summary">
        <h3>\u{1F4CA} \u0E2A\u0E23\u0E38\u0E1B\u0E20\u0E32\u0E1E\u0E23\u0E27\u0E21</h3>
        <div class="report-summary-grid">
          <div class="summary-item"><span class="summary-num">${t.days}</span><span class="summary-label">\u0E27\u0E31\u0E19\u0E17\u0E33\u0E07\u0E32\u0E19</span></div>
          <div class="summary-item"><span class="summary-num">${t.totalVisits}</span><span class="summary-label">\u0E04\u0E23\u0E31\u0E49\u0E07\u0E17\u0E35\u0E48\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21</span></div>
          <div class="summary-item"><span class="summary-num">${t.totalUpcoming}</span><span class="summary-label">\u0E2B\u0E19\u0E35\u0E49\u0E16\u0E36\u0E07\u0E01\u0E33\u0E2B\u0E19\u0E14</span></div>
          <div class="summary-item"><span class="summary-num">${t.totalOverdue}</span><span class="summary-label">\u0E2B\u0E19\u0E35\u0E49\u0E04\u0E49\u0E32\u0E07</span></div>
          <div class="summary-item"><span class="summary-num">${t.qualifyingDays}</span><span class="summary-label">\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E40\u0E1A\u0E34\u0E01\u0E44\u0E14\u0E49</span></div>
          <div class="summary-item highlight"><span class="summary-num">${Utils.formatBaht(t.totalAllowance)}</span><span class="summary-label">\u0E40\u0E1A\u0E35\u0E49\u0E22\u0E40\u0E25\u0E35\u0E49\u0E22\u0E07\u0E23\u0E27\u0E21</span></div>
        </div>
        <div class="report-fuel-cost">
          <span>\u26FD ${data.vehicleLabel} \xB7 ${data.kmPerLiter} \u0E01\u0E21./\u0E25\u0E34\u0E15\u0E23 \xB7 ${Utils.formatBaht(data.fuelPrice)}/\u0E25\u0E34\u0E15\u0E23</span>
          <span>\u{1F4CF} \u0E23\u0E30\u0E22\u0E30\u0E17\u0E32\u0E07\u0E1B\u0E23\u0E30\u0E21\u0E32\u0E13\u0E01\u0E32\u0E23: ${Utils.formatKm(t.totalDistance)} \u0E01\u0E21.</span>
          <span>\u{1F4B0} \u0E04\u0E48\u0E32\u0E19\u0E49\u0E33\u0E21\u0E31\u0E19\u0E1B\u0E23\u0E30\u0E21\u0E32\u0E13\u0E01\u0E32\u0E23: ${Utils.formatBaht(t.totalFuelBaht)}</span>
        </div>
      </div>
      
      <!-- Simple bar chart -->
      <div class="report-chart">
        <h3>\u{1F4C8} \u0E2A\u0E23\u0E38\u0E1B\u0E23\u0E32\u0E22\u0E27\u0E31\u0E19</h3>
        <div class="chart-container">
          ${this._renderBarChart(data.days)}
        </div>
      </div>
      
      <div class="report-days">
        <h3>\u{1F4C5} \u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E23\u0E32\u0E22\u0E27\u0E31\u0E19</h3>
    `;
    for (const day of data.days) {
      const dayClass = day.qualifies ? "day-qualifies" : "day-no-qualify";
      const allowanceBadge = day.qualifies ? `<span class="badge-yes">\u2705 \u0E40\u0E1A\u0E34\u0E01\u0E44\u0E14\u0E49 ${Utils.formatBaht(day.allowance)}</span>` : `<span class="badge-no">\u274C \u0E44\u0E21\u0E48\u0E16\u0E36\u0E07\u0E40\u0E01\u0E13\u0E11\u0E4C</span>`;
      html += `
        <div class="report-day ${dayClass}">
          <div class="report-day-header">
            <strong>${day.dateLabel}</strong>
            ${allowanceBadge}
            <span class="day-stats">\u{1F4C5} ${day.upcoming} \u0E16\u0E36\u0E07\u0E01\u0E33\u0E2B\u0E19\u0E14 \xB7 \u26A0\uFE0F ${day.overdue} \u0E04\u0E49\u0E32\u0E07 \xB7 \u{1F465} ${day.visits.length} \u0E23\u0E32\u0E22</span>
          </div>
          <table class="report-day-table">
            <thead><tr><th>\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32</th><th>\u0E2A\u0E16\u0E32\u0E19\u0E30</th><th>\u0E40\u0E27\u0E25\u0E32</th><th>\u0E1E\u0E34\u0E01\u0E31\u0E14</th><th>\u0E2B\u0E21\u0E32\u0E22\u0E40\u0E2B\u0E15\u0E38</th></tr></thead>
            <tbody>
      `;
      for (const v of day.visits) {
        const c = v.customer;
        const status = this._statusBadge(v.visit.status);
        const time = v.visit.timestamp ? new Date(v.visit.timestamp).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "-";
        const coords = v.visit.lat && v.visit.lng ? `<a href="https://www.google.com/maps?q=${v.visit.lat},${v.visit.lng}" target="_blank">\u{1F4CD} ${v.visit.lat.toFixed(4)}, ${v.visit.lng.toFixed(4)}</a>` : "-";
        const note = v.visit.note ? this._escapeHTML(v.visit.note) : "-";
        html += `
          <tr>
            <td>
              <div class="td-name">${this._escapeHTML(c.name)}</div>
              <div class="td-sub">${c.phone || ""}</div>
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
    html += "</div>";
    preview.innerHTML = html;
  },
  // ===== Export: HTML (printable) =====
  exportHTML() {
    var _a;
    if (!this._currentReport) return;
    const data = this._currentReport;
    const officer = ((_a = Auth.getUser()) == null ? void 0 : _a.name) || "\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38";
    const t = data.totals;
    const html = this._buildPrintHTML(data, officer, false);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    Utils.toast("\u{1F4C4} \u0E40\u0E1B\u0E34\u0E14\u0E23\u0E32\u0E22\u0E07\u0E32\u0E19 HTML \u0E41\u0E25\u0E49\u0E27");
  },
  // ===== Export: PDF (auto-print) =====
  exportPDF() {
    var _a;
    if (!this._currentReport) return;
    const data = this._currentReport;
    const officer = ((_a = Auth.getUser()) == null ? void 0 : _a.name) || "\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38";
    const t = data.totals;
    const html = this._buildPrintHTML(data, officer, true);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    Utils.toast('\u{1F4D1} \u0E40\u0E1B\u0E34\u0E14\u0E2B\u0E19\u0E49\u0E32\u0E1E\u0E34\u0E21\u0E1E\u0E4C PDF \u0E41\u0E25\u0E49\u0E27 \u2014 \u0E40\u0E25\u0E37\u0E2D\u0E01 "Save as PDF"');
  },
  // ===== Build print-friendly HTML =====
  _buildPrintHTML(data, officer, autoPrint) {
    const t = data.totals;
    return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>\u0E23\u0E32\u0E22\u0E07\u0E32\u0E19\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E2B\u0E19\u0E35\u0E49 - ${officer}</title>
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
  <h1>\u{1F4CB} \u0E23\u0E32\u0E22\u0E07\u0E32\u0E19\u0E01\u0E32\u0E23\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E2B\u0E19\u0E35\u0E49</h1>
  <div class="meta">
    <div><strong>\u0E40\u0E08\u0E49\u0E32\u0E2B\u0E19\u0E49\u0E32\u0E17\u0E35\u0E48:</strong> ${this._escapeHTML(officer)}</div>
    <div><strong>\u0E0A\u0E48\u0E27\u0E07\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48:</strong> ${Utils.formatThaiDate(data.from)} \u2013 ${Utils.formatThaiDate(data.to)}</div>
    <div><strong>\u0E22\u0E32\u0E19\u0E1E\u0E32\u0E2B\u0E19\u0E30:</strong> ${this._escapeHTML(data.vehicleLabel)} (${data.kmPerLiter} \u0E01\u0E21./\u0E25\u0E34\u0E15\u0E23, ${Utils.formatBaht(data.fuelPrice)}/\u0E25\u0E34\u0E15\u0E23)</div>
    <div><strong>\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E2D\u0E2D\u0E01\u0E23\u0E32\u0E22\u0E07\u0E32\u0E19:</strong> ${Utils.formatThaiDate(/* @__PURE__ */ new Date())}</div>
  </div>

  <h2>\u{1F4CA} \u0E2A\u0E23\u0E38\u0E1B\u0E20\u0E32\u0E1E\u0E23\u0E27\u0E21</h2>
  <div class="summary-grid">
    <div class="summary-card"><span class="summary-num">${t.days}</span><span class="summary-label">\u0E27\u0E31\u0E19\u0E17\u0E33\u0E07\u0E32\u0E19</span></div>
    <div class="summary-card"><span class="summary-num">${t.totalVisits}</span><span class="summary-label">\u0E04\u0E23\u0E31\u0E49\u0E07\u0E17\u0E35\u0E48\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21</span></div>
    <div class="summary-card"><span class="summary-num">${t.totalUpcoming}</span><span class="summary-label">\u0E2B\u0E19\u0E35\u0E49\u0E16\u0E36\u0E07\u0E01\u0E33\u0E2B\u0E19\u0E14</span></div>
    <div class="summary-card"><span class="summary-num">${t.totalOverdue}</span><span class="summary-label">\u0E2B\u0E19\u0E35\u0E49\u0E04\u0E49\u0E32\u0E07</span></div>
    <div class="summary-card"><span class="summary-num">${t.qualifyingDays}</span><span class="summary-label">\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E40\u0E1A\u0E34\u0E01\u0E44\u0E14\u0E49</span></div>
    <div class="summary-card highlight"><span class="summary-num">${Utils.formatBaht(t.totalAllowance)}</span><span class="summary-label">\u0E40\u0E1A\u0E35\u0E49\u0E22\u0E40\u0E25\u0E35\u0E49\u0E22\u0E07\u0E23\u0E27\u0E21</span></div>
  </div>
  <p>\u26FD \u0E04\u0E48\u0E32\u0E19\u0E49\u0E33\u0E21\u0E31\u0E19\u0E1B\u0E23\u0E30\u0E21\u0E32\u0E13\u0E01\u0E32\u0E23: ${Utils.formatBaht(t.totalFuelBaht)} (\u0E23\u0E30\u0E22\u0E30\u0E17\u0E32\u0E07 ${Utils.formatKm(t.totalDistance)} \u0E01\u0E21.)</p>

  <h2>\u{1F4C5} \u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E23\u0E32\u0E22\u0E27\u0E31\u0E19</h2>
  ${data.days.map((day) => `
    <div class="${day.qualifies ? "day-qualifies" : "day-no-qualify"}">
      <h3>${day.dateLabel} ${day.qualifies ? '<span class="badge-yes">\u2705 \u0E40\u0E1A\u0E34\u0E01\u0E44\u0E14\u0E49 ' + Utils.formatBaht(day.allowance) + "</span>" : '<span class="badge-no">\u274C \u0E44\u0E21\u0E48\u0E16\u0E36\u0E07\u0E40\u0E01\u0E13\u0E11\u0E4C</span>'}</h3>
      <p>\u{1F4C5} ${day.upcoming} \u0E16\u0E36\u0E07\u0E01\u0E33\u0E2B\u0E19\u0E14 \xB7 \u26A0\uFE0F ${day.overdue} \u0E04\u0E49\u0E32\u0E07 \xB7 \u{1F465} ${day.visits.length} \u0E23\u0E32\u0E22</p>
      <table>
        <thead><tr><th>\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32</th><th>\u0E2A\u0E16\u0E32\u0E19\u0E30</th><th>\u0E40\u0E27\u0E25\u0E32</th><th>\u0E1E\u0E34\u0E01\u0E31\u0E14</th><th>\u0E2B\u0E21\u0E32\u0E22\u0E40\u0E2B\u0E15\u0E38</th></tr></thead>
        <tbody>
          ${day.visits.map((v) => `
            <tr>
              <td>${this._escapeHTML(v.customer.name)}<br><small>${this._escapeHTML(v.customer.phone || "")}</small></td>
              <td>${this._statusLabel(v.visit.status)}</td>
              <td>${v.visit.timestamp ? new Date(v.visit.timestamp).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
              <td>${v.visit.lat && v.visit.lng ? v.visit.lat.toFixed(4) + ", " + v.visit.lng.toFixed(4) : "-"}</td>
              <td>${this._escapeHTML(v.visit.note || "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `).join("")}

  <div class="signature">
    <div class="signature-box">\u0E25\u0E07\u0E0A\u0E37\u0E48\u0E2D .....................................<br><small>\u0E1C\u0E39\u0E49\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21 (${this._escapeHTML(officer)})</small></div>
    <div class="signature-box">\u0E25\u0E07\u0E0A\u0E37\u0E48\u0E2D .....................................<br><small>\u0E2B\u0E31\u0E27\u0E2B\u0E19\u0E49\u0E32\u0E07\u0E32\u0E19</small></div>
  </div>

  <div class="no-print">
    <button onclick="window.print()">\u{1F5A8}\uFE0F \u0E1E\u0E34\u0E21\u0E1E\u0E4C / Save PDF</button>
    <button onclick="window.close()">\u2716\uFE0F \u0E1B\u0E34\u0E14</button>
  </div>
  ${autoPrint ? "<script>window.onload = () => setTimeout(() => window.print(), 500);<\/script>" : ""}
</body>
</html>`;
  },
  // ===== Export: CSV =====
  exportCSV() {
    var _a;
    if (!this._currentReport) return;
    const data = this._currentReport;
    const t = data.totals;
    const rows = [
      ["\u0E23\u0E32\u0E22\u0E07\u0E32\u0E19\u0E01\u0E32\u0E23\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E2B\u0E19\u0E35\u0E49"],
      ["\u0E40\u0E08\u0E49\u0E32\u0E2B\u0E19\u0E49\u0E32\u0E17\u0E35\u0E48", ((_a = Auth.getUser()) == null ? void 0 : _a.name) || ""],
      ["\u0E0A\u0E48\u0E27\u0E07\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48", `${Utils.formatThaiDate(data.from)} \u2013 ${Utils.formatThaiDate(data.to)}`],
      ["\u0E22\u0E32\u0E19\u0E1E\u0E32\u0E2B\u0E19\u0E30", `${data.vehicleLabel} (${data.kmPerLiter} \u0E01\u0E21./\u0E25\u0E34\u0E15\u0E23, ${data.fuelPrice}\u0E3F/\u0E25\u0E34\u0E15\u0E23)`],
      [],
      ["\u0E2A\u0E23\u0E38\u0E1B\u0E20\u0E32\u0E1E\u0E23\u0E27\u0E21"],
      ["\u0E27\u0E31\u0E19\u0E17\u0E33\u0E07\u0E32\u0E19", t.days],
      ["\u0E04\u0E23\u0E31\u0E49\u0E07\u0E17\u0E35\u0E48\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21", t.totalVisits],
      ["\u0E2B\u0E19\u0E35\u0E49\u0E16\u0E36\u0E07\u0E01\u0E33\u0E2B\u0E19\u0E14", t.totalUpcoming],
      ["\u0E2B\u0E19\u0E35\u0E49\u0E04\u0E49\u0E32\u0E07", t.totalOverdue],
      ["\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E40\u0E1A\u0E34\u0E01\u0E44\u0E14\u0E49", t.qualifyingDays],
      ["\u0E40\u0E1A\u0E35\u0E49\u0E22\u0E40\u0E25\u0E35\u0E49\u0E22\u0E07\u0E23\u0E27\u0E21 (\u0E3F)", t.totalAllowance],
      ["\u0E04\u0E48\u0E32\u0E19\u0E49\u0E33\u0E21\u0E31\u0E19\u0E1B\u0E23\u0E30\u0E21\u0E32\u0E13\u0E01\u0E32\u0E23 (\u0E3F)", Math.round(t.totalFuelBaht)],
      ["\u0E23\u0E30\u0E22\u0E30\u0E17\u0E32\u0E07\u0E1B\u0E23\u0E30\u0E21\u0E32\u0E13\u0E01\u0E32\u0E23 (\u0E01\u0E21.)", Math.round(t.totalDistance)],
      [],
      ["\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E23\u0E32\u0E22\u0E27\u0E31\u0E19"],
      ["\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48", "\u0E0A\u0E37\u0E48\u0E2D\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32", "\u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E42\u0E17\u0E23", "\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17\u0E2B\u0E19\u0E35\u0E49", "\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E04\u0E27\u0E32\u0E21\u0E40\u0E2A\u0E35\u0E48\u0E22\u0E07", "\u0E2A\u0E16\u0E32\u0E19\u0E30\u0E40\u0E02\u0E49\u0E32\u0E1E\u0E1A", "\u0E40\u0E27\u0E25\u0E32", "\u0E25\u0E30\u0E15\u0E34\u0E08\u0E39\u0E14", "\u0E25\u0E2D\u0E07\u0E08\u0E34\u0E08\u0E39\u0E14", "\u0E2B\u0E21\u0E32\u0E22\u0E40\u0E2B\u0E15\u0E38", "\u0E40\u0E1A\u0E34\u0E01\u0E40\u0E1A\u0E35\u0E49\u0E22\u0E40\u0E25\u0E35\u0E49\u0E22\u0E07\u0E44\u0E14\u0E49"]
    ];
    for (const day of data.days) {
      for (const v of day.visits) {
        const c = v.customer;
        rows.push([
          day.dateLabel,
          c.name || "",
          c.phone || "",
          c.debtType === "current" ? "\u0E2B\u0E19\u0E35\u0E49\u0E16\u0E36\u0E07\u0E01\u0E33\u0E2B\u0E19\u0E14" : c.debtType === "overdue" ? "\u0E2B\u0E19\u0E35\u0E49\u0E04\u0E49\u0E32\u0E07" : "-",
          this._riskLabel(c.riskLevel),
          this._statusLabel(v.visit.status),
          v.visit.timestamp ? new Date(v.visit.timestamp).toLocaleTimeString("th-TH") : "",
          v.visit.lat || "",
          v.visit.lng || "",
          v.visit.note || "",
          day.qualifies ? "\u0E44\u0E14\u0E49 " + Utils.formatBaht(day.allowance) : "\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49"
        ]);
      }
    }
    const csv = "\uFEFF" + rows.map((r) => r.map((cell) => {
      const s = String(cell);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    Utils.toast("\u{1F4CA} \u0E14\u0E32\u0E27\u0E19\u0E4C\u0E42\u0E2B\u0E25\u0E14 CSV \u0E41\u0E25\u0E49\u0E27");
  },
  // ===== Export: Share text =====
  shareText() {
    var _a;
    if (!this._currentReport) return;
    const data = this._currentReport;
    const t = data.totals;
    const officer = ((_a = Auth.getUser()) == null ? void 0 : _a.name) || "";
    const lines = [
      `\u{1F4CB} *\u0E23\u0E32\u0E22\u0E07\u0E32\u0E19\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E2B\u0E19\u0E35\u0E49*`,
      `\u{1F464} \u0E40\u0E08\u0E49\u0E32\u0E2B\u0E19\u0E49\u0E32\u0E17\u0E35\u0E48: ${officer}`,
      `\u{1F4C5} \u0E0A\u0E48\u0E27\u0E07: ${Utils.formatThaiDate(data.from)} \u2013 ${Utils.formatThaiDate(data.to)}`,
      `\u{1F697} ${data.vehicleLabel}`,
      ``,
      `\u{1F4CA} *\u0E2A\u0E23\u0E38\u0E1B*`,
      `\u2022 ${t.days} \u0E27\u0E31\u0E19\u0E17\u0E33\u0E07\u0E32\u0E19 \xB7 ${t.totalVisits} \u0E04\u0E23\u0E31\u0E49\u0E07`,
      `\u2022 \u0E2B\u0E19\u0E35\u0E49\u0E16\u0E36\u0E07\u0E01\u0E33\u0E2B\u0E19\u0E14: ${t.totalUpcoming} \u0E23\u0E32\u0E22`,
      `\u2022 \u0E2B\u0E19\u0E35\u0E49\u0E04\u0E49\u0E32\u0E07: ${t.totalOverdue} \u0E23\u0E32\u0E22`,
      `\u2022 \u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E40\u0E1A\u0E34\u0E01\u0E44\u0E14\u0E49: ${t.qualifyingDays}/${t.days}`,
      `\u2022 *\u0E40\u0E1A\u0E35\u0E49\u0E22\u0E40\u0E25\u0E35\u0E49\u0E22\u0E07\u0E23\u0E27\u0E21: ${Utils.formatBaht(t.totalAllowance)}*`,
      `\u2022 \u0E04\u0E48\u0E32\u0E19\u0E49\u0E33\u0E21\u0E31\u0E19\u0E1B\u0E23\u0E30\u0E21\u0E32\u0E13\u0E01\u0E32\u0E23: ${Utils.formatBaht(t.totalFuelBaht)}`,
      ``
    ];
    for (const day of data.days) {
      lines.push(`\u{1F4C5} *${day.dateLabel}* ${day.qualifies ? "\u2705 \u0E40\u0E1A\u0E34\u0E01\u0E44\u0E14\u0E49" : "\u274C"}`);
      lines.push(`  \u0E16\u0E36\u0E07\u0E01\u0E33\u0E2B\u0E19\u0E14: ${day.upcoming} \xB7 \u0E04\u0E49\u0E32\u0E07: ${day.overdue} \xB7 \u0E23\u0E32\u0E22: ${day.visits.length}`);
      for (const v of day.visits.slice(0, 5)) {
        const status = this._statusEmoji(v.visit.status);
        const coords = v.visit.lat ? ` \u{1F4CD}${v.visit.lat.toFixed(3)},${v.visit.lng.toFixed(3)}` : "";
        lines.push(`  ${status} ${v.customer.name}${coords}`);
      }
      if (day.visits.length > 5) lines.push(`  ... +${day.visits.length - 5} \u0E23\u0E32\u0E22`);
    }
    const text = lines.join("\n");
    if (navigator.share) {
      navigator.share({ title: "\u0E23\u0E32\u0E22\u0E07\u0E32\u0E19\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E2B\u0E19\u0E35\u0E49", text }).catch(() => {
        this._copyToClipboard(text);
      });
    } else {
      this._copyToClipboard(text);
    }
  },
  _copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => Utils.toast("\u{1F4CB} \u0E04\u0E31\u0E14\u0E25\u0E2D\u0E01\u0E23\u0E32\u0E22\u0E07\u0E32\u0E19\u0E41\u0E25\u0E49\u0E27"));
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      Utils.toast("\u{1F4CB} \u0E04\u0E31\u0E14\u0E25\u0E2D\u0E01\u0E23\u0E32\u0E22\u0E07\u0E32\u0E19\u0E41\u0E25\u0E49\u0E27");
    }
  },
  // ===== Helpers =====
  _statusBadge(status) {
    const label = this._statusLabel(status);
    const cls = {
      visited: "badge-yes",
      interested: "badge-yes",
      wait_income: "badge-warn",
      no_answer: "badge-no",
      not_home: "badge-no",
      not_interested: "badge-no",
      reschedule: "badge-warn"
    }[status] || "badge-warn";
    return `<span class="${cls}">${label}</span>`;
  },
  _statusLabel(status) {
    return {
      visited: "\u2705 \u0E1E\u0E1A\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32",
      no_answer: "\u274C \u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32",
      not_home: "\u{1F6AA} \u0E44\u0E21\u0E48\u0E2D\u0E22\u0E39\u0E48\u0E1A\u0E49\u0E32\u0E19",
      reschedule: "\u{1F4C5} \u0E19\u0E31\u0E14\u0E43\u0E2B\u0E21\u0E48",
      interested: "\u{1F91D} \u0E23\u0E31\u0E1A\u0E1B\u0E32\u0E01\u0E08\u0E48\u0E32\u0E22",
      wait_income: "\u23F3 \u0E23\u0E2D\u0E23\u0E32\u0E22\u0E44\u0E14\u0E49",
      not_interested: "\u{1F6AB} \u0E44\u0E21\u0E48\u0E08\u0E48\u0E32\u0E22",
      pending: "\u23F3 \u0E23\u0E2D"
    }[status] || status || "-";
  },
  _statusEmoji(status) {
    return {
      visited: "\u2705",
      no_answer: "\u274C",
      not_home: "\u{1F6AA}",
      reschedule: "\u{1F4C5}",
      interested: "\u{1F91D}",
      wait_income: "\u23F3",
      not_interested: "\u{1F6AB}",
      pending: "\u23F3"
    }[status] || "\u2022";
  },
  _riskLabel(level) {
    return {
      good: "\u{1F7E2} \u0E14\u0E35",
      warning: "\u{1F7E1} \u0E40\u0E23\u0E34\u0E48\u0E21\u0E21\u0E35\u0E1B\u0E31\u0E0D\u0E2B\u0E32",
      bad: "\u{1F534} \u0E21\u0E35\u0E1B\u0E31\u0E0D\u0E2B\u0E32\u0E21\u0E32\u0E01",
      unclassified: "\u2753 \u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E08\u0E31\u0E14"
    }[level] || "-";
  },
  _escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }
};
window.Report = Report;
const OFFICE_LOCATION = {
  lat: 13.7760801,
  lng: 101.8907475,
  name: "BAAC \u0E2A\u0E32\u0E02\u0E32\u0E27\u0E31\u0E07\u0E17\u0E48\u0E32\u0E0A\u0E49\u0E32\u0E07",
  accuracy: 50
  // meters — used for the GPS pin accuracy circle
};
window.OFFICE_LOCATION = OFFICE_LOCATION;
const App = {
  // Known server version (updated on every fetch from version.json)
  _knownVersion: null,
  _versionCheckTimer: null,
  // Init
  async init() {
    this.attachEvents();
    this.startVersionWatcher();
    if (typeof Utils !== "undefined" && Utils.initKeyboardGuard) Utils.initKeyboardGuard();
    this._notifyUpdateCompleted();
    try {
      if (typeof Storage !== "undefined" && Storage.ready) await Storage.ready;
    } catch (e) {
    }
    try {
      if (Auth.isLoggedIn()) {
        Auth.showApp();
        await this.afterLogin();
      } else {
        Auth.showLogin();
        try {
          document.getElementById("login-screen").classList.add("login-mode");
          const pinForm = document.getElementById("pin-form");
          if (pinForm) {
            pinForm.classList.remove("hidden");
            try {
              this.loadStaffGrid();
            } catch (e) {
            }
          }
        } catch (e) {
        }
      }
    } catch (e) {
      console.warn("[App.init] afterLogin error:", e == null ? void 0 : e.message);
    }
  },
  // ===== แจ้งเตือน "อัปเดตเสร็จแล้ว" หลัง reload จากปุ่ม 🔄 =====
  _notifyUpdateCompleted() {
    const flag = sessionStorage.getItem("bfr_update_done");
    if (!flag) return;
    sessionStorage.removeItem("bfr_update_done");
    if (typeof Utils !== "undefined" && Utils.toast) {
      setTimeout(() => {
        Utils.toast("\u2705 \u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E40\u0E27\u0E47\u0E1A\u0E40\u0E1B\u0E47\u0E19\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E43\u0E2B\u0E21\u0E48\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22", "success");
      }, 800);
    }
  },
  // ===== Version watcher (auto-detect new deploys) =====
  async fetchServerVersion() {
    try {
      const res = await fetch("/version.json?_=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      return data.version || null;
    } catch (e) {
      return null;
    }
  },
  // ===== Show current version in header label =====
  _renderVersionLabel(ver) {
    const el = document.getElementById("version-label");
    if (!el) return;
    el.textContent = `v${ver}`;
    el.style.cursor = "default";
    el.title = "\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E1B\u0E31\u0E08\u0E08\u0E38\u0E1A\u0E31\u0E19\u0E02\u0E2D\u0E07\u0E40\u0E27\u0E47\u0E1A";
  },
  // ===== Initialize header components =====
  _initHeader() {
    const user = Auth.getUser();
    if (user && user.name) {
      const initial = user.name.charAt(0).toUpperCase();
      const avatarEl = document.getElementById("avatar-initial");
      if (avatarEl) avatarEl.textContent = initial;
    }
    const moreBtn = document.getElementById("more-menu-btn");
    const moreDropdown = document.getElementById("more-menu-dropdown");
    if (moreBtn && moreDropdown) {
      moreBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        moreDropdown.classList.toggle("active");
      });
      document.addEventListener("click", (e) => {
        if (!e.target.closest(".header-more-menu")) {
          moreDropdown.classList.remove("active");
        }
      });
      moreDropdown.querySelectorAll(".more-menu-item").forEach((item) => {
        item.addEventListener("click", () => {
          moreDropdown.classList.remove("active");
        });
      });
    }
    const syncBadge = document.getElementById("sync-badge-header");
    if (syncBadge) {
      syncBadge.addEventListener("click", () => {
        if (typeof Storage !== "undefined" && Storage.retrySync) {
          Storage.retrySync();
        }
      });
    }
  },
  async checkForUpdate() {
    const serverVer = await this.fetchServerVersion();
    if (!serverVer) return false;
    const stored = localStorage.getItem("app_version") || "0";
    const btn = document.getElementById("refresh-btn");
    const label = document.getElementById("version-label");
    if (serverVer !== stored && !this._skipFirstNotify) {
      if (btn) {
        btn.classList.add("has-update");
        btn.title = `\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E43\u0E2B\u0E21\u0E48 ${serverVer} \u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19! (\u0E01\u0E14\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2D\u0E31\u0E1E\u0E40\u0E14\u0E17)`;
      }
      if (label) {
        label.textContent = `v${serverVer}`;
        label.classList.add("has-update");
        label.title = "\u0E21\u0E35\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E43\u0E2B\u0E21\u0E48 \u2014 \u0E23\u0E30\u0E1A\u0E1A\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E43\u0E2B\u0E49\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34";
      }
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then((reg) => {
          if (reg.waiting) {
            reg.waiting.postMessage({ type: "SKIP_WAITING" });
          } else {
            reg.update();
          }
        });
      }
      if (!this._updateNotified && typeof Utils !== "undefined") {
        this._updateNotified = true;
        this._showUpdateToast(serverVer);
      }
      return true;
    }
    if (btn) {
      btn.classList.remove("has-update");
      btn.title = "\u0E01\u0E14\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E40\u0E27\u0E47\u0E1A\u0E40\u0E1B\u0E47\u0E19\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14 (\u0E40\u0E04\u0E25\u0E35\u0E22\u0E23\u0E4C cache)";
    }
    if (label) {
      label.classList.remove("has-update");
      label.textContent = `v${stored}`;
      label.title = "\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E1B\u0E31\u0E08\u0E08\u0E38\u0E1A\u0E31\u0E19\u0E02\u0E2D\u0E07\u0E40\u0E27\u0E47\u0E1A";
    }
    return false;
  },
  _showUpdateToast(newVer) {
    const existing = document.getElementById("update-banner");
    if (existing) existing.remove();
    const banner = document.createElement("div");
    banner.id = "update-banner";
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
      background: #0a8f3c; color: #fff; text-align: center;
      padding: 12px 16px; font-size: 15px; font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      cursor: pointer; display: flex; align-items: center;
      justify-content: center; gap: 10px;
    `;
    banner.innerHTML = `
      <span>\u{1F504} \u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19 ${newVer} \u2014 \u0E01\u0E14\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E42\u0E2B\u0E25\u0E14\u0E43\u0E2B\u0E21\u0E48\u0E17\u0E31\u0E19\u0E17\u0E35</span>
      <span style="background:rgba(255,255,255,0.2);padding:4px 10px;border-radius:4px;font-size:13px" id="update-countdown">\u23F3 8 \u0E27\u0E34</span>
    `;
    banner.addEventListener("click", () => {
      if (typeof App !== "undefined") App.applyUpdate();
    });
    document.body.prepend(banner);
    let sec = 8;
    const countEl = document.getElementById("update-countdown");
    this._updateTimer = setInterval(() => {
      sec--;
      if (countEl) countEl.textContent = `\u23F3 ${sec} \u0E27\u0E34`;
      if (sec <= 0) {
        clearInterval(this._updateTimer);
        if (typeof App !== "undefined") App.applyUpdate();
      }
    }, 1e3);
  },
  startVersionWatcher() {
    this._skipFirstNotify = true;
    setTimeout(() => {
      this._skipFirstNotify = false;
    }, 15e3);
    this.fetchServerVersion().then((v) => {
      if (v) {
        this._knownVersion = v;
        localStorage.setItem("app_version", v);
        this._renderVersionLabel(v);
      }
      this._skipFirstNotify = false;
    });
    if (this._versionCheckTimer) clearInterval(this._versionCheckTimer);
    this._versionCheckTimer = setInterval(() => this.checkForUpdate(), 60 * 1e3);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.checkForUpdate();
    });
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!this._swReloading) {
          this._swReloading = true;
          sessionStorage.setItem("bfr_update_done", "1");
          window.location.reload();
        }
      });
    }
  },
  // Backfill เครื่องเก่าด้วยข้อมูลสดจากฐานกลาง (22 ต.ค.69)
  // ที่มา: เข้าแอปด้วย user เดิมบนเครื่องที่เคยโหลดไว้ → afterLogin ข้าม import (ของไม่ว่าง)
  // เติมแค่ overlay → หมุดที่ปักจากเครื่องอื่น (อยู่ใน D1 แต่ไม่อยู่ใน overlay) ไม่เข้าเครื่องนี้เลย
  // CustomerDB.load() ดึง /api/customers สดทุกครั้งที่เปิดแอปอยู่แล้ว — เติมลง Storage ต่อโดยไม่ยิงเน็ตเพิ่ม
  // กฎ: เติมเฉพาะ 4 ช่องที่ server เป็นเจ้าของ (branch/zone/lat/lng) ห้ามแตะชื่อ/เบอร์ฝีมือคนแก้
  _backfillFromCentralDB() {
    try {
      if (typeof CustomerDB === "undefined" || !CustomerDB._loaded || !CustomerDB._byCif) return 0;
      if (typeof Storage === "undefined" || !Storage.getCustomers) return 0;
      const list = Storage.getCustomers();
      if (!list.length) return 0;
      const byCif = new Map(list.map((c) => [String(c.cif || "").trim(), c]));
      let n = 0;
      CustomerDB._byCif.forEach((r, key) => {
        var _a, _b, _c, _d;
        if (!r) return;
        const old = byCif.get(String(key || "").trim());
        if (!old) return;
        const nLat = (_a = r.lat) != null ? _a : null, nLng = (_b = r.lng) != null ? _b : null;
        const nAddr = typeof Storage._fullAddress === "function" ? Storage._fullAddress(r) : r.address || "";
        const addrStale = nAddr && old.address !== nAddr && (!old.address || old.address === (r.address || "") || old.address === "-");
        if ((old.branch || "") !== (r.branch || "") || (old.zone || "") !== (r.zone || "") || ((_c = old.lat) != null ? _c : null) !== nLat || ((_d = old.lng) != null ? _d : null) !== nLng || addrStale) {
          old.branch = r.branch || "";
          old.zone = r.zone || "";
          old.lat = nLat;
          old.lng = nLng;
          if (addrStale) old.address = nAddr;
          n++;
        }
      });
      if (n > 0) {
        Storage.saveCustomers(list);
        if (typeof Customers !== "undefined" && Customers.renderAll) Customers.renderAll();
        if (typeof Utils !== "undefined" && Utils.toast) Utils.toast(`\u{1F4CD} \u0E2D\u0E31\u0E1E\u0E40\u0E14\u0E17\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E08\u0E32\u0E01\u0E10\u0E32\u0E19\u0E01\u0E25\u0E32\u0E07 ${n} \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23`);
      }
      return n;
    } catch (e) {
      console.warn("[backfill] failed:", e.message);
      return 0;
    }
  },
  // After login — load data
  async afterLogin() {
    var _a, _b, _c;
    try {
      const me = typeof Auth !== "undefined" && Auth.getUser ? Auth.getUser() : null;
      const myId = me && (me.id || me.username);
      let lastId = null;
      try {
        lastId = localStorage.getItem("bfr_login_id");
      } catch (e) {
      }
      if (myId && !lastId) {
        try {
          localStorage.setItem("bfr_login_id", myId);
        } catch (e) {
        }
      } else if (myId && lastId && lastId !== myId) {
        try {
          await Storage.push();
        } catch (e) {
        }
        try {
          Storage.saveCustomers([]);
          if (typeof CustomerDB !== "undefined") CustomerDB._loaded = false;
          if (typeof DebtDB !== "undefined") DebtDB._loaded = false;
        } catch (e) {
        }
        try {
          localStorage.setItem("bfr_login_id", myId);
        } catch (e) {
        }
        if (typeof Utils !== "undefined" && Utils.toast) Utils.toast("\u{1F504} \u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49 \u2014 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E42\u0E2B\u0E25\u0E14\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E43\u0E2B\u0E21\u0E48");
      }
    } catch (e) {
    }
    Storage.migrateCustomers();
    this._initHeader();
    this.applyFieldBig();
    Customers.initMap();
    Customers.renderAll();
    try {
      const _office = window.OFFICE_LOCATION || { lat: 13.7760801, lng: 101.8907475 };
      if (Customers.map) Customers.map.setView([_office.lat, _office.lng], 13);
    } catch (e) {
    }
    Visit.render();
    Route.attachEvents();
    this.updateRouteUI();
    this.updateAdminUI();
    this.initBottomSheet();
    const _custPromise = Promise.resolve();
    if (typeof CustomerDB !== "undefined" && CustomerDB.ensure) {
      document.addEventListener("customerdb:loaded", () => {
        try {
          this._backfillFromCentralDB();
        } catch (e) {
        }
      }, { once: true });
    }
    if (typeof Storage !== "undefined" && Storage.importFromStaticDB) {
      const _topUp = async () => {
        try {
          const st = await API.get("/api/customers/stats");
          if (!st || !st.success || !st.total_customers) return;
          const have = Storage.getActiveCustomers().length;
          if (have > 0 && have < st.total_customers) {
            const r = await Storage.importFromStaticDB();
            if (r && r.imported > 0) {
              if (typeof Customers !== "undefined" && Customers.renderAll) Customers.renderAll();
              if (typeof Utils !== "undefined" && Utils.toast) Utils.toast(`\u{1F4E5} \u0E40\u0E15\u0E34\u0E21\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E43\u0E2B\u0E49\u0E04\u0E23\u0E1A ${r.imported.toLocaleString()} \u0E23\u0E32\u0E22`);
            }
          }
        } catch (e) {
        }
      };
      if (typeof requestIdleCallback !== "undefined") requestIdleCallback(_topUp, { timeout: 5e3 });
      else setTimeout(_topUp, 3e3);
    }
    const _debtPromise = typeof DebtDB !== "undefined" && DebtDB.load ? DebtDB.load().then(() => {
      if (typeof Customers !== "undefined" && Customers.initDebtFilter) Customers.initDebtFilter();
      if (typeof Customers !== "undefined" && Customers.renderAll) Customers.renderAll();
      if (typeof TodayUI !== "undefined") {
        const _doToday = () => {
          try {
            TodayUI.refresh();
          } catch (e) {
          }
        };
        if (typeof requestIdleCallback !== "undefined") requestIdleCallback(_doToday, { timeout: 1200 });
        else setTimeout(_doToday, 60);
      }
    }).catch(() => {
    }) : Promise.resolve();
    this.renderTodayRoute();
    try {
      this.switchSheetTab("today");
    } catch (e) {
    }
    if (typeof TodayUI !== "undefined") {
      try {
        TodayUI.refreshCollect();
        TodayUI.refreshPromise();
      } catch (e) {
      }
    }
    if (typeof MapSearch !== "undefined") MapSearch.init();
    if (typeof FilterPanel !== "undefined") FilterPanel.init();
    if (Storage.getCustomers().length === 0) {
      try {
        const r = await Storage.importFromStaticDB();
        if (r && r.imported > 0) {
          Customers.renderAll(void 0, { fitBounds: true });
          Utils.toast(`\u{1F4E5} \u0E42\u0E2B\u0E25\u0E14\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32 ${r.imported} \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E08\u0E32\u0E01\u0E10\u0E32\u0E19\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E01\u0E25\u0E32\u0E07 (${r.withGPS} \u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14)`);
        }
      } catch (e) {
        console.warn("[afterLogin] auto-import failed:", e.message);
      }
    } else {
      try {
        const n = await Storage.applyGpsOverlay();
        if (n > 0) {
          Customers.renderAll();
          Utils.toast(`\u{1F4CD} \u0E2D\u0E31\u0E1E\u0E40\u0E14\u0E17\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E08\u0E32\u0E01\u0E40\u0E27\u0E47\u0E1A ${n} \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23`);
        }
      } catch (e) {
        console.warn("[afterLogin] gps-overlay apply failed:", e.message);
      }
    }
    const sync = await Storage.sync();
    if (sync && sync.success) {
      const c = sync.counts || {};
      Utils.toast(`\u2601\uFE0F Sync: ${(_a = c.customers) != null ? _a : 0} \u0E25\u0E39\u0E01\u0E04\u0E49\u0E32, ${(_b = c.visits) != null ? _b : 0} visits, ${(_c = c.savedRoutes) != null ? _c : 0} \u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07`);
      Customers.renderAll();
      this.updateRouteUI();
    } else if (sync && sync.error) {
      Utils.toast("\u26A0\uFE0F Sync \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \u2014 \u0E43\u0E0A\u0E49\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25 local", "warn");
    }
    this._wireSyncEvents();
    Storage.startPolling(2e4);
    if (!this._pollNowBound) {
      this._pollNowBound = true;
      const pollNow = () => {
        if (!document.hidden && navigator.onLine) Storage.pollOnce();
      };
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) pollNow();
      });
      window.addEventListener("focus", pollNow);
      window.addEventListener("online", async () => {
        if (!navigator.onLine) return;
        const pending = Storage.pendingCount();
        if (pending > 0) Utils.toast(`\u{1F4E4} \u0E40\u0E19\u0E47\u0E15\u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32\u0E41\u0E25\u0E49\u0E27 \u2014 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E48\u0E07\u0E07\u0E32\u0E19\u0E04\u0E49\u0E32\u0E07 ${pending} \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23`);
        const res = await Storage.push();
        if (res && res.success) {
          Storage.clearAllDirty();
          if (pending > 0) Utils.toast(`\u2705 \u0E2A\u0E48\u0E07\u0E07\u0E32\u0E19\u0E04\u0E49\u0E32\u0E07\u0E02\u0E36\u0E49\u0E19\u0E40\u0E27\u0E47\u0E1A\u0E41\u0E25\u0E49\u0E27 ${pending} \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23`);
        } else if (res && res.error) {
          Utils.toast("\u26A0\uFE0F \u0E22\u0E31\u0E07\u0E2A\u0E48\u0E07\u0E07\u0E32\u0E19\u0E04\u0E49\u0E32\u0E07\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \u2014 \u0E08\u0E30\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48\u0E40\u0E21\u0E37\u0E48\u0E2D\u0E40\u0E19\u0E47\u0E15\u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32", "error");
        }
        pollNow();
      });
    }
    this.initPwaInstall();
    try {
      if (typeof location !== "undefined" && location.hash === "#debtsummary") {
        this.switchSheetTab("debtsummary");
        if (window.DebtSummary) DebtSummary.render();
      }
    } catch (e) {
    }
  },
  // ===== ป๊อบอัพ "วันนี้ทำอะไร" — โผล่หลัง login (ข้ามได้ถ้าเคยติ๊กจำไว้) =====
  // force=true = เปิดจากเมนู "🏠 เริ่มตรงนี้" (ข้ามธงจำไว้ได้)
  showStartModePopup(force) {
    var _a;
    try {
      if (!force && localStorage.getItem("bfr_start_mode_skip") === "1") return;
      if (document.getElementById("start-mode-overlay")) return;
    } catch (e) {
      return;
    }
    const overlay = document.createElement("div");
    overlay.id = "start-mode-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;";
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:360px;width:100%;padding:24px 20px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.3);">
        <div style="font-size:20px;font-weight:700;margin-bottom:4px;">\u0E27\u0E31\u0E19\u0E19\u0E35\u0E49\u0E17\u0E33\u0E2D\u0E30\u0E44\u0E23?</div>
        <div style="font-size:14px;color:#666;margin-bottom:14px;">\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E41\u0E25\u0E49\u0E27\u0E40\u0E27\u0E47\u0E1A\u0E1E\u0E32\u0E44\u0E1B\u0E2B\u0E19\u0E49\u0E32\u0E19\u0E31\u0E49\u0E19\u0E40\u0E25\u0E22</div>
        <button data-mode="gps" style="display:block;width:100%;margin:8px 0;padding:14px;min-height:56px;border-radius:12px;border:1px solid #ddd;background:#f1f8f1;font-size:18px;cursor:pointer;">\u{1F4CD} \u0E14\u0E39\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32 / \u0E40\u0E01\u0E47\u0E1A\u0E1E\u0E34\u0E01\u0E31\u0E14</button>
        <button data-mode="route" style="display:block;width:100%;margin:8px 0;padding:14px;min-height:56px;border-radius:12px;border:1px solid #ddd;background:#eef4ff;font-size:18px;cursor:pointer;">\u{1F9ED} \u0E2D\u0E2D\u0E01\u0E1E\u0E37\u0E49\u0E19\u0E17\u0E35\u0E48</button>
        <button data-mode="summary" style="display:block;width:100%;margin:8px 0;padding:14px;min-height:56px;border-radius:12px;border:1px solid #ddd;background:#fff8ec;font-size:18px;cursor:pointer;">\u{1F4CA} \u0E14\u0E39\u0E2A\u0E23\u0E38\u0E1B</button>
        <button data-close="1" style="display:block;width:100%;margin:8px 0 0;padding:12px;min-height:50px;border-radius:12px;border:1px solid #ccc;background:#fff;font-size:16px;color:#555;cursor:pointer;">\u0E44\u0E27\u0E49\u0E17\u0E35\u0E2B\u0E25\u0E31\u0E07 \u2715</button>
        <label style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;font-size:14px;color:#666;cursor:pointer;min-height:44px;">
          <input type="checkbox" id="start-mode-remember" style="width:22px;height:22px;"> \u0E08\u0E33\u0E44\u0E27\u0E49 \u0E44\u0E21\u0E48\u0E16\u0E32\u0E21\u0E2D\u0E35\u0E01 (\u0E40\u0E23\u0E35\u0E22\u0E01\u0E01\u0E25\u0E31\u0E1A: \u22EF \u2192 \u{1F3E0} \u0E40\u0E23\u0E34\u0E48\u0E21\u0E15\u0E23\u0E07\u0E19\u0E35\u0E49)
        </label>
      </div>`;
    const close = (mode) => {
      var _a2;
      try {
        if (((_a2 = overlay.querySelector("#start-mode-remember")) == null ? void 0 : _a2.checked) && mode) {
          localStorage.setItem("bfr_start_mode_skip", "1");
          localStorage.setItem("bfr_start_mode", mode);
        }
      } catch (e) {
      }
      overlay.remove();
      if (mode === "gps") this.switchTab("customers");
      else if (mode === "route") this.switchSheetTab("planvisit");
      else if (mode === "summary") this.switchSheetTab("debtsummary");
    };
    overlay.querySelectorAll("button[data-mode]").forEach((b) => {
      b.addEventListener("click", () => close(b.dataset.mode));
    });
    (_a = overlay.querySelector("button[data-close]")) == null ? void 0 : _a.addEventListener("click", () => close(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  },
  // ===== B (17 ต.ค.69): โหมดตัวใหญ่สำหรับหน้างาน — สลับ class ที่ body + จำค่าในเครื่อง =====
  isFieldBig() {
    try {
      return localStorage.getItem("bfr_field_big") === "1";
    } catch (e) {
      return false;
    }
  },
  applyFieldBig() {
    const on = this.isFieldBig();
    try {
      document.body.classList.toggle("field-big", on);
    } catch (e) {
    }
    const s = document.getElementById("field-big-state");
    if (s) s.textContent = on ? "\u0E40\u0E1B\u0E34\u0E14" : "\u0E1B\u0E34\u0E14";
  },
  toggleFieldBig() {
    try {
      localStorage.setItem("bfr_field_big", this.isFieldBig() ? "0" : "1");
    } catch (e) {
    }
    this.applyFieldBig();
  },
  // ===== ติดตั้งลงหน้าจอ PWA (17 ต.ค.69 — พ่อสั่ง: เปิดเว็บแล้วชวนลงหน้าจอ) =====
  _pwaEvent: null,
  initPwaInstall() {
    if (this._pwaSnoozed()) return;
    window.addEventListener("beforeinstallprompt", (e) => {
      try {
        e.preventDefault();
      } catch (e2) {
      }
      this._pwaEvent = e;
      this.showPwaBanner(false);
    });
    window.addEventListener("appinstalled", () => this._pwaHide(true));
    try {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
      const standalone = navigator.standalone === true || window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
      if (ios && !standalone) this.showPwaBanner(true);
    } catch (e) {
    }
  },
  _pwaSnoozed() {
    try {
      return Date.now() < (+localStorage.getItem("bfr_pwa_snooze") || 0);
    } catch (e) {
      return false;
    }
  },
  _pwaSnooze(days) {
    try {
      localStorage.setItem("bfr_pwa_snooze", String(Date.now() + days * 864e5));
    } catch (e) {
    }
  },
  showPwaBanner(isIOS) {
    if (document.getElementById("pwa-install-banner")) return;
    if (this._pwaSnoozed()) return;
    const bar = document.createElement("div");
    bar.id = "pwa-install-banner";
    bar.style.cssText = "position:fixed;top:64px;left:12px;right:12px;max-width:420px;margin:0 auto;background:#fff;border:2px solid #0a8f3c;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,0.25);z-index:9000;padding:14px 14px 12px;";
    const howto = isIOS ? "\u0E41\u0E15\u0E30\u0E1B\u0E38\u0E48\u0E21 <b>\u0E41\u0E0A\u0E23\u0E4C</b> \u0E02\u0E2D\u0E07 Safari \u0E41\u0E25\u0E49\u0E27\u0E40\u0E25\u0E37\u0E2D\u0E01 <b>\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E44\u0E1B\u0E17\u0E35\u0E48\u0E2B\u0E19\u0E49\u0E32\u0E08\u0E2D\u0E42\u0E2E\u0E21</b>" : "\u0E01\u0E14\u0E1B\u0E38\u0E48\u0E21\u0E14\u0E49\u0E32\u0E19\u0E25\u0E48\u0E32\u0E07\u0E04\u0E23\u0E31\u0E49\u0E07\u0E40\u0E14\u0E35\u0E22\u0E27 \u0E40\u0E1B\u0E34\u0E14\u0E04\u0E23\u0E31\u0E49\u0E07\u0E2B\u0E19\u0E49\u0E32\u0E41\u0E15\u0E30\u0E44\u0E2D\u0E04\u0E2D\u0E19\u0E44\u0E14\u0E49\u0E40\u0E25\u0E22 \u0E44\u0E21\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E1E\u0E34\u0E21\u0E1E\u0E4C\u0E40\u0E27\u0E47\u0E1A";
    bar.innerHTML = '<div style="display:flex;gap:10px;align-items:center;"><div style="font-size:28px;">\u{1F4CC}</div><div style="flex:1;min-width:0;"><div style="font-size:16px;font-weight:700;">\u0E15\u0E34\u0E14\u0E15\u0E31\u0E49\u0E07\u0E41\u0E2D\u0E1B\u0E25\u0E07\u0E2B\u0E19\u0E49\u0E32\u0E08\u0E2D</div><div style="font-size:13px;color:#444;">' + howto + '</div></div><button id="pwa-banner-close" style="min-width:44px;min-height:44px;border:none;background:none;font-size:20px;cursor:pointer;" aria-label="\u0E1B\u0E34\u0E14">\u2715</button></div>' + (isIOS ? '<button id="pwa-banner-ok" style="display:block;width:100%;margin-top:10px;padding:12px;min-height:52px;border-radius:12px;border:none;background:#0a8f3c;color:#fff;font-size:17px;font-weight:700;cursor:pointer;">\u0E40\u0E02\u0E49\u0E32\u0E43\u0E08\u0E41\u0E25\u0E49\u0E27</button>' : '<button id="pwa-banner-install" style="display:block;width:100%;margin-top:10px;padding:12px;min-height:52px;border-radius:12px;border:none;background:#0a8f3c;color:#fff;font-size:17px;font-weight:700;cursor:pointer;">\u{1F4CC} \u0E15\u0E34\u0E14\u0E15\u0E31\u0E49\u0E07\u0E40\u0E25\u0E22</button>');
    document.body.appendChild(bar);
    const close = (days) => {
      this._pwaSnooze(days);
      bar.remove();
    };
    const c = document.getElementById("pwa-banner-close");
    if (c) c.addEventListener("click", () => close(7));
    const ok = document.getElementById("pwa-banner-ok");
    if (ok) ok.addEventListener("click", () => close(7));
    const go = document.getElementById("pwa-banner-install");
    if (go) go.addEventListener("click", async () => {
      try {
        if (this._pwaEvent && this._pwaEvent.prompt) {
          await this._pwaEvent.prompt();
          const ch = this._pwaEvent.userChoice ? await this._pwaEvent.userChoice : null;
          this._pwaEvent = null;
          close(ch && ch.outcome === "accepted" ? 30 : 7);
          return;
        }
      } catch (e) {
      }
      close(7);
    });
  },
  _pwaHide(forever) {
    const bar = document.getElementById("pwa-install-banner");
    if (bar) bar.remove();
    this._pwaEvent = null;
    this._pwaSnooze(forever ? 30 : 7);
  },
  // Listen for sync events to update UI badge
  _wireSyncEvents() {
    this._unsubSync = Storage.onSyncEvent((evt) => {
      this._updateSyncBadge(evt);
      if (evt.status === "synced" && evt.counts) {
        Customers.renderAll();
        if (typeof Visit !== "undefined") Visit.render();
        this.updateRouteUI();
      }
    });
  },
  // ให้ส่วนอื่นสั่งสถานะบนจอได้ (saving = กำลังบันทึก, saved = เสร็จแล้ว, error)
  // ใช้ป้ายลอยมุมขวาล่างตัวเดียวกับ sync badge
  setSaveStatus(state) {
    try {
      if (state === "saving") this._updateSyncBadge({ status: "saving" });
      else if (state === "saved") this._updateSyncBadge({ status: "saved" });
      else this._updateSyncBadge({ status: "error", error: "save-failed" });
    } catch (e) {
    }
  },
  _updateSyncBadge(evt) {
    var _a, _b;
    let badge = document.getElementById("sync-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "sync-badge";
      badge.style.cssText = "position:fixed;bottom:8px;right:8px;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600;z-index:9999;background:#4caf50;color:white;box-shadow:0 2px 6px rgba(0,0,0,0.2);transition:opacity 0.3s;cursor:pointer;";
      badge.title = "\u0E01\u0E14\u0E40\u0E1E\u0E37\u0E48\u0E2D retry sync";
      badge.addEventListener("click", () => Storage.retrySync());
      document.body.appendChild(badge);
    }
    badge.style.display = "";
    if (evt.status === "saving") {
      badge.textContent = "\u23F3 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E1E\u0E34\u0E01\u0E31\u0E14...";
      badge.style.background = "#ff9800";
      badge.style.cursor = "wait";
    } else if (evt.status === "saved") {
      badge.textContent = "\u2705 \u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E41\u0E25\u0E49\u0E27";
      badge.style.background = "#4caf50";
      badge.style.cursor = "pointer";
      clearTimeout(this._badgeHideTimer);
      this._badgeHideTimer = setTimeout(() => {
        const b = document.getElementById("sync-badge");
        if (b && b.textContent.indexOf("\u2705 \u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E1E\u0E34\u0E01\u0E31\u0E14") === 0) b.style.display = "none";
      }, 5e3);
    } else if (evt.status === "syncing") {
      badge.textContent = evt.action === "retry" ? "\u{1F504} \u0E01\u0E33\u0E25\u0E31\u0E07 sync \u0E43\u0E2B\u0E21\u0E48..." : "\u{1F504} Syncing...";
      badge.style.background = "#ff9800";
      badge.style.cursor = "wait";
    } else if (evt.status === "synced" && evt.counts) {
      const c = evt.counts;
      badge.textContent = `\u2601\uFE0F Sync: ${(_a = c.customers) != null ? _a : 0} \u0E04\u0E19, ${(_b = c.visits) != null ? _b : 0} visits`;
      badge.style.background = "#4caf50";
      badge.style.cursor = "pointer";
    } else if (evt.status === "error") {
      badge.textContent = "\u26A0\uFE0F Sync \u0E25\u0E49\u0E21\u0E40\u0E2B\u0E25\u0E27 \u2014 \u0E01\u0E14\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48";
      badge.style.background = "#f44336";
      badge.style.cursor = "pointer";
    }
  },
  // Called by Storage when remote data changes — re-render
  _onRemoteUpdate(remote) {
    Customers.renderAll();
    if (typeof Visit !== "undefined") Visit.render();
    this.updateRouteUI();
  },
  // Attach all event handlers (null-safe — missing elements won't crash the rest)
  attachEvents() {
    const $ = (id) => document.getElementById(id);
    const on = (id, evt, fn) => {
      const el = $(id);
      if (el) el.addEventListener(evt, fn);
    };
    on("pin-form", "submit", async (e) => {
      e.preventDefault();
      const pin = document.getElementById("pin-input").value;
      const username = (document.getElementById("pin-username") || {}).value || "";
      const errEl = document.getElementById("pin-error");
      errEl.textContent = "";
      const btn = document.getElementById("pin-btn");
      setLoginLoading(btn, true);
      const ok = username ? await Auth.loginStaff(username, pin) : await Auth.loginPIN(pin);
      if (ok) {
        await this.afterLogin();
      } else {
        errEl.textContent = username ? "\u0E0A\u0E37\u0E48\u0E2D\u0E2B\u0E23\u0E37\u0E2D PIN \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07" : "PIN \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07";
      }
      setLoginLoading(btn, false);
      btn.textContent = "\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A (PIN)";
    });
    on("logout-btn", "click", () => {
      if (confirm("\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E23\u0E30\u0E1A\u0E1A?")) Auth.logout();
    });
    on("start-mode-btn", "click", () => this.showStartModePopup(true));
    on("field-big-btn", "click", () => this.toggleFieldBig());
    on("admin-users-btn", "click", () => this.openAdminUsers());
    on("export-users-btn", "click", () => this.exportUsersCSV());
    on("close-staff-pin", "click", () => {
      const m = document.getElementById("staff-pin-modal");
      if (m) m.classList.add("hidden");
    });
    on("staff-pin-modal", "click", (e) => {
      if (e.target.id === "staff-pin-modal") e.target.classList.add("hidden");
    });
    on("staff-pin-form", "submit", (e) => {
      e.preventDefault();
      this.submitStaffPin();
    });
    on("admin-data-btn", "click", () => {
      window.location.href = "/admin.html";
    });
    document.querySelectorAll(".sheet-tab").forEach((t) => {
      t.addEventListener("click", () => {
        this.switchSheetTab(t.dataset.sheet);
        if (window.matchMedia("(min-width: 768px)").matches) this.setSheetState("full");
      });
    });
    const customerSearch = document.getElementById("customer-search");
    if (customerSearch) {
      customerSearch.addEventListener("input", Utils.debounce(() => Customers.renderList(), 150));
    }
    const customerSort = document.getElementById("customer-sort");
    if (customerSort) {
      customerSort.addEventListener("change", () => Customers.renderList());
    }
    const customerZone = document.getElementById("customer-zone");
    if (customerZone) {
      customerZone.addEventListener("change", () => Customers.renderList());
    }
    on("fab-add-customer", "click", () => this.openAddCustomerModal());
    on("fab-my-location", "click", () => this.useGPS());
    on("fab-zoom-in", "click", () => Customers.map && Customers.map.zoomIn());
    on("fab-zoom-out", "click", () => Customers.map && Customers.map.zoomOut());
    on("close-add-modal", "click", () => this.closeAddCustomerModal());
    on("add-customer-modal", "click", (e) => {
      if (e.target.id === "add-customer-modal") this.closeAddCustomerModal();
    });
    on("btn-use-gps", "click", () => this.useGPS(true));
    on("btn-pick-on-main-map", "click", () => this.pickOnMainMap());
    on("add-customer-form", "submit", (e) => {
      e.preventDefault();
      this.saveCustomer(e.target);
    });
    const photoInput = document.getElementById("photo-input");
    if (photoInput) {
      photoInput.addEventListener("change", (e) => this.handlePhotoUpload(e.target.files[0]));
    }
    this._initDBSearch();
    on("close-visit-modal", "click", () => Visit.closeLog());
    on("btn-cancel-visit", "click", () => Visit.closeLog());
    on("visit-log-form", "submit", (e) => {
      e.preventDefault();
      Visit.submit(e.target);
    });
    on("visit-log-modal", "click", (e) => {
      if (e.target.id === "visit-log-modal") Visit.closeLog();
    });
    on("btn-capture-gps", "click", () => Visit.captureGPS());
    on("route-start-mode", "change", (e) => {
      const cs = document.getElementById("custom-start");
      if (cs) cs.classList.toggle("hidden", e.target.value !== "custom");
    });
    on("btn-calculate-route", "click", () => this.calculateRoute());
    on("btn-open-gmaps", "click", () => Route.openGoogleMaps());
    on("btn-save-route", "click", () => Route.saveRoute());
    on("report-btn", "click", () => Report.open());
    on("help-btn", "click", () => App.openHelp());
    on("close-help-modal", "click", () => App.closeHelp());
    on("btn-close-help", "click", () => App.closeHelp());
    on("close-report-modal", "click", () => Report.close());
    on("report-modal", "click", (e) => {
      if (e.target.id === "report-modal") Report.close();
    });
    on("report-range", "change", () => {
      const rr = document.getElementById("report-range");
      if (rr) Report.setRange(rr.value);
    });
    on("btn-generate-report", "click", () => Report.generate());
    on("btn-export-html", "click", () => Report.exportHTML());
    on("btn-export-pdf", "click", () => Report.exportPDF());
    on("btn-export-csv", "click", () => Report.exportCSV());
    on("btn-export-share", "click", () => Report.shareText());
  },
  // ===== Bottom Sheet (Map-as-Canvas) =====
  // Init sheet interaction (drag + click handle)
  initBottomSheet() {
    const sheet = document.getElementById("bottom-sheet");
    if (!sheet) return;
    if (sheet.dataset.sheetBound === "1") return;
    sheet.dataset.sheetBound = "1";
    document.getElementById("sheet-handle").addEventListener("click", (e) => {
      e.stopPropagation();
      const isWide = window.matchMedia("(min-width: 768px)").matches;
      if (isWide) {
        this.setSheetState(sheet.classList.contains("sheet-full") ? "peek" : "full");
        return;
      }
      if (sheet.classList.contains("sheet-half") || sheet.classList.contains("sheet-full")) {
        this.setSheetState("peek");
      } else {
        this.setSheetState("half");
      }
    });
    let startY = 0, startTranslate = 0, isDragging = false;
    const handle = document.getElementById("sheet-handle");
    const _readTransform = (el) => {
      const m = window.getComputedStyle(el).transform;
      if (!m || m === "none") return 0;
      try {
        return new DOMMatrixReadOnly(m).m42 || 0;
      } catch (e) {
        return 0;
      }
    };
    const onStart = (e) => {
      if (!e.target.closest(".sheet-handle")) return;
      isDragging = true;
      startY = e.type === "touchstart" ? e.touches[0].clientY : e.clientY;
      startTranslate = _readTransform(sheet);
      sheet.style.transition = "none";
      sheet.style.transform = `translateY(${startTranslate}px)`;
      ["sheet-collapsed", "sheet-peek", "sheet-half", "sheet-full"].forEach((c) => sheet.classList.remove(c));
    };
    const onMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const y = e.type === "touchmove" ? e.touches[0].clientY : e.clientY;
      const dy = y - startY;
      const newT = Math.max(0, startTranslate + dy);
      sheet.style.transform = `translateY(${newT}px)`;
    };
    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      sheet.style.transition = "";
      const t = _readTransform(sheet);
      sheet.style.transform = "";
      const sheetH = sheet.offsetHeight;
      const pct = t / sheetH;
      if (pct < 0.15) this.setSheetState("full");
      else if (pct < 0.55) this.setSheetState("half");
      else if (pct < 0.85) this.setSheetState("peek");
      else this.setSheetState("collapsed");
    };
    handle.addEventListener("touchstart", onStart, { passive: true });
    handle.addEventListener("touchmove", onMove, { passive: false });
    handle.addEventListener("touchend", onEnd);
    handle.addEventListener("mousedown", onStart);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
  },
  // Set bottom sheet state
  setSheetState(state) {
    const sheet = document.getElementById("bottom-sheet");
    if (!sheet) return;
    ["sheet-collapsed", "sheet-peek", "sheet-half", "sheet-full"].forEach((c) => sheet.classList.remove(c));
    if (state && state !== "default") sheet.classList.add("sheet-" + state);
    if ((state === "half" || state === "full") && typeof FilterPanel !== "undefined" && FilterPanel.collapse) {
      FilterPanel.collapse();
    }
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  },
  // Legacy switchTab — adapts to new map-as-canvas layout
  switchTab(name) {
    if (name === "map") {
      this.setSheetState("peek");
      this.switchSheetTab("today");
      setTimeout(() => Customers.map && Customers.map.invalidateSize(), 50);
      return;
    }
    const sheetNames = { customers: "customers", route: "today", visit: "planvisit", plan: "planvisit", planvisit: "planvisit", today: "today" };
    this.switchSheetTab(sheetNames[name] || name);
    this.setSheetState("half");
  },
  // Switch bottom sheet content tab
  switchSheetTab(name) {
    document.querySelectorAll(".sheet-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".sheet-content").forEach((p) => p.classList.remove("active"));
    const tab = document.querySelector(`.sheet-tab[data-sheet="${name}"]`);
    if (tab) tab.classList.add("active");
    const idMap = { today: "sheet-today", route: "sheet-today", plan: "tab-planvisit", planvisit: "tab-planvisit", visit: "tab-planvisit", customers: "tab-customers", calendar: "sheet-calendar", debtsummary: "sheet-debtsummary" };
    const pane = document.getElementById(idMap[name] || "sheet-today");
    if (pane) pane.classList.add("active");
    if (name !== "today" && name !== "route") this.setSheetState("half");
    if ((name === "visit" || name === "plan" || name === "planvisit") && typeof Visit !== "undefined") Visit.render();
    if (name === "today" && typeof TodayUI !== "undefined") TodayUI.refresh();
    if (name === "calendar" && typeof WorkCalendar !== "undefined") WorkCalendar.render();
    if (name === "customers" && typeof Customers !== "undefined") Customers.renderList();
    if (name === "debtsummary" && typeof DebtDB !== "undefined" && DebtDB._loaded && window.DebtSummary) {
      DebtSummary.render();
    }
  },
  // Render today's visits in the route pane
  renderTodayRoute() {
    const container = document.getElementById("today-visits");
    if (!container) return;
    const customers = Storage.getActiveCustomers();
    const routeIds = Storage.getRoute();
    const routeCusts = routeIds.map((id) => customers.find((c) => c.id === id)).filter(Boolean);
    if (!routeCusts.length) {
      container.innerHTML = '<p class="empty-state">\u0E44\u0E21\u0E48\u0E21\u0E35\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07\u0E27\u0E31\u0E19\u0E19\u0E35\u0E49 \u2014 \u0E44\u0E1B\u0E17\u0E35\u0E48 <strong>\u0E27\u0E32\u0E07\u0E41\u0E1C\u0E19/\u0E40\u0E02\u0E49\u0E32\u0E1E\u0E1A</strong> \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07</p>';
      this._updateRouteProgress(null);
      return;
    }
    const result = Route.currentResult;
    let ordered = routeCusts;
    if (result && result.stops && result.stops.length > 0) {
      ordered = result.stops;
    }
    const visits = Storage.getVisits();
    const visitedCifs = new Set(Object.keys(visits));
    const pending = ordered.filter((c) => !visitedCifs.has(c.cif || c.id));
    let html = '<div class="visits-list">';
    ordered.forEach((c, i) => html += this._visitCard(c, i + 1));
    html += "</div>";
    container.innerHTML = html;
    container.querySelectorAll(".visit-card").forEach((card) => {
      card.addEventListener("click", () => {
        const cif = card.dataset.cif;
        const id = card.dataset.id;
        if (window.Visit && typeof Visit.openLog === "function") {
          Visit.openLog(id || cif);
        }
      });
    });
    const done = ordered.length - pending.length;
    if (result && result.distance) {
      document.getElementById("route-progress").textContent = `${done}/${ordered.length} \xB7 ${Utils.formatKm(result.distance)}`;
    } else {
      document.getElementById("route-progress").textContent = `${done}/${ordered.length} \u2705`;
    }
  },
  // Render a single visit card (used by renderTodayRoute)
  _visitCard(c, order) {
    const name = c.name || c.customerName || "\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38\u0E0A\u0E37\u0E48\u0E2D";
    const branch = c.branch || "";
    const visits = Storage.getVisits();
    const visited = visits[c.cif || c.id];
    const debtType = c.debtType || "";
    let badge = "";
    if (visited) {
      badge = '<span class="visit-badge" style="background:#d1fae5;color:#065f46">\u2705 \u0E40\u0E22\u0E35\u0E48\u0E22\u0E21\u0E41\u0E25\u0E49\u0E27</span>';
    } else if (debtType === "overdue") {
      badge = '<span class="visit-badge badge-overdue">\u26A0\uFE0F \u0E04\u0E49\u0E32\u0E07</span>';
    } else if (debtType === "current") {
      badge = '<span class="visit-badge badge-current">\u{1F4C5} \u0E16\u0E36\u0E07\u0E01\u0E33\u0E2B\u0E19\u0E14</span>';
    }
    const lat = c.lat || c.latitude || "";
    const lng = c.lng || c.longitude || "";
    const dist = lat && lng ? "" : "";
    return `<div class="visit-card" data-cif="${this.escapeHTML(c.cif || "")}" data-id="${this.escapeHTML(c.id || "")}">
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
    const el = document.getElementById("route-progress");
    if (!el) return;
    if (!stats) {
      el.textContent = "";
      return;
    }
    el.textContent = `${stats.completed || 0}/${stats.total} \u2705`;
  },
  // Open add customer modal
  openAddCustomerModal() {
    document.getElementById("add-customer-modal").classList.remove("hidden");
    document.getElementById("add-modal-title").textContent = "\u2795 \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E43\u0E2B\u0E21\u0E48";
    const form = document.getElementById("add-customer-form");
    const latKeep = document.getElementById("new-lat").value;
    const lngKeep = document.getElementById("new-lng").value;
    form.dataset.editId = "";
    form.reset();
    if (latKeep && lngKeep) {
      document.getElementById("new-lat").value = latKeep;
      document.getElementById("new-lng").value = lngKeep;
    }
    this._resetPhotoPreview();
    const dbInput = document.getElementById("db-search-input");
    const dbResults = document.getElementById("db-search-results");
    const dbInfo = document.getElementById("db-filled-info");
    if (dbInput) dbInput.value = "";
    if (dbResults) {
      dbResults.innerHTML = "";
      dbResults.classList.remove("active");
    }
    if (dbInfo) {
      dbInfo.innerHTML = "";
      dbInfo.classList.remove("active");
    }
    this._renderAddGpsDisplay();
    if (latKeep && lngKeep) {
      const la = parseFloat(latKeep), ln = parseFloat(lngKeep);
      setTimeout(() => this.initMiniMap(isNaN(la) ? void 0 : la, isNaN(ln) ? void 0 : ln), 100);
    } else {
      setTimeout(() => this.initMiniMap(), 100);
    }
  },
  // ===== Photo upload (capture/file → resize → base64) =====
  _resetPhotoPreview() {
    const preview = document.getElementById("photo-preview");
    const dataInput = document.getElementById("photo-data");
    const removeBtn = document.getElementById("btn-remove-photo");
    if (preview) preview.innerHTML = '<div class="photo-empty">\u{1F4F7} \u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E23\u0E39\u0E1B \u2014 \u0E41\u0E15\u0E30\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E40\u0E25\u0E37\u0E2D\u0E01/\u0E16\u0E48\u0E32\u0E22</div>';
    if (dataInput) dataInput.value = "";
    if (removeBtn) removeBtn.classList.add("hidden");
  },
  _showPhotoPreview(dataUrl) {
    const preview = document.getElementById("photo-preview");
    const dataInput = document.getElementById("photo-data");
    const removeBtn = document.getElementById("btn-remove-photo");
    if (preview) {
      preview.innerHTML = `<img src="${dataUrl}" alt="customer photo" class="photo-img">`;
    }
    if (dataInput) dataInput.value = dataUrl;
    if (removeBtn) removeBtn.classList.remove("hidden");
    const details = document.querySelector("#add-customer-modal .photo-details");
    if (details) details.open = true;
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
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
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
    if (!file.type.startsWith("image/")) {
      Utils.toast("\u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E1F\u0E25\u0E4C\u0E23\u0E39\u0E1B\u0E20\u0E32\u0E1E", "error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      Utils.toast("\u0E23\u0E39\u0E1B\u0E43\u0E2B\u0E0D\u0E48\u0E40\u0E01\u0E34\u0E19 10MB \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E23\u0E39\u0E1B\u0E2D\u0E37\u0E48\u0E19", "error");
      return;
    }
    Utils.toast("\u{1F4F7} \u0E01\u0E33\u0E25\u0E31\u0E07\u0E22\u0E48\u0E2D\u0E23\u0E39\u0E1B...");
    try {
      const dataUrl = await this._resizeImage(file, 800, 0.7);
      const sizeKB = Math.round(dataUrl.length * 0.75 / 1024);
      this._showPhotoPreview(dataUrl);
      Utils.toast(`\u2705 \u0E22\u0E48\u0E2D\u0E23\u0E39\u0E1B\u0E40\u0E2A\u0E23\u0E47\u0E08 (~${sizeKB} KB)`);
    } catch (err) {
      Utils.toast("\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E1B\u0E23\u0E30\u0E21\u0E27\u0E25\u0E1C\u0E25\u0E23\u0E39\u0E1B\u0E44\u0E14\u0E49: " + err.message, "error");
    }
  },
  removePhoto() {
    this._resetPhotoPreview();
    const fileInput = document.getElementById("photo-input");
    if (fileInput) fileInput.value = "";
    Utils.toast("\u{1F5D1}\uFE0F \u0E25\u0E1A\u0E23\u0E39\u0E1B\u0E41\u0E25\u0E49\u0E27");
  },
  // ===== Help modal — explain how to use the app =====
  openHelp() {
    document.getElementById("help-modal").classList.remove("hidden");
  },
  closeHelp() {
    document.getElementById("help-modal").classList.add("hidden");
  },
  // ===== Customer DB Search (auto-fill from imported data) =====
  _initDBSearch() {
    const input = document.getElementById("db-search-input");
    const results = document.getElementById("db-search-results");
    if (!input || !results) return;
    let debounceTimer = null;
    let highlightIdx = -1;
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const q = input.value.trim();
        if (q.length < 2) {
          results.classList.remove("active");
          results.innerHTML = "";
          return;
        }
        if (typeof CustomerDB !== "undefined" && !CustomerDB._loaded) {
          results.innerHTML = '<div class="db-search-hint">\u23F3 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E42\u0E2B\u0E25\u0E14\u0E10\u0E32\u0E19\u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D...</div>';
          results.classList.add("active");
          CustomerDB.ensure().then(() => {
            try {
              input.dispatchEvent(new Event("input"));
            } catch (e) {
            }
          });
          return;
        }
        const matches = CustomerDB.search(q, 15);
        if (matches.length === 0) {
          results.innerHTML = '<div class="db-search-hint">\u274C \u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25</div>';
          results.classList.add("active");
          return;
        }
        highlightIdx = -1;
        results.innerHTML = matches.map((r, i) => `
          <div class="db-search-item" data-idx="${i}" data-cif="${r.cif}">
            <div class="db-name">${this._esc(r.name)}</div>
            <div class="db-meta">
              <span>CIF: ${r.cif}</span>
              ${r.customer_class ? `<span class="badge badge-blue">${r.customer_class}</span>` : ""}
              ${r.potential ? `<span class="badge ${r.potential === "\u0E41\u0E14\u0E07" ? "badge-red" : r.potential === "\u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E07" ? "badge-yellow" : "badge-green"}">${r.potential}</span>` : ""}
              ${r.zone ? `<span class="badge badge-gray">\u0E40\u0E02\u0E15 ${r.zone}</span>` : ""}
              ${r.tambon ? `<span>${r.tambon}</span>` : ""}
              ${r.lat ? `<span class="badge badge-green">\u{1F4CD}</span>` : ""}
            </div>
          </div>
        `).join("");
        results.classList.add("active");
        results.querySelectorAll(".db-search-item").forEach((el) => {
          el.addEventListener("click", () => {
            const cif = el.dataset.cif;
            const rec = CustomerDB.getByCif(cif);
            if (rec) this._fillFromDB(rec);
          });
        });
      }, 200);
    });
    input.addEventListener("keydown", (e) => {
      var _a, _b, _c;
      const items = results.querySelectorAll(".db-search-item");
      if (!items.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlightIdx = Math.min(highlightIdx + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle("highlighted", i === highlightIdx));
        (_a = items[highlightIdx]) == null ? void 0 : _a.scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlightIdx = Math.max(highlightIdx - 1, 0);
        items.forEach((el, i) => el.classList.toggle("highlighted", i === highlightIdx));
        (_b = items[highlightIdx]) == null ? void 0 : _b.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && highlightIdx >= 0) {
        e.preventDefault();
        const cif = (_c = items[highlightIdx]) == null ? void 0 : _c.dataset.cif;
        const rec = cif && CustomerDB.getByCif(cif);
        if (rec) this._fillFromDB(rec);
      } else if (e.key === "Escape") {
        results.classList.remove("active");
      }
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".db-search-container")) {
        results.classList.remove("active");
      }
    });
  },
  _fillFromDB(rec) {
    const results = document.getElementById("db-search-results");
    if (results) {
      results.classList.remove("active");
      results.innerHTML = "";
    }
    const searchInput = document.getElementById("db-search-input");
    if (searchInput) {
      searchInput.value = `${rec.name} (CIF: ${rec.cif})`;
    }
    const form = document.getElementById("add-customer-form");
    if (!form) return;
    try {
      if (rec.cif) form.elements.cif.value = rec.cif;
      if (rec.name) form.elements.name.value = rec.name;
      if (rec.phone) form.elements.phone.value = rec.phone.replace(/\s/g, "");
      const addr = CustomerDB.fullAddress(rec);
      if (addr) form.elements.address.value = addr;
      if (rec.lat && rec.lng) {
        document.getElementById("new-lat").value = rec.lat;
        document.getElementById("new-lng").value = rec.lng;
        this._renderAddGpsDisplay();
        setTimeout(() => this.initMiniMap(rec.lat, rec.lng), 150);
      }
    } catch (e) {
      console.warn("[App] _fillFromDB field-fill error:", e);
    }
    const info = document.getElementById("db-filled-info");
    if (info) {
      const badges = [];
      if (rec.zone) badges.push(`\u0E40\u0E02\u0E15 ${rec.zone}`);
      if (rec.customer_class) badges.push(`\u0E0A\u0E31\u0E49\u0E19 ${rec.customer_class}`);
      if (rec.potential) badges.push(`\u0E28\u0E31\u0E01\u0E22\u0E20\u0E32\u0E1E ${rec.potential}`);
      if (rec.dob) badges.push(`\u0E40\u0E01\u0E34\u0E14 ${rec.dob}`);
      if (rec.lat) badges.push(`\u{1F4CD} \u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E41\u0E25\u0E49\u0E27`);
      info.innerHTML = `\u2705 <strong>${this._esc(rec.name)}</strong> \xB7 CIF ${rec.cif}${badges.length ? " \xB7 " + badges.join(" \xB7 ") : ""}`;
      info.classList.add("active");
    }
    Utils.toast("\u{1F4CB} \u0E01\u0E23\u0E2D\u0E01\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34\u0E08\u0E32\u0E01\u0E10\u0E32\u0E19\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E41\u0E25\u0E49\u0E27" + (rec.lat ? " (\u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14 \u{1F4CD})" : ""));
  },
  _esc(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  },
  // ===== Confirm Delete (custom modal with customer details) =====
  confirmDelete(customer) {
    return new Promise((resolve) => {
      const modal = document.getElementById("confirm-delete-modal");
      const nameEl = document.getElementById("confirm-del-name");
      const detailsEl = document.getElementById("confirm-del-details");
      const photoEl = document.getElementById("confirm-del-photo");
      const btnYes = document.getElementById("btn-confirm-del-yes");
      const btnNo = document.getElementById("btn-confirm-del-no");
      const btnX = document.getElementById("close-confirm-del");
      nameEl.textContent = customer.name || "(\u0E44\u0E21\u0E48\u0E21\u0E35\u0E0A\u0E37\u0E48\u0E2D)";
      const details = [];
      if (customer.cif) details.push("CIF: " + customer.cif);
      if (customer.phone) details.push("\u{1F4DE} " + customer.phone);
      if (customer.nickname) details.push("\u{1F3F7}\uFE0F " + customer.nickname);
      detailsEl.textContent = details.length ? details.join(" \xB7 ") : "\u2014";
      if (customer.photo) {
        photoEl.innerHTML = `<img src="${customer.photo}" alt="photo" class="confirm-del-photo-img">`;
        photoEl.style.display = "block";
      } else {
        photoEl.innerHTML = "";
        photoEl.style.display = "none";
      }
      modal.classList.remove("hidden");
      const cleanup = (result) => {
        modal.classList.add("hidden");
        btnYes.removeEventListener("click", yesHandler);
        btnNo.removeEventListener("click", noHandler);
        btnX.removeEventListener("click", noHandler);
        modal.removeEventListener("click", backdropHandler);
        resolve(result);
      };
      const yesHandler = () => cleanup(true);
      const noHandler = () => cleanup(false);
      const backdropHandler = (e) => {
        if (e.target.id === "confirm-delete-modal") cleanup(false);
      };
      btnYes.addEventListener("click", yesHandler);
      btnNo.addEventListener("click", noHandler);
      btnX.addEventListener("click", noHandler);
      modal.addEventListener("click", backdropHandler);
    });
  },
  // Init mini-map in add customer modal
  initMiniMap(prefillLat, prefillLng) {
    const container = document.getElementById("mini-map");
    if (!container) return;
    if (this._miniMap) {
      this._miniMap.remove();
      this._miniMap = null;
      this._miniMarker = null;
    }
    const lat = prefillLat != null ? prefillLat : OFFICE_LOCATION.lat;
    const lng = prefillLng != null ? prefillLng : OFFICE_LOCATION.lng;
    this._miniMap = L.map("mini-map", {
      zoomControl: true,
      // Mobile fix: explicit touch gestures
      tap: true,
      bounceAtZoomLimits: false,
      // iOS Safari sometimes needs this
      worldCopyJump: false,
      // Use CSS-driven sizing (important for invalidateSize)
      preferCanvas: false
    }).setView([lat, lng], 14);
    this._miniBaseLayers = {
      roadmap: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "\xA9 OSM",
        maxZoom: 19
      }),
      satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: "\xA9 Esri",
        maxZoom: 19
      })
    };
    this._miniBaseLayers.roadmap.addTo(this._miniMap);
    this._miniCurrentLayer = "roadmap";
    this._addMiniLayerToggle();
    this._miniMap.on("click", (e) => {
      this.setMiniMapLocation(e.latlng.lat, e.latlng.lng);
    });
    this._miniMap.getContainer().style.webkitUserSelect = "none";
    this._miniMap.getContainer().style.userSelect = "none";
    if (prefillLat !== void 0 && prefillLng !== void 0) {
      this.setMiniMapLocation(prefillLat, prefillLng);
    }
    setTimeout(() => this._miniMap.invalidateSize(), 200);
  },
  // ===== Mini-map layer toggle (roadmap ↔ satellite) =====
  _addMiniLayerToggle() {
    const LayerToggle = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create("div", "layer-toggle layer-toggle-mini leaflet-bar");
        div.innerHTML = `
          <button class="layer-btn active" data-layer="roadmap" title="\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48\u0E16\u0E19\u0E19">\u{1F5FA}\uFE0F</button>
          <button class="layer-btn" data-layer="satellite" title="\u0E20\u0E32\u0E1E\u0E14\u0E32\u0E27\u0E40\u0E17\u0E35\u0E22\u0E21">\u{1F6F0}\uFE0F</button>
        `;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        div.querySelectorAll(".layer-btn").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            L.DomEvent.stop(e);
            App.switchMiniBaseLayer(btn.dataset.layer);
          });
        });
        return div;
      }
    });
    new LayerToggle({ position: "topright" }).addTo(this._miniMap);
  },
  switchMiniBaseLayer(layerName) {
    if (!this._miniBaseLayers[layerName] || layerName === this._miniCurrentLayer) return;
    this._miniMap.removeLayer(this._miniBaseLayers[this._miniCurrentLayer]);
    this._miniBaseLayers[layerName].addTo(this._miniMap);
    this._miniCurrentLayer = layerName;
    const buttons = document.querySelectorAll(".layer-toggle-mini .layer-btn");
    buttons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.layer === layerName);
    });
  },
  // Set location on mini-map (add/move marker)
  setMiniMapLocation(lat, lng) {
    document.getElementById("new-lat").value = lat.toFixed(6);
    document.getElementById("new-lng").value = lng.toFixed(6);
    this._renderAddGpsDisplay();
    if (this._miniMarker) {
      this._miniMarker.setLatLng([lat, lng]);
    } else {
      this._miniMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: "",
          html: '<div class="mini-map-pin">\u{1F4CD}</div>',
          iconSize: [32, 32],
          iconAnchor: [16, 32]
        })
      }).addTo(this._miniMap);
    }
    this._miniMap.panTo([lat, lng]);
  },
  // Render GPS status strip in add-customer modal (hidden lat/lng → readable)
  _renderAddGpsDisplay() {
    var _a, _b;
    const el = document.getElementById("add-gps-display");
    if (!el) return;
    const lat = (_a = document.getElementById("new-lat")) == null ? void 0 : _a.value;
    const lng = (_b = document.getElementById("new-lng")) == null ? void 0 : _b.value;
    if (lat && lng) {
      el.innerHTML = `<div class="gps-captured"><span class="gps-coord">\u{1F4CD} ${parseFloat(lat).toFixed(6)}, ${parseFloat(lng).toFixed(6)}</span></div>`;
    } else {
      el.innerHTML = '<span class="gps-empty">\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E40\u0E25\u0E37\u0E2D\u0E01 \u2014 \u0E08\u0E34\u0E49\u0E21\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48\u0E2B\u0E23\u0E37\u0E2D\u0E01\u0E14\u0E1B\u0E38\u0E48\u0E21 GPS</span>';
    }
  },
  // Pick location on main map (close modal temporarily)
  pickOnMainMap() {
    const form = document.getElementById("add-customer-form");
    const draft = Object.fromEntries(new FormData(form));
    sessionStorage.setItem("add-customer-draft", JSON.stringify(draft));
    this.closeAddCustomerModal();
    this.switchTab("map");
    Utils.toast('\u{1F5FA}\uFE0F \u0E04\u0E25\u0E34\u0E01\u0E1A\u0E19\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48\u0E2B\u0E25\u0E31\u0E01\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07 \u2192 \u0E01\u0E14 "\u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32"');
    window._pickMode = true;
  },
  // Restore draft and re-open modal
  restoreAddCustomerModal() {
    const draft = sessionStorage.getItem("add-customer-draft");
    if (!draft) {
      this.openAddCustomerModal();
      return;
    }
    const data = JSON.parse(draft);
    const form = document.getElementById("add-customer-form");
    Object.entries(data).forEach(([k, v]) => {
      const el = form.elements[k];
      if (el) el.value = v;
    });
    document.getElementById("add-customer-modal").classList.remove("hidden");
    sessionStorage.removeItem("add-customer-draft");
    setTimeout(() => {
      const lat = parseFloat(data.lat);
      const lng = parseFloat(data.lng);
      if (!isNaN(lat) && !isNaN(lng)) {
        this.initMiniMap(lat, lng);
      } else {
        this.initMiniMap();
        this._renderAddGpsDisplay();
      }
    }, 100);
  },
  closeAddCustomerModal() {
    document.getElementById("add-customer-modal").classList.add("hidden");
  },
  // Save customer (add or edit) — Local-first: ขึ้นจอทันที แล้วส่งขึ้นเว็บเบื้องหลัง
  async saveCustomer(form) {
    const data = Object.fromEntries(new FormData(form));
    const editId = form.dataset.editId;
    const isEdit = !!editId;
    let savedCustomer;
    if (isEdit) {
      savedCustomer = Storage.updateCustomerLocal(editId, data) || Storage.getCustomers().find((c) => c.id === editId);
    } else {
      savedCustomer = Storage.addCustomerLocal(data);
    }
    this.closeAddCustomerModal();
    Customers._lastMarkerHash = null;
    Customers.renderAll();
    if (savedCustomer && savedCustomer.lat && savedCustomer.lng && Customers.map) {
      const newLatLng = L.latLng(parseFloat(savedCustomer.lat), parseFloat(savedCustomer.lng));
      const currentCenter = Customers.map.getCenter();
      const isVisible = Customers.map.getBounds().contains(newLatLng);
      const tooFarOut = Customers.map.getZoom() < 16;
      if (!isVisible || tooFarOut || currentCenter.distanceTo(newLatLng) > 500) {
        Customers.map.flyTo(newLatLng, 17, { duration: 0.6 });
      }
      if (Customers._flashPin) Customers._flashPin(newLatLng);
    }
    this.setSaveStatus("saving");
    Utils.toast(isEdit ? "\u270F\uFE0F \u0E41\u0E01\u0E49\u0E44\u0E02\u0E41\u0E25\u0E49\u0E27 \xB7 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E02\u0E36\u0E49\u0E19\u0E40\u0E27\u0E47\u0E1A..." : "\u{1F4DD} \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E41\u0E25\u0E49\u0E27 \xB7 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E02\u0E36\u0E49\u0E19\u0E40\u0E27\u0E47\u0E1A...", "info");
    const settled = isEdit && savedCustomer && savedCustomer.cif ? await Storage.uploadCustomer(savedCustomer.cif, this._customerUploadFields(data)) : await Storage.push().then((r) => ({ synced: !!(r && r.success), error: r && r.error }));
    if (settled && settled.synced) {
      this.setSaveStatus("saved");
      Utils.toast(isEdit ? "\u2705 \u0E41\u0E01\u0E49\u0E44\u0E02\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E41\u0E25\u0E49\u0E27 \xB7 \u0E2A\u0E48\u0E07\u0E02\u0E36\u0E49\u0E19\u0E40\u0E27\u0E47\u0E1A\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22" : "\u2705 \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E41\u0E25\u0E49\u0E27 \xB7 \u0E2A\u0E48\u0E07\u0E02\u0E36\u0E49\u0E19\u0E40\u0E27\u0E47\u0E1A\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22");
    } else {
      this.setSaveStatus("error");
      Utils.toast("\u26A0\uFE0F \u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E43\u0E19\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E19\u0E35\u0E49\u0E41\u0E25\u0E49\u0E27 \u0E41\u0E15\u0E48\u0E22\u0E31\u0E07\u0E2A\u0E48\u0E07\u0E02\u0E36\u0E49\u0E19\u0E40\u0E27\u0E47\u0E1A\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \xB7 \u0E01\u0E14\u0E1B\u0E38\u0E48\u0E21 sync \u0E25\u0E48\u0E32\u0E07\u0E02\u0E27\u0E32\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48", "error");
    }
  },
  // เตรียมข้อมูลจากฟอร์มก่อนส่งขึ้นเว็บ
  // - ตัดช่องที่เซิร์ฟเวอร์ไม่รับ (cif/debtNote)
  // - ช่องพิกัดว่าง = ไม่แตะพิกัดเดิม (กัน lat/lng กลายเป็น 0 แล้วหมุดเด้งไปกลางทะเล)
  // - แปลงพิกัดจากข้อความ ("13.77") เป็นตัวเลข → หมุดขึ้นทันที
  _customerUploadFields(data) {
    const f = __spreadValues({}, data);
    delete f.cif;
    delete f.debtNote;
    const nlat = Storage._normCoord(f.lat);
    const nlng = Storage._normCoord(f.lng);
    if (nlat === null || nlng === null) {
      delete f.lat;
      delete f.lng;
    } else {
      f.lat = nlat;
      f.lng = nlng;
    }
    return f;
  },
  // Use GPS
  useGPS(forForm = false) {
    if (!navigator.geolocation) {
      Utils.toast("\u0E40\u0E1A\u0E23\u0E32\u0E27\u0E4C\u0E40\u0E0B\u0E2D\u0E23\u0E4C\u0E44\u0E21\u0E48\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A GPS", "error");
      return;
    }
    if (forForm) {
      Utils.toast("\u{1F4CD} \u0E01\u0E33\u0E25\u0E31\u0E07\u0E04\u0E49\u0E19\u0E2B\u0E32\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07...");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          window._lastGPS = { lat, lng };
          document.getElementById("new-lat").value = lat.toFixed(6);
          document.getElementById("new-lng").value = lng.toFixed(6);
          this._renderAddGpsDisplay();
          Utils.toast("\u{1F4CD} \u0E43\u0E0A\u0E49\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07\u0E1B\u0E31\u0E08\u0E08\u0E38\u0E1A\u0E31\u0E19\u0E41\u0E25\u0E49\u0E27");
        },
        (err) => {
          Utils.toast("\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E40\u0E02\u0E49\u0E32\u0E16\u0E36\u0E07 GPS: " + err.message, "error");
        },
        { enableHighAccuracy: true, timeout: 1e4 }
      );
      return;
    }
    if (this._gpsWatchId !== null) {
      this._stopGPS();
      return;
    }
    if (!Customers.map) {
      Utils.toast("\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E1E\u0E23\u0E49\u0E2D\u0E21", "error");
      return;
    }
    Utils.toast("\u{1F4CD} \u0E01\u0E33\u0E25\u0E31\u0E07\u0E04\u0E49\u0E19\u0E2B\u0E32\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this._updateGPSMarker(pos.coords);
        Customers.map.setView([pos.coords.latitude, pos.coords.longitude], 16);
      },
      (err) => {
        console.warn("GPS initial fix failed:", err.message);
      },
      { enableHighAccuracy: true, timeout: 1e4 }
    );
    this._gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => this._updateGPSMarker(pos.coords),
      (err) => Utils.toast("GPS \u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14: " + err.message, "error"),
      { enableHighAccuracy: true, maximumAge: 5e3, timeout: 3e4 }
    );
    const fab = document.getElementById("fab-my-location");
    if (fab) fab.classList.add("tracking");
  },
  // Update or create the single GPS pin + accuracy circle (Google-Maps style)
  _updateGPSMarker(coords) {
    const lat = coords.latitude;
    const lng = coords.longitude;
    const acc = coords.accuracy || 0;
    window._lastGPS = { lat, lng, accuracy: acc };
    if (!Customers.map) return;
    if (!this._gpsMarker) {
      this._gpsMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: "",
          html: '<div class="gps-dot"><div class="gps-arrow-wrap"><div class="gps-arrow"></div></div><div class="gps-dot-inner"></div></div>',
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        }),
        zIndexOffset: 1e3,
        interactive: false
      }).addTo(Customers.map);
      this._gpsCircle = L.circle([lat, lng], {
        radius: acc,
        color: "#4285F4",
        fillColor: "#4285F4",
        fillOpacity: 0.15,
        weight: 1,
        interactive: false
      }).addTo(Customers.map);
    } else {
      this._gpsMarker.setLatLng([lat, lng]);
      this._gpsCircle.setLatLng([lat, lng]);
      if (acc > 0) this._gpsCircle.setRadius(acc);
    }
    const el = this._gpsMarker.getElement();
    if (el) {
      const wrap = el.querySelector(".gps-arrow-wrap");
      const hasHeading = coords.heading !== null && coords.heading !== void 0 && !isNaN(coords.heading);
      if (wrap) {
        if (hasHeading) {
          wrap.style.transform = `rotate(${coords.heading}deg)`;
          el.classList.add("has-heading");
        } else {
          el.classList.remove("has-heading");
        }
      }
    }
    if (this._gpsFirstFix === void 0) {
      this._gpsFirstFix = false;
      Customers.map.setView([lat, lng], 16);
    }
  },
  // Stop tracking + clean up pin + circle
  _stopGPS() {
    if (this._gpsWatchId !== null && this._gpsWatchId !== void 0) {
      navigator.geolocation.clearWatch(this._gpsWatchId);
    }
    this._gpsWatchId = null;
    this._gpsFirstFix = void 0;
    if (this._gpsMarker) {
      Customers.map.removeLayer(this._gpsMarker);
      this._gpsMarker = null;
    }
    if (this._gpsCircle) {
      Customers.map.removeLayer(this._gpsCircle);
      this._gpsCircle = null;
    }
    const fab = document.getElementById("fab-my-location");
    if (fab) fab.classList.remove("tracking");
    Utils.toast("\u0E1B\u0E34\u0E14\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21 GPS \u0E41\u0E25\u0E49\u0E27");
  },
  // Update route tab UI — render selected chips with drag&drop + ▲▼ reorder
  updateRouteUI() {
    const route = Storage.getRoute();
    const customers = Storage.getActiveCustomers();
    const routeCustomers = route.map((id) => customers.find((c) => c.id === id)).filter(Boolean);
    const el = document.getElementById("route-chips");
    const countEl = document.getElementById("route-count");
    const btnCalculate = document.getElementById("btn-calculate-route");
    const btnOptimize = document.getElementById("btn-optimize-route");
    if (countEl) countEl.textContent = routeCustomers.length;
    if (routeCustomers.length === 0) {
      if (el) el.innerHTML = '<p class="empty-state">\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E08\u0E32\u0E01\u0E0A\u0E48\u0E2D\u0E07\u0E04\u0E49\u0E19\u0E2B\u0E32\u0E14\u0E49\u0E32\u0E19\u0E1A\u0E19 \u0E2B\u0E23\u0E37\u0E2D\u0E01\u0E14 "\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E43\u0E19\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07\u0E27\u0E31\u0E19\u0E19\u0E35\u0E49" \u0E08\u0E32\u0E01\u0E41\u0E17\u0E47\u0E1A\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32</p>';
      if (btnCalculate) btnCalculate.disabled = true;
      if (btnOptimize) btnOptimize.disabled = true;
      this.updateRouteDebtSummary(routeCustomers);
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
            <span class="route-chip-cif">${this.escapeHTML(c.cif || "-")}</span>
            ${this.escapeHTML(c.name)}
            <span class="route-chip-order">
              <button onclick="Route.move(${idx}, -1)" ${isFirst ? "disabled" : ""} title="\u0E40\u0E25\u0E37\u0E48\u0E2D\u0E19\u0E02\u0E36\u0E49\u0E19">\u25B2</button>
              <button onclick="Route.move(${idx}, 1)" ${isLast ? "disabled" : ""} title="\u0E40\u0E25\u0E37\u0E48\u0E2D\u0E19\u0E25\u0E07">\u25BC</button>
            </span>
            <button class="route-chip-remove" onclick="Route.toggle('${this.escapeHTML(c.id)}')" title="\u0E40\u0E2D\u0E32\u0E2D\u0E2D\u0E01">\xD7</button>
          </span>
        `;
      }).join("");
    }
    if (btnCalculate) btnCalculate.disabled = false;
    if (btnOptimize) btnOptimize.disabled = false;
    this.renderTodayRoute();
    this.updateRouteDebtSummary(routeCustomers);
    if (!routeCustomers || routeCustomers.length === 0) this.hidePlanQuick();
  },
  // สรุปสั้นบนสุดของแท็บวางแผน — ให้เห็น "ได้อะไร" ก่อนเลื่อนลงไปดูรายละเอียด
  // เลื่อนไปยังการ์ด "สรุปหนี้ตามแผน" (รายละเอียด) ในแท็บวางแผน
  scrollToDebtSummary() {
    const el = document.getElementById("route-debt-summary");
    if (!el || el.classList.contains("hidden")) {
      Utils.toast("\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E41\u0E1C\u0E19 \u2014 \u0E01\u0E14\u0E08\u0E31\u0E14\u0E41\u0E1C\u0E19\u0E01\u0E48\u0E2D\u0E19\u0E04\u0E48\u0E30");
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  },
  hidePlanQuick() {
    const q = document.getElementById("plan-quick");
    if (q) q.classList.add("hidden");
    for (const id of ["pq-km", "pq-min"]) {
      const n = document.getElementById(id);
      if (n) n.textContent = "\u2014";
    }
  },
  updatePlanQuick(nums) {
    const q = document.getElementById("plan-quick");
    if (!q || !nums) return;
    const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
    const set = (id, v) => {
      const n = document.getElementById(id);
      if (n) n.textContent = v;
    };
    set("pq-count", nums.count + " \u0E23\u0E32\u0E22");
    set("pq-debt", fmt(nums.debt));
    set("pq-m15", nums.m15 > 0 ? fmt(nums.m15) : "\u2014");
    const more = document.getElementById("pq-more");
    if (more && !more.dataset.bound) {
      more.dataset.bound = "1";
      more.addEventListener("click", (e) => {
        e.preventDefault();
        this.scrollToDebtSummary();
      });
    }
    q.classList.remove("hidden");
  },
  // สรุปหนี้สำหรับแผน (ถ้าออกตามแผนจะได้ตามหนี้ประเภทไหน ต้นเงินคงเป็นหนี้เท่าไหร่ สำรองประเภทไหน ดอกเบี้ย 15 เดือน ผลงานเท่าไหร่)
  updateRouteDebtSummary(routeCustomers) {
    const el = document.getElementById("route-debt-summary");
    if (!el) return;
    if (!routeCustomers || routeCustomers.length === 0) {
      el.classList.add("hidden");
      el.innerHTML = "";
      this.hidePlanQuick();
      return;
    }
    if (!window.DebtDB || !DebtDB._loaded || !DebtDB._byCif) {
      el.classList.remove("hidden");
      el.innerHTML = '<div class="rds-note">\u0E01\u0E33\u0E25\u0E31\u0E07\u0E42\u0E2B\u0E25\u0E14\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2B\u0E19\u0E35\u0E49...</div>';
      if (window.DebtDB && !DebtDB._loaded) DebtDB.load().then(() => this.updateRouteDebtSummary(routeCustomers));
      return;
    }
    const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
    let totalDebt = 0;
    let totalContracts = 0;
    let maxTier = 0;
    const subsidyTypes = {};
    const reserveTypes = {};
    const tierCount = {};
    let m15Total = 0;
    let m15Count = 0;
    const marketCodes = {};
    const dueGroups = {};
    for (const c of routeCustomers) {
      const debt = DebtDB.getByCif(c.cif);
      if (!debt) continue;
      totalDebt += +debt.total_debt || 0;
      totalContracts += +debt.num_contracts || 0;
      const t = parseInt(debt.max_tier) || 0;
      if (t > maxTier) maxTier = t;
      if (t) tierCount[t] = (tierCount[t] || 0) + 1;
      for (const ct of debt.contracts || []) {
        const sub = (ct.sub || "").trim();
        const subKey = sub || "\u0E1B\u0E01\u0E15\u0E34 (\u0E44\u0E21\u0E48\u0E21\u0E35\u0E0A\u0E14\u0E40\u0E0A\u0E22)";
        subsidyTypes[subKey] = (subsidyTypes[subKey] || 0) + (+ct.d || 0);
        const res = (ct.reserve || "").trim();
        if (res) reserveTypes[res] = (reserveTypes[res] || 0) + (+ct.d || 0);
        if (ct.m15 === "Y") {
          m15Count++;
          m15Total += +ct.d || 0;
        }
        const mc = (ct.mc || "").trim();
        if (mc) marketCodes[mc] = (marketCodes[mc] || 0) + (+ct.d || 0);
        const dueKey = (ct.due || "").trim();
        if (dueKey) {
          if (!dueGroups[dueKey]) dueGroups[dueKey] = { amount: 0, count: 0 };
          dueGroups[dueKey].amount += +ct.d || 0;
          dueGroups[dueKey].count++;
        }
      }
    }
    const totalCif = routeCustomers.filter((c) => DebtDB.getByCif(c.cif)).length;
    const tierLabels = { 1: "\u0E0A\u0E31\u0E49\u0E19 1", 2: "\u0E0A\u0E31\u0E49\u0E19 2", 3: "\u0E0A\u0E31\u0E49\u0E19 3", 4: "\u0E0A\u0E31\u0E49\u0E19 4", 5: "\u0E0A\u0E31\u0E49\u0E19 5" };
    let html = '<div class="rds-card">';
    html += '<h3 class="rds-title">\u{1F4CA} \u0E2A\u0E23\u0E38\u0E1B\u0E2B\u0E19\u0E35\u0E49\u0E15\u0E32\u0E21\u0E41\u0E1C\u0E19 (' + routeCustomers.length + " \u0E23\u0E32\u0E22)</h3>";
    html += '<div class="rds-overview">';
    html += '<div class="rds-stat"><span class="rds-num">' + fmt(totalDebt) + '</span><span class="rds-label">\u0E15\u0E49\u0E19\u0E40\u0E07\u0E34\u0E19\u0E04\u0E07\u0E40\u0E1B\u0E47\u0E19\u0E2B\u0E19\u0E35\u0E49 (\u0E1A\u0E32\u0E17)</span></div>';
    html += '<div class="rds-stat"><span class="rds-num">' + totalContracts.toLocaleString("th-TH") + '</span><span class="rds-label">\u0E2A\u0E31\u0E0D\u0E0D\u0E32</span></div>';
    html += '<div class="rds-stat"><span class="rds-num">' + totalCif.toLocaleString("th-TH") + '</span><span class="rds-label">\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E17\u0E35\u0E48\u0E21\u0E35\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2B\u0E19\u0E35\u0E49</span></div>';
    if (maxTier) html += '<div class="rds-stat"><span class="rds-num" style="color:' + DebtDB.tierColor(maxTier) + '">\u0E0A\u0E31\u0E49\u0E19 ' + maxTier + '</span><span class="rds-label">\u0E0A\u0E31\u0E49\u0E19\u0E2B\u0E19\u0E35\u0E49\u0E2A\u0E39\u0E07\u0E2A\u0E38\u0E14</span></div>';
    html += "</div>";
    const subKeys = Object.keys(subsidyTypes);
    if (subKeys.length) {
      html += '<div class="rds-block"><div class="rds-block-title">\u{1F3F7}\uFE0F \u0E2B\u0E19\u0E35\u0E49\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17\u0E44\u0E2B\u0E19 (\u0E15\u0E32\u0E21\u0E42\u0E04\u0E23\u0E07\u0E01\u0E32\u0E23/\u0E0A\u0E14\u0E40\u0E0A\u0E22)</div>';
      for (const k of subKeys.sort()) {
        const pct = totalDebt ? Math.round(subsidyTypes[k] / totalDebt * 100) : 0;
        html += '<div class="rds-row"><span class="rds-label">' + this.escapeHTML(k) + '</span><span class="rds-val">' + fmt(subsidyTypes[k]) + " \u0E1A\u0E32\u0E17 (" + pct + "%)</span></div>";
      }
      html += "</div>";
    }
    const resKeys = Object.keys(reserveTypes);
    if (resKeys.length) {
      html += '<div class="rds-block"><div class="rds-block-title">\u{1F6E1}\uFE0F \u0E2A\u0E33\u0E23\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17\u0E44\u0E2B\u0E19 (\u0E01\u0E31\u0E19\u0E2A\u0E33\u0E23\u0E2D\u0E07)</div>';
      for (const k of resKeys.sort()) {
        const pct = totalDebt ? Math.round(reserveTypes[k] / totalDebt * 100) : 0;
        html += '<div class="rds-row"><span class="rds-label">\u0E01\u0E31\u0E19\u0E2A\u0E33\u0E23\u0E2D\u0E07 ' + this.escapeHTML(k) + '%</span><span class="rds-val">' + fmt(reserveTypes[k]) + " \u0E1A\u0E32\u0E17 (" + pct + "%)</span></div>";
      }
      html += "</div>";
    }
    const dueKeys = Object.keys(dueGroups);
    if (dueKeys.length) {
      const toNum = (d) => {
        const m = String(d).match(/(\d+)\/(\d+)\/(\d+)/);
        if (!m) return Number.MAX_SAFE_INTEGER;
        return +m[3] * 1e4 + +m[2] * 100 + +m[1];
      };
      dueKeys.sort((a, b) => toNum(a) - toNum(b));
      html += '<div class="rds-block"><div class="rds-block-title">\u{1F4C5} \u0E01\u0E33\u0E2B\u0E19\u0E14\u0E0A\u0E33\u0E23\u0E30\u0E41\u0E15\u0E48\u0E25\u0E30\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23 (\u0E15\u0E49\u0E19\u0E40\u0E07\u0E34\u0E19\u0E41\u0E22\u0E01\u0E15\u0E32\u0E21\u0E27\u0E31\u0E19\u0E16\u0E36\u0E07\u0E01\u0E33\u0E2B\u0E19\u0E14)</div>';
      for (const k of dueKeys) {
        const g = dueGroups[k];
        const pct = totalDebt ? Math.round(g.amount / totalDebt * 100) : 0;
        html += '<div class="rds-row"><span class="rds-label">\u{1F4C5} ' + this.escapeHTML(k) + " (" + g.count + ' \u0E2A\u0E31\u0E0D\u0E0D\u0E32)</span><span class="rds-val">' + fmt(g.amount) + " \u0E1A\u0E32\u0E17 (" + pct + "%)</span></div>";
      }
      html += "</div>";
    }
    const tierKeys = Object.keys(tierCount);
    if (tierKeys.length) {
      html += '<div class="rds-block"><div class="rds-block-title">\u{1F4CA} \u0E0A\u0E31\u0E49\u0E19\u0E2B\u0E19\u0E35\u0E49</div>';
      for (const t of tierKeys.sort()) {
        html += '<div class="rds-row"><span class="rds-label" style="color:' + DebtDB.tierColor(t) + '">' + (tierLabels[t] || "\u0E0A\u0E31\u0E49\u0E19 " + t) + '</span><span class="rds-val">' + tierCount[t] + " \u0E23\u0E32\u0E22</span></div>";
      }
      html += "</div>";
    }
    html += '<div class="rds-block"><div class="rds-block-title">\u23F0 \u0E2A\u0E31\u0E0D\u0E0D\u0E32 15 \u0E40\u0E14\u0E37\u0E2D\u0E19</div>';
    if (m15Count > 0) {
      html += '<div class="rds-row rds-warn"><span class="rds-label">\u{1F534} \u0E2A\u0E31\u0E0D\u0E0D\u0E32 15 \u0E40\u0E14\u0E37\u0E2D\u0E19</span><span class="rds-val">' + m15Count + " \u0E2A\u0E31\u0E0D\u0E0D\u0E32 \xB7 " + fmt(m15Total) + " \u0E1A\u0E32\u0E17</span></div>";
    } else {
      html += '<div class="rds-row rds-ok"><span class="rds-label">\u2705 \u0E44\u0E21\u0E48\u0E21\u0E35\u0E19\u0E31\u0E14\u0E04\u0E49\u0E32\u0E07 15 \u0E40\u0E14\u0E37\u0E2D\u0E19</span><span class="rds-val">0 \u0E1A\u0E32\u0E17</span></div>';
    }
    html += "</div>";
    html += '<div class="rds-block rds-perf"><div class="rds-block-title">\u{1F3AF} \u0E1C\u0E25\u0E07\u0E32\u0E19\u0E17\u0E35\u0E48\u0E08\u0E30\u0E44\u0E14\u0E49\u0E16\u0E49\u0E32\u0E2D\u0E2D\u0E01\u0E15\u0E32\u0E21\u0E41\u0E1C\u0E19</div>';
    html += '<div class="rds-row"><span class="rds-label">\u{1F4B0} \u0E2B\u0E19\u0E35\u0E49\u0E17\u0E35\u0E48\u0E08\u0E30\u0E44\u0E14\u0E49\u0E15\u0E32\u0E21 (\u0E23\u0E27\u0E21)</span><span class="rds-val">' + fmt(totalDebt) + " \u0E1A\u0E32\u0E17</span></div>";
    if (m15Count > 0) html += '<div class="rds-row rds-warn"><span class="rds-label">\u{1F4B0} \u0E2B\u0E19\u0E35\u0E49\u0E17\u0E35\u0E48\u0E08\u0E30\u0E44\u0E14\u0E49\u0E15\u0E32\u0E21 (15 \u0E40\u0E14\u0E37\u0E2D\u0E19)</span><span class="rds-val">' + fmt(m15Total) + " \u0E1A\u0E32\u0E17 (" + m15Count + " \u0E2A\u0E31\u0E0D\u0E0D\u0E32)</span></div>";
    html += '<div class="rds-row"><span class="rds-label">\u{1F4CB} \u0E2A\u0E31\u0E0D\u0E0D\u0E32\u0E17\u0E35\u0E48\u0E08\u0E30\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21</span><span class="rds-val">' + totalContracts.toLocaleString("th-TH") + " \u0E2A\u0E31\u0E0D\u0E0D\u0E32</span></div>";
    html += '<div class="rds-row"><span class="rds-label">\u{1F465} \u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E17\u0E35\u0E48\u0E08\u0E30\u0E40\u0E22\u0E35\u0E48\u0E22\u0E21</span><span class="rds-val">' + routeCustomers.length + " \u0E23\u0E32\u0E22</span></div>";
    if (m15Count > 0) html += '<div class="rds-row rds-warn"><span class="rds-label">\u26A0\uFE0F \u0E15\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E48\u0E07\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21 (15 \u0E40\u0E14\u0E37\u0E2D\u0E19)</span><span class="rds-val">' + m15Count + " \u0E2A\u0E31\u0E0D\u0E0D\u0E32 \xB7 " + fmt(m15Total) + " \u0E1A\u0E32\u0E17</span></div>";
    html += "</div>";
    html += "</div>";
    el.innerHTML = html;
    el.classList.remove("hidden");
    this.updatePlanQuick({ count: routeCustomers.length, debt: totalDebt, m15: m15Total });
  },
  // Calculate route
  // useTSP = false (default) = use the manual order from chips
  // useTSP = true = call TSP.plan() to auto-optimize (opt-in)
  async calculateRoute(useTSP = false, opts = {}) {
    const route = Storage.getRoute();
    if (route.length === 0) return;
    const start = Route.getStartCoords();
    const end = Route.getEndCoords();
    let ordered = route;
    if (useTSP) {
      try {
        ordered = await Route.optimizeOrder(start, route, end);
      } catch (err) {
        console.warn("optimizeOrder (OSRM table) \u0E25\u0E49\u0E21\u0E40\u0E2B\u0E25\u0E27 \u2192 \u0E43\u0E0A\u0E49 haversine TSP \u0E41\u0E17\u0E19", err);
        ordered = TSP.plan(start, route, end);
      }
    }
    let reordered = false;
    if (useTSP && ordered.length === route.length && ordered.join("|") !== route.join("|")) {
      Storage.saveRoute(ordered);
      this.updateRouteUI();
      reordered = true;
    }
    const result = await Route.calculate(start, ordered, end);
    if (result) {
      result.autoOrdered = reordered;
      result.autoOrderTried = useTSP;
      Route.showResult(result);
      const kmEl = document.getElementById("pq-km");
      const minEl = document.getElementById("pq-min");
      if (kmEl) kmEl.textContent = (result.distance / 1e3).toFixed(1) + " \u0E01\u0E21.";
      if (minEl) minEl.textContent = result.duration ? Math.round(result.duration / 60) + " \u0E19." : "\u2014";
      try {
        const pane = document.getElementById("tab-planvisit");
        const sc = pane && pane.closest ? pane.closest(".sheet-scroll") : null;
        if (sc) sc.scrollTop = 0;
      } catch (e) {
      }
      if (opts && opts.focusSummary) {
        this.switchSheetTab("planvisit");
        this.setSheetState("half");
        requestAnimationFrame(() => {
          const sc = document.querySelector(".sheet-scroll");
          if (sc) sc.scrollTo({ top: 0, behavior: "smooth" });
          const q = document.getElementById("plan-quick");
          if (q) {
            q.classList.add("flash");
            setTimeout(() => q.classList.remove("flash"), 1600);
          }
        });
      } else {
        this.switchTab("map");
      }
      const routeType = result.isOpenPath ? " (\u0E40\u0E1B\u0E34\u0E14)" : "";
      const tspNote = reordered ? " \xB7 \u{1F3AF} \u0E08\u0E31\u0E14\u0E25\u0E33\u0E14\u0E31\u0E1A\u0E43\u0E2B\u0E49\u0E43\u0E2B\u0E21\u0E48\u0E41\u0E25\u0E49\u0E27" : useTSP ? " \xB7 \u0E25\u0E33\u0E14\u0E31\u0E1A\u0E40\u0E14\u0E34\u0E21\u0E2A\u0E31\u0E49\u0E19\u0E17\u0E35\u0E48\u0E2A\u0E38\u0E14\u0E2D\u0E22\u0E39\u0E48\u0E41\u0E25\u0E49\u0E27" : "";
      Utils.toast(`\u2705 \u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07${routeType}${tspNote} \u2014 ${Utils.formatKm(result.distance)} \u0E01\u0E21. / ${result.fuel ? Utils.formatBaht(result.fuel.baht) : "?"} \u0E1A\u0E32\u0E17`);
    }
  },
  // ===== Admin: Show/hide admin button based on role =====
  updateAdminUI() {
    const isAdmin = Auth.isAdmin();
    const canManage = typeof Auth.canManage === "function" ? Auth.canManage() : isAdmin;
    const userBtn = document.getElementById("admin-users-btn");
    const dataBtn = document.getElementById("admin-data-btn");
    if (userBtn) userBtn.style.display = canManage ? "" : "none";
    if (dataBtn) dataBtn.style.display = isAdmin ? "" : "none";
    if (!isAdmin) {
      for (const id of ["map-branch-filter", "customer-branch"]) {
        const s = document.getElementById(id);
        if (s) s.style.display = "none";
      }
    }
  },
  // ===== Admin: Open management modal =====
  async openAdminUsers() {
    const modal = document.getElementById("admin-users-modal");
    modal.classList.remove("hidden");
    const isSuperAdmin = Auth.isAdmin();
    const myBranch = typeof Auth.myBranch === "function" ? Auth.myBranch() : "";
    for (const key of ["branches", "pin", "health"]) {
      const btn = modal.querySelector(`.admin-tab[data-admin-tab="${key}"]`);
      if (btn) btn.style.display = isSuperAdmin ? "" : "none";
    }
    const roleGroup = document.getElementById("new-role-group");
    if (roleGroup) roleGroup.style.display = isSuperAdmin ? "" : "none";
    const scopeHint = document.getElementById("admin-scope-hint");
    if (scopeHint) {
      if (isSuperAdmin) {
        scopeHint.style.display = "none";
      } else {
        const bName = (Auth.getUser() || {}).branchName || myBranch;
        scopeHint.style.display = "";
        scopeHint.textContent = `\u{1F3E2} \u0E04\u0E38\u0E13\u0E40\u0E1B\u0E47\u0E19\u0E1C\u0E39\u0E49\u0E14\u0E39\u0E41\u0E25\u0E2A\u0E32\u0E02\u0E32 \u2014 \u0E08\u0E31\u0E14\u0E01\u0E32\u0E23\u0E44\u0E14\u0E49\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E02\u0E2D\u0E07${bName}\u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19`;
      }
    }
    modal.querySelectorAll(".admin-import-section, .admin-export-section").forEach((el) => {
      el.style.display = isSuperAdmin ? "" : "none";
    });
    if (!isSuperAdmin) {
      modal.querySelectorAll(".admin-tab").forEach((t) => t.classList.toggle("active", t.dataset.adminTab === "users"));
      modal.querySelectorAll(".admin-tab-pane").forEach((p) => p.classList.toggle("active", p.id === "admin-tab-users"));
    }
    modal.querySelectorAll(".admin-tab").forEach((tab) => {
      tab.onclick = () => {
        if (tab.style.display === "none") return;
        modal.querySelectorAll(".admin-tab").forEach((t) => t.classList.remove("active"));
        modal.querySelectorAll(".admin-tab-pane").forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById("admin-tab-" + tab.dataset.adminTab).classList.add("active");
      };
    });
    const branchSelect = document.getElementById("new-branch");
    branchSelect.innerHTML = '<option value="">\u2014 \u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2A\u0E32\u0E02\u0E32 \u2014</option>';
    try {
      const res = await API.get("/api/branches");
      if (res.success && res.branches) {
        window._adminBranches = res.branches;
        res.branches.forEach((b) => {
          const opt = document.createElement("option");
          opt.value = b.code;
          opt.textContent = b.name;
          branchSelect.appendChild(opt);
        });
      }
    } catch (e) {
      console.warn("Failed to load branches:", e);
    }
    if (!isSuperAdmin) {
      const mine = (window._adminBranches || []).find((b) => b.code === myBranch);
      branchSelect.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = myBranch;
      opt.textContent = mine && mine.name || myBranch;
      branchSelect.appendChild(opt);
      branchSelect.value = myBranch;
      branchSelect.disabled = true;
    } else {
      branchSelect.disabled = false;
    }
    await this.loadAdminUsers();
    if (isSuperAdmin) {
      await this.loadAdminBranches();
      this.loadAdminHealth();
      const healthBtn = document.getElementById("health-refresh");
      if (healthBtn && !healthBtn.dataset.bound) {
        healthBtn.dataset.bound = "1";
        healthBtn.onclick = () => this.loadAdminHealth(true);
      }
    }
    await this.loadAdminViews();
    const viewsFilter = document.getElementById("admin-views-filter");
    if (viewsFilter && !viewsFilter.dataset.bound) {
      viewsFilter.dataset.bound = "1";
      viewsFilter.addEventListener("change", () => this.loadAdminViews());
      document.getElementById("admin-views-refresh").onclick = () => this.loadAdminViews();
    }
    document.getElementById("close-admin-users").onclick = () => modal.classList.add("hidden");
    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    };
    document.getElementById("admin-add-user-form").onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("admin-user-error");
      errEl.textContent = "";
      const username = document.getElementById("new-username").value.trim();
      const pin = ((document.getElementById("new-staff-pin") || {}).value || "").trim();
      const displayName = document.getElementById("new-display-name").value.trim();
      const branch = document.getElementById("new-branch").value;
      if (!pin) {
        errEl.textContent = "\u0E15\u0E49\u0E2D\u0E07\u0E43\u0E2A\u0E48 PIN (4-8 \u0E2B\u0E25\u0E31\u0E01)";
        return;
      }
      try {
        const body = { username, displayName, branch };
        const roleGroupEl = document.getElementById("new-role-group");
        const roleSel = document.getElementById("new-role");
        if (roleGroupEl && roleGroupEl.style.display !== "none" && roleSel) body.role = roleSel.value || "user";
        if (pin) body.pin = pin;
        const res = await API.post("/api/admin/users", body);
        if (res.success) {
          Utils.toast(`\u2705 \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49 "${displayName}" \u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08`);
          document.getElementById("admin-add-user-form").reset();
          if (roleSel) roleSel.value = "user";
          if (branchSelect.disabled) branchSelect.value = myBranch;
          await this.loadAdminUsers();
        }
      } catch (err) {
        errEl.textContent = err.message || "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08";
      }
    };
    const importBtn = document.getElementById("btn-import-static-db");
    if (importBtn) {
      importBtn.onclick = async (e) => {
        e.preventDefault();
        const errEl = document.getElementById("import-static-error");
        const successEl = document.getElementById("import-static-success");
        errEl.style.display = "none";
        successEl.style.display = "none";
        errEl.textContent = "";
        importBtn.disabled = true;
        const originalText = importBtn.textContent;
        importBtn.textContent = "\u23F3 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32...";
        try {
          if (typeof Storage === "undefined" || !Storage.importFromStaticDB) {
            throw new Error("\u0E1F\u0E31\u0E07\u0E01\u0E4C\u0E0A\u0E31\u0E19\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32\u0E22\u0E31\u0E07\u0E42\u0E2B\u0E25\u0E14\u0E44\u0E21\u0E48\u0E40\u0E2A\u0E23\u0E47\u0E08");
          }
          const result = await Storage.importFromStaticDB();
          successEl.textContent = `\u2705 \u0E19\u0E33\u0E40\u0E02\u0E49\u0E32 ${result.imported} \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23 \xB7 ${result.withGPS} \u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14 \xB7 \u0E02\u0E49\u0E32\u0E21 ${result.skipped} \u0E17\u0E35\u0E48\u0E0B\u0E49\u0E33`;
          successEl.style.display = "block";
          Utils.toast(`\u{1F4E5} \u0E19\u0E33\u0E40\u0E02\u0E49\u0E32 ${result.imported} \u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E41\u0E25\u0E49\u0E27`);
          if (typeof Customers !== "undefined" && Customers.renderAll) {
            setTimeout(() => Customers.renderAll(), 500);
          }
        } catch (err) {
          errEl.textContent = err.message || "\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08";
          errEl.style.display = "block";
          Utils.toast("\u274C \u0E19\u0E33\u0E40\u0E02\u0E49\u0E32\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08", "error");
        } finally {
          importBtn.disabled = false;
          importBtn.textContent = originalText;
        }
      };
    }
    document.getElementById("admin-add-branch-form").onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("admin-branch-error");
      errEl.textContent = "";
      const code = document.getElementById("new-branch-code").value.trim().toUpperCase();
      const name = document.getElementById("new-branch-name").value.trim();
      try {
        const res = await API.post("/api/admin/branches", { code, name });
        if (res.success) {
          Utils.toast(`\u2705 \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E2A\u0E32\u0E02\u0E32 "${name}" \u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08`);
          document.getElementById("admin-add-branch-form").reset();
          await this.loadAdminBranches();
          const branchSelect2 = document.getElementById("new-branch");
          const opt = document.createElement("option");
          opt.value = code;
          opt.textContent = name;
          branchSelect2.appendChild(opt);
        }
      } catch (err) {
        errEl.textContent = err.message || "\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E2A\u0E32\u0E02\u0E32\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08";
      }
    };
    document.getElementById("admin-change-pin-form").onsubmit = async (e) => {
      var _a, _b;
      e.preventDefault();
      const errEl = document.getElementById("admin-pin-error");
      const successEl = document.getElementById("admin-pin-success");
      errEl.textContent = "";
      successEl.style.display = "none";
      const currentPin = document.getElementById("current-pin").value;
      const newPin = document.getElementById("new-pin").value;
      const confirmPin = document.getElementById("confirm-pin").value;
      if (newPin !== confirmPin) {
        errEl.textContent = "PIN \u0E43\u0E2B\u0E21\u0E48\u0E44\u0E21\u0E48\u0E15\u0E23\u0E07\u0E01\u0E31\u0E19";
        return;
      }
      if (newPin.length < 4) {
        errEl.textContent = "PIN \u0E43\u0E2B\u0E21\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E21\u0E35\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E19\u0E49\u0E2D\u0E22 4 \u0E2B\u0E25\u0E31\u0E01";
        return;
      }
      try {
        const res = await API.postRaw("/api/admin/pin", { currentPin, newPin });
        if (res.ok && ((_a = res.data) == null ? void 0 : _a.success)) {
          Utils.toast("\u{1F510} \u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19 PIN \u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
          successEl.textContent = "\u2705 \u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19 PIN \u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08\u0E41\u0E25\u0E49\u0E27";
          successEl.style.display = "block";
          document.getElementById("admin-change-pin-form").reset();
        } else if ((_b = res.data) == null ? void 0 : _b.error) {
          errEl.textContent = res.data.error;
        } else {
          errEl.textContent = "\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19 PIN \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (HTTP " + res.status + ")";
        }
      } catch (err) {
        errEl.textContent = err.message || "\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19 PIN \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08";
      }
    };
    const exportBtn = document.getElementById("btn-export-customers");
    if (exportBtn) {
      exportBtn.onclick = () => this.exportCustomersCSV();
    }
    this.initDebtImport();
  },
  // ===== Debt Import: อัปโหลด Customer Indicator =====
  initDebtImport() {
    const uploadBtn = document.getElementById("debt-upload-btn");
    const fileInput = document.getElementById("debt-file-input");
    const fileName = document.getElementById("debt-file-name");
    const progress = document.getElementById("debt-progress");
    const progressText = document.getElementById("debt-progress-text");
    const result = document.getElementById("debt-result");
    const resultStats = document.getElementById("debt-result-stats");
    const resultTime = document.getElementById("debt-result-time");
    const lastUpdate = document.getElementById("debt-last-update-time");
    if (!uploadBtn || !fileInput) return;
    const verifyBtn = document.getElementById("debt-verify-btn");
    const verifyBox = document.getElementById("debt-verify-result");
    if (verifyBtn && !verifyBtn.dataset.bound) {
      verifyBtn.dataset.bound = "1";
      verifyBtn.onclick = async () => {
        verifyBtn.disabled = true;
        if (verifyBox) verifyBox.innerHTML = "\u23F3 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A...";
        try {
          const r = await API.get("/api/admin/debt-verify");
          const names = { "854": "\u0E27\u0E31\u0E07\u0E17\u0E48\u0E32\u0E0A\u0E49\u0E32\u0E07", "145": "\u0E01\u0E1A\u0E34\u0E19\u0E17\u0E23\u0E4C\u0E1A\u0E38\u0E23\u0E35", "291": "\u0E1A\u0E49\u0E32\u0E19\u0E2A\u0E23\u0E49\u0E32\u0E07" };
          const lines = Object.keys(r.per_branch || {}).map((b) => {
            const v = r.per_branch[b];
            const bad = Math.abs(v.diff_baht) > 1 || v.d1_n !== v.kv_n;
            const sign = v.diff_baht > 0 ? "\u0E40\u0E01\u0E34\u0E19" : v.diff_baht < 0 ? "\u0E02\u0E32\u0E14" : "\u0E15\u0E23\u0E07";
            return `<div style="${bad ? "color:#b45309;font-weight:600" : ""}">${bad ? "\u26A0\uFE0F" : "\u2705"} ${names[b] || "\u0E2A\u0E32\u0E02\u0E32 " + b}: \u0E01\u0E32\u0E23\u0E4C\u0E14 ${v.kv_n.toLocaleString()} \u0E23\u0E32\u0E22 \xB7 ${Number(v.kv_baht).toLocaleString()} \u0E1A\u0E32\u0E17` + (bad ? ` \u2014 \u0E15\u0E48\u0E32\u0E07\u0E08\u0E32\u0E01\u0E10\u0E32\u0E19\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25 ${sign} ${Math.abs(Number(v.diff_baht)).toLocaleString()} \u0E1A\u0E32\u0E17` : " \u2014 \u0E15\u0E23\u0E07") + "</div>";
          }).join("");
          const ghost = r.ghost_count > 0 ? `<div style="margin-top:6px;color:#b45309">\u{1F9F9} \u0E1E\u0E1A\u0E41\u0E16\u0E27\u0E04\u0E49\u0E32\u0E07\u0E17\u0E35\u0E48\u0E10\u0E32\u0E19\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E25\u0E1A\u0E41\u0E25\u0E49\u0E27 ${r.ghost_count.toLocaleString()} \u0E23\u0E32\u0E22 (${Number(r.ghost_baht).toLocaleString()} \u0E1A\u0E32\u0E17) <button type="button" id="debt-verify-fix" style="margin-left:6px;background:#b45309;color:#fff;border:none;border-radius:6px;padding:4px 10px">\u0E25\u0E1A\u0E41\u0E16\u0E27\u0E04\u0E49\u0E32\u0E07</button></div>` : "";
          if (verifyBox) verifyBox.innerHTML = (r.ok ? "\u2705 \u0E22\u0E2D\u0E14\u0E15\u0E23\u0E07\u0E01\u0E31\u0E1A\u0E10\u0E32\u0E19\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E17\u0E38\u0E01\u0E2A\u0E32\u0E02\u0E32" : "\u26A0\uFE0F \u0E22\u0E2D\u0E14\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E15\u0E23\u0E07") + "<br>" + lines + ghost + `<div style="margin-top:6px;font-size:12px;color:#666">\u0E15\u0E23\u0E27\u0E08\u0E40\u0E21\u0E37\u0E48\u0E2D ${new Date(r.checked_at).toLocaleString("th-TH")}</div>`;
          const fix = document.getElementById("debt-verify-fix");
          if (fix) fix.onclick = async () => {
            if (!confirm("\u0E25\u0E1A\u0E41\u0E16\u0E27\u0E04\u0E49\u0E32\u0E07\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E04\u0E25\u0E31\u0E07\u0E01\u0E32\u0E23\u0E4C\u0E14\u0E2B\u0E19\u0E35\u0E49? (\u0E23\u0E30\u0E1A\u0E1A\u0E2A\u0E33\u0E23\u0E2D\u0E07\u0E01\u0E48\u0E2D\u0E19\u0E25\u0E1A)")) return;
            fix.disabled = true;
            try {
              const res = await API.post("/api/admin/debt-verify", { fix_ghosts: true });
              Utils.toast(`\u{1F9F9} \u0E25\u0E1A\u0E41\u0E16\u0E27\u0E04\u0E49\u0E32\u0E07 ${res.removed} \u0E23\u0E32\u0E22 \u2014 ${res.ok ? "\u0E22\u0E2D\u0E14\u0E15\u0E23\u0E07\u0E41\u0E25\u0E49\u0E27" : "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E15\u0E23\u0E07 \u0E14\u0E39\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14"}`, res.ok ? "success" : "error");
              verifyBtn.click();
            } catch (e) {
              Utils.toast(e.message || "\u0E25\u0E1A\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08", "error");
              fix.disabled = false;
            }
          };
        } catch (e) {
          if (verifyBox) verifyBox.innerHTML = `\u274C \u0E15\u0E23\u0E27\u0E08\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08: ${e.message}`;
        } finally {
          verifyBtn.disabled = false;
        }
      };
    }
    const scopeHint = document.getElementById("debt-scope-hint");
    if (scopeHint) {
      if (Auth.isAdmin()) {
        scopeHint.style.display = "none";
      } else {
        const bName = (Auth.getUser() || {}).branchName || Auth.myBranch();
        scopeHint.style.display = "";
        scopeHint.textContent = `\u{1F3E2} \u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14\u0E44\u0E14\u0E49\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E02\u0E2D\u0E07${bName} \u2014 \u0E41\u0E16\u0E27\u0E2A\u0E32\u0E02\u0E32\u0E2D\u0E37\u0E48\u0E19\u0E43\u0E19\u0E44\u0E1F\u0E25\u0E4C\u0E08\u0E30\u0E16\u0E39\u0E01\u0E02\u0E49\u0E32\u0E21\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34`;
      }
    }
    this.loadDebtLastUpdate();
    uploadBtn.onclick = () => fileInput.click();
    let pendingFile = null;
    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      if (!file) return;
      pendingFile = file;
      fileName.textContent = `\u{1F4C4} ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
      result.style.display = "none";
      document.getElementById("debt-preview").style.display = "none";
      progress.style.display = "block";
      progressText.textContent = "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E23\u0E27\u0E08\u0E44\u0E1F\u0E25\u0E4C\u0E40\u0E17\u0E35\u0E22\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E40\u0E14\u0E34\u0E21...";
      uploadBtn.disabled = true;
      try {
        const formData = new FormData();
        formData.append("file", file);
        const token = Auth.getToken();
        const res = await fetch("/api/debt-import?dryrun=1", {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
          body: formData
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "\u0E15\u0E23\u0E27\u0E08\u0E44\u0E1F\u0E25\u0E4C\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
        }
        progress.style.display = "none";
        this.showDebtPreview(data);
      } catch (err) {
        progress.style.display = "none";
        result.style.display = "block";
        resultStats.innerHTML = `<span style="color:var(--danger)">\u274C ${err.message}</span>`;
        resultTime.textContent = "";
        Utils.toast("\u274C \u0E15\u0E23\u0E27\u0E08\u0E44\u0E1F\u0E25\u0E4C\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08", "error");
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = "\u{1F4C2} \u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E1F\u0E25\u0E4C Customer Indicator";
      }
    };
    document.getElementById("debt-confirm-btn").onclick = () => this.confirmDebtImport(pendingFile);
    document.getElementById("debt-cancel-btn").onclick = () => {
      document.getElementById("debt-preview").style.display = "none";
      fileInput.value = "";
      pendingFile = null;
    };
    this.loadDebtQuota();
    this.loadDebtRestore();
  },
  // ===== Debt Import: แถบโควต้าเขียนวันนี้ =====
  renderDebtQuota(el, quota) {
    if (!el || !quota) return;
    const pct = quota.pct || 0;
    const color = quota.blockBulk ? "var(--danger)" : quota.warn ? "#f9a825" : "var(--baac-green)";
    const ops = quota.byOp ? Object.entries(quota.byOp).map(([k, v]) => `${k} ${Number(v).toLocaleString()}`).join(" \xB7 ") : "";
    el.innerHTML = `\u{1F4DD} \u0E42\u0E04\u0E27\u0E15\u0E49\u0E32\u0E40\u0E02\u0E35\u0E22\u0E19\u0E27\u0E31\u0E19\u0E19\u0E35\u0E49: <strong>${quota.used.toLocaleString()}/${quota.limit.toLocaleString()}</strong> (\u0E40\u0E2B\u0E25\u0E37\u0E2D ${quota.remaining.toLocaleString()})<div style="height:8px;background:#eee;border-radius:4px;margin-top:4px"><div style="width:${pct}%;height:100%;background:${color};border-radius:4px"></div></div>` + (ops ? `<small class="text-muted">\u0E43\u0E0A\u0E49\u0E44\u0E1B: ${ops}</small>` : "");
    if ((quota.blockBulk || quota.warn) && !this._quotaWarned) {
      this._quotaWarned = true;
      if (typeof Utils !== "undefined" && Utils.toast) {
        Utils.toast(quota.blockBulk ? "\u{1F6D1} \u0E42\u0E04\u0E27\u0E15\u0E49\u0E32\u0E40\u0E02\u0E35\u0E22\u0E19\u0E27\u0E31\u0E19\u0E19\u0E35\u0E49\u0E43\u0E01\u0E25\u0E49\u0E40\u0E15\u0E47\u0E21 \u2014 \u0E07\u0E32\u0E19\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32\u0E44\u0E1F\u0E25\u0E4C\u0E43\u0E2B\u0E0D\u0E48\u0E16\u0E39\u0E01\u0E25\u0E47\u0E2D\u0E01\u0E0A\u0E31\u0E48\u0E27\u0E04\u0E23\u0E32\u0E27" : "\u26A0\uFE0F \u0E42\u0E04\u0E27\u0E15\u0E49\u0E32\u0E40\u0E02\u0E35\u0E22\u0E19\u0E27\u0E31\u0E19\u0E19\u0E35\u0E49\u0E43\u0E01\u0E25\u0E49\u0E40\u0E15\u0E47\u0E21\u0E41\u0E25\u0E49\u0E27 \u2014 \u0E19\u0E33\u0E40\u0E02\u0E49\u0E32\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E17\u0E35\u0E48\u0E08\u0E33\u0E40\u0E1B\u0E47\u0E19", "error");
      }
    }
  },
  async loadDebtQuota() {
    try {
      const token = Auth.getToken();
      const res = await fetch("/api/admin/quota", { headers: { "Authorization": `Bearer ${token}` } });
      const data = await res.json();
      if (data && data.success) this.renderDebtQuota(document.getElementById("debt-quota"), data.quota);
    } catch (e) {
    }
  },
  // ===== สุขภาพระบบ (เฟส 0): เส้นฐานพิกัด/หนี้/โควต้า + เวลาโหลดเครื่องนี้ =====
  async loadAdminHealth(force = false) {
    const el = document.getElementById("health-panel");
    if (!el) return;
    try {
      const token = Auth.getToken();
      const res = await fetch("/api/admin/quota" + (force ? "?force=1" : ""), { headers: { "Authorization": `Bearer ${token}` } });
      const data = await res.json();
      if (!data || !data.success || !data.health) {
        el.innerHTML = '<p class="text-muted">\u0E42\u0E2B\u0E25\u0E14\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2A\u0E38\u0E02\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08</p>';
        return;
      }
      const h = data.health, q = data.quota || {};
      const branchName = { "854": "\u0E27\u0E31\u0E07\u0E17\u0E48\u0E32\u0E0A\u0E49\u0E32\u0E07", "145": "\u0E01\u0E1A\u0E34\u0E19\u0E17\u0E23\u0E4C\u0E1A\u0E38\u0E23\u0E35" };
      const rows = (h.branches || []).map((b) => `<div style="padding:8px 10px;border:1px solid #dfe8e2;border-radius:10px;margin:6px 0">\u{1F3E2} <strong>${branchName[b.branch] || "\u0E2A\u0E32\u0E02\u0E32 " + (b.branch || "\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38")}</strong><br>\u{1F465} \u0E25\u0E39\u0E01\u0E04\u0E49\u0E32 <strong>${b.total.toLocaleString()}</strong> \u0E23\u0E32\u0E22 \xB7 \u{1F4CD} \u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14 <strong>${b.gps.toLocaleString()}</strong> \u0E23\u0E32\u0E22 (<strong>${b.gpsPct}%</strong>) \xB7 \u{1F4B0} \u0E21\u0E35\u0E2B\u0E19\u0E35\u0E49 ${b.debt.toLocaleString()} \u0E23\u0E32\u0E22</div>`).join("");
      const gpsColor = h.gpsPct >= 50 ? "var(--baac-green)" : h.gpsPct >= 20 ? "#f9a825" : "var(--danger)";
      const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0] || null;
      const loadMs = nav ? Math.round(nav.domContentLoadedEventEnd || nav.loadEventEnd || 0) : null;
      let localTxt = "";
      try {
        const cs = Storage.getCustomers();
        const lg = cs.filter((c) => c.lat && c.lng).length;
        localTxt = `<br>\u{1F4F1} \u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E19\u0E35\u0E49: \u0E40\u0E01\u0E47\u0E1A\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32 ${cs.length.toLocaleString()} \u0E23\u0E32\u0E22 (\u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14 ${lg.toLocaleString()})` + (loadMs != null ? ` \xB7 \u23F1\uFE0F \u0E42\u0E2B\u0E25\u0E14\u0E2B\u0E19\u0E49\u0E32\u0E40\u0E27\u0E47\u0E1A ${loadMs.toLocaleString()} \u0E21\u0E34\u0E25\u0E25\u0E34\u0E27\u0E34\u0E19\u0E32\u0E17\u0E35` : "");
        if (typeof DebtDB !== "undefined" && DebtDB._loaded && DebtDB._byCif) {
          localTxt += `<br>\u{1F4B0} \u0E2B\u0E19\u0E35\u0E49\u0E43\u0E19\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07: ${DebtDB._byCif.size.toLocaleString()} \u0E23\u0E32\u0E22` + (DebtDB._fromCache ? " (\u0E43\u0E0A\u0E49\u0E41\u0E04\u0E0A \u2014 \u0E44\u0E21\u0E48\u0E42\u0E2B\u0E25\u0E14\u0E43\u0E2B\u0E21\u0E48)" : " (\u0E42\u0E2B\u0E25\u0E14\u0E2A\u0E14\u0E08\u0E32\u0E01\u0E40\u0E27\u0E47\u0E1A)");
        }
      } catch (e) {
      }
      el.innerHTML = `<div style="font-size:20px">\u{1F4CD} \u0E1E\u0E34\u0E01\u0E31\u0E14\u0E23\u0E27\u0E21 <strong style="color:${gpsColor};font-size:26px">${h.gpsPct}%</strong> (${h.gps.toLocaleString()}/${h.total.toLocaleString()} \u0E23\u0E32\u0E22)</div><div style="height:10px;background:#eee;border-radius:5px"><div style="width:${Math.min(100, h.gpsPct)}%;height:100%;background:${gpsColor};border-radius:5px"></div></div>` + rows + `<div>\u{1F4DD} \u0E42\u0E04\u0E27\u0E15\u0E49\u0E32\u0E40\u0E02\u0E35\u0E22\u0E19\u0E27\u0E31\u0E19\u0E19\u0E35\u0E49: <strong>${(q.used || 0).toLocaleString()}/${(q.limit || 1e5).toLocaleString()}</strong> (\u0E43\u0E0A\u0E49 ${q.pct || 0}%)</div><div class="text-muted" style="font-size:14px">\u{1F550} \u0E27\u0E31\u0E14\u0E40\u0E21\u0E37\u0E48\u0E2D ${new Date(h.at).toLocaleString("th-TH")}${h.cached ? ` \xB7 \u0E08\u0E32\u0E01\u0E41\u0E04\u0E0A (\u0E2D\u0E32\u0E22\u0E38 ${h.cacheAgeSec} \u0E27\u0E34)` : " \xB7 \u0E27\u0E31\u0E14\u0E2A\u0E14\u0E08\u0E32\u0E01\u0E10\u0E32\u0E19\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25"}${localTxt}</div>`;
    } catch (e) {
      el.innerHTML = '<p class="text-muted">\u0E42\u0E2B\u0E25\u0E14\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2A\u0E38\u0E02\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08</p>';
    }
  },
  // ===== Debt Import: โชว์ผลวิเคราะห์ก่อนยืนยัน =====
  showDebtPreview(data) {
    const stats = document.getElementById("debt-preview-stats");
    const fields = document.getElementById("debt-preview-fields");
    stats.innerHTML = `\u{1F4CB} \u0E43\u0E19\u0E44\u0E1F\u0E25\u0E4C: <strong>${data.unique_cifs.toLocaleString()}</strong> CIF (${data.total_contracts.toLocaleString()} \u0E2A\u0E31\u0E0D\u0E0D\u0E32)<br>\u270F\uFE0F \u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E08\u0E23\u0E34\u0E07: <strong>${data.will_update.toLocaleString()}</strong> \u0E23\u0E32\u0E22` + (data.will_add > 0 ? ` \xB7 \u{1F195} \u0E43\u0E2B\u0E21\u0E48: <strong>${data.will_add.toLocaleString()}</strong> \u0E23\u0E32\u0E22` : "") + (data.will_clear > 0 ? ` \xB7 \u{1F9F9} \u0E2B\u0E21\u0E14\u0E2B\u0E19\u0E35\u0E49: <strong>${data.will_clear.toLocaleString()}</strong> \u0E23\u0E32\u0E22` : "") + `<br>\u23ED\uFE0F \u0E40\u0E17\u0E48\u0E32\u0E40\u0E14\u0E34\u0E21\u0E02\u0E49\u0E32\u0E21: <strong>${data.will_skip_identical.toLocaleString()}</strong> \u0E23\u0E32\u0E22 (\u0E44\u0E21\u0E48\u0E40\u0E1B\u0E25\u0E37\u0E2D\u0E07\u0E42\u0E04\u0E27\u0E15\u0E49\u0E32)<br>\u{1F6E1}\uFE0F \u0E04\u0E25\u0E31\u0E07\u0E01\u0E32\u0E23\u0E4C\u0E14\u0E2B\u0E19\u0E35\u0E49\u0E2B\u0E25\u0E31\u0E07\u0E2D\u0E31\u0E1E: <strong>${(data.kv_total || 0).toLocaleString()}</strong> \u0E23\u0E32\u0E22 (\u0E04\u0E07\u0E40\u0E14\u0E34\u0E21 ${(data.kv_kept || 0).toLocaleString()} \xB7 \u0E40\u0E2D\u0E32\u0E2D\u0E2D\u0E01 ${(data.kv_dropped || 0).toLocaleString()})<br>` + (data.ignored_other_branch > 0 ? `\u23ED\uFE0F \u0E02\u0E49\u0E32\u0E21\u0E41\u0E16\u0E27\u0E2A\u0E32\u0E02\u0E32\u0E2D\u0E37\u0E48\u0E19: <strong>${data.ignored_other_branch.toLocaleString()}</strong> \u0E41\u0E16\u0E27<br>` : "") + (data.ignored_no_branch > 0 ? `\u26A0\uFE0F \u0E41\u0E16\u0E27\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38\u0E2A\u0E32\u0E02\u0E32 (\u0E02\u0E49\u0E32\u0E21): <strong>${data.ignored_no_branch.toLocaleString()}</strong> \u0E41\u0E16\u0E27<br>` : "") + (data.clear_skipped ? `\u{1F6E1}\uFE0F ${data.clear_skipped}<br>` : "") + `\u{1F4BE} \u0E23\u0E2D\u0E1A\u0E19\u0E35\u0E49\u0E08\u0E30\u0E40\u0E02\u0E35\u0E22\u0E19 ~<strong>${data.estimated_writes.toLocaleString()}</strong> \u0E41\u0E16\u0E27`;
    const fds = data.field_diff || {};
    const keys = Object.keys(fds);
    fields.innerHTML = keys.length ? `\u{1F4CC} \u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E35\u0E48\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19: ` + keys.map((k) => `${k} <strong>${fds[k].toLocaleString()}</strong>`).join(" \xB7 ") : `\u{1F4CC} \u0E44\u0E21\u0E48\u0E21\u0E35\u0E0A\u0E48\u0E2D\u0E07\u0E44\u0E2B\u0E19\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19 \u2014 \u0E01\u0E14\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19\u0E01\u0E47\u0E44\u0E21\u0E48\u0E40\u0E02\u0E35\u0E22\u0E19\u0E2D\u0E30\u0E44\u0E23\u0E40\u0E1E\u0E34\u0E48\u0E21`;
    this.renderDebtQuota(document.getElementById("debt-quota"), data.quota);
    document.getElementById("debt-confirm-btn").textContent = `\u2705 \u0E22\u0E37\u0E19\u0E22\u0E31\u0E19\u0E2D\u0E31\u0E1E\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25 (~${data.estimated_writes.toLocaleString()} \u0E41\u0E16\u0E27)`;
    document.getElementById("debt-preview").style.display = "block";
    document.getElementById("debt-preview").scrollIntoView({ behavior: "smooth", block: "nearest" });
  },
  // แสดงผลตรวจสอบยอดหลังอัพ (KV กับ D1 ต้องตรงกันทุกสาขา)
  renderDebtVerify(data) {
    if (!data || data.verify_ok === null || data.verify_ok === void 0 || !data.verify) return "";
    const keys = Object.keys(data.verify);
    if (!keys.length) return "";
    if (data.verify_ok) {
      return `<div style="margin-top:6px;color:#0a7c34;font-weight:600">\u2705 \u0E15\u0E23\u0E27\u0E08\u0E41\u0E25\u0E49\u0E27: \u0E22\u0E2D\u0E14\u0E43\u0E19\u0E04\u0E25\u0E31\u0E07\u0E01\u0E32\u0E23\u0E4C\u0E14\u0E2B\u0E19\u0E35\u0E49\u0E15\u0E23\u0E07\u0E01\u0E31\u0E1A\u0E10\u0E32\u0E19\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E17\u0E38\u0E01\u0E2A\u0E32\u0E02\u0E32</div>`;
    }
    const names = { "854": "\u0E27\u0E31\u0E07\u0E17\u0E48\u0E32\u0E0A\u0E49\u0E32\u0E07", "145": "\u0E01\u0E1A\u0E34\u0E19\u0E17\u0E23\u0E4C\u0E1A\u0E38\u0E23\u0E35", "291": "\u0E1A\u0E49\u0E32\u0E19\u0E2A\u0E23\u0E49\u0E32\u0E07" };
    const rows = keys.filter((b) => Math.abs(data.verify[b].diff_baht || 0) > 1 || data.verify[b].d1_n !== data.verify[b].kv_n).map((b) => {
      const v = data.verify[b];
      const d = Number(v.diff_baht || 0);
      const sign = d > 0 ? "\u0E40\u0E01\u0E34\u0E19" : "\u0E02\u0E32\u0E14";
      return `\u2022 \u0E2A\u0E32\u0E02\u0E32 ${names[b] || b}: \u0E01\u0E32\u0E23\u0E4C\u0E14 ${v.kv_n.toLocaleString()} \u0E23\u0E32\u0E22 / \u0E10\u0E32\u0E19\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25 ${v.d1_n.toLocaleString()} \u0E23\u0E32\u0E22 \xB7 \u0E22\u0E2D\u0E14${sign} ${Math.abs(d).toLocaleString()} \u0E1A\u0E32\u0E17`;
    });
    const body = rows.length ? rows.join("<br>") : keys.map((b) => {
      const v = data.verify[b];
      return `\u2022 \u0E2A\u0E32\u0E02\u0E32 ${names[b] || b}: ${v.kv_n.toLocaleString()} \u0E23\u0E32\u0E22 \xB7 ${Number(v.kv_baht || 0).toLocaleString()} \u0E1A\u0E32\u0E17`;
    }).join("<br>");
    return `<div style="margin-top:6px;padding:8px;border-radius:8px;background:#fff4e5;color:#8a4b00;text-align:left">
      <b>\u26A0\uFE0F \u0E22\u0E2D\u0E14\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E15\u0E23\u0E07\u0E01\u0E31\u0E19 \u2014 \u0E2D\u0E22\u0E48\u0E32\u0E1B\u0E34\u0E14\u0E2B\u0E19\u0E49\u0E32\u0E19\u0E35\u0E49\u0E01\u0E48\u0E2D\u0E19\u0E41\u0E08\u0E49\u0E07\u0E41\u0E2D\u0E14\u0E21\u0E34\u0E19</b><br>${body}</div>`;
  },
  // ===== Debt Import: ยืนยันอัพจริง =====
  async confirmDebtImport(file) {
    if (!file) {
      Utils.toast("\u274C \u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E44\u0E1F\u0E25\u0E4C \u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E43\u0E2B\u0E21\u0E48", "error");
      return;
    }
    const progress = document.getElementById("debt-progress");
    const progressText = document.getElementById("debt-progress-text");
    const result = document.getElementById("debt-result");
    const resultStats = document.getElementById("debt-result-stats");
    const resultTime = document.getElementById("debt-result-time");
    const lastUpdate = document.getElementById("debt-last-update-time");
    const confirmBtn = document.getElementById("debt-confirm-btn");
    document.getElementById("debt-preview").style.display = "none";
    progress.style.display = "block";
    progressText.textContent = "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2D\u0E31\u0E1E\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2B\u0E19\u0E35\u0E49...";
    confirmBtn.disabled = true;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = Auth.getToken();
      const res = await fetch("/api/debt-import", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "\u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
      progress.style.display = "none";
      result.style.display = "block";
      resultStats.innerHTML = `\u2705 \u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15: <strong>${data.updated.toLocaleString()}</strong> \u0E23\u0E32\u0E22` + (data.added > 0 ? ` \xB7 \u{1F195} \u0E43\u0E2B\u0E21\u0E48: <strong>${data.added.toLocaleString()}</strong> \u0E23\u0E32\u0E22` : "") + (data.cleared > 0 ? ` \xB7 \u{1F9F9} \u0E2B\u0E21\u0E14\u0E2B\u0E19\u0E35\u0E49: <strong>${data.cleared.toLocaleString()}</strong> \u0E23\u0E32\u0E22` : "") + `<br>\u23ED\uFE0F \u0E02\u0E49\u0E32\u0E21 (\u0E40\u0E17\u0E48\u0E32\u0E40\u0E14\u0E34\u0E21): <strong>${(data.skipped_identical || 0).toLocaleString()}</strong> \u0E23\u0E32\u0E22<br>\u{1F6E1}\uFE0F \u0E04\u0E25\u0E31\u0E07\u0E01\u0E32\u0E23\u0E4C\u0E14\u0E2B\u0E19\u0E35\u0E49: <strong>${(data.kv_total || 0).toLocaleString()}</strong> \u0E23\u0E32\u0E22` + (data.kv_backup ? ` (\u0E2A\u0E33\u0E23\u0E2D\u0E07\u0E01\u0E48\u0E2D\u0E19\u0E2D\u0E31\u0E1E\u0E44\u0E27\u0E49\u0E17\u0E35\u0E48 ${data.kv_backup})` : "") + `<br>` + (data.ignored_other_branch > 0 ? `\u23ED\uFE0F \u0E02\u0E49\u0E32\u0E21\u0E41\u0E16\u0E27\u0E2A\u0E32\u0E02\u0E32\u0E2D\u0E37\u0E48\u0E19: <strong>${data.ignored_other_branch.toLocaleString()}</strong> \u0E41\u0E16\u0E27<br>` : "") + (data.ignored_no_branch > 0 ? `\u26A0\uFE0F \u0E41\u0E16\u0E27\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38\u0E2A\u0E32\u0E02\u0E32 (\u0E02\u0E49\u0E32\u0E21): <strong>${data.ignored_no_branch.toLocaleString()}</strong> \u0E41\u0E16\u0E27<br>` : "") + (data.clear_skipped ? `\u{1F6E1}\uFE0F ${data.clear_skipped}<br>` : "") + this.renderDebtVerify(data) + (data.quota ? `\u{1F4DD} \u0E42\u0E04\u0E27\u0E15\u0E49\u0E32\u0E27\u0E31\u0E19\u0E19\u0E35\u0E49\u0E40\u0E2B\u0E25\u0E37\u0E2D <strong>${data.quota.remaining.toLocaleString()}</strong> \u0E41\u0E16\u0E27` : "");
      resultTime.textContent = `\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E40\u0E21\u0E37\u0E48\u0E2D: ${new Date(data.debt_updated_at).toLocaleString("th-TH")}`;
      if (lastUpdate) lastUpdate.textContent = new Date(data.debt_updated_at).toLocaleString("th-TH");
      this.renderDebtQuota(document.getElementById("debt-quota"), data.quota);
      Utils.toast(`\u{1F4CA} \u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E2B\u0E19\u0E35\u0E49\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 ${data.updated} \u0E23\u0E32\u0E22${data.added > 0 ? ` +${data.added} \u0E43\u0E2B\u0E21\u0E48` : ""}`);
      if (typeof Customers !== "undefined" && Customers.renderAll) {
        setTimeout(() => Customers.renderAll(), 500);
      }
    } catch (err) {
      progress.style.display = "none";
      result.style.display = "block";
      resultStats.innerHTML = `<span style="color:var(--danger)">\u274C ${err.message}</span>`;
      resultTime.textContent = "";
      Utils.toast("\u274C \u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E2B\u0E19\u0E35\u0E49\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08", "error");
    } finally {
      confirmBtn.disabled = false;
      document.getElementById("debt-file-input").value = "";
    }
  },
  // ===== Debt Import: โหลดวันที่อัปเดตหนี้ล่าสุด =====
  async loadDebtLastUpdate() {
    const lastUpdate = document.getElementById("debt-last-update-time");
    if (!lastUpdate) return;
    try {
      const token = Auth.getToken();
      const res = await fetch("/api/customers?limit=1", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.customers && data.customers.length > 0) {
        const debtUpdated = data.customers[0].debt_updated_at;
        if (debtUpdated) {
          lastUpdate.textContent = new Date(debtUpdated).toLocaleString("th-TH");
        } else {
          lastUpdate.textContent = "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E40\u0E04\u0E22\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15";
        }
      }
    } catch (err) {
      console.warn("Failed to load debt last update:", err);
      lastUpdate.textContent = "-";
    }
  },
  // ===== Debt KV: รายชื่อสำรอง + ปุ่มกู้คืน (ระบบกันหาย 17 ต.ค.69) =====
  // กู้คืนทั้งคลังทุกสาขา = แอดมินกลางเท่านั้น
  async loadDebtRestore() {
    const el = document.getElementById("debt-restore");
    if (!el) return;
    if (!Auth.isAdmin()) {
      el.innerHTML = "";
      return;
    }
    try {
      const token = Auth.getToken();
      const res = await fetch("/api/admin/debt-restore", { headers: { "Authorization": `Bearer ${token}` } });
      const data = await res.json();
      if (!data || !data.success) {
        el.innerHTML = "";
        return;
      }
      if (!data.backups.length) {
        el.innerHTML = `\u{1F6E1}\uFE0F \u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E33\u0E23\u0E2D\u0E07\u0E04\u0E25\u0E31\u0E07\u0E2B\u0E19\u0E35\u0E49 (\u0E08\u0E30\u0E21\u0E35\u0E2B\u0E25\u0E31\u0E07\u0E2D\u0E31\u0E1E\u0E23\u0E2D\u0E1A\u0E16\u0E31\u0E14\u0E44\u0E1B)`;
        return;
      }
      const opts = data.backups.map((d) => `<option value="${d}">${d}</option>`).join("");
      el.innerHTML = `\u{1F6E1}\uFE0F \u0E2A\u0E33\u0E23\u0E2D\u0E07\u0E04\u0E25\u0E31\u0E07\u0E2B\u0E19\u0E35\u0E49: <select id="debt-restore-date" class="sort-select">${opts}</select> <button type="button" class="btn2" id="debt-restore-btn" style="width:auto;padding:8px 14px;min-height:44px">\u267B\uFE0F \u0E01\u0E39\u0E49\u0E04\u0E37\u0E19</button> <small class="text-muted">(\u0E04\u0E25\u0E31\u0E07\u0E1B\u0E31\u0E08\u0E08\u0E38\u0E1A\u0E31\u0E19 ${(data.current || 0).toLocaleString()} \u0E23\u0E32\u0E22)</small>`;
      document.getElementById("debt-restore-btn").onclick = async () => {
        const date = document.getElementById("debt-restore-date").value;
        if (!confirm(`\u0E01\u0E39\u0E49\u0E04\u0E37\u0E19\u0E04\u0E25\u0E31\u0E07\u0E2B\u0E19\u0E35\u0E49\u0E08\u0E32\u0E01\u0E2A\u0E33\u0E23\u0E2D\u0E07\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48 ${date}?
(\u0E2A\u0E20\u0E32\u0E1E\u0E1B\u0E31\u0E08\u0E08\u0E38\u0E1A\u0E31\u0E19\u0E08\u0E30\u0E16\u0E39\u0E01\u0E2A\u0E33\u0E23\u0E2D\u0E07\u0E44\u0E27\u0E49\u0E2D\u0E35\u0E01\u0E0A\u0E31\u0E49\u0E19\u0E01\u0E48\u0E2D\u0E19\u0E17\u0E31\u0E1A)`)) return;
        const r2 = await fetch("/api/admin/debt-restore", {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ date })
        });
        const d2 = await r2.json();
        if (!r2.ok) throw new Error(d2.error || "\u0E01\u0E39\u0E49\u0E04\u0E37\u0E19\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
        Utils.toast(`\u267B\uFE0F \u0E01\u0E39\u0E49\u0E04\u0E37\u0E19\u0E41\u0E25\u0E49\u0E27 ${d2.restored.toLocaleString()} \u0E23\u0E32\u0E22 (\u0E08\u0E32\u0E01 ${d2.from})`);
      };
    } catch (e) {
      el.innerHTML = "";
    }
  },
  // ===== Export Customers as CSV =====
  exportCustomersCSV() {
    const customers = Storage.getActiveCustomers();
    if (!customers.length) {
      Utils.toast("\u26A0\uFE0F \u0E44\u0E21\u0E48\u0E21\u0E35\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E43\u0E2B\u0E49 export", "error");
      return;
    }
    const headers = ["CIF", "\u0E0A\u0E37\u0E48\u0E2D", "\u0E0A\u0E37\u0E48\u0E2D\u0E40\u0E25\u0E48\u0E19", "\u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E42\u0E17\u0E23", "\u0E17\u0E35\u0E48\u0E2D\u0E22\u0E39\u0E48", "Latitude", "Longitude", "\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E04\u0E27\u0E32\u0E21\u0E40\u0E2A\u0E35\u0E48\u0E22\u0E07", "\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17\u0E2B\u0E19\u0E35\u0E49", "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E42\u0E14\u0E22", "\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E2A\u0E23\u0E49\u0E32\u0E07"];
    const rows = customers.map((c) => [
      c.cif || "",
      c.name || "",
      c.nickname || "",
      c.phone || "",
      c.address || "",
      c.lat || "",
      c.lng || "",
      c.riskLevel || "",
      c.debtType || "",
      c.createdBy || "",
      c.createdAt || ""
    ]);
    const escapeCSV = (val) => {
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    const csv = [
      headers.join(","),
      ...rows.map((row) => row.map(escapeCSV).join(","))
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `baac-customers-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Utils.toast(`\u{1F4CA} Export ${customers.length} \u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E40\u0E1B\u0E47\u0E19 CSV \u0E41\u0E25\u0E49\u0E27`);
  },
  // ===== Admin: Load user list =====
  async loadAdminUsers() {
    const listEl = document.getElementById("admin-users-list");
    try {
      const res = await API.get("/api/admin/users");
      if (!res.success || !res.users.length) {
        this._adminUsers = [];
        const cnt2 = document.getElementById("admin-users-count");
        if (cnt2) cnt2.textContent = "";
        listEl.innerHTML = '<p class="text-muted">\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49 \u2014 \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E04\u0E19\u0E41\u0E23\u0E01\u0E14\u0E49\u0E32\u0E19\u0E25\u0E48\u0E32\u0E07\u0E40\u0E25\u0E22</p>';
        return;
      }
      this._adminUsers = res.users;
      const cnt = document.getElementById("admin-users-count");
      if (cnt) cnt.textContent = `\u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14 ${res.users.length} \u0E04\u0E19`;
      const me = Auth.getUser() || {};
      const isSuperAdmin = Auth.isAdmin();
      const roleBadge = (r) => r === "admin" ? "\u{1F451} \u0E41\u0E2D\u0E14\u0E21\u0E34\u0E19\u0E01\u0E25\u0E32\u0E07" : r === "branch_admin" ? "\u{1F3E2} \u0E1C\u0E39\u0E49\u0E14\u0E39\u0E41\u0E25\u0E2A\u0E32\u0E02\u0E32" : "\u{1F464} \u0E1E\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19";
      const canPin = (u) => u.role !== "admin" && (isSuperAdmin || u.role === "user" || u.id === me.id);
      const canClear = (u) => u.hasPin && (isSuperAdmin || u.id === me.id);
      const canDelete = (u) => u.id !== me.id && (isSuperAdmin || u.role === "user");
      listEl.innerHTML = res.users.map((u) => `
        <div class="admin-user-card">
          <div class="admin-user-info">
            <span class="admin-user-name">${this.escapeHTML(u.displayName)}</span>
            <span class="admin-user-meta">${this.escapeHTML(u.username)} \xB7 ${this.escapeHTML(u.branchName)} \xB7 ${roleBadge(u.role)} \xB7 ${u.pin ? "\u{1F511}PIN " + this.escapeHTML(u.pin) : u.hasPin ? "\u{1F511}\u0E21\u0E35 PIN (\u0E40\u0E01\u0E48\u0E32)" : "\u2014 \u0E44\u0E21\u0E48\u0E21\u0E35 PIN"}</span>
          </div>
          ${canPin(u) ? `<button class="btn-icon-sm" title="\u0E15\u0E31\u0E49\u0E07/\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19 PIN" onclick="App.openStaffPin('${u.id}', '${this.escapeHTML(u.displayName)}', '${u.pin || ""}')">\u{1F511}</button>` : ""}
          ${canClear(u) ? `<button class="btn-icon-sm" title="\u0E1B\u0E34\u0E14 login \u0E14\u0E49\u0E27\u0E22 PIN" onclick="App.clearStaffPin('${u.id}', '${this.escapeHTML(u.displayName)}')">\u{1F6AB}</button>` : ""}
          ${canDelete(u) ? `<button class="btn-danger-sm" onclick="App.deleteAdminUser('${u.id}', '${this.escapeHTML(u.displayName)}')">\u{1F5D1}\uFE0F</button>` : ""}
        </div>
      `).join("");
    } catch (err) {
      listEl.innerHTML = `<p class="login-error">\u0E42\u0E2B\u0E25\u0E14\u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08: ${err.message}</p>`;
    }
  },
  // ===== รายงานผู้ใช้ CSV (17 ต.ค.69 — พ่อสั่ง: ดูรายชื่อ+รหัสในเมนูจัดการระบบ) =====
  // หมายเหตุ: เลข PIN จริง export ไม่ได้ (เก็บแบบ hash ทางเดียว ถอดกลับไม่ได้แม้แอดมิน)
  // รายงานจึงบอกแค่ว่ามี/ไม่มี PIN + ตั้งใหม่ได้ทีละคนด้วยปุ่ม 🔑 ในการ์ด
  _adminUsers: [],
  buildUsersCSV(users) {
    const cell = (v) => `"${String(v != null ? v : "").replace(/"/g, '""')}"`;
    const rows = [["Username", "\u0E0A\u0E37\u0E48\u0E2D\u0E17\u0E35\u0E48\u0E41\u0E2A\u0E14\u0E07", "\u0E2A\u0E32\u0E02\u0E32", "\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C", "PIN", "\u0E21\u0E35 PIN", "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E21\u0E37\u0E48\u0E2D"]];
    for (const u of users || []) {
      rows.push([
        u.username || "",
        u.displayName || "",
        u.branchName || u.branch || "",
        u.role === "admin" ? "Admin" : "User",
        u.pin || "\u2014",
        u.hasPin ? "\u0E21\u0E35" : "\u0E44\u0E21\u0E48\u0E21\u0E35",
        u.createdAt || "-"
      ]);
    }
    return "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
  },
  exportUsersCSV() {
    const users = this._adminUsers || [];
    if (!users.length) {
      if (typeof Utils !== "undefined" && Utils.toast) Utils.toast("\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E43\u0E2B\u0E49 export", "warn");
      return;
    }
    const blob = new Blob([this.buildUsersCSV(users)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    const d = /* @__PURE__ */ new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    a.href = URL.createObjectURL(blob);
    a.download = `users-report-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5e3);
    if (typeof Utils !== "undefined" && Utils.toast) Utils.toast(`\u{1F4E5} \u0E42\u0E2B\u0E25\u0E14\u0E23\u0E32\u0E22\u0E07\u0E32\u0E19 ${users.length} \u0E04\u0E19\u0E41\u0E25\u0E49\u0E27`);
  },
  // ===== Staff grid: แตะชื่อ + PIN (แผน B, แยกสาขาอัตโนมัติ) =====
  // pure: จัดรายชื่อตามสาขา (เทสได้โดยไม่ต้องมี backend)
  groupStaffByBranch(staff) {
    const map = {};
    (staff || []).forEach((s) => {
      const key = s.branch || "";
      if (!map[key]) map[key] = { branch: s.branch, branchName: s.branchName || s.branch, members: [] };
      map[key].members.push(s);
    });
    return Object.values(map);
  },
  async loadStaffGrid() {
    const grid = document.getElementById("staff-grid");
    if (!grid) return;
    const renderNames = (members) => {
      grid.innerHTML = members.map((s) => `
        <button type="button" class="staff-btn" data-username="${this.escapeHTML(s.username)}">
          <span class="staff-name">${this.escapeHTML(s.displayName)}</span>
        </button>
      `).join("");
      grid.querySelectorAll(".staff-btn").forEach((btn) => {
        btn.onclick = () => {
          grid.querySelectorAll(".staff-btn").forEach((b) => b.classList.remove("staff-selected"));
          btn.classList.add("staff-selected");
          document.getElementById("pin-username").value = btn.dataset.username;
          const pi = document.getElementById("pin-input");
          if (pi) pi.focus();
        };
      });
    };
    try {
      const staff = await Auth.loadStaffList();
      if (!staff.length) {
        grid.innerHTML = '<p class="text-muted">\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D\u0E1E\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19 \u2014 \u0E41\u0E2D\u0E14\u0E21\u0E34\u0E19\u0E43\u0E2A\u0E48 PIN \u0E44\u0E14\u0E49\u0E40\u0E25\u0E22</p>';
        return;
      }
      const groups = this.groupStaffByBranch(staff);
      if (groups.length <= 1) {
        renderNames(groups[0].members);
        return;
      }
      grid.innerHTML = '<p class="text-muted">\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2A\u0E32\u0E02\u0E32\u0E01\u0E48\u0E2D\u0E19</p>' + groups.map((g, i) => `
        <button type="button" class="staff-btn staff-branch" data-gi="${i}">
          <span class="staff-name">\u{1F3E2} ${this.escapeHTML(g.branchName)}</span>
        </button>
      `).join("");
      grid.querySelectorAll(".staff-branch").forEach((btn) => {
        btn.onclick = () => {
          document.getElementById("pin-username").value = "";
          renderNames(groups[Number(btn.dataset.gi)].members);
          const back = document.createElement("button");
          back.type = "button";
          back.className = "staff-btn staff-back";
          back.innerHTML = '<span class="staff-name">\u2039 \u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E2A\u0E32\u0E02\u0E32</span>';
          back.onclick = () => {
            document.getElementById("pin-username").value = "";
            this.loadStaffGrid();
          };
          grid.prepend(back);
        };
      });
    } catch (e) {
      grid.innerHTML = '<p class="text-muted">\u0E42\u0E2B\u0E25\u0E14\u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49 \u2014 \u0E41\u0E2D\u0E14\u0E21\u0E34\u0E19\u0E43\u0E2A\u0E48 PIN \u0E44\u0E14\u0E49\u0E40\u0E25\u0E22</p>';
    }
  },
  // ===== Admin: สมุดคุมเปิดดูการ์ด (ขั้น 4) =====
  async loadAdminViews() {
    const listEl = document.getElementById("admin-views-list");
    if (!listEl) return;
    const filter = (document.getElementById("admin-views-filter") || {}).value || "";
    listEl.innerHTML = '<p class="text-muted">\u0E01\u0E33\u0E25\u0E31\u0E07\u0E42\u0E2B\u0E25\u0E14...</p>';
    try {
      const q = filter.trim() ? "?viewer=" + encodeURIComponent(filter.trim()) : "";
      const res = await API.get("/api/admin/views" + q);
      if (!res.success || !res.views.length) {
        listEl.innerHTML = '<p class="text-muted">\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1B\u0E23\u0E30\u0E27\u0E31\u0E15\u0E34\u0E40\u0E1B\u0E34\u0E14\u0E14\u0E39\u0E01\u0E32\u0E23\u0E4C\u0E14</p>';
        return;
      }
      listEl.innerHTML = res.views.map((v) => {
        const when = (v.viewed_at || "").replace("T", " ").slice(0, 16);
        return `<div class="admin-user-card"><div class="admin-user-info"><span class="admin-user-name">${this.escapeHTML(v.customer_name || v.cif)}</span><span class="admin-user-meta">\u{1F464} ${this.escapeHTML(v.viewer_name || v.viewer)} \xB7 \u{1F558} ${this.escapeHTML(when)}</span></div></div>`;
      }).join("");
    } catch (err) {
      listEl.innerHTML = `<p class="login-error">\u0E42\u0E2B\u0E25\u0E14\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08: ${this.escapeHTML(err.message)}</p>`;
    }
  },
  // ===== Admin: ตั้ง/ปิด PIN พนักงาน (ฟอร์ม 17 ต.ค.69 — เห็นเลขเดิมก่อนเปลี่ยน กันพิมพ์ผิด) =====
  _staffPinId: null,
  openStaffPin(id, name, currentPin) {
    this._staffPinId = id;
    document.getElementById("staff-pin-name").textContent = name;
    document.getElementById("staff-pin-current").textContent = currentPin ? `PIN \u0E1B\u0E31\u0E08\u0E08\u0E38\u0E1A\u0E31\u0E19: ${currentPin}` : "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35 PIN";
    document.getElementById("staff-pin-new").value = "";
    document.getElementById("staff-pin-confirm").value = "";
    document.getElementById("staff-pin-error").textContent = "";
    document.getElementById("staff-pin-modal").classList.remove("hidden");
    setTimeout(() => {
      const el = document.getElementById("staff-pin-new");
      if (el) el.focus();
    }, 100);
  },
  async submitStaffPin() {
    const errEl = document.getElementById("staff-pin-error");
    errEl.textContent = "";
    const p1 = document.getElementById("staff-pin-new").value.trim();
    const p2 = document.getElementById("staff-pin-confirm").value.trim();
    if (!/^\d{4,8}$/.test(p1)) {
      errEl.textContent = "PIN \u0E15\u0E49\u0E2D\u0E07\u0E40\u0E1B\u0E47\u0E19\u0E15\u0E31\u0E27\u0E40\u0E25\u0E02 4-8 \u0E2B\u0E25\u0E31\u0E01";
      return;
    }
    if (p1 !== p2) {
      errEl.textContent = "PIN \u0E2A\u0E2D\u0E07\u0E0A\u0E48\u0E2D\u0E07\u0E44\u0E21\u0E48\u0E15\u0E23\u0E07\u0E01\u0E31\u0E19";
      return;
    }
    try {
      const res = await API.put("/api/admin/users", { id: this._staffPinId, pin: p1 });
      if (res.success) {
        Utils.toast(`\u{1F511} \u0E15\u0E31\u0E49\u0E07 PIN \u0E43\u0E2B\u0E21\u0E48\u0E41\u0E25\u0E49\u0E27: ${p1}`);
        document.getElementById("staff-pin-modal").classList.add("hidden");
        await this.loadAdminUsers();
      } else {
        errEl.textContent = res.error || "\u0E15\u0E31\u0E49\u0E07 PIN \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08";
      }
    } catch (err) {
      errEl.textContent = err.message || "\u0E15\u0E31\u0E49\u0E07 PIN \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08";
    }
  },
  async clearStaffPin(id, name) {
    if (!confirm(`\u0E1B\u0E34\u0E14 login \u0E14\u0E49\u0E27\u0E22 PIN \u0E02\u0E2D\u0E07 "${name}"?`)) return;
    try {
      const res = await API.put("/api/admin/users", { id, clearPin: true });
      if (res.success) {
        Utils.toast(`\u0E1B\u0E34\u0E14 PIN \u0E02\u0E2D\u0E07 "${name}" \u0E41\u0E25\u0E49\u0E27`);
        await this.loadAdminUsers();
      } else Utils.toast(res.error || "\u0E1B\u0E34\u0E14 PIN \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08", "error");
    } catch (err) {
      Utils.toast("\u0E1B\u0E34\u0E14 PIN \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08: " + err.message, "error");
    }
  },
  // ===== Admin: Delete user =====
  async deleteAdminUser(id, name) {
    if (!confirm(`\u0E25\u0E1A\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49 "${name}"?`)) return;
    try {
      const token = Auth.getToken();
      const res = await fetch(API.baseUrl() + "/api/admin/users", {
        method: "DELETE",
        headers: __spreadValues({
          "Content-Type": "application/json"
        }, token ? { "Authorization": `Bearer ${token}` } : {}),
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) {
        Utils.toast(`\u{1F5D1}\uFE0F \u0E25\u0E1A\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49 "${name}" \u0E41\u0E25\u0E49\u0E27`);
        await this.loadAdminUsers();
      } else {
        Utils.toast(data.error || "\u0E25\u0E1A\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08", "error");
      }
    } catch (err) {
      Utils.toast("\u0E25\u0E1A\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08: " + err.message, "error");
    }
  },
  // ===== Admin: Load branch list =====
  async loadAdminBranches() {
    const listEl = document.getElementById("admin-branches-list");
    try {
      const res = await API.get("/api/admin/branches");
      if (!res.success || !res.branches.length) {
        listEl.innerHTML = '<p class="text-muted">\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E32\u0E02\u0E32</p>';
        return;
      }
      listEl.innerHTML = res.branches.map((b) => `
        <div class="admin-user-card">
          <div class="admin-user-info">
            <span class="admin-user-name">${this.escapeHTML(b.name)}</span>
            <span class="admin-user-meta">${this.escapeHTML(b.code)}</span>
          </div>
          <button class="btn-danger-sm" onclick="App.deleteAdminBranch('${this.escapeHTML(b.code)}', '${this.escapeHTML(b.name)}')">\u{1F5D1}\uFE0F</button>
        </div>
      `).join("");
    } catch (err) {
      listEl.innerHTML = `<p class="login-error">\u0E42\u0E2B\u0E25\u0E14\u0E2A\u0E32\u0E02\u0E32\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08: ${err.message}</p>`;
    }
  },
  // ===== Admin: Delete branch =====
  async deleteAdminBranch(code, name) {
    if (!confirm(`\u0E25\u0E1A\u0E2A\u0E32\u0E02\u0E32 "${name}" (${code})?`)) return;
    try {
      const token = Auth.getToken();
      const res = await fetch(API.baseUrl() + "/api/admin/branches", {
        method: "DELETE",
        headers: __spreadValues({
          "Content-Type": "application/json"
        }, token ? { "Authorization": `Bearer ${token}` } : {}),
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      if (data.success) {
        Utils.toast(`\u{1F5D1}\uFE0F \u0E25\u0E1A\u0E2A\u0E32\u0E02\u0E32 "${name}" \u0E41\u0E25\u0E49\u0E27`);
        await this.loadAdminBranches();
        const sel = document.getElementById("new-branch");
        const opt = sel.querySelector(`option[value="${code}"]`);
        if (opt) opt.remove();
      } else {
        Utils.toast(data.error || "\u0E25\u0E1A\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08", "error");
      }
    } catch (err) {
      Utils.toast("\u0E25\u0E1A\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08: " + err.message, "error");
    }
  },
  escapeHTML(str) {
    return String(str || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
  },
  // ===== Hard refresh — bypass HTTP cache + unregister SW + clear caches =====
  async hardRefresh() {
    const btn = document.getElementById("refresh-btn");
    if (btn) {
      btn.classList.add("spinning");
      btn.disabled = true;
    }
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          try {
            await r.unregister();
          } catch (e) {
          }
        }
      }
      if ("caches" in window) {
        const names = await caches.keys();
        for (const n of names) {
          try {
            await caches.delete(n);
          } catch (e) {
          }
        }
      }
      const newVer = await this.fetchServerVersion();
      if (newVer) localStorage.setItem("app_version", newVer);
      sessionStorage.setItem("bfr_update_done", newVer || "1");
      if (typeof Utils !== "undefined" && Utils.toast) {
        Utils.toast("\u{1F504} \u0E01\u0E33\u0E25\u0E31\u0E07\u0E23\u0E35\u0E40\u0E1F\u0E23\u0E0A...");
      }
      setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.set("_v", Date.now());
        window.location.replace(url.toString());
      }, 400);
    } catch (e) {
      console.error("Hard refresh failed:", e);
      window.location.reload();
    }
  },
  // ===== Update available — prompt user =====
  async applyUpdate() {
    if (this._updateTimer) {
      clearInterval(this._updateTimer);
      this._updateTimer = null;
    }
    const banner = document.getElementById("update-banner");
    if (banner) banner.remove();
    this._updateNotified = false;
    const newVer = await this.fetchServerVersion();
    if (newVer) {
      if (typeof Utils !== "undefined" && Utils.toast) {
        Utils.toast("\u2728 \u0E2D\u0E31\u0E1E\u0E40\u0E14\u0E17\u0E40\u0E1B\u0E47\u0E19\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19 " + newVer);
      }
    }
    this.hardRefresh();
  }
};
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("SW registration failed:", err);
    });
  });
}
document.addEventListener("DOMContentLoaded", () => App.init());
document.addEventListener("DOMContentLoaded", () => {
  const savedVehicle = Utils.getVehicle();
  const routeVehicle = document.getElementById("route-vehicle");
  if (routeVehicle) routeVehicle.value = savedVehicle;
  if (routeVehicle) {
    routeVehicle.addEventListener("change", () => Utils.setVehicle(routeVehicle.value));
  }
  const reportVehicle = document.getElementById("report-vehicle");
  if (reportVehicle) reportVehicle.value = savedVehicle;
  Utils.loadFuelPrices();
  const endMode = document.getElementById("route-end-mode");
  const endCustomer = document.getElementById("route-end-customer");
  if (endMode && endCustomer) {
    const populateEndCustomers = () => {
      const customers = Storage.getActiveCustomers();
      endCustomer.innerHTML = '<option value="">-- \u0E40\u0E25\u0E37\u0E2D\u0E01\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32 --</option>' + customers.map((c) => `<option value="${c.id}">${this.escapeHTML(c.name)} (${this.escapeHTML(c.cif || "-")})</option>`).join("");
    };
    populateEndCustomers();
    document.addEventListener("customersUpdated", populateEndCustomers);
    endMode.addEventListener("change", () => {
      if (endMode.value === "customer") {
        endCustomer.classList.remove("hidden");
      } else {
        endCustomer.classList.add("hidden");
      }
    });
  }
  const updateBtn = document.getElementById("update-db-btn");
  if (updateBtn) {
    updateBtn.addEventListener("click", async () => {
      updateBtn.classList.add("spinning");
      updateBtn.disabled = true;
      if (typeof Utils !== "undefined") Utils.toast("\u23F3 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E2D\u0E31\u0E1E\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25... (\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32+\u0E1E\u0E34\u0E01\u0E31\u0E14+\u0E2B\u0E19\u0E35\u0E49)");
      try {
        if (typeof Storage === "undefined" || !Storage.reloadStaticDB) {
          throw new Error("\u0E1F\u0E31\u0E07\u0E01\u0E4C\u0E0A\u0E31\u0E19\u0E2D\u0E31\u0E1E\u0E40\u0E14\u0E17\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E1E\u0E23\u0E49\u0E2D\u0E21");
        }
        const result = await Storage.reloadStaticDB();
        if (typeof Utils !== "undefined") {
          Utils.toast(`\u2705 \u0E2D\u0E31\u0E1E\u0E40\u0E14\u0E17\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08: \u0E25\u0E39\u0E01\u0E04\u0E49\u0E32 ${result.total} \u0E23\u0E32\u0E22 \xB7 \u0E2B\u0E19\u0E35\u0E49 ${result.debt} \u0E23\u0E32\u0E22` + (result.backfilled > 0 ? ` \xB7 \u0E40\u0E15\u0E34\u0E21\u0E02\u0E2D\u0E07\u0E40\u0E01\u0E48\u0E32 ${result.backfilled} \u0E23\u0E32\u0E22` : ""));
        }
        if (typeof Customers !== "undefined") Customers.renderAll();
        if (typeof Visit !== "undefined") Visit.render();
        if (typeof App !== "undefined") App.updateRouteUI();
      } catch (err) {
        if (typeof Utils !== "undefined") {
          Utils.toast(`\u274C \u0E2D\u0E31\u0E1E\u0E40\u0E14\u0E17\u0E25\u0E49\u0E21\u0E40\u0E2B\u0E25\u0E27: ${err.message}`, "error");
        }
        console.error("[UpdateDB]", err);
      } finally {
        updateBtn.classList.remove("spinning");
        updateBtn.disabled = false;
      }
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "F5" || (e.ctrlKey || e.metaKey) && e.key === "r") {
      e.preventDefault();
      App.hardRefresh();
    }
  });
});
(function() {
  const originalHandler = window.onerror;
  window.onerror = function(msg, source, line, col, error) {
    console.error("[Global Error]", msg, "at", source, line, col, error);
    try {
      if (typeof Utils !== "undefined" && Utils.toast) {
        const errStr = String(msg || (error == null ? void 0 : error.message) || "");
        const warnOnly = errStr.includes("ResizeObserver") || errStr.includes("Cancelled") || errStr.includes("AbortError");
        if (!warnOnly) {
          Utils.toast("\u26A0\uFE0F \u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E40\u0E25\u0E47\u0E01\u0E19\u0E49\u0E2D\u0E22 \u2014 \u0E1B\u0E34\u0E14\u0E41\u0E25\u0E49\u0E27\u0E40\u0E1B\u0E34\u0E14\u0E40\u0E27\u0E47\u0E1A\u0E43\u0E2B\u0E21\u0E48\u0E16\u0E49\u0E32\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49", "error");
        }
      }
    } catch (_) {
    }
    if (typeof originalHandler === "function") {
      return originalHandler.call(window, msg, source, line, col, error);
    }
    return true;
  };
  window.addEventListener("unhandledrejection", function(e) {
    var _a;
    console.error("[Unhandled Promise]", e.reason);
    try {
      if (typeof Utils !== "undefined" && Utils.toast) {
        const errStr = String(((_a = e.reason) == null ? void 0 : _a.message) || e.reason || "");
        if (!errStr.includes("AbortError") && !errStr.includes("Cancelled")) {
          Utils.toast("\u26A0\uFE0F \u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14 \u2014 \u0E16\u0E49\u0E32\u0E43\u0E0A\u0E49\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E25\u0E2D\u0E07\u0E1B\u0E34\u0E14\u0E41\u0E25\u0E49\u0E27\u0E40\u0E1B\u0E34\u0E14\u0E40\u0E27\u0E47\u0E1A\u0E43\u0E2B\u0E21\u0E48", "error");
        }
      }
    } catch (_) {
    }
  });
})();
const FilterPanel = {
  _panel: null,
  _toggle: null,
  init() {
    this._panel = document.getElementById("map-debt-filter");
    this._toggle = document.getElementById("mdf-toggle");
    if (!this._panel || !this._toggle) return;
    if (!this._panel.classList.contains("mdf-collapsed") && !this._hasActiveFilter()) {
      this._panel.classList.add("mdf-collapsed");
    }
    this._syncToggle();
    this._toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this._panel.querySelectorAll("select").forEach((sel) => {
      sel.addEventListener("change", () => this._syncToggle());
    });
    const resetBtn = document.getElementById("debt-filter-reset");
    if (resetBtn) resetBtn.addEventListener("click", () => setTimeout(() => this._syncToggle(), 0));
  },
  isCollapsed() {
    return this._panel ? this._panel.classList.contains("mdf-collapsed") : true;
  },
  expand() {
    if (!this._panel) return;
    this._panel.classList.remove("mdf-collapsed");
    this._syncToggle();
    if (typeof App !== "undefined" && App.setSheetState) {
      const sheet = document.getElementById("bottom-sheet");
      if (sheet && (sheet.classList.contains("sheet-half") || sheet.classList.contains("sheet-full"))) {
        App.setSheetState("peek");
      }
    }
  },
  collapse() {
    if (!this._panel) return;
    if (!this.isCollapsed()) {
      this._panel.classList.add("mdf-collapsed");
      this._syncToggle();
      const r = document.getElementById("msb-results");
      if (r) r.classList.add("hidden");
    } else {
      this._syncToggle();
    }
  },
  toggle() {
    if (this.isCollapsed()) this.expand();
    else this.collapse();
  },
  _hasActiveFilter() {
    const ids = ["debt-month-filter", "debt-tier-filter", "map-zone-filter", "debt-omsom-filter", "debt-15m-filter", "debt-reserve-filter"];
    return ids.some((id) => {
      const el = document.getElementById(id);
      return el && el.value !== "";
    });
  },
  _syncToggle() {
    if (!this._toggle) return;
    const collapsed = this.isCollapsed();
    this._toggle.textContent = collapsed ? "\u25BC" : "\u25B2";
    this._toggle.setAttribute("aria-expanded", String(!collapsed));
    this._toggle.classList.toggle("has-active", this._hasActiveFilter());
  }
};
const MapSearch = {
  _input: null,
  _results: null,
  _clearBtn: null,
  _allCustomersCache: null,
  _refreshTimer: null,
  init() {
    this._input = document.getElementById("map-search");
    this._results = document.getElementById("msb-results");
    this._clearBtn = document.getElementById("msb-clear");
    if (!this._input || !this._results) return;
    this._input.addEventListener("input", () => this._onInput());
    this._input.addEventListener("focus", () => {
      if (this._input.value) this._onInput();
    });
    this._clearBtn.addEventListener("click", () => this._clear());
    document.addEventListener("click", (e) => {
      const bar = document.getElementById("map-debt-filter");
      if (bar && !bar.contains(e.target)) this._hideResults();
    });
    this._refreshTimer = setInterval(() => {
      this._allCustomersCache = null;
    }, 3e4);
  },
  _getCustomers() {
    if (this._allCustomersCache) return this._allCustomersCache;
    if (typeof Storage !== "undefined" && Storage.getActiveCustomers) {
      this._allCustomersCache = Storage.getActiveCustomers();
    } else {
      this._allCustomersCache = [];
    }
    return this._allCustomersCache;
  },
  _onInput() {
    const q = this._input.value.trim();
    this._clearBtn.classList.toggle("hidden", !q);
    if (typeof Customers !== "undefined" && Customers.updateGpsGauge) Customers.updateGpsGauge();
    if (!q || q.length < 1) {
      this._hideResults();
      return;
    }
    const query = q.toLowerCase();
    const customers = this._getCustomers();
    const matches = customers.filter((c) => {
      const name = (c.name || "").toLowerCase();
      const nick = (c.nickname || "").toLowerCase();
      const cif = String(c.cif || "");
      const phone = String(c.phone || "");
      return name.includes(query) || nick.includes(query) || cif.includes(query) || phone.includes(query);
    });
    const top = matches.slice(0, 6);
    if (top.length === 0) {
      this._results.innerHTML = '<div class="msb-no-results">\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E17\u0E35\u0E48\u0E15\u0E23\u0E07\u0E01\u0E31\u0E1A "<strong>' + this._esc(q) + '</strong>"</div>';
      this._results.classList.remove("hidden");
      return;
    }
    const riskColors = { "\u0E41\u0E14\u0E07": "#d32f2f", "\u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E07": "#e6a817", "\u0E40\u0E02\u0E35\u0E22\u0E27": "#16a34a" };
    this._results.innerHTML = top.map((c) => {
      const color = riskColors[c.riskLevel] || "#9e9e9e";
      const sub = [c.cif ? "CIF:" + c.cif : "", c.phone, c.nickname].filter(Boolean).join(" \xB7 ");
      const id = c.id || c.cif;
      return '<div class="msb-result-item" data-id="' + this._escAttr(id) + '" role="option"><span class="msb-result-dot" style="background:' + color + '"></span><div class="msb-result-info"><div class="msb-result-name">' + this._esc(c.name || "\u0E44\u0E21\u0E48\u0E21\u0E35\u0E0A\u0E37\u0E48\u0E2D") + '</div><div class="msb-result-meta">' + this._esc(sub || "-") + "</div></div></div>";
    }).join("");
    const self = this;
    this._results.querySelectorAll(".msb-result-item").forEach((el) => {
      el.addEventListener("click", () => self._select(el.dataset.id));
    });
    this._results.classList.remove("hidden");
  },
  _select(id) {
    const customers = this._getCustomers();
    const c = customers.find((x) => x.id === id || String(x.cif) === id);
    if (!c) return;
    if (!c.lat || !c.lng) {
      if (typeof Utils !== "undefined") Utils.toast("\u26A0\uFE0F \u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E19\u0E35\u0E49\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E1A\u0E19\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48", "warn");
      this._clear();
      this._hideResults();
      return;
    }
    if (typeof Customers !== "undefined" && Customers.locateCustomer && Customers.map) {
      Customers.locateCustomer(c.id);
    }
    this._clear();
    this._hideResults();
    this._input.blur();
  },
  _clear() {
    if (this._input) this._input.value = "";
    if (this._clearBtn) this._clearBtn.classList.add("hidden");
    if (typeof Customers !== "undefined" && Customers.updateGpsGauge) Customers.updateGpsGauge();
    this._hideResults();
  },
  _hideResults() {
    if (this._results) this._results.classList.add("hidden");
  },
  _esc(s) {
    if (!s) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  },
  _escAttr(s) {
    if (!s) return "";
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
};
