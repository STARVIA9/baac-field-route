// ===== Quick Route — fast CIF/name search + auto-route =====

const Quick = {
  selected: [], // array of customer ids
  MAX_SELECT: 10,

  // Init
  init() {
    this.attachEvents();
  },

  // Attach events
  attachEvents() {
    const search = document.getElementById('quick-search');
    if (search) {
      search.addEventListener('input', () => this.search(search.value));
      search.addEventListener('focus', () => {
        if (search.value.trim()) this.search(search.value);
      });
      // Close dropdown on outside click
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.quick-search-box')) {
          document.getElementById('quick-results').classList.remove('active');
        }
      });
    }
    document.getElementById('btn-clear-quick').addEventListener('click', () => this.clear());
    document.getElementById('btn-quick-route').addEventListener('click', () => this.calculate());
  },

  // Search customers by CIF, name, phone, address
  search(query) {
    const q = (query || '').trim().toLowerCase();
    const resultsEl = document.getElementById('quick-results');

    if (q.length < 1) {
      resultsEl.classList.remove('active');
      resultsEl.innerHTML = '';
      return;
    }

    const customers = Storage.getActiveCustomers();
    // Match by CIF, name, phone, address
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
      const isSelected = this.selected.includes(c.id);
      const disabled = isSelected ? 'disabled' : '';
      return `
        <div class="quick-result-item">
          <div class="quick-result-info">
            <div class="quick-result-name">${this.escapeHTML(c.name)}</div>
            <div class="quick-result-meta">${c.address ? this.escapeHTML(c.address) : 'ไม่มีที่อยู่'}${c.phone ? ' · ' + this.escapeHTML(c.phone) : ''}</div>
          </div>
          <span class="quick-result-cif">${this.escapeHTML(c.cif || '-')}</span>
          <button class="quick-result-add" ${disabled} onclick="Quick.toggle('${c.id}')" title="${isSelected ? 'เลือกแล้ว' : 'เพิ่ม'}">
            ${isSelected ? '✓' : '+'}
          </button>
        </div>
      `;
    }).join('');
    resultsEl.classList.add('active');
  },

  // Toggle customer selection
  toggle(id) {
    const idx = this.selected.indexOf(id);
    if (idx >= 0) {
      this.selected.splice(idx, 1);
    } else {
      if (this.selected.length >= this.MAX_SELECT) {
        Utils.toast(`เลือกได้สูงสุด ${this.MAX_SELECT} คน`, 'error');
        return;
      }
      this.selected.push(id);
    }
    this.renderSelected();
    // Re-search to update button states
    const search = document.getElementById('quick-search');
    if (search.value) this.search(search.value);
  },

  // Clear all
  clear() {
    this.selected = [];
    this.renderSelected();
    document.getElementById('quick-route-result').classList.add('hidden');
    Utils.toast('ล้างรายการแล้ว');
  },

  // Render selected chips
  renderSelected() {
    const customers = Storage.getActiveCustomers();
    const el = document.getElementById('quick-chips');
    const countEl = document.getElementById('quick-count');
    countEl.textContent = this.selected.length;

    if (this.selected.length === 0) {
      el.innerHTML = `<p style="color:#5a655a;font-size:12px;margin:0;padding:4px 0">ยังไม่ได้เลือกลูกค้า — พิมพ์ CIF/ชื่อด้านบน</p>`;
      document.getElementById('btn-quick-route').disabled = true;
      return;
    }

    el.innerHTML = this.selected.map((id, idx) => {
      const c = customers.find(x => x.id === id);
      if (!c) return '';
      const isFirst = idx === 0;
      const isLast = idx === this.selected.length - 1;
      return `
        <span class="quick-chip" draggable="true" data-id="${c.id}" data-idx="${idx}"
              ondragstart="Quick.dragStart(event, ${idx})"
              ondragover="Quick.dragOver(event)"
              ondrop="Quick.drop(event, ${idx})"
              ondragend="Quick.dragEnd(event)">
          <span class="quick-chip-num">${idx + 1}</span>
          <span class="quick-chip-cif">${this.escapeHTML(c.cif || '-')}</span>
          ${this.escapeHTML(c.name)}
          <span class="quick-chip-order">
            <button onclick="Quick.move(${idx}, -1)" ${isFirst ? 'disabled' : ''} title="เลื่อนขึ้น">▲</button>
            <button onclick="Quick.move(${idx}, 1)" ${isLast ? 'disabled' : ''} title="เลื่อนลง">▼</button>
          </span>
          <button class="quick-chip-remove" onclick="Quick.toggle('${c.id}')" title="เอาออก">×</button>
        </span>
      `;
    }).join('');

    document.getElementById('btn-quick-route').disabled = false;
  },

  // Move item up/down
  move(idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= this.selected.length) return;
    [this.selected[idx], this.selected[newIdx]] = [this.selected[newIdx], this.selected[idx]];
    this.renderSelected();
    // Re-search to refresh button states
    const search = document.getElementById('quick-search');
    if (search.value) this.search(search.value);
  },

  // Drag & drop reordering
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
    [this.selected[fromIdx], this.selected[targetIdx]] = [this.selected[targetIdx], this.selected[fromIdx]];
    this.renderSelected();
    const search = document.getElementById('quick-search');
    if (search.value) this.search(search.value);
  },
  dragEnd(e) {
    e.target.classList.remove('dragging');
  },

  // Calculate route from selected
  // Supports open path: start → ... → end (instead of round trip)
  async calculate() {
    if (this.selected.length === 0) return;
    const start = this.getStartCoords();
    const end = this.getEndCoords();
    // TSP: nearest-neighbor + 2-opt
    const ordered = TSP.plan(start, this.selected, end);
    // OSRM: real road routing
    const result = await Route.calculate(start, ordered, end);
    if (result) this.showResult(result);
  },

  // Get start coords from quick start mode
  getStartCoords() {
    const mode = document.getElementById('quick-start-mode')?.value || 'current';
    if (mode === 'office') {
      return { lat: window.OFFICE_LOCATION.lat, lng: window.OFFICE_LOCATION.lng }; // BAAC สาขาวังท่าช้าง
    }
    return window._lastGPS || { lat: window.OFFICE_LOCATION.lat, lng: window.OFFICE_LOCATION.lng };
  },

  // Get end coords (for open path)
  getEndCoords() {
    const mode = document.getElementById('quick-end-mode')?.value || 'none';
    if (mode === 'none') return null;
    if (mode === 'current') {
      return window._lastGPS || { lat: window.OFFICE_LOCATION.lat, lng: window.OFFICE_LOCATION.lng };
    }
    if (mode === 'office') {
      return { lat: window.OFFICE_LOCATION.lat, lng: window.OFFICE_LOCATION.lng };
    }
    return null;
  },

  // Get vehicle profile (synced with Route tab)
  getVehicle() {
    return Utils.getVehicle();
  },

  // Show result inline (different from Route.showResult which targets #route-result)
  showResult(result) {
    const resultEl = document.getElementById('quick-route-result');
    resultEl.classList.remove('hidden');

    const routeTypeBadge = result.isOpenPath
      ? '<span class="route-type-badge open">🔀 เปิด (มีจุดสิ้นสุด)</span>'
      : '<span class="route-type-badge round">🔄 ไป-กลับ</span>';

    const fuelHtml = result.fuel ? `
      <div class="quick-fuel">
        <span class="quick-fuel-icon">⛽</span>
        <span class="quick-fuel-amount">~${result.fuel.liters.toFixed(2)} ลิตร</span>
        <span class="quick-fuel-cost">~${Utils.formatBaht(result.fuel.baht)} บาท</span>
        <span class="quick-fuel-meta">${result.fuel.vehicle.name}</span>
      </div>
    ` : '';

    resultEl.innerHTML = `
      <div class="result-card">
        <h3>📊 สรุปเส้นทาง ${routeTypeBadge}</h3>
        <div class="result-stats">
          <div class="stat">
            <span class="stat-value">${Utils.formatKm(result.distance)}</span>
            <span class="stat-label">กิโลเมตร</span>
          </div>
          <div class="stat">
            <span class="stat-value">${Math.round(result.duration / 60)}</span>
            <span class="stat-label">นาที</span>
          </div>
          <div class="stat">
            <span class="stat-value">${result.stops.length}</span>
            <span class="stat-label">จุดแวะ</span>
          </div>
        </div>
        ${fuelHtml}
      </div>
      <ol class="route-order">
        ${result.stops.map((c, idx) => {
          const prev = idx === 0 ? this.getStartCoords() : result.stops[idx - 1];
          const d = Utils.haversine(prev.lat, prev.lng, c.lat, c.lng);
          return `
            <li>
              <div class="order-num">${idx + 1}</div>
              <div class="order-info">
                <div class="order-name">${this.escapeHTML(c.name)}</div>
                <div class="order-distance">
                  <span class="quick-result-cif">${this.escapeHTML(c.cif || '-')}</span>
                  · ${Utils.formatKm(d)} กม.
                </div>
              </div>
            </li>
          `;
        }).join('')}
      </ol>
      <div class="route-actions">
        <button class="btn-primary" onclick="Quick.openGoogleMaps()">📤 เปิด Google Maps นำทาง</button>
        <button class="btn-secondary" onclick="Quick.saveAsRoute()">💾 บันทึกเป็นเส้นทางวันนี้</button>
      </div>
    `;

    // Draw on map (now includes end marker if open path)
    Route.drawOnMap(result);
    // Scroll to result
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const routeType = result.isOpenPath ? ' (เปิด)' : '';
    Utils.toast(`✅ เส้นทาง${routeType}พร้อม: ${Utils.formatKm(result.distance)} กม. / ${Math.round(result.duration / 60)} นาที / ~${result.fuel ? Utils.formatBaht(result.fuel.baht) : '?'} บาท`);
  },

  // Open Google Maps for current result
  openGoogleMaps() {
    Route.openGoogleMaps();
  },

  // Save current selection as today's route
  saveAsRoute() {
    Storage.saveRoute([...this.selected]);
    Utils.toast('💾 บันทึกเป็นเส้นทางวันนี้แล้ว → ไปดูที่แท็บ "เส้นทาง"');
  },

  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },
};

window.Quick = Quick;
