// ===== Storage layer — localStorage + cloud sync =====

const Storage = {
  KEY_CUSTOMERS: 'bfr_customers',
  KEY_ROUTE: 'bfr_route',
  KEY_VISITS: 'bfr_visits',
  KEY_SYNC_TIME: 'bfr_last_sync',

  // Read customers
  getCustomers() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY_CUSTOMERS) || '[]');
    } catch { return []; }
  },

  // Save customers
  saveCustomers(list) {
    localStorage.setItem(this.KEY_CUSTOMERS, JSON.stringify(list));
  },

  // Add customer
  addCustomer(customer) {
    const list = this.getCustomers();
    customer.id = customer.id || Utils.uuid();
    customer.createdAt = customer.createdAt || new Date().toISOString();
    customer.createdBy = Auth.getUser()?.name || 'unknown';
    list.push(customer);
    this.saveCustomers(list);
    return customer;
  },

  // Update customer
  updateCustomer(id, updates) {
    const list = this.getCustomers();
    const idx = list.findIndex(c => c.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...updates };
      this.saveCustomers(list);
    }
  },

  // Delete customer
  deleteCustomer(id) {
    const list = this.getCustomers().filter(c => c.id !== id);
    this.saveCustomers(list);
  },

  // Today's route (selected customers for routing)
  getRoute() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY_ROUTE) || '[]');
    } catch { return []; }
  },

  saveRoute(list) {
    localStorage.setItem(this.KEY_ROUTE, JSON.stringify(list));
  },

  addToRoute(customerId) {
    const route = this.getRoute();
    if (!route.includes(customerId)) {
      route.push(customerId);
      this.saveRoute(route);
    }
  },

  removeFromRoute(customerId) {
    this.saveRoute(this.getRoute().filter(id => id !== customerId));
  },

  // Visit logs
  getVisits() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY_VISITS) || '{}');
    } catch { return {}; }
  },

  saveVisit(customerId, visit) {
    const visits = this.getVisits();
    visits[customerId] = {
      ...visit,
      timestamp: new Date().toISOString(),
      by: Auth.getUser()?.name || 'unknown',
    };
    localStorage.setItem(this.KEY_VISITS, JSON.stringify(visits));
  },

  // Sync with cloud (push local, pull remote, merge by id)
  async sync() {
    if (!navigator.onLine) return { skipped: true, reason: 'offline' };
    try {
      const local = this.getCustomers();
      const res = await API.syncCustomers(local);
      if (res.success && res.customers) {
        // Merge: keep local edits newer than remote
        const remoteMap = new Map(res.customers.map(c => [c.id, c]));
        const localMap = new Map(local.map(c => [c.id, c]));
        const merged = [];
        for (const [id, l] of localMap) {
          const r = remoteMap.get(id);
          if (!r) {
            merged.push(l);
          } else {
            const lTime = new Date(l.updatedAt || l.createdAt).getTime();
            const rTime = new Date(r.updatedAt || r.createdAt).getTime();
            merged.push(lTime >= rTime ? l : r);
          }
        }
        // Add remote-only customers
        for (const [id, r] of remoteMap) {
          if (!localMap.has(id)) merged.push(r);
        }
        this.saveCustomers(merged);
        localStorage.setItem(this.KEY_SYNC_TIME, new Date().toISOString());
        return { success: true, count: merged.length };
      }
      return { success: false };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  getLastSync() {
    return localStorage.getItem(this.KEY_SYNC_TIME);
  },
};

window.Storage = Storage;
