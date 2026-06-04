// ===== Customers management + Map rendering =====

const Customers = {
  map: null,
  markers: {},
  currentFilter: 'all',

  // Init map
  initMap() {
    if (this.map) return;
    // Default: BAAC Wang Tha Chang (approx)
    this.map = L.map('map').setView([13.7563, 100.5018], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(this.map);

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
  renderMarkers(routeOrder) {
    if (!this.map) return;
    // Clear existing
    Object.values(this.markers).forEach(m => this.map.removeLayer(m));
    this.markers = {};

    const customers = Storage.getCustomers();
    const visits = Storage.getVisits();
    // Build order map: id -> order number (1-based)
    const orderMap = {};
    if (routeOrder && routeOrder.length) {
      routeOrder.forEach((id, idx) => { orderMap[id] = idx + 1; });
    }
    customers.forEach((c, idx) => {
      const visited = !!visits[c.id];
      const orderNum = orderMap[c.id] || (idx + 1);
      const icon = L.divIcon({
        className: '',
        html: `<div class="customer-marker ${visited ? 'visited' : ''}">${orderNum}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      const marker = L.marker([c.lat, c.lng], { icon }).addTo(this.map);
      marker.bindPopup(this.popupHTML(c));
      this.markers[c.id] = marker;
    });

    // Fit bounds if any customers
    if (customers.length > 0) {
      const bounds = L.latLngBounds(customers.map(c => [c.lat, c.lng]));
      this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }
  },

  // Popup HTML
  popupHTML(c) {
    return `
      <div class="popup-name">${this.escapeHTML(c.name)}</div>
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
    document.querySelector('#add-customer-form [name=name]').value = c.name;
    document.querySelector('#add-customer-form [name=phone]').value = c.phone || '';
    document.querySelector('#add-customer-form [name=address]').value = c.address || '';
    document.querySelector('#add-customer-form [name=lat]').value = c.lat;
    document.querySelector('#add-customer-form [name=lng]').value = c.lng;
    document.querySelector('#add-customer-form [name=note]').value = c.note || '';
    document.getElementById('add-customer-form').dataset.editId = id;
    App.openAddCustomerModal();
  },

  // Delete customer
  async del(id) {
    if (!confirm('ลบลูกค้าคนนี้?')) return;
    Storage.deleteCustomer(id);
    Storage.removeFromRoute(id);
    this.renderAll();
    Utils.toast('ลบลูกค้าแล้ว');
    await Storage.sync();
  },

  // Render customer list (Customers tab)
  renderList() {
    const list = document.getElementById('customers-list');
    let customers = Storage.getCustomers();
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
      return `
        <div class="customer-card ${visited ? 'visited' : ''}">
          <div class="customer-avatar">${visited ? '✓' : '👤'}</div>
          <div class="customer-info">
            <div class="customer-name">${this.escapeHTML(c.name)}</div>
            ${c.cif ? `<div class="customer-cif">CIF: ${this.escapeHTML(c.cif)}</div>` : ''}
            <div class="customer-address">${this.escapeHTML(c.address || 'ไม่มีที่อยู่')}</div>
          </div>
          <div class="customer-actions">
            <button class="btn-small ${inRoute ? 'btn-route-active' : ''}" onclick="Customers.toggleRoute('${c.id}')" title="เพิ่มในเส้นทาง">
              ${inRoute ? '✓' : '➕'}
            </button>
            <button class="btn-small" onclick="Customers.edit('${c.id}')" title="แก้ไข">✏️</button>
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

  // Render everything
  renderAll(routeOrder) {
    this.renderMarkers(routeOrder);
    this.renderList();
  },

  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },
};

window.Customers = Customers;
