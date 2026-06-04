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
      document.getElementById('new-lat').value = e.latlng.lat.toFixed(6);
      document.getElementById('new-lng').value = e.latlng.lng.toFixed(6);
      App.openAddCustomerModal();
    });
  },

  // Render all markers on map
  renderMarkers() {
    if (!this.map) return;
    // Clear existing
    Object.values(this.markers).forEach(m => this.map.removeLayer(m));
    this.markers = {};

    const customers = Storage.getCustomers();
    const visits = Storage.getVisits();
    customers.forEach((c, idx) => {
      const visited = !!visits[c.id];
      const icon = L.divIcon({
        className: '',
        html: `<div class="customer-marker ${visited ? 'visited' : ''}">${idx + 1}</div>`,
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

    document.getElementById('customer-count').textContent = customers.length;

    if (customers.length === 0) {
      list.innerHTML = `<p class="empty-state">ยังไม่มีลูกค้า กดปุ่ม <strong>＋</strong> มุมขวาล่างเพื่อเพิ่ม</p>`;
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
  renderAll() {
    this.renderMarkers();
    this.renderList();
  },

  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },
};

window.Customers = Customers;
