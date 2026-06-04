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

    const customers = Storage.getCustomers();
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
    const customers = Storage.getCustomers();
    const el = document.getElementById('quick-chips');
    const countEl = document.getElementById('quick-count');
    countEl.textContent = this.selected.length;

    if (this.selected.length === 0) {
      el.innerHTML = `<p style="color:#5a655a;font-size:12px;margin:0;padding:4px 0">ยังไม่ได้เลือกลูกค้า — พิมพ์ CIF/ชื่อด้านบน</p>`;
      document.getElementById('btn-quick-route').disabled = true;
      return;
    }

    el.innerHTML = this.selected.map(id => {
      const c = customers.find(x => x.id === id);
      if (!c) return '';
      return `
        <span class="quick-chip">
          <span class="quick-chip-cif">${this.escapeHTML(c.cif || '-')}</span>
          ${this.escapeHTML(c.name)}
          <button class="quick-chip-remove" onclick="Quick.toggle('${c.id}')" title="เอาออก">×</button>
        </span>
      `;
    }).join('');

    document.getElementById('btn-quick-route').disabled = false;
  },

  // Calculate route from selected
  async calculate() {
    if (this.selected.length === 0) return;
    const start = this.getStartCoords();
    const ordered = TSP.plan(start, this.selected);
    const result = await Route.calculate(start, ordered);
    if (result) this.showResult(result);
  },

  // Get start coords from quick start mode
  getStartCoords() {
    const mode = document.getElementById('quick-start-mode')?.value || 'current';
    if (mode === 'office') {
      return { lat: 13.7563, lng: 100.5018 }; // BAAC Wang Tha Chang
    }
    return window._lastGPS || { lat: 13.7563, lng: 100.5018 };
  },

  // Show result inline (different from Route.showResult which targets #route-result)
  showResult(result) {
    const resultEl = document.getElementById('quick-route-result');
    resultEl.classList.remove('hidden');

    resultEl.innerHTML = `
      <div class="result-card">
        <h3>📊 สรุปเส้นทาง</h3>
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

    // Draw on map
    Route.drawOnMap(result);
    // Scroll to result
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    Utils.toast(`✅ เส้นทางพร้อม: ${Utils.formatKm(result.distance)} กม. / ${Math.round(result.duration / 60)} นาที`);
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
