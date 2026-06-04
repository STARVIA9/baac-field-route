// ===== Route planning + OSRM routing =====

const Route = {
  routeLine: null,
  endMarker: null,  // marker for endpoint (if different from start)
  currentResult: null,

  // Calculate route using OSRM
  // start: {lat, lng} — required start point
  // orderedCustomerIds: array of customer IDs in visit order
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

    // Build coordinates: start → stops → [end]
    const coordList = [
      { lat: start.lat, lng: start.lng },
      ...stops.map(c => ({ lat: c.lat, lng: c.lng })),
    ];
    if (isOpenPath) coordList.push({ lat: end.lat, lng: end.lng });

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
      const estDuration = (estDist / 1000) / 40 * 3600; // 40 km/h avg
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
      };
      this.currentResult = result;
      Utils.toast('⚠️ ใช้การประมาณ (OSRM ไม่ตอบสนอง)');
      return result;
    }
  },

  // Show result on UI
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
    // Fuel display
    const fuelEl = document.getElementById('result-fuel');
    if (fuelEl && result.fuel) {
      const v = result.fuel.vehicle;
      fuelEl.innerHTML = `
        <div class="fuel-card">
          <div class="fuel-icon">⛽</div>
          <div class="fuel-info">
            <div class="fuel-amount">~${result.fuel.liters.toFixed(2)} ลิตร</div>
            <div class="fuel-cost">~${Utils.formatBaht(result.fuel.baht)} บาท</div>
            <div class="fuel-meta">${v.name} · ${v.kmPerLiter} กม./ลิตร</div>
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

  // Get start coordinates
  getStartCoords() {
    const mode = document.getElementById('route-start-mode').value;
    if (mode === 'custom') {
      return {
        lat: parseFloat(document.getElementById('start-lat').value),
        lng: parseFloat(document.getElementById('start-lng').value),
      };
    } else if (mode === 'office') {
      // BAAC Wang Tha Chang (approx)
      return { lat: 13.7563, lng: 100.5018 };
    } else if (mode === 'last-stop') {
      // End of last leg — use the last customer in the route
      return window._routeEnd || { lat: 13.7563, lng: 100.5018 };
    }
    // current — use last known GPS
    return window._lastGPS || { lat: 13.7563, lng: 100.5018 };
  },

  // Get end coordinates (for open-path route)
  getEndCoords() {
    const mode = document.getElementById('route-end-mode')?.value || 'none';
    if (mode === 'none') return null; // round trip
    if (mode === 'current') {
      return window._lastGPS || { lat: 13.7563, lng: 100.5018 };
    }
    if (mode === 'office') {
      return { lat: 13.7563, lng: 100.5018 };
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

  // Draw route on map
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

  // Open in Google Maps
  openGoogleMaps() {
    if (!this.currentResult) return;
    const start = this.getStartCoords();
    const end = this.currentResult.end;
    const waypoints = this.currentResult.stops
      .map(c => `${c.lat},${c.lng}`)
      .join('/');
    // Open path: A → waypoints → B
    // Round trip: A → waypoints → A
    const endParam = end ? `/${end.lat},${end.lng}` : `/${start.lat},${start.lng}`;
    const url = `https://www.google.com/maps/dir/${start.lat},${start.lng}/${waypoints}${endParam}/@${start.lat},${start.lng},12z/data=!3m1!4b1!4m2!4m1!3e0`;
    window.open(url, '_blank');
  },

  // Save route snapshot
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

window.Route = Route;
