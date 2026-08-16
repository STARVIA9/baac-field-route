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

  // ===== Server-first architecture: save → push to KV → confirm =====
  // Returns: { customer, synced: true/false, error?: string }
  async addCustomer(customer) {
    const list = this.getCustomers();
    customer.id = customer.id || Utils.uuid();
    customer.createdAt = customer.createdAt || new Date().toISOString();
    customer.updatedAt = new Date().toISOString();
    customer.createdBy = Auth.getUser()?.name || 'unknown';
    // ===== Phase 1: Risk classification (BAAC debt follow-up) =====
    customer.riskLevel = customer.riskLevel || 'unclassified';
    customer.debtType = customer.debtType || null;
    list.push(customer);
    this.saveCustomers(list);  // Save locally FIRST (instant UI)
    // Push to server and await result
    const result = await this.push();
    if (result && result.success) {
      return { customer, synced: true };
    } else {
      console.warn('[Storage] addCustomer: server sync failed, saved locally only', result?.error || result);
      return { customer, synced: false, error: result?.error || 'Sync failed' };
    }
  },

  // ===== Bulk import static customer DB → Storage (one-time, idempotent) =====
  // Reads /customers-db.json and imports EVERY record (GPS or not) so the full
  // 3,852-customer database is searchable in the list. Only records with lat/lng
  // render as map markers (Customers.renderMarkers skips null coords).
  // Static-DB records are NOT pushed to KV — they're served from customers-db.json,
  // and pushing 3,852 records re-triggers the Worker 503 (JSON.stringify > CPU limit).
  // User edits flip `createdBy` (see updateCustomer/deleteCustomer) so they sync.
  async importFromStaticDB() {
    if (typeof CustomerDB === 'undefined') throw new Error('CustomerDB not loaded');
    const res = await fetch('/customers-db.json');
    if (!res.ok) throw new Error(`Failed to fetch customers-db.json: ${res.status}`);
    const db = await res.json();

    // Find existing CIFs to avoid duplicates
    const existing = new Set(this.getActiveCustomers().map(c => c.cif).filter(Boolean));
    const toImport = db.filter(r => r.cif && !existing.has(r.cif));
    const withGPS = toImport.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng)).length;

    // Build customer objects (lat/lng null-safe — non-GPS records stay searchable)
    const make = (r) => ({
      id: 'db_' + r.cif,
      cif: r.cif,
      name: r.name,
      phone: r.phone || '',
      address: [r.address, r.moo && 'ม.' + r.moo, r.tambon && 'ต.' + r.tambon, r.amphoe && 'อ.' + r.amphoe, r.province && 'จ.' + r.province].filter(Boolean).join(' '),
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      riskLevel: r.riskLevel || 'unclassified',
      debtType: r.debtType || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'AutoImport:StaticDB',
      geo_source: r.geo_source || 'static_db',
    });

    const list = this.getCustomers();
    for (const r of toImport) list.push(make(r));
    this.saveCustomers(list);

    // Apply bulk GPS overlay (admin file uploads) — match by CIF, create new for unmatched
    await this.applyGpsOverlay();

    return { imported: toImport.length, withGPS, skipped: existing.size, total: db.length };
  },

  // ===== Apply bulk GPS overlay (admin file uploads) =====
  // Fetches /api/gps-overlay (compact map CIF -> {lat,lng,name}) and applies it:
  // - matching seed (AutoImport:StaticDB) customers get lat/lng set
  // - CIFs not yet in the list are created as new seed customers
  // - user-edited customers (createdBy != AutoImport:StaticDB) are left untouched
  // Returns count of customers changed (applied + created).
  async applyGpsOverlay() {
    try {
      const res = await API.get('/api/gps-overlay');
      if (!res || !res.success || !res.overlay) return 0;
      const overlay = res.overlay;
      const list = this.getCustomers();
      const byCif = new Map();
      for (const c of list) {
        if (c.cif) byCif.set(String(c.cif).trim(), c);
      }
      const now = new Date().toISOString();
      let applied = 0, created = 0;
      for (const [cif, g] of Object.entries(overlay)) {
        if (!g || !(Number.isFinite(g.lat) && Number.isFinite(g.lng))) continue;
        const existing = byCif.get(String(cif).trim());
        if (existing) {
          if (existing.createdBy !== 'AutoImport:StaticDB') continue; // user-owned → keep their data
          existing.lat = g.lat;
          existing.lng = g.lng;
          if (g.name && !existing.name) existing.name = g.name;
          existing.updatedAt = now;
          applied++;
        } else {
          list.push({
            id: 'db_' + cif,
            cif,
            name: g.name || '',
            phone: '',
            address: '',
            lat: g.lat,
            lng: g.lng,
            riskLevel: 'unclassified',
            debtType: null,
            createdAt: now,
            updatedAt: now,
            createdBy: 'AutoImport:StaticDB',
            geo_source: 'gps-overlay',
          });
          created++;
        }
      }
      if (applied > 0 || created > 0) this.saveCustomers(list);
      return applied + created;
    } catch (e) {
      console.warn('[gps-overlay] apply failed:', e.message);
      return 0;
    }
  },

  // Returns: { synced: true/false, error?: string }
  async updateCustomer(id, updates) {
    const list = this.getCustomers();
    const idx = list.findIndex(c => c.id === id);
    if (idx >= 0) {
      // Editing a static-DB seed customer "claims" it — flip createdBy so the
      // change actually syncs (push() skips AutoImport:StaticDB records).
      if (list[idx].createdBy === 'AutoImport:StaticDB') {
        list[idx].createdBy = Auth.getUser()?.name || 'user';
      }
      list[idx] = { ...list[idx], ...updates, updatedAt: new Date().toISOString() };
      this.saveCustomers(list);
      const result = await this.push();
      if (result && result.success) {
        return { synced: true };
      } else {
        console.warn('[Storage] updateCustomer: server sync failed, saved locally only', result?.error || result);
        return { synced: false, error: result?.error || 'Sync failed' };
      }
    }
    return { synced: false, error: 'Customer not found' };
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

  async deleteCustomer(id) {
    // Soft delete: mark as deleted so mergeByUpdatedAt skips it on pull
    const list = this.getCustomers();
    const idx = list.findIndex(c => c.id === id);
    if (idx >= 0) {
      // Deleting a static-DB seed customer must sync — flip createdBy first
      // (push() skips AutoImport:StaticDB records).
      if (list[idx].createdBy === 'AutoImport:StaticDB') {
        list[idx].createdBy = Auth.getUser()?.name || 'user';
      }
      list[idx].deleted = true;
      list[idx].updatedAt = new Date().toISOString();
      this.saveCustomers(list);
      const result = await this.push();
      return { synced: !!(result && result.success), error: result?.error };
    }
    return { synced: false, error: 'Not found' };
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
      // Guard: a customer without GPS can't be routed (OSRM/haversine would NaN).
      const c = this.getCustomers().find(x => x.id === customerId);
      if (!c || !(Number.isFinite(c.lat) && Number.isFinite(c.lng))) return false;
      route.push(customerId);
      this.saveRoute(route);
    }
    return true;
  },

  removeFromRoute(customerId) {
    this.saveRoute(this.getRoute().filter(id => id !== customerId));
  },

  getVisits() {
    try { return JSON.parse(localStorage.getItem(this.KEY_VISITS) || '{}'); }
    catch { return {}; }
  },

  async saveVisit(customerId, visit) {
    const visits = this.getVisits();
    visits[customerId] = {
      ...visit,
      timestamp: new Date().toISOString(),
      by: Auth.getUser()?.name || 'unknown',
    };
    localStorage.setItem(this.KEY_VISITS, JSON.stringify(visits));
    const result = await this.push();
    return { synced: !!(result && result.success), error: result?.error };
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
      // Static-DB seed customers are excluded — they're served from customers-db.json.
      // Pushing all 3,852 re-triggers the Worker 503 (JSON.stringify > CPU limit).
      // User edits flip createdBy (updateCustomer/deleteCustomer) so they sync.
      customers: this.getCustomers().filter(c => c.createdBy !== 'AutoImport:StaticDB'),
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
    const pushResult = await this.push();
    const pullResult = await this.pull();
    // Return pull counts (from server) if available, fall back to push
    if (pullResult && pullResult.success) {
      return pullResult;
    }
    return pushResult;
  },

  // Manual retry — forces push of all local data then pull
  async retrySync() {
    this._pushInFlight = null;  // Clear any stuck in-flight flag
    this._pullInFlight = null;
    this._notifyListeners({ status: 'syncing', action: 'retry' });
    return this.sync();
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
        // Poll with since= — returns delta customers + full visits/routes
        const lastServer = localStorage.getItem(this.KEY_SERVER_TIME);
        const res = await fetch(API.baseUrl() + '/api/sync?since=' + encodeURIComponent(lastServer || ''), {
          headers: API.headers(),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.serverTime && data.serverTime !== lastServer) {
            // Merge delta directly from poll response (don't call pull — returns empty customers)
            this._mergeRemote(data);
            localStorage.setItem(this.KEY_SERVER_TIME, data.serverTime);
            localStorage.setItem(this.KEY_SYNC_TIME, new Date().toISOString());
            this._notifyListeners({
              status: 'synced',
              serverTime: data.serverTime,
              counts: data.counts,
            });
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

  // ===== Reload customers from static DB (clear seed + re-import) =====
  async reloadStaticDB() {
    // 1) Clear all existing seed GPS records
    const list = this.getCustomers();
    const kept = list.filter(c => c.createdBy !== 'AutoImport:StaticDB');
    const removed = list.length - kept.length;
    this.saveCustomers(kept);
    console.log(`[Storage] Cleared ${removed} seed GPS records`);

    // 2) Refresh CustomerDB cache
    if (typeof CustomerDB !== 'undefined') {
      CustomerDB._loaded = false;
      await CustomerDB.load();
    }

    // 3) Re-import from fresh static DB (with cache buster)
    const res = await fetch('/customers-db.json?_=' + Date.now());
    if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
    const db = await res.json();
    const result = await this.importFromStaticDB();

    return { removed, imported: result?.imported || 0, total: db.length };
  },
};

// ===== Merge helpers =====
function mergeByUpdatedAt(local, remote) {
  const byId = new Map();
  for (const c of local) { if (c.id) byId.set(c.id, c); }
  for (const c of remote) {
    if (!c.id) continue;
    if (c.deleted) {
      byId.set(c.id, c);
      continue;
    }
    const old = byId.get(c.id);
    if (!old) {
      byId.set(c.id, c);
    } else if (old.deleted) {
      const oldTime = new Date(old.updatedAt || 0).getTime();
      const newTime = new Date(c.updatedAt || 0).getTime();
      byId.set(c.id, newTime >= oldTime ? c : old);
    } else {
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
