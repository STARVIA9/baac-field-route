// ===== Storage layer — localStorage + real-time cloud sync =====

const Storage = {
  KEY_CUSTOMERS: 'bfr_customers',
  KEY_ROUTE: 'bfr_route',
  KEY_VISITS: 'bfr_visits',
  KEY_SYNC_TIME: 'bfr_last_sync',
  KEY_SERVER_TIME: 'bfr_server_time',
  KEY_SAVED_ROUTES: 'bfr_saved_routes',
  KEY_OVERLAY_TIME: 'bfr_overlay_time',

  // ===== Local persistence (always first — fast, offline) =====
  getCustomers() {
    try { return JSON.parse(localStorage.getItem(this.KEY_CUSTOMERS) || '[]'); }
    catch { return []; }
  },

  // Returns only non-deleted customers (for UI display)
  getActiveCustomers() {
    return this.getCustomers().filter(c => !c.deleted);
  },

  // ===== S2: Dirty tracking — push เฉพาะรายการที่แก้จริง =====
  _dirtyCifs: null,   // Set of CIFs changed locally, awaiting push
  KEY_DIRTY: 'bfr_dirty_cifs',

  _loadDirty() {
    if (this._dirtyCifs) return this._dirtyCifs;
    try { this._dirtyCifs = new Set(JSON.parse(localStorage.getItem(this.KEY_DIRTY) || '[]')); }
    catch { this._dirtyCifs = new Set(); }
    return this._dirtyCifs;
  },

  markDirty(cif) {
    if (!cif) return;
    const s = this._loadDirty();
    s.add(String(cif).trim());
    try { localStorage.setItem(this.KEY_DIRTY, JSON.stringify([...s])); } catch {}
  },

  clearDirty(cifs) {
    const s = this._loadDirty();
    for (const cif of cifs) s.delete(String(cif).trim());
    this._dirtyCifs = s;
    try { localStorage.setItem(this.KEY_DIRTY, JSON.stringify([...s])); } catch {}
  },

  // จำนวนงานที่แก้/เพิ่มในเครื่องแล้วแต่ยังไม่ขึ้นเว็บ — ใช้เตือนตอนเน็ตกลับมา
  pendingCount() {
    return this._loadDirty().size;
  },

  // ล้างรายการค้างทั้งหมด — เรียกหลัง push ทั้งก้อนสำเร็จ (เช่นตอนเน็ตกลับมา)
  clearAllDirty() {
    this._dirtyCifs = new Set();
    try { localStorage.removeItem(this.KEY_DIRTY); } catch {}
  },

  saveCustomers(list) {
    try {
      localStorage.setItem(this.KEY_CUSTOMERS, JSON.stringify(list));
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
        console.warn('[Storage] localStorage quota exceeded — pruning photos');
        // Try to free space by stripping base64 photos from seed customers
        const pruned = list.map(c => {
          if (c.photo && c.photo.length > 1000 && c.createdBy === 'AutoImport:StaticDB') {
            return { ...c, photo: null };
          }
          return c;
        });
        try {
          localStorage.setItem(this.KEY_CUSTOMERS, JSON.stringify(pruned));
          Utils.toast('⚠️ พื้นที่เต็ม — ลบรูปเก่าออกแล้ว', 'error');
        } catch (e2) {
          console.error('[Storage] Still cannot save after pruning:', e2);
          Utils.toast('❌ พื้ที่จัดเก็บเต็ม — ข้อมูลอาจไม่บันทึก', 'error');
        }
      } else {
        throw e;
      }
    }
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
    if (customer.cif) this.markDirty(customer.cif);   // S2: dirty-list
    // Push to server and await result
    const result = await this.push();
    if (result && result.success) this.clearDirty([customer.cif]);
    if (result && result.success) {
      return { customer, synced: true };
    } else {
      console.warn('[Storage] addCustomer: server sync failed, saved locally only', result?.error || result);
      return { customer, synced: false, error: result?.error || 'Sync failed' };
    }
  },

  // ===== Bulk import customers from single D1 source → Storage (idempotent) =====
  // Fetch ALL active customers from the unified D1 API (/api/customers) so the
  // single D1 database is the one source of truth for the map, admin, and sync.
  // This replaces the old fragmented static customers-db.json + KV stores with
  // one D1-backed endpoint. Only records with lat/lng render as map markers.
  async importFromStaticDB() {
    // Pull full customer list from D1 (single source of truth)
    let res;
    try {
      res = await API.get('/api/customers');
    } catch (e) {
      console.warn('[Storage] importFromStaticDB: network error', e.message);
      throw new Error('ไม่สามารถโหลดข้อมูลจากเซิร์ฟเวอร์ได้ — กรุณาตรวจสอบอินเทอร์เน็ต');
    }
    if (!res || !res.success) throw new Error('Failed to load customers from D1');
    const db = res.customers || [];

    // Find existing CIFs to avoid duplicates
    const existing = new Set(this.getActiveCustomers().map(c => c.cif).filter(Boolean));
    const toImport = db.filter(r => r.cif && !existing.has(r.cif));
    const withGPS = toImport.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng)).length;

    // Build customer objects (lat/lng null-safe — non-GPS records stay searchable)
    const make = (r) => ({
      id: r.id || 'db_' + r.cif,
      cif: r.cif,
      name: r.name,
      nickname: r.nickname || '',
      phone: r.phone || '',
      address: r.address || [r.extra?.moo && 'ม.' + r.extra.moo, r.extra?.tambon && 'ต.' + r.extra.tambon, r.extra?.amphoe && 'อ.' + r.extra.amphoe, r.extra?.province && 'จ.' + r.extra.province].filter(Boolean).join(' '),
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      riskLevel: r.riskLevel || 'unclassified',
      debtType: r.debtType || null,
      createdAt: r.createdAt || new Date().toISOString(),
      updatedAt: r.updatedAt || new Date().toISOString(),
      createdBy: r.createdBy || 'AutoImport:StaticDB',
      geo_source: r.geo_source || 'static_db',
    });

    const list = this.getCustomers();
    for (const r of toImport) list.push(make(r));
    this.saveCustomers(list);

    // Apply any server GPS overlay updates (kept for live marker refresh)
    try {
      await this.applyGpsOverlay();
    } catch (e) {
      console.warn('[Storage] importFromStaticDB: GPS overlay apply failed', e.message);
      // Non-fatal — import succeeded, overlay can be retried later
    }

    return { imported: toImport.length, withGPS, skipped: existing.size, total: db.length };
  },

  // ===== Apply bulk GPS overlay (admin file uploads) — SERVER-AUTHORITATIVE =====
  // Fetches /api/gps-overlay (compact map CIF -> {lat,lng,name}) and applies it.
  // Server wins: coords uploaded to the web overwrite the device copy for EVERY
  // matching record (including user-edited ones) so all devices show identical
  // markers. Only records NOT in the overlay keep their local values.
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
          existing.lat = g.lat;
          existing.lng = g.lng;
          if (g.name && !existing.name) existing.name = g.name;
          existing.updatedAt = now;
          existing.geo_source = 'gps-overlay';
          applied++;
        } else {
          // W1 FIX: Don't create phantom customers for CIFs only in overlay.
          // If the CIF doesn't exist in D1 or local, skip it — the admin should
          // import via /api/admin/gps-import which creates proper D1 records.
          // Don't increment created — nothing was actually created.
        }
      }
      if (applied > 0 || created > 0) this.saveCustomers(list);
      if (res.overlayUpdatedAt) {
        localStorage.setItem(this.KEY_OVERLAY_TIME, res.overlayUpdatedAt);
      }
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
      // W4 FIX: Whitelist editable fields — prevent accidental overwrite of id/cif/deleted/createdAt
      const EDITABLE = new Set([
        'name', 'nickname', 'phone', 'address', 'lat', 'lng',
        'riskLevel', 'debtType', 'photo', 'note', 'zone', 'potential',
      ]);
      const safe = {};
      for (const [k, v] of Object.entries(updates)) {
        if (EDITABLE.has(k)) safe[k] = v;
      }
      // Editing a static-DB seed customer "claims" it — flip createdBy so the
      // change actually syncs (push() skips AutoImport:StaticDB records).
      if (list[idx].createdBy === 'AutoImport:StaticDB') {
        list[idx].createdBy = Auth.getUser()?.name || 'user';
      }
      list[idx] = { ...list[idx], ...safe, updatedAt: new Date().toISOString() };
      this.saveCustomers(list);
      if (list[idx].cif) this.markDirty(list[idx].cif);   // S2: dirty-list
      const result = await this.push();
      if (result && result.success) this.clearDirty([list[idx].cif]);
      if (result && result.success) {
        return { synced: true };
      } else {
        console.warn('[Storage] updateCustomer: server sync failed, saved locally only', result?.error || result);
        return { synced: false, error: result?.error || 'Sync failed' };
      }
    }
    return { synced: false, error: 'Customer not found' };
  },

  // ===== Local-first (optimistic) =====
  // ปัญหาเดิม: กดเซฟแล้ว UI รอเน็ต 1–2.5 วิ กว่าหมุดจะขึ้น (วัดจากเว็บจริง 14 ก.ย.69)
  // แนวใหม่: เขียนลงเครื่อง + วาดหมุดก่อน (~20ms) แล้วค่อยส่งขึ้นเว็บเบื้องหลัง
  _EDITABLE_FIELDS: new Set([
    'name', 'nickname', 'phone', 'address', 'lat', 'lng',
    'riskLevel', 'debtType', 'photo', 'note', 'zone', 'potential',
  ]),

  // พิกัดต้องเป็นตัวเลขเสมอ — ค่าจากฟอร์มเป็นข้อความ ("13.77") ทำให้หมุดไม่ขึ้น
  _normCoord(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  },

  // เขียนลง localStorage เท่านั้น (ไม่ยิงเน็ต) — คืน record ที่บันทึกแล้ว
  updateCustomerLocal(id, updates) {
    const list = this.getCustomers();
    const idx = list.findIndex(c => c.id === id);
    if (idx < 0) return null;
    if (list[idx].createdBy === 'AutoImport:StaticDB') {
      list[idx].createdBy = (typeof Auth !== 'undefined' && Auth.getUser && Auth.getUser() ? Auth.getUser().name : '') || 'user';
    }
    const safe = {};
    for (const [k, v] of Object.entries(updates || {})) {
      if (this._EDITABLE_FIELDS.has(k)) safe[k] = v;
    }
    if ('lat' in safe || 'lng' in safe) {
      safe.lat = this._normCoord(safe.lat !== undefined ? safe.lat : list[idx].lat);
      safe.lng = this._normCoord(safe.lng !== undefined ? safe.lng : list[idx].lng);
    }
    list[idx] = { ...list[idx], ...safe, updatedAt: new Date().toISOString() };
    this.saveCustomers(list);
    if (list[idx].cif) this.markDirty(list[idx].cif);
    return list[idx];
  },

  // เพิ่มลูกค้าใหม่ลงเครื่องก่อน (ยังไม่ยิงเน็ต)
  addCustomerLocal(customer) {
    const list = this.getCustomers();
    customer.id = customer.id || Utils.uuid();
    customer.createdAt = customer.createdAt || new Date().toISOString();
    customer.updatedAt = new Date().toISOString();
    customer.createdBy = (typeof Auth !== 'undefined' && Auth.getUser && Auth.getUser() ? Auth.getUser().name : '') || 'unknown';
    customer.riskLevel = customer.riskLevel || 'unclassified';
    customer.debtType = customer.debtType || null;
    if ('lat' in customer || 'lng' in customer) {
      customer.lat = this._normCoord(customer.lat);
      customer.lng = this._normCoord(customer.lng);
    }
    list.push(customer);
    this.saveCustomers(list);
    if (customer.cif) this.markDirty(customer.cif);
    return customer;
  },

  // ส่งลูกค้ารายเดียวขึ้นเว็บ — PUT ตรง (เบา ~1 วิ) ถ้าไม่ผ่านค่อยถอยไป push() ทั้งก้อน
  async uploadCustomer(cif, fields) {
    if (!navigator.onLine) return { synced: false, error: 'offline' };
    let ok = false;
    let err = '';
    if (cif) {
      try {
        const res = await fetch(API.baseUrl() + '/api/customers/' + encodeURIComponent(cif), {
          method: 'PUT',
          headers: API.headers(),
          body: JSON.stringify(fields || {}),
        });
        const data = await res.json().catch(() => ({}));
        ok = res.ok && !!data.success;
        if (!ok) err = data.error || ('HTTP ' + res.status);
      } catch (e) { err = e.message; }
    }
    if (!ok) {
      const r = await this.push();
      ok = !!(r && r.success);
      err = ok ? '' : ((r && r.error) || err || 'sync failed');
    }
    if (ok && cif) this.clearDirty([cif]);
    this._notifyListeners(ok ? { status: 'saved' } : { status: 'error', error: err });
    return { synced: ok, error: err };
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
      // พิกัดที่เคยเก็บเป็นข้อความ (ค่าจากฟอร์ม) → แปลงเป็นตัวเลข ไม่งั้นหมุดไม่ขึ้นบนแผนที่
      if (typeof c.lat === 'string' || typeof c.lng === 'string') {
        const nlat = this._normCoord(c.lat);
        const nlng = this._normCoord(c.lng);
        if (nlat !== null && nlng !== null) { c.lat = nlat; c.lng = nlng; changed = true; }
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
      if (list[idx].cif) this.markDirty(list[idx].cif);   // S2: dirty-list
      const result = await this.push();
      if (result && result.success && list[idx].cif) this.clearDirty([list[idx].cif]);
      return { synced: !!(result && result.success), error: result?.error };
    }
    return { synced: false, error: 'Not found' };
  },

  // ===== แยกเส้นทางตาม "ผู้ใช้ + เครื่องนี้" =====
  // ปัญหาเดิม: ทุกเครื่องใช้คีย์เดียวกัน (bfr_route) → 10 คนใช้พร้อมกัน เส้นทางทับกัน
  KEY_DEVICE: 'bfr_device_id',

  // รหัสประจำเครื่องนี้ (สร้างครั้งเดียว เก็บถาวรใน localStorage ของเครื่องนั้น)
  deviceId() {
    try {
      let id = localStorage.getItem(this.KEY_DEVICE);
      if (!id) {
        id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        localStorage.setItem(this.KEY_DEVICE, id);
      }
      return id;
    } catch (e) { return 'dunknown'; }
  },

  // รหัสผู้ใช้ (ต้องตรงกับที่เซิร์ฟเวอร์ใช้: username → sub)
  // login ด้วย PIN ผู้ดูแลได้ username 'admin' → สโคปตรงกับที่เซิร์ฟเวอร์คิด
  _userId() {
    const u = (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser() : null;
    let who = (u && u.username) ? String(u.username) : '';
    if (!who) {
      try {
        const t = (typeof Auth !== 'undefined' && Auth.getToken) ? Auth.getToken() : '';
        if (t && t.indexOf('.') > 0) {
          const p = JSON.parse(atob(t.split('.')[1]));
          who = p.username || p.sub || '';
        }
      } catch (e) { /* token เสีย → ใช้ชื่อผู้ใช้แทน */ }
    }
    if (!who && u && u.name) who = String(u.name);
    return String(who || 'guest').replace(/[^A-Za-z0-9._-]/g, '') || 'guest';
  },

  // สโคปของเครื่องนี้ = ผู้ใช้ + รหัสเครื่อง (ต้องตรงกับเซิร์ฟเวอร์: routes:user:<scope>)
  routeScope() { return this._userId() + '_' + this.deviceId(); },

  _routeSuffix() { return '_' + this.routeScope(); },

  // สโคป visit: ใช้แค่ username (ตาม user ไม่ว่าใช้เครื่องอะไร)
  _visitSuffix() { return '_' + this._userId(); },
  _visitsKey() { return this.KEY_VISITS + this._visitSuffix(); },

  // คีย์เดิมก่อนแยกตามเครื่อง — ใช้ย้ายข้อมูลครั้งแรก แล้วลบทิ้ง
  _legacyKeys(base) {
    const u = (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser() : null;
    const who = (u && u.username) ? String(u.username).replace(/[^A-Za-z0-9._-]/g, '') : '';
    return who ? [base + '_' + who, base] : [base];
  },

  // อ่านคีย์ของเครื่องนี้; ถ้ายังว่างให้ย้ายจากคีย์เดิม (ครั้งเดียว) แล้วลบคีย์เดิม
  _readScoped(key, legacyKeys) {
    try {
      const cur = localStorage.getItem(key);
      if (cur !== null && cur !== '[]' && cur !== '') return JSON.parse(cur);
      for (const lk of legacyKeys) {
        if (lk === key) continue;
        const v = localStorage.getItem(lk);
        if (v !== null && v !== '[]' && v !== '') {
          localStorage.setItem(key, v);
          localStorage.removeItem(lk);   // กันคนอื่นบนเครื่องเดียวกันเห็นข้อมูลของเรา
          return JSON.parse(v);
        }
      }
    } catch (e) { /* ข้อมูลเสีย → เริ่มใหม่ */ }
    return [];
  },

  getRoute() {
    this._routeKey = this.KEY_ROUTE + this._routeSuffix();
    try { return this._readScoped(this._routeKey, this._legacyKeys(this.KEY_ROUTE)); }
    catch { return []; }
  },

  async saveRoute(list) {
    this._routeKey = this.KEY_ROUTE + this._routeSuffix();
    localStorage.setItem(this._routeKey, JSON.stringify(list));
    // กด + รัวๆ ไม่หน่วง: เซฟลงเครื่องทันที + ส่งขึ้นเว็บรวมรอบเดียวหลังหยุดกด 2.5 วิ
    clearTimeout(this._routePushTimer);
    this._routePushTimer = setTimeout(() => { this.push().catch(() => {}); }, 2500);
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
    // อ่าน visit ของ user นี้ (scoped key)
    let visits = {};
    try {
      const raw = localStorage.getItem(this._visitsKey());
      if (raw && raw !== '{}') visits = JSON.parse(raw);
    } catch (e) { visits = {}; }

    // migration จากคีย์เก่า (bfr_visits) ครั้งแรกเท่านั้น
    if (!visits || Object.keys(visits).length === 0) {
      try {
        const legacyRaw = localStorage.getItem(this.KEY_VISITS);
        if (legacyRaw && legacyRaw !== '{}') {
          const legacyVisits = JSON.parse(legacyRaw);
          if (Object.keys(legacyVisits).length > 0) {
            visits = legacyVisits;
            localStorage.setItem(this._visitsKey(), JSON.stringify(visits));
            localStorage.removeItem(this.KEY_VISITS);
          }
        }
      } catch (e) { /* ignore */ }
    }
    return visits;
  },

  async saveVisit(customerId, visit) {
    const visits = this.getVisits();
    visits[customerId] = {
      ...visit,
      timestamp: new Date().toISOString(),
      by: Auth.getUser()?.name || 'unknown',
    };
    localStorage.setItem(this._visitsKey(), JSON.stringify(visits));
    const result = await this.push();
    return { synced: !!(result && result.success), error: result?.error };
  },

  // ===== ส่งคลังเส้นทางขึ้นเว็บเฉพาะตอนที่มีการเปลี่ยน =====
  // เดิม: ทุกครั้งที่ push จะแนบคลังทั้งก้อน (เส้นทางถนนในคลัง ~87 KB/ชุด) ขึ้นเน็ตทุกรอบ
  // ใหม่: แนบเฉพาะเมื่อลายเซ็นคลังต่างจากครั้งที่ส่งสำเร็จล่าสุด (ไม่เปลี่ยน = ส่ง [] )
  // ปลอดภัยเพราะเซิร์ฟเวอร์ merge แบบเพิ่ม (mergeById) — ส่ง [] ไม่ลบข้อมูลเดิม
  KEY_ROUTES_SIG: 'bfr_routes_sig',

  _routesSig(list) {
    try {
      return JSON.stringify((list || []).map(r => [r.id, r.savedAt, (r.stops || []).length, r.distance, String(r.name || '')]));
    } catch (e) { return ''; }
  },

  _routesChangedSinceSync() {
    try {
      return localStorage.getItem(this.KEY_ROUTES_SIG) !== this._routesSig(this.getSavedRoutes());
    } catch (e) { return true; }
  },

  _markRoutesSynced(list) {
    try {
      localStorage.setItem(this.KEY_ROUTES_SIG, this._routesSig(list || this.getSavedRoutes()));
    } catch (e) { /* พื้นที่เต็ม → ส่งซ้ำได้ ไม่พัง */ }
  },

  getSavedRoutes() {
    this._savedRoutesKey = this.KEY_SAVED_ROUTES + this._routeSuffix();
    try { return this._readScoped(this._savedRoutesKey, this._legacyKeys(this.KEY_SAVED_ROUTES)); }
    catch { return []; }
  },

  async saveSavedRoute(route) {
    const list = this.getSavedRoutes();
    route.id = route.id || Utils.uuid();
    route.savedAt = route.savedAt || new Date().toISOString();
    route.savedBy = Auth.getUser()?.name || 'unknown';
    list.push(route);
    this._savedRoutesKey = this.KEY_SAVED_ROUTES + this._routeSuffix();
    localStorage.setItem(this._savedRoutesKey, JSON.stringify(list));
    await this.push();
    return route;
  },

  // ===== Cloud sync — push local + pull remote =====
  // Uses unified /api/sync endpoint that handles customers + visits + savedRoutes
  _pushInFlight: null,
  _pullInFlight: null,
  _listeners: [],
  _routePushTimer: null,

  // Push local changes to cloud (after every save)
  // Coalescing queue: if push is in-flight, mark dirty and re-push after it finishes.
  // This ensures rapid addCustomer/updateCustomer calls never lose data.
  async push() {
    if (!navigator.onLine) return { skipped: 'offline' };
    // If push is in-flight, mark dirty and wait for the in-flight push
    if (this._pushInFlight) {
      this._pushDirty = true;
      return this._pushInFlight;
    }
    this._pushDirty = false;
    this._pushInFlight = (async () => {
      try {
        this._notifyListeners({ status: 'syncing' });
        const res = await API.syncAll(this._buildPayload());
        if (res && res.success) {
          localStorage.setItem(this.KEY_SERVER_TIME, res.serverTime);
          localStorage.setItem(this.KEY_SYNC_TIME, new Date().toISOString());
          this._markRoutesSynced();   // ส่งสำเร็จแล้ว → จำลายเซ็นคลัง ไม่ต้องส่งซ้ำจนกว่าจะเปลี่ยน
          this._notifyListeners({ status: 'synced', serverTime: res.serverTime });
        }
        return res;
      } catch (err) {
        this._notifyListeners({ status: 'error', error: err.message });
        return { error: err.message };
      } finally {
        this._pushInFlight = null;
        // If new data arrived while we were pushing, flush it
        if (this._pushDirty) {
          this._pushDirty = false;
          this.push().catch(e => console.warn('[Storage] coalesced push failed:', e.message));
        }
      }
    })();
    return this._pushInFlight;
  },

  // Build sync payload (shared by push + retrySync)
  _buildPayload() {
    // S2: push เฉพาะลูกค้าที่ถูกแก้บนเครื่องนี้จริงๆ (dirty list)
    const all = this.getCustomers();
    const dirty = this._loadDirty();

    // Edge cases:
    // - local add ลูกค้าใหม่ (ไม่มี in D1) → dirty เก็บ CIF
    // - delete local → deleted flag + markDirty ที่ call site
    let customers;
    if (dirty.size > 0) {
      customers = all.filter(c => c.cif && dirty.has(String(c.cif).trim()) && c.createdBy !== 'AutoImport:StaticDB');
      // ลูกค้า manual-add ที่ยังไม่ sync (id = db_ prefix เฉพาะ server) → ส่งไปด้วย
      if (customers.length === 0 && this._forceFullPushOnce) {
        customers = all.filter(c => c.createdBy !== 'AutoImport:StaticDB');
        this._forceFullPushOnce = false;
      }
    } else {
      // ไม่มี dirty → payload เบา (visits/routes ยัง merge full เหมือนเดิม)
      customers = [];
    }

    // ส่งคลังเส้นทางเฉพาะตอนเปลี่ยน (ไม่เปลี่ยน = ส่ง [] → ประหยัดเน็ตมือถือ เพราะในคลังมีเส้นทางถนนหนัก ๆ)
    const routesToSend = this._routesChangedSinceSync() ? this.getSavedRoutes() : [];

    return {
      customers,
      visits: this.getVisits(),
      savedRoutes: routesToSend,
      // รหัสเครื่องนี้ → เซิร์ฟเวอร์แยกเส้นทางต่อผู้ใช้+เครื่อง (routes:user:<scope>)
      deviceId: this.deviceId(),
    };
  },

  // Pull remote changes (called by polling timer + manual refresh)
  async pull() {
    if (!navigator.onLine) return { skipped: 'offline' };
    if (this._pullInFlight) return this._pullInFlight;
    this._pullInFlight = (async () => {
      try {
        this._notifyListeners({ status: 'syncing' });
        const res = await API.getAll(this.deviceId());
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
    localStorage.setItem(this._visitsKey(), JSON.stringify(mergedVisits));
    // เขียนลงคีย์ของเครื่องนี้เท่านั้น (เดิมเขียนคีย์กลาง → เครื่องอื่นบนเครื่องเดียวกันเห็นข้อมูลกัน)
    this._savedRoutesKey = this.KEY_SAVED_ROUTES + this._routeSuffix();
    localStorage.setItem(this._savedRoutesKey, JSON.stringify(mergedRoutes));
    // คลังที่ได้จากเซิร์ฟเวอร์ (เครื่องนี้ยังไม่มีของตัวเอง) → จำลายเซ็นไว้ ไม่ต้องส่งคืนให้เปลืองเน็ต
    if (localSavedRoutes.length === 0 && mergedRoutes.length > 0) this._markRoutesSynced(mergedRoutes);

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
    this._pushDirty = false;
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

  // ===== Polling — ตรวจข้อมูลใหม่จากเซิร์ฟเวอร์ =====
  _pollingTimer: null,

  // ตรวจ 1 รอบ (แยกไว้เพื่อเรียกทันทีตอนกลับเข้าแอป/เน็ตกลับมา)
  // ขั้น 1 = ตรวจเบา ๆ (?probe=1) อ่าน KV 2 คีย์ → ไม่มีของใหม่ก็จบรอบ (ประหยัดโควตา KV มาก)
  // ขั้น 2 = มีของใหม่จริงค่อยดึงข้อมูลเต็ม
  async pollOnce() {
    if (!navigator.onLine) return;
    const tick = async () => {
      try {
        const lastServer = localStorage.getItem(this.KEY_SERVER_TIME);
        const probeOverlay = localStorage.getItem(this.KEY_OVERLAY_TIME);

        // ===== ขั้น 1: ตรวจเบา ๆ =====
        let hasNew = true;
        try {
          const pRes = await fetch(API.baseUrl() + '/api/sync?probe=1', { headers: API.headers() });
          if (pRes.ok) {
            const p = await pRes.json();
            if (p && p.success) {
              const overlayChanged = !!(p.overlayUpdatedAt && p.overlayUpdatedAt !== probeOverlay);
              const newer = !!(p.serverTime && (!lastServer || p.serverTime > lastServer));
              hasNew = overlayChanged || newer;
            }
          }
        } catch (e) { /* probe ล้มเหลว → ลองทางเต็มแทน */ }
        if (!hasNew) return;   // ไม่มีของใหม่ → จบรอบนี้

        // ===== ขั้น 2: ดึงข้อมูลเต็ม =====
        const res = await fetch(API.baseUrl() + '/api/sync?since=' + encodeURIComponent(lastServer || '') + '&device=' + encodeURIComponent(this.deviceId()), {
          headers: API.headers(),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            let changed = false;
            // Server-authoritative GPS overlay: if the web has newer coords,
            // fetch + apply them so every device shows the same markers.
            const localOverlayTime = localStorage.getItem(this.KEY_OVERLAY_TIME);
            if (data.overlayUpdatedAt && data.overlayUpdatedAt !== localOverlayTime) {
              const n = await this.applyGpsOverlay();
              if (n > 0) changed = true;
              else localStorage.setItem(this.KEY_OVERLAY_TIME, data.overlayUpdatedAt);
            }
            if (data.serverTime && data.serverTime !== lastServer) {
              // Merge delta directly from poll response (don't call pull — returns empty customers)
              this._mergeRemote(data);
              localStorage.setItem(this.KEY_SERVER_TIME, data.serverTime);
              localStorage.setItem(this.KEY_SYNC_TIME, new Date().toISOString());
              changed = true;
            }
            if (changed) {
              this._notifyListeners({
                status: 'synced',
                serverTime: data.serverTime,
                counts: data.counts,
              });
            }
          }
        }
      } catch (e) {
        // Silently ignore — will retry on next tick
      }
    };
    return tick();
  },

  // รอบเช็ค 20 วิ (เดิม 60) — เครื่องอื่นเห็นหมุดใหม่ไวกว่า
  // ต้นทุนจริง ~1 rows_read/รอบ ตอนไม่มีข้อมูลใหม่ (etag cache hit) → ไม่ชนโควตา D1
  startPolling(intervalMs = 20000) {
    this.stopPolling();
    // Run immediately, then every interval
    this.pollOnce();
    this._pollingTimer = setInterval(() => this.pollOnce(), intervalMs);
  },

  stopPolling() {
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = null;
    }
  },

  // ===== Reload customers from D1 (clear seed + re-import) =====
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

    // 3) Re-import from D1 (single source of truth)
    const result = await this.importFromStaticDB();
    // 4) Re-apply server GPS overlay on top of the fresh D1 data
    await this.applyGpsOverlay();

    return { removed, imported: result?.imported || 0, total: result?.total || 0 };
  },
};

// ===== Merge helpers =====
function mergeByUpdatedAt(local, remote) {
  const byId = new Map();
  for (const c of local) { if (c.id) byId.set(c.id, c); }
  for (const c of remote) {
    if (!c.id) continue;
    if (c.deleted) {
      // Remote says deleted — always accept (propagate delete)
      byId.set(c.id, c);
      continue;
    }
    const old = byId.get(c.id);
    if (!old) {
      byId.set(c.id, c);
    } else if (old.deleted) {
      // W5 FIX: local is deleted — keep deleted unless remote explicitly un-deletes
      // with a newer timestamp. Prevents stale pulls from resurrecting deleted records.
      const oldTime = new Date(old.updatedAt || 0).getTime();
      const newTime = new Date(c.updatedAt || 0).getTime();
      // N3 FIX: Use >= to match server mergeById behavior.
      // Prevents timestamp collision from blocking legitimate un-deletes.
      if (newTime >= oldTime && c.deleted === false) {
        // Explicit un-delete with newer timestamp — accept
        byId.set(c.id, c);
      }
      // Otherwise keep the deleted version (do nothing)
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
