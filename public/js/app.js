// ===== Main App — orchestration + event handlers =====

const App = {
  // Init
  async init() {
    if (Auth.isLoggedIn()) {
      Auth.showApp();
      await this.afterLogin();
    } else {
      Auth.showLogin();
    }
    this.attachEvents();
  },

  // After login — load data
  async afterLogin() {
    Customers.initMap();
    Customers.renderAll();
    Visit.render();
    this.updateRouteUI();

    // Sync with cloud
    const sync = await Storage.sync();
    if (sync.success) {
      console.log(`Synced ${sync.count} customers`);
      Customers.renderAll();
      this.updateRouteUI();
    }
  },

  // Attach all event handlers
  attachEvents() {
    // Login form
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = document.getElementById('pin-input').value;
      const errEl = document.getElementById('login-error');
      errEl.textContent = '';
      const btn = document.getElementById('login-btn');
      btn.disabled = true;
      btn.textContent = 'กำลังเข้าสู่ระบบ...';
      const ok = await Auth.login(pin);
      if (ok) {
        await this.afterLogin();
      } else {
        errEl.textContent = 'PIN ไม่ถูกต้อง';
      }
      btn.disabled = false;
      btn.textContent = 'เข้าสู่ระบบ';
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
      if (confirm('ออกจากระบบ?')) Auth.logout();
    });

    // Tabs
    document.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => this.switchTab(t.dataset.tab));
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

    // FAB buttons
    document.getElementById('fab-add-customer').addEventListener('click', () => this.openAddCustomerModal());
    document.getElementById('fab-my-location').addEventListener('click', () => this.useGPS());

    // Modal close
    document.getElementById('close-add-modal').addEventListener('click', () => this.closeAddCustomerModal());
    document.getElementById('add-customer-modal').addEventListener('click', (e) => {
      if (e.target.id === 'add-customer-modal') this.closeAddCustomerModal();
    });

    // GPS button
    document.getElementById('btn-use-gps').addEventListener('click', () => this.useGPS(true));

    // Add customer form
    document.getElementById('add-customer-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveCustomer(e.target);
    });

    // Visit modal
    document.getElementById('close-visit-modal').addEventListener('click', () => Visit.closeLog());
    document.getElementById('btn-cancel-visit').addEventListener('click', () => Visit.closeLog());
    document.getElementById('visit-log-form').addEventListener('submit', (e) => {
      e.preventDefault();
      Visit.submit(e.target);
    });
    document.getElementById('visit-log-modal').addEventListener('click', (e) => {
      if (e.target.id === 'visit-log-modal') Visit.closeLog();
    });

    // Route: start mode
    document.getElementById('route-start-mode').addEventListener('change', (e) => {
      document.getElementById('custom-start').classList.toggle('hidden', e.target.value !== 'custom');
    });

    // Calculate route
    document.getElementById('btn-calculate-route').addEventListener('click', () => this.calculateRoute());

    // Open Google Maps
    document.getElementById('btn-open-gmaps').addEventListener('click', () => Route.openGoogleMaps());

    // Save route
    document.getElementById('btn-save-route').addEventListener('click', () => Route.saveRoute());
  },

  // Switch tab
  switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
    document.getElementById(`tab-${name}`).classList.add('active');
    if (name === 'map') {
      // Re-render map size after showing
      setTimeout(() => Customers.map && Customers.map.invalidateSize(), 100);
    }
  },

  // Open add customer modal
  openAddCustomerModal() {
    document.getElementById('add-customer-modal').classList.remove('hidden');
    document.getElementById('add-customer-form').dataset.editId = '';
    document.getElementById('add-customer-form').reset();
  },

  closeAddCustomerModal() {
    document.getElementById('add-customer-modal').classList.add('hidden');
  },

  // Save customer (add or edit)
  async saveCustomer(form) {
    const data = Object.fromEntries(new FormData(form));
    const editId = form.dataset.editId;
    if (editId) {
      Storage.updateCustomer(editId, data);
      Utils.toast('แก้ไขลูกค้าแล้ว');
    } else {
      Storage.addCustomer(data);
      Utils.toast('เพิ่มลูกค้าแล้ว ✓');
    }
    this.closeAddCustomerModal();
    Customers.renderAll();
    await Storage.sync();
  },

  // Use GPS
  useGPS(forForm = false) {
    if (!navigator.geolocation) {
      Utils.toast('เบราว์เซอร์ไม่รองรับ GPS', 'error');
      return;
    }
    Utils.toast('📍 กำลังค้นหาตำแหน่ง...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        window._lastGPS = { lat, lng };
        if (forForm) {
          document.getElementById('new-lat').value = lat.toFixed(6);
          document.getElementById('new-lng').value = lng.toFixed(6);
          Utils.toast('📍 ใช้ตำแหน่งปัจจุบันแล้ว');
        } else {
          if (Customers.map) {
            Customers.map.setView([lat, lng], 15);
            L.marker([lat, lng], {
              icon: L.divIcon({
                className: '',
                html: '<div class="customer-marker current">📍</div>',
                iconSize: [32, 32],
                iconAnchor: [16, 16],
              }),
            }).addTo(Customers.map).bindPopup('📍 ตำแหน่งปัจจุบัน');
          }
        }
      },
      (err) => {
        Utils.toast('ไม่สามารถเข้าถึง GPS: ' + err.message, 'error');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  },

  // Update route tab UI
  updateRouteUI() {
    const route = Storage.getRoute();
    const customers = Storage.getCustomers();
    const routeCustomers = route.map(id => customers.find(c => c.id === id)).filter(Boolean);
    const el = document.getElementById('route-customers');
    const btn = document.getElementById('btn-calculate-route');

    if (routeCustomers.length === 0) {
      el.innerHTML = `<p class="empty-state">เลือกลูกค้าจากแท็บ "ลูกค้า" → กด "เพิ่มในเส้นทางวันนี้"</p>`;
      btn.disabled = true;
      return;
    }

    el.innerHTML = routeCustomers.map(c => `
      <div class="route-customer-chip">
        <div class="customer-avatar">${c.name[0]}</div>
        <div class="customer-info" style="flex:1;min-width:0">
          <div class="customer-name">${this.escapeHTML(c.name)}</div>
          <div class="customer-address">${this.escapeHTML(c.address || '')}</div>
        </div>
        <button class="chip-remove" onclick="Customers.toggleRoute('${c.id}')" title="เอาออก">×</button>
      </div>
    `).join('');

    btn.disabled = false;
  },

  // Calculate route
  async calculateRoute() {
    const route = Storage.getRoute();
    if (route.length === 0) return;
    const start = Route.getStartCoords();

    // Plan optimal order
    const ordered = TSP.plan(start, route);

    // Get real route from OSRM
    const result = await Route.calculate(start, ordered);
    if (result) {
      Route.showResult(result);
      this.switchTab('map'); // show route on map
      Utils.toast(`✅ เส้นทางพร้อม: ${Utils.formatKm(result.distance)} กม.`);
    }
  },

  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
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

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
