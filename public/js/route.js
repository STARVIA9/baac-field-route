// ===== Route planning + OSRM routing =====

const Route = {
  routeLine: null,
  currentResult: null,

  // Calculate route using OSRM
  async calculate(start, orderedCustomerIds) {
    const customers = Storage.getCustomers();
    const stops = orderedCustomerIds
      .map(id => customers.find(c => c.id === id))
      .filter(Boolean);

    if (stops.length === 0) {
      Utils.toast('กรุณาเพิ่มลูกค้าในเส้นทางก่อน', 'error');
      return null;
    }

    Utils.toast('🧮 กำลังคำนวณเส้นทาง...');

    // Build coordinates: start → stops
    const coords = [
      `${start.lng},${start.lat}`,
      ...stops.map(c => `${c.lng},${c.lat}`),
    ].join(';');

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
      // Add 30% detour factor for road vs straight-line
      const estDist = totalDist * 1.3;
      const estDuration = (estDist / 1000) / 40 * 3600; // 40 km/h avg
      const result = {
        distance: estDist,
        duration: estDuration,
        stops,
        geometry: null,
        order: orderedCustomerIds,
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
    }
    // current — use last known GPS
    return window._lastGPS || { lat: 13.7563, lng: 100.5018 };
  },

  // Draw route on map
  drawOnMap(result) {
    if (this.routeLine && Customers.map) {
      Customers.map.removeLayer(this.routeLine);
    }
    if (result.geometry && Customers.map) {
      const coords = result.geometry.coordinates.map(c => [c[1], c[0]]);
      this.routeLine = L.polyline(coords, {
        color: '#0a8f3c',
        weight: 5,
        opacity: 0.8,
      }).addTo(Customers.map);
      // Re-render markers with route order numbers
      Customers.renderMarkers(result.order);
      Customers.map.fitBounds(this.routeLine.getBounds(), { padding: [50, 50] });
    } else {
      // Fallback: still show order numbers
      Customers.renderMarkers(result.order);
    }
  },

  // Open in Google Maps
  openGoogleMaps() {
    if (!this.currentResult) return;
    const start = this.getStartCoords();
    const waypoints = this.currentResult.stops
      .map(c => `${c.lat},${c.lng}`)
      .join('/');
    const url = `https://www.google.com/maps/dir/${start.lat},${start.lng}/${waypoints}/@${start.lat},${start.lng},12z/data=!3m1!4b1!4m2!4m1!3e0`;
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
