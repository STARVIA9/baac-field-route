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
      Storage.addToRoute(id);
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
      const roadClassification = document.getElementById(road-classification)?.value || 'auto';
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

  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },
};
