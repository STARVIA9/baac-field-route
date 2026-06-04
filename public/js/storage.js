// ===== Storage layer — localStorage + real-time cloud sync =====

const Storage = {
  KEY_CUSTOMERS: 'bfr_customers',
  KEY_ROUTE: 'bfr_route',
  KEY_VISITS: 'bfr_visits',
  KEY_SYNC_TIME: 'bfr_last_sync',
  KEY_SERVER_TIME: 'bfr_server_time',
  KEY_SAVED_ROUTES: 'bfr_saved_routes',

  // ===== Local persistence (always first — fast, offline) =====
  getCustomers() {
    try { return JSON.parse(localStorage.getItem(this.KEY_CUSTOMERS) || '[]'); }
    catch { return []; }
  },

  // Returns only non-deleted customers (for UI display)
  getActiveCustomers() {
    return this.getCustomers().filter(c => !c.deleted);
  },

  saveCustomers(list) {
    localStorage.setItem(this.KEY_CUSTOMERS, JSON.stringify(list));
  },

  addCustomer(customer) {
    const list = this.getCustomers();
    customer.id = customer.id || Utils.uuid();
    customer.createdAt = customer.createdAt || new Date().toISOString();
    customer.updatedAt = new Date().toISOString();
    customer.createdBy = Auth.getUser()?.name || 'unknown';
    // ===== Phase 1: Risk classification (BAAC debt follow-up) =====
    // riskLevel: 'unclassified' | 'good' | 'warning' | 'bad'
    //   - unclassified: ยังไม่จัดระดับ (default สำหรับลูกค้าเก่าที่ migrate)
    //   - good: ดี ติดตามง่าย
    //   - warning: เริ่มมีปัญหา ยังติดต่อได้
    //   - bad: มีปัญหามาก ติดต่อยาก/ไม่ได้
    customer.riskLevel = customer.riskLevel || 'unclassified';
    // debtType: 'current' (หนี้ถึงกำหนด ยังไม่เกินกำหนด) | 'overdue' (หนี้ค้าง เลยกำหนดแล้ว) | null
    customer.debtType = customer.debtType || null;
    list.push(customer);
    this.saveCustomers(list);
    this.push(); // auto-sync
    return customer;
  },

  updateCustomer(id, updates) {
    const list = this.getCustomers();
    const idx = list.findIndex(c => c.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...updates, updatedAt: new Date().toISOString() };
      this.saveCustomers(list);
      this.push();
    }
  },

  // ===== Phase 1 + Nickname/Photo: Migrate old customers to new schema =====
  // ลูกค้าเดิมที่ไม่มี riskLevel → 'unclassified' (marker แสดง "?" ไม่มีสี)
  // ลูกค้าเดิมที่ไม่มี debtType → null
  // Phase 2: เพิ่ม nickname + photo (รูปถ่าย base64)
  migrateCustomers() {
    const list = this.getCustomers();
    let changed = false;
    list.forEach(c => {
      if (!c.riskLevel) {
        c.riskLevel = 'unclassified';
        c.updatedAt = new Date().toISOString();
        changed = true;
      }
      if (c.debtType === undefined) {
        c.debtType = null;
        changed = true;
      }
      if (c.nickname === undefined) {
        c.nickname = '';
        changed = true;
      }
      if (c.photo === undefined) {
        c.photo = null;
        changed = true;
      }
    });
    if (changed) {
      this.saveCustomers(list);
      console.log('[Storage] Migrated', list.length, 'customers to new schema');
    }
    return list;
  },

  deleteCustomer(id) {
    // Soft delete: mark as deleted so mergeByUpdatedAt skips it on pull
    const list = this.getCustomers();
    const idx = list.findIndex(c => c.id === id);
    if (idx >= 0) {
      list[idx].deleted = true;
      list[idx].updatedAt = new Date().toISOString();
      this.saveCustomers(list);
      this.push();
    }
  },

  getRoute() {
    try { return JSON.parse(localStorage.getItem(this.KEY_ROUTE) || '[]'); }
    catch { return []; }
  },

  saveRoute(list) {
    localStorage.setItem(this.KEY_ROUTE, JSON.stringify(list));
    this.push();
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

  getVisits() {
    try { return JSON.parse(localStorage.getItem(this.KEY_VISITS) || '{}'); }
    catch { return {}; }
  },

  saveVisit(customerId, visit) {
    const visits = this.getVisits();
    visits[customerId] = {
      ...visit,
      timestamp: new Date().toISOString(),
      by: Auth.getUser()?.name || 'unknown',
    };
    localStorage.setItem(this.KEY_VISITS, JSON.stringify(visits));
    this.push();
  },

  getSavedRoutes() {
    try { return JSON.parse(localStorage.getItem(this.KEY_SAVED_ROUTES) || '[]'); }
    catch { return []; }
  },

  saveSavedRoute(route) {
    const list = this.getSavedRoutes();
    route.id = route.id || Utils.uuid();
    route.savedAt = route.savedAt || new Date().toISOString();
    route.savedBy = Auth.getUser()?.name || 'unknown';
    list.push(route);
    localStorage.setItem(this.KEY_SAVED_ROUTES, JSON.stringify(list));
    this.push();
    return route;
  },

  // ===== Cloud sync — push local + pull remote =====
  // Uses unified /api/sync endpoint that handles customers + visits + savedRoutes
  _pushInFlight: null,
  _pullInFlight: null,
  _listeners: [],

  // Push local changes to cloud (after every save)
  async push() {
    if (!navigator.onLine) return { skipped: 'offline' };
    // Debounce: if push is in-flight, wait for it
    if (this._pushInFlight) {
      return this._pushInFlight;
    }
    const payload = {
      customers: this.getCustomers(),
      visits: this.getVisits(),
      savedRoutes: this.getSavedRoutes(),
    };
    this._pushInFlight = (async () => {
      try {
        this._notifyListeners({ status: 'syncing' });
        const res = await API.syncAll(payload);
        if (res && res.success) {
          localStorage.setItem(this.KEY_SERVER_TIME, res.serverTime);
          localStorage.setItem(this.KEY_SYNC_TIME, new Date().toISOString());
          this._notifyListeners({ status: 'synced', serverTime: res.serverTime });
        }
        return res;
      } catch (err) {
        this._notifyListeners({ status: 'error', error: err.message });
        return { error: err.message };
      } finally {
        this._pushInFlight = null;
      }
    })();
    return this._pushInFlight;
  },

  // Pull remote changes (called by polling timer + manual refresh)
  async pull() {
    if (!navigator.onLine) return { skipped: 'offline' };
    if (this._pullInFlight) return this._pullInFlight;
    this._pullInFlight = (async () => {
      try {
        this._notifyListeners({ status: 'syncing' });
        const res = await API.getAll();
        if (res && res.success) {
          this._mergeRemote(res);
          localStorage.setItem(this.KEY_SERVER_TIME, res.serverTime);
          localStorage.setItem(this.KEY_SYNC_TIME, new Date().toISOString());
          this._notifyListeners({
            status: 'synced',
            serverTime: res.serverTime,
            counts: res.counts,
          });
        }
        return res;
      } catch (err) {
        this._notifyListeners({ status: 'error', error: err.message });
        return { error: err.message };
      } finally {
        this._pullInFlight = null;
      }
    })();
    return this._pullInFlight;
  },

  // Merge remote state into localStorage, then trigger re-render
  _mergeRemote(remote) {
    const localCustomers = this.getCustomers();
    const localVisits = this.getVisits();
    const localSavedRoutes = this.getSavedRoutes();

    const mergedCustomers = mergeByUpdatedAt(localCustomers, remote.customers || []);
    const mergedVisits = mergeVisitsByTimestamp(localVisits, remote.visits || {});
    const mergedRoutes = mergeByUpdatedAt(localSavedRoutes, remote.savedRoutes || []);

    this.saveCustomers(mergedCustomers);
    localStorage.setItem(this.KEY_VISITS, JSON.stringify(mergedVisits));
    localStorage.setItem(this.KEY_SAVED_ROUTES, JSON.stringify(mergedRoutes));

    // Trigger app re-render if available
    if (typeof App !== 'undefined' && App._onRemoteUpdate) {
      App._onRemoteUpdate(remote);
    }
  },

  // Full sync (push then pull)
  async sync() {
    if (!navigator.onLine) return { skipped: 'offline' };
    await this.push();
    return this.pull();
  },

  // Subscribe to sync status updates
  onSyncEvent(cb) {
    this._listeners.push(cb);
    return () => {
      this._listeners = this._listeners.filter(l => l !== cb);
    };
  },

  _notifyListeners(event) {
    for (const cb of this._listeners) {
      try { cb(event); } catch (e) { console.warn('sync listener error:', e); }
    }
  },

  getLastSync() {
    return localStorage.getItem(this.KEY_SYNC_TIME);
  },

  // ===== Polling — fire every 3s to detect remote changes =====
  _pollingTimer: null,
  startPolling(intervalMs = 3000) {
    this.stopPolling();
    const tick = async () => {
      try {
        // First, do a HEAD-like cheap check
        const lastServer = localStorage.getItem(this.KEY_SERVER_TIME);
        const res = await fetch(API.baseUrl() + '/api/sync?since=' + encodeURIComponent(lastServer || ''), {
          headers: API.headers(),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.serverTime && data.serverTime !== lastServer) {
            // Server has new data — pull full
            await this.pull();
          }
        }
      } catch (e) {
        // Silently ignore — will retry on next tick
      }
    };
    // Run immediately, then every interval
    tick();
    this._pollingTimer = setInterval(tick, intervalMs);
  },

  stopPolling() {
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = null;
    }
  },
};

// ===== Merge helpers =====
function mergeByUpdatedAt(local, remote) {
  const byId = new Map();
  // Load local first
  for (const c of local) { if (c.id) byId.set(c.id, c); }
  // Merge remote — skip remote items older than local, and honor deleted flag
  for (const c of remote) {
    if (!c.id) continue;
    if (c.deleted) {
      // Remote says deleted — always accept (propagate delete across devices)
      byId.set(c.id, c);
      continue;
    }
    const old = byId.get(c.id);
    if (!old) {
      byId.set(c.id, c);  // new from remote
    } else if (old.deleted) {
      // Local is deleted but remote isn't — keep deleted if local is newer
      const oldTime = new Date(old.updatedAt || 0).getTime();
      const newTime = new Date(c.updatedAt || 0).getTime();
      byId.set(c.id, newTime >= oldTime ? c : old);
    } else {
      // Normal merge by updatedAt
      const oldTime = new Date(old.updatedAt || old.createdAt || 0).getTime();
      const newTime = new Date(c.updatedAt || c.createdAt || 0).getTime();
      byId.set(c.id, newTime >= oldTime ? c : old);
    }
  }
  return Array.from(byId.values());
}

function mergeVisitsByTimestamp(local, remote) {
  const merged = { ...local };
  for (const [cid, visit] of Object.entries(remote)) {
    const old = merged[cid];
    if (!old) {
      merged[cid] = visit;
    } else {
      const oldTime = new Date(old.timestamp || 0).getTime();
      const newTime = new Date(visit.timestamp || 0).getTime();
      merged[cid] = newTime >= oldTime ? visit : old;
    }
  }
  return merged;
}

window.Storage = Storage;
