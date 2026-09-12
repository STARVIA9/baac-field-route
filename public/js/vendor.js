// ===== Utility functions =====

const Utils = {
  // Format distance (m → km with 1 decimal)
  formatKm(meters) {
    return (meters / 1000).toFixed(1);
  },

  // Format duration (seconds → "Xh Ym" or "Y นาที")
  formatDuration(seconds) {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return mins;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h} ชม. ${m} นาที` : `${h} ชั่วโมง`;
  },

  // Format Thai date
  formatThaiDate(date) {
    return new Date(date).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  },

  // Calculate haversine distance (meters) between two points
  haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  // Debounce
  debounce(fn, ms = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  },

  // UUID
  uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  },

  // Toast notification
  toast(msg, type = 'success') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast ${type}`;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
  },

  // Format PIN display
  maskPin(pin) {
    return '•'.repeat(String(pin).length);
  },

  // Number with Thai locale
  formatNum(n) {
    return new Intl.NumberFormat('th-TH').format(n);
  },

  // ===== Vehicle fuel profiles =====
  // kmPerLiter: fixed. fuelPrice: loaded from /fuel-prices.json (Bangchak API)
    VEHICLE_PROFILES: {
    pickup: {
      name: "🛻 กระบะ",
      kmPerLiter: 10,
      fuelPrice: 35.80,
      speed: {
        highway: 70,
        road: 45,
        village: 30,
        dirt: 20
      }
    },
    car: {
      name: "🚗 รถเก๋ง",
      kmPerLiter: 12,
      fuelPrice: 42.73,
      speed: {
        highway: 80,
        road: 50,
        village: 35,
        dirt: 25
      }
    },
    motorcycle: {
      name: "🏍️ มอเตอร์ไซค์",
      kmPerLiter: 35,
      fuelPrice: 43.10,
      speed: {
        highway: 60,
        road: 40,
        village: 25,
        dirt: 15
      }
    },
  },
  _fuelPricesLoaded: false,
  _fuelUpdated: null,
  _fuelData: null,
  // Fetch live prices from static JSON (updated by cron)
  async loadFuelPrices() {
    try {
      const resp = await fetch('/fuel-prices.json?t=' + Date.now());
      if (!resp.ok) return;
      const data = await resp.json();
      if (!data.fuels) return;
      this._fuelData = data;
      this._fuelUpdated = data.updated || null;
      for (const [key, info] of Object.entries(data.fuels)) {
        if (this.VEHICLE_PROFILES[key]) {
          this.VEHICLE_PROFILES[key].fuelPrice = info.price;
          this.VEHICLE_PROFILES[key].fuelName = info.name;
          this.VEHICLE_PROFILES[key].fuelDiff = info.diff;
          this.VEHICLE_PROFILES[key].fuelPriceTomorrow = info.price_tomorrow;
        }
      }
      this._fuelPricesLoaded = true;
      console.log('[Fuel] Prices loaded:', new Date(data.updated).toLocaleDateString('th-TH'));
    } catch (e) {
      console.warn('[Fuel] Cannot load live prices, using defaults:', e.message);
    }
  },
  // Get fuel update date (e.g. "10/06/2569")
  getFuelUpdated() { return this._fuelUpdated; },
  // Get current fuel price for a vehicle type
  getFuelPrice(vehicleType) {
    const v = this.VEHICLE_PROFILES[vehicleType || this.getVehicle()];
    return v ? v.fuelPrice : null;
  },
  // Default vehicle: pickup (กระบะ)
  getVehicle() {
    const saved = localStorage.getItem('vehicle_profile');
    return saved && this.VEHICLE_PROFILES[saved]
      ? saved
      : 'pickup';
  },
  setVehicle(profile) {
    if (this.VEHICLE_PROFILES[profile]) {
      localStorage.setItem('vehicle_profile', profile);
    }
  },
  // Calculate fuel cost for a distance (meters)
  // Returns {liters, baht, km}
  calcFuel(distanceMeters, vehicleProfile) {
    const v = this.VEHICLE_PROFILES[vehicleProfile || this.getVehicle()] || this.VEHICLE_PROFILES.motorcycle;
    const km = distanceMeters / 1000;
    const liters = km / v.kmPerLiter;
    const baht = liters * v.fuelPrice;
    return { km, liters, baht, vehicle: v, profile: vehicleProfile || this.getVehicle() };
  },
  // Format Baht (Thai currency)
  formatBaht(amount) {
    return new Intl.NumberFormat('th-TH', {
      minimumFractionDigits: amount < 100 ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(amount);
  },

  // ===== iOS/Android keyboard guard =====
  // element position:fixed; bottom:X อ้างอิง layout viewport เต็มจอ
  // แต่พอแป้นพิมพ์เปิดบนมือถือ visualViewport หด -> หน้าต่าง/ช่องพิมพ์โดนบัง
  // แก้: ฟัง visualViewport resize/scroll คำนวณความสูงแป้นพิมพ์ (--kb-h)
  // + class keyboard-open บน <html> ให้ CSS ยก panel/modal ขึ้นพ้นแป้นพิมพ์
  initKeyboardGuard() {
    const vv = window.visualViewport;
    if (!vv || typeof vv.addEventListener !== 'function') return; // ไม่ support → ข้าม
    const root = document.documentElement;
    let raf = null;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));
      root.style.setProperty('--kb-h', kb.toFixed(0) + 'px');
      root.classList.toggle('keyboard-open', kb > 60);
    };
    vv.addEventListener('resize', () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = null; update(); });
    });
    vv.addEventListener('scroll', update);
    window.addEventListener('focusin', () => setTimeout(update, 350));
    update();
  },

  // ===== Custom confirm dialog (iOS Safari confirm() ไม่แสดงตอนแป้นพิมพ์เปิด) =====
  // รับ: { title, message, confirmText, cancelText, danger } → Promise<boolean>
  confirmDialog({ title = 'ยืนยัน', message = '', confirmText = 'ยืนยัน', cancelText = 'ยกเลิก', danger = false } = {}) {
    return new Promise((resolve) => {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }

      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      const card = document.createElement('div');
      card.className = 'confirm-card';
      const t = document.createElement('div');
      t.className = 'confirm-title';
      t.textContent = title;
      const m = document.createElement('div');
      m.className = 'confirm-msg';
      m.style.whiteSpace = 'pre-line';
      m.textContent = message;
      const btns = document.createElement('div');
      btns.className = 'confirm-btns';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'confirm-btn cancel';
      cancelBtn.textContent = cancelText;
      const okBtn = document.createElement('button');
      okBtn.className = 'confirm-btn ok' + (danger ? ' danger' : '');
      okBtn.textContent = confirmText;

      btns.appendChild(cancelBtn);
      btns.appendChild(okBtn);
      card.appendChild(t);
      card.appendChild(m);
      card.appendChild(btns);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      setTimeout(() => okBtn.focus(), 50);

      const done = (v) => {
        overlay.remove();
        resolve(v);
      };
      cancelBtn.addEventListener('click', () => done(false));
      okBtn.addEventListener('click', () => done(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
      document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); done(false); }
        if (e.key === 'Enter') { document.removeEventListener('keydown', onKey); done(true); }
      });
    });
  },
};

window.Utils = Utils;
// ===== Authentication — username/password + legacy PIN fallback =====

const Auth = {
  TOKEN_KEY: 'bfr_token',
  USER_KEY: 'bfr_user',
  TOKEN_REFRESH_KEY: 'bfr_token_refresh',
  SESSION_WARNING_KEY: 'bfr_session_warning',

  // ===== Local storage helpers =====
  getToken() { return localStorage.getItem(this.TOKEN_KEY); },

  getUser() {
    try { return JSON.parse(localStorage.getItem(this.USER_KEY)); }
    catch { return null; }
  },

  isLoggedIn() { return !!this.getToken() && !!this.getUser() && !this.isTokenExpired(); },

  // Check if JWT token is expired (decode payload, check exp claim)
  isTokenExpired() {
    const token = this.getToken();
    if (!token) return true;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp ? (payload.exp * 1000) < Date.now() : false;
    } catch {
      return false; // can't decode = assume valid (server will reject)
    }
  },

  // Get token expiry time in milliseconds
  getTokenExpiry() {
    const token = this.getToken();
    if (!token) return 0;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp ? (payload.exp * 1000) : 0;
    } catch {
      return 0;
    }
  },

  // Check if token needs refresh (within 30 minutes of expiry)
  needsRefresh() {
    const expiry = this.getTokenExpiry();
    if (!expiry) return false;
    const now = Date.now();
    const thirtyMinutes = 30 * 60 * 1000;
    return (expiry - now) < thirtyMinutes && (expiry - now) > 0;
  },

  // Try to refresh the token
  async refreshToken() {
    try {
      const token = this.getToken();
      if (!token) return false;
      
      const res = await fetch('/api/refresh-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.token) {
          localStorage.setItem(this.TOKEN_KEY, data.token);
          localStorage.setItem(this.TOKEN_REFRESH_KEY, Date.now().toString());
          console.log('[Auth] Token refreshed successfully');
          return true;
        }
      }
    } catch (err) {
      console.warn('[Auth] Token refresh failed:', err.message);
    }
    return false;
  },

  // Start token refresh timer (check every 5 minutes)
  startRefreshTimer() {
    // Clear existing timer
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
    }
    
    // Check every 5 minutes
    this._refreshTimer = setInterval(() => {
      if (this.isLoggedIn() && this.needsRefresh()) {
        this.refreshToken();
      }
    }, 5 * 60 * 1000);
    
    // Also check immediately
    if (this.isLoggedIn() && this.needsRefresh()) {
      this.refreshToken();
    }
  },

  // Show session timeout warning (5 minutes before expiry)
  showSessionWarning() {
    const expiry = this.getTokenExpiry();
    if (!expiry) return;
    
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    const timeLeft = expiry - now;
    
    if (timeLeft > 0 && timeLeft <= fiveMinutes) {
      // Show warning toast
      const minutesLeft = Math.ceil(timeLeft / 60000);
      if (typeof Utils !== 'undefined' && Utils.toast) {
        Utils.toast(`⚠️ เซสชันจะหมดอายุใน ${minutesLeft} นาที — กรุณาบันทึกงาน`, 'warn');
      }
      localStorage.setItem(this.SESSION_WARNING_KEY, 'true');
    }
  },

  // Start session warning timer
  startSessionWarningTimer() {
    // Clear existing timer
    if (this._warningTimer) {
      clearInterval(this._warningTimer);
    }
    
    // Check every minute
    this._warningTimer = setInterval(() => {
      if (this.isLoggedIn()) {
        this.showSessionWarning();
      }
    }, 60 * 1000);
  },

  logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    localStorage.removeItem(this.TOKEN_REFRESH_KEY);
    localStorage.removeItem(this.SESSION_WARNING_KEY);
    
    // Clear timers
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    if (this._warningTimer) {
      clearInterval(this._warningTimer);
      this._warningTimer = null;
    }
    
    location.reload();
  },

  // ===== UI transitions =====
  showLogin() {
    const ls = document.getElementById('login-screen');
    ls.classList.remove('hidden');
    ls.classList.remove('login-mode');
    document.getElementById('app').classList.add('hidden');
  },

  showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    const user = this.getUser();
    if (user) {
      const nameEl = document.getElementById('user-name');
      const branchLabel = user.branchName || user.branch || '';
      nameEl.textContent = branchLabel
        ? `👤 ${user.name} · ${branchLabel}`
        : `👤 ${user.name}`;
    }
    
    // Start token refresh and session warning timers
    this.startRefreshTimer();
    this.startSessionWarningTimer();
  },

  // ===== Login with username/password (primary) =====
  async login(username, password) {
    // Try primary endpoint
    let data;
    try {
      data = await API.post('/api/login', { username, password });
    } catch (err) {
      console.warn('Primary login failed:', err);
      // Legacy /api/auth/login รับแค่ PIN ไม่รับ username/password — เลยไม่ fallback
      // ให้แสดง error ชัดๆ ว่าลองใช้ PIN แทน
      Utils.toast('ระบบเข้าสู่ระบบขัดข้อง — กรุณาใช้ PIN หรือลองใหม่อีกครั้ง');
      return false;
    }
    if (data?.success) return this._finalizeLogin(data, '🌟');
    return false;
  },

  // ===== Login with legacy PIN (fallback) =====
  async loginPIN(pin) {
    try {
      const data = await API.post('/api/login', { pin });
      if (data?.success) return this._finalizeLogin(data, ' (PIN) 🌟');
    } catch (err) {
      console.warn('Primary PIN login failed:', err);
      // Fallback: legacy /api/auth/login (uses old PIN_TEAM map, no KV needed)
      const legacy = await this._tryLegacyAuth({ pin });
      if (legacy?.success) return this._finalizeLogin(legacy, ' (PIN) 🌟');
      Utils.toast('ระบบ PIN ขัดข้อง — กรุณาลองใหม่');
      return false;
    }
    return false;
  },

  // ===== Internal helpers =====
  _finalizeLogin(data, suffix) {
    localStorage.setItem(this.TOKEN_KEY, data.token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(data.user));
    localStorage.setItem(this.TOKEN_REFRESH_KEY, Date.now().toString());
    this.showApp();
    Utils.toast(`ยินดีต้อนรับคุณ ${data.user.name}${suffix}`);
    return true;
  },

  /**
   * Try legacy /api/auth/login — has hardcoded PIN_TEAM + no PBKDF2.
   * Survives total backend regression on /api/login.
   * Used as automatic fallback, not user-visible.
   */
  async _tryLegacyAuth(payload) {
    try {
      const data = await API.post('/api/auth/login', payload);
      if (data?.success) console.info('[auth] Logged in via legacy fallback');
      return data;
    } catch (e) {
      console.warn('[auth] Legacy fallback also failed:', e);
      return null;
    }
  },

  // ===== Check if current user is admin =====
  isAdmin() {
    const user = this.getUser();
    return user && user.role === 'admin';
  },
};

window.Auth = Auth;
// ===== API client — talks to Cloudflare Pages Functions =====

const API = {
  // Get API base URL (same-origin in production)
  baseUrl() {
    return window.location.origin;
  },

  // Get auth headers
  headers() {
    const token = Auth.getToken();
    return {
      'Content-Type': 'application/json',
      ...(token && !token.startsWith('offline_') ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  },

  // GET request
  async get(path) {
    try {
      const res = await fetch(this.baseUrl() + path, {
        method: 'GET',
        headers: this.headers(),
      });
      if (!res.ok) {
        if (res.status === 401) {
          Utils.toast('Session หมดอายุ กรุณา login ใหม่', 'error');
          Auth.logout();
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      console.warn(`API GET ${path} failed:`, err.message);
      throw err;
    }
  },

  // POST request
  async post(path, body) {
    try {
      const res = await fetch(this.baseUrl() + path, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 401) {
          Auth.logout();
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      console.warn(`API POST ${path} failed:`, err.message);
      throw err;
    }
  },

  // PUT request
  async put(path, body) {
    const res = await fetch(this.baseUrl() + path, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  },

  // DELETE request (optional body for actions that need it)
  async del(path, body) {
    const res = await fetch(this.baseUrl() + path, {
      method: 'DELETE',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  },

  // ===== Unified sync =====
  // Push local state to cloud
  async syncAll(payload) {
    return this.post('/api/sync', payload);
  },

  // Pull full state from cloud
  async getAll() {
    return this.get('/api/sync');
  },

  // Legacy single-customer sync (kept for back-compat)
  async syncCustomers(local) {
    return this.post('/api/customers/sync', { customers: local });
  },
};

window.API = API;
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
      if (list[idx].cif) this.markDirty(list[idx].cif);   // S2: dirty-list
      const result = await this.push();
      if (result && result.success && list[idx].cif) this.clearDirty([list[idx].cif]);
      return { synced: !!(result && result.success), error: result?.error };
    }
    return { synced: false, error: 'Not found' };
  },

  getRoute() {
    try { return JSON.parse(localStorage.getItem(this.KEY_ROUTE) || '[]'); }
    catch { return []; }
  },

  async saveRoute(list) {
    localStorage.setItem(this.KEY_ROUTE, JSON.stringify(list));
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

  async saveSavedRoute(route) {
    const list = this.getSavedRoutes();
    route.id = route.id || Utils.uuid();
    route.savedAt = route.savedAt || new Date().toISOString();
    route.savedBy = Auth.getUser()?.name || 'unknown';
    list.push(route);
    localStorage.setItem(this.KEY_SAVED_ROUTES, JSON.stringify(list));
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

    return {
      customers,
      visits: this.getVisits(),
      savedRoutes: this.getSavedRoutes(),
    };
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

  // ===== Polling — fire every 3s to detect remote changes =====
  _pollingTimer: null,
  startPolling(intervalMs = 60000) {
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
// ===== Fuel: vehicle data + price cache =====
// Phase 6: BAAC debt follow-up — calculate fuel cost per route/visit report
// Pricing model: keep simple, default values + manual update via Settings
// (no live PTT scrape — CORS + reliability concerns, can be added later)

const Fuel = {
  KEY_PRICES: 'bfr_fuel_prices',
  KEY_PRICES_DATE: 'bfr_fuel_prices_date',

  // Vehicle catalog (3 types per BAAC ops spec)
  // km/L = average fuel consumption; baht/L = price (cache-able)
  VEHICLES: {
    motorcycle: {
      id: 'motorcycle',
      label: '🏍️ มอเตอร์ไซด์',
      kmPerLiter: 35,
      fuelType: 'gasohol95',
    },
    car: {
      id: 'car',
      label: '🚗 รถเก๋ง',
      kmPerLiter: 12,
      fuelType: 'gasohol95',
    },
    pickup: {
      id: 'pickup',
      label: '🛻 กระบะ',
      kmPerLiter: 10,
      fuelType: 'diesel',
    },
  },

  // Fuel type catalog (label + default price ฿/L)
  FUEL_TYPES: {
    diesel:       { id: 'diesel',       label: 'ดีเซล (B7)',     defaultPrice: 30.0 },
    gasohol95:    { id: 'gasohol95',    label: 'แก๊สโซฮอล์ 95',  defaultPrice: 36.0 },
    gasohol91:    { id: 'gasohol91',    label: 'แก๊สโซฮอล์ 91',  defaultPrice: 35.5 },
  },

  // ===== Get vehicle =====
  getVehicle(id) {
    return this.VEHICLES[id] || this.VEHICLES.car;
  },

  // ===== Get fuel price (with cache + fallback to default) =====
  getPrice(fuelTypeId) {
    const cache = this._getCache();
    const fuel = this.FUEL_TYPES[fuelTypeId] || this.FUEL_TYPES.gasohol95;
    if (cache[fuelTypeId] && cache[fuelTypeId] > 0) {
      return cache[fuelTypeId];
    }
    return fuel.defaultPrice;
  },

  // ===== Set price (admin) — updates cache =====
  setPrice(fuelTypeId, price) {
    if (price < 0 || isNaN(price)) return false;
    const cache = this._getCache();
    cache[fuelTypeId] = parseFloat(price);
    this._saveCache(cache);
    return true;
  },

  // ===== Calculate fuel cost for distance (km) =====
  // Returns: { liters, baht, kmPerLiter, pricePerLiter }
  calculate(distanceKm, vehicleId) {
    const v = this.getVehicle(vehicleId);
    const pricePerLiter = this.getPrice(v.fuelType);
    const liters = distanceKm / v.kmPerLiter;
    const baht = liters * pricePerLiter;
    return {
      liters: liters,
      baht: baht,
      kmPerLiter: v.kmPerLiter,
      pricePerLiter: pricePerLiter,
      fuelType: v.fuelType,
      fuelLabel: this.FUEL_TYPES[v.fuelType].label,
    };
  },

  // ===== Get all current prices (for display) =====
  getAllPrices() {
    const cache = this._getCache();
    const out = {};
    for (const [id, fuel] of Object.entries(this.FUEL_TYPES)) {
      out[id] = {
        label: fuel.label,
        price: cache[id] || fuel.defaultPrice,
        isDefault: !cache[id] || cache[id] === fuel.defaultPrice,
        defaultPrice: fuel.defaultPrice,
      };
    }
    return out;
  },

  // ===== Reset to defaults =====
  resetPrices() {
    localStorage.removeItem(this.KEY_PRICES);
    localStorage.removeItem(this.KEY_PRICES_DATE);
  },

  // ===== Last update date =====
  getLastUpdate() {
    return localStorage.getItem(this.KEY_PRICES_DATE);
  },

  // ===== Internal: cache helpers =====
  _getCache() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY_PRICES) || '{}');
    } catch { return {}; }
  },

  _saveCache(cache) {
    localStorage.setItem(this.KEY_PRICES, JSON.stringify(cache));
    localStorage.setItem(this.KEY_PRICES_DATE, new Date().toISOString());
  },
};

window.Fuel = Fuel;
// ===== Customer Database — search from imported BAAC customer data =====
// Lazy-loaded: defers JSON.parse until browser is idle (saves ~200ms on initial load)

const CustomerDB = {
  _data: null,      // Full array
  _byCif: null,     // Map: CIF → record
  _loading: false,
  _loaded: false,

  // Load database from static JSON — deferred via requestIdleCallback
  load() {
    if (this._loaded) return Promise.resolve(this._data);
    if (this._loading) return this._loadPromise;
    this._loading = true;
    this._loadPromise = new Promise(resolve => {
      const doLoad = async () => {
        try {
          // Security: read from authed API instead of public static JSON
          const res = await fetch(API.baseUrl() + '/api/customers?limit=10000', { headers: API.headers() });
          if (!res.ok) throw new Error('Failed to load customer database');
          const payload = await res.json();
          this._data = Array.isArray(payload.customers) ? payload.customers : [];
          // Build CIF index
          this._byCif = new Map();
          for (const r of this._data) {
            this._byCif.set(r.cif, r);
          }
          this._loaded = true;
          console.log(`[CustomerDB] Loaded ${this._data.length} customers`);
        } catch (err) {
          console.warn('[CustomerDB] Load failed:', err.message);
          this._data = [];
          this._byCif = new Map();
        }
        this._loading = false;
        resolve(this._data);
      };
      // Defer to idle time so we don't block initial render
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(doLoad, { timeout: 3000 });
      } else {
        setTimeout(doLoad, 100);
      }
    });
    return this._loadPromise;
  },

  // Search by CIF or name (fuzzy, returns top N results)
  search(query, limit = 15) {
    if (!this._data || !query) return [];
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];

    const results = [];
    for (const r of this._data) {
      const cifMatch = r.cif.includes(q);
      const nameMatch = r.name.toLowerCase().includes(q);
      const idMatch = r.id_card && r.id_card.includes(q);
      if (cifMatch || nameMatch || idMatch) {
        results.push(r);
        if (results.length >= limit) break;
      }
    }
    return results;
  },

  // Lookup by exact CIF
  getByCif(cif) {
    if (!this._byCif) return null;
    return this._byCif.get(cif) || null;
  },

  // Format potential badge
  formatPotential(potential) {
    if (!potential) return '';
    const colors = { 'แดง': '🔴', 'เหลือง': '🟡', 'เขียว': '🟢' };
    return (colors[potential] || '') + ' ' + potential;
  },

  // Format customer class badge
  formatClass(cls) {
    if (!cls) return '';
    const badges = {
      'AAA+': '⭐⭐⭐', 'AAA': '⭐⭐', 'AA': '⭐',
      'A': '🟢', 'B': '🟡', '1': '🔴'
    };
    return (badges[cls] || '') + ' ' + cls;
  },

  // Build full address string
  fullAddress(r) {
    const parts = [r.address];
    if (r.moo) parts.push('ม.' + r.moo.replace(/^'/, ''));
    if (r.tambon) parts.push('ต.' + r.tambon);
    if (r.amphoe) parts.push('อ.' + r.amphoe);
    if (r.province) parts.push('จ.' + r.province);
    if (r.postcode) parts.push(r.postcode);
    return parts.filter(Boolean).join(' ');
  },
};

window.CustomerDB = CustomerDB;
// ===== Debt Database — imported BAAC Customer Indicator (หนี้) data =====
// ข้อมูล: จำนวนสัญญา, หนี้รวม, ชั้นหนี้สูงสุด, Next Due เร็วสุด + รายการสัญญาแต่ละตัว

const DebtDB = {
  _byCif: null,
  _loaded: false,
  _loading: false,

  async load() {
    if (this._loaded) return true;
    if (this._loading) return false;
    this._loading = true;
    try {
      // โหลดจาก API (อ่าน KV ที่อัปเดตล่าสุดจาก /api/debt-import → fallback static เดิม)
      const res = await fetch(API.baseUrl() + '/api/debt-data', { headers: API.headers() });
      if (!res.ok) throw new Error('Failed to load debt data');
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('debt data not array');
      this._byCif = new Map();
      for (const r of data) this._byCif.set(r.cif, r);
      this._loaded = true;
      this._loadedAt = Date.now();
      console.log(`[DebtDB] Loaded ${data.length} customers` + (res.headers.get('X-Debt-Source') === 'kv' ? ' (from KV)' : ''));
    } catch (err) {
      console.warn('[DebtDB] Load failed:', err.message);
      this._byCif = new Map();
    }
    this._loading = false;
    return this._loaded;
  },

  // re-fetch ข้อมูลล่าสุด (หลังแอดมินอัพหนี้ใหม่ → หน้าสรุปเห็นเลขใหม่
  // โดยไม่ต้องรีเฟรชหน้า) — ไม่บล็อก ล้มเหลวเงียบ
  async refresh() {
    try {
      const res = await fetch(API.baseUrl() + '/api/debt-data', { headers: API.headers() });
      if (!res.ok) return false;
      const data = await res.json();
      if (!Array.isArray(data)) return false;
      this._byCif = new Map();
      for (const r of data) this._byCif.set(r.cif, r);
      this._loaded = true;
      this._loadedAt = Date.now();
      console.log(`[DebtDB] Refreshed ${data.length} customers (หลังอัพหนี้ใหม่)`);
      return true;
    } catch (err) {
      console.warn('[DebtDB] refresh failed:', err.message);
      return false;
    }
  },

  // Lookup debt by exact CIF -> record {cif,total_debt,num_contracts,max_tier,earliest_due,contracts[]} | null
  getByCif(cif) {
    if (!this._byCif) return null;
    return this._byCif.get(String(cif).trim()) || null;
  },

  // รูปแบบตัวเลขเงิน
  fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('th-TH', { maximumFractionDigits: 0 }) + ' บาท';
  },

  // รูปแบบวันที่ dd/mm/yyyy -> เดือนไทย
  fmtDate(d) {
    if (!d) return '';
    const m = String(d).match(/(\d+)\/(\d+)\/(\d+)/);
    if (!m) return d;
    const th = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    return th[parseInt(m[2]) - 1] + ' ' + (parseInt(m[3]) + 543);
  },

  // key สำหรับกรองเดือน: 'MM/YYYY' (ใช้ใน dropdown)
  dueMonthKey(d) {
    if (!d) return '';
    const m = String(d).match(/(\d+)\/(\d+)\/(\d+)/);
    if (!m) return '';
    return m[2] + '/' + m[3];
  },

  // สีตามชั้นหนี้
  tierColor(t) {
    t = parseInt(t) || 0;
    if (t >= 5) return '#b30000';
    if (t >= 4) return '#d00000';
    if (t >= 3) return '#ff7a00';
    if (t >= 2) return '#ffaa00';
    return '#1f8a4c';
  },

  // แสดงชั้นหนี้เป็น badge
  tierBadge(t) {
    t = parseInt(t) || 0;
    if (!t) return '<span class="meta-badge gray">ไม่ระบุ</span>';
    const labels = { 1: 'ชั้น 1', 2: 'ชั้น 2', 3: 'ชั้น 3', 4: 'ชั้น 4', 5: 'ชั้น 5' };
    return `<span class="meta-badge red-debt">${labels[t] || t}</span>`;
  },

  // แถบสรุปหนี้สำหรับการ์ด (popup + list)
  summaryHTML(debt) {
    if (!debt) return '';
    const urgent = debt.max_tier >= 2;
    const color = this.tierColor(debt.max_tier);
    return `
      <div class="debt-summary ${urgent ? 'debt-urgent' : ''}" style="border-left-color:${color}">
        <div class="debt-row">
          <span class="debt-label">💰 หนี้รวม</span>
          <span class="debt-val">${this.fmtMoney(debt.total_debt)}</span>
        </div>
        <div class="debt-row">
          <span class="debt-label">📦 สัญญา</span>
          <span class="debt-val">${debt.num_contracts} สัญญา · ชั้นสูงสุด ${debt.max_tier || '-'}</span>
        </div>
        <div class="debt-row">
          <span class="debt-label">📅 ถึงกำหนดเร็วสุด</span>
          <span class="debt-val">${this.fmtDate(debt.earliest_due) || '-'}</span>
        </div>
      </div>
    `;
  },

  // รายการสัญญา (โชว์ 3 ตัวแรก + ปุ่มดูอีก)
  contractsHTML(debt, showAll) {
    if (!debt || !debt.contracts || debt.contracts.length === 0) return '';
    const shown = showAll ? debt.contracts : debt.contracts.slice(0, 3);
    const hasMore = debt.contracts.length > 3 && !showAll;
    const fmtBaht = (n) => Number(n||0).toLocaleString('th-TH',{maximumFractionDigits:0})+' บาท';
    const rows = shown.map((c, i) => {
      const t = parseInt(c.t) || 0;
      const urgent = t >= 2;
      // 15 เดือน badges
      let m15line = '';
      if (c.m15 === 'Y') m15line += '<div class="dc-line" style="color:#92400e">⏳ <b>15 เดือน: ต้องชำระ</b></div>';
      if (c.m15_amt > 0) m15line += `<div class="dc-line" style="color:#b91c1c">💸 15เดือน 31มี.ค.70 ขั้นต่ำ ${fmtBaht(c.m15_amt)}</div>`;
      // พักหนี้ — แสดงเฉพาะรหัสที่มีตัวอักษร (SP/EP ฯลฯ) ไม่เอา ''/0/1/2/3
      let subLine = '';
      if (c.sub && !['','0','1','2','3'].includes(String(c.sub).trim()) && /[A-Za-z]/.test(c.sub)) {
        subLine = `<div class="dc-line" style="color:#0f766e">🛟 พักหนี้ (${this.escapeHTML(c.sub)})</div>`;
      }
      // คาดการณ์
      let fore='';
      if (c.f08==='Y' || c.f09==='Y' || c.f10==='Y'){
        const parts=[];
        if(c.f08==='Y') parts.push(`ส.ค.69${c.p08>0?' '+fmtBaht(c.p08):''}`);
        if(c.f09==='Y') parts.push(`ก.ย.69${c.p09>0?' '+fmtBaht(c.p09):''}`);
        if(c.f10==='Y') parts.push(`ต.ค.69${c.p10>0?' '+fmtBaht(c.p10):''}`);
        fore = `<div class="dc-line" style="color:#7c3aed">🔮 คาด 15เดือน: ${parts.join(' · ')}</div>`;
      }
      return `
        <div class="debt-contract ${urgent ? 'debt-contract-urgent' : ''}">
          <div class="dc-head">
            <span class="dc-no">สัญญา ${i + 1}</span>
            <span class="dc-tier" style="color:${this.tierColor(t)}">${t ? 'ชั้น ' + t : 'ชั้น -'}</span>
          </div>
          <div class="dc-line">🏷️ เลขสัญญา ${this.escapeHTML(c.c)}</div>
          <div class="dc-line">💰 ${this.fmtMoney(c.d)}</div>
          <div class="dc-line">📅 ถึง ${this.fmtDate(c.due) || '-'}</div>
          ${c.reserve ? `<div class="dc-line">🛡️ กันสำรอง ${this.escapeHTML(c.reserve)}%</div>` : ''}
          ${m15line}
          ${subLine}
          ${fore}
        </div>
      `;
    }).join('');
    const btn = hasMore
      ? `<button class="debt-more" onclick="DebtUI.expand('${debt.cif}')">ดูสัญญาทั้งหมด (${debt.contracts.length} สัญญา) ▾</button>`
      : '';
    return `<div class="debt-contracts">${rows}${btn}</div>`;
  },

  escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  },
};

window.DebtDB = DebtDB;

// ===== DebtUI — ตัวช่วย UI สำหรับการ์ดหนี้ =====
const DebtUI = {
  // ขยาย/ย่อรายการสัญญาในการ์ด popup
  expand(cif) {
    const detail = document.getElementById('debt-contracts-' + cif);
    if (!detail) return;
    const debt = DebtDB.getByCif(cif);
    if (!debt) return;
    detail.innerHTML = DebtDB.contractsHTML(debt, true);
  },
};
window.DebtUI = DebtUI;
// ===== DebtSummary — แสดงภาพรวมหนี้ทั้งสาขา (แท็บ 📊 สรุปหนี้) =====
// ข้อมูลจาก DebtDB (Customer Indicator)

const DebtSummary = {
  async render() {
    if (!window.DebtDB || !DebtDB._loaded) {
      this._setSub('ข้อมูลหนี้ยังไม่โหลด');
      if (window.DebtDB && !DebtDB._loaded) DebtDB.load().then(() => this.render());
      return;
    }
    // อัพหนี้ใหม่ระหว่างเปิดแอปค้างไว้ → refresh เงียบๆ ถ้า cache เก่าเกิน 2 นาที
    const staleMs = Date.now() - (DebtDB._loadedAt || 0);
    if (staleMs > 120000) {
      DebtDB._loadedAt = Date.now(); // กัน refresh ซ้ำเป็น loop
      DebtDB.refresh().then((ok) => { if (ok) this.render(); });
    }
    const data = [...DebtDB._byCif.values()];

    // ===== ภาพรวม =====
    const totalCif = data.length;
    const totalDebt = data.reduce((s, r) => s + (+r.total_debt || 0), 0);

    const self = this;
    const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 });
    const sub = document.getElementById('debt-summary-sub');
    if (sub) sub.textContent = `ลูกค้า ${totalCif.toLocaleString('th-TH')} ราย · ${data.reduce((s,r)=>s+(+r.num_contracts||0),0).toLocaleString('th-TH')} สัญญา` +
      ` · หนี้รวม ${fmt(totalDebt)} บาท`;

    // การ์ดภาพรวม
    const ov = document.getElementById('debt-overview-cards');
    if (ov) {
      ov.innerHTML = `
        <div class="dov-card dov-green"><span class="dov-num">${fmt(totalDebt)}</span><span class="dov-label">หนี้รวม (บาท)</span></div>
        <div class="dov-card dov-blue"><span class="dov-num">${totalCif.toLocaleString('th-TH')}</span><span class="dov-label">ลูกค้าหนี้</span></div>
        <div class="dov-card dov-amber"><span class="dov-num">${data.reduce((s,r)=>s+(+r.num_contracts||0),0).toLocaleString('th-TH')}</span><span class="dov-label">สัญญา</span></div>
      `;
    }

    // ===== แยกตามกลุ่มสี (จาก Customer Indicator via CustomerDB potential) =====
    // ใช้ debt-data ไม่มี color ตรงๆ -> ใช้ customer list (Storage) หา potential
    // แต่ summary นี้อิงข้อมูลหนี้เป็นหลัก; เรียงตามชั้นหนี้แทน และให้ block สีใช้จาก Storage
    const colorBlock = document.getElementById('debt-color-block');
    const customers = typeof Storage !== 'undefined' ? Storage.getActiveCustomers() : [];
    const colorCount = { แดง: 0, เหลือง: 0, เขียว: 0 };
    const colorDebt = { แดง: 0, เหลือง: 0, เขียว: 0 };
    for (const c of customers) {
      const db = c.cif && window.CustomerDB && CustomerDB._loaded ? CustomerDB.getByCif(c.cif) : null;
      const p = db ? db.potential : null;
      if (p && colorCount[p] !== undefined) {
        colorCount[p]++;
        const debt = c.cif ? DebtDB.getByCif(c.cif) : null;
        colorDebt[p] += (debt ? +debt.total_debt || 0 : 0);
      }
    }
    if (colorBlock) {
      const totalColor = (colorCount['แดง'] + colorCount['เหลือง'] + colorCount['เขียว']) || 1;
      colorBlock.innerHTML = `
        <div class="ds-row"><span class="ds-label" style="color:#d00000">🔴 แดง</span><span class="ds-val">${colorCount['แดง']} ราย (${Math.round(colorCount['แดง']/totalColor*100)}%) · ${fmt(colorDebt['แดง'])} บาท</span></div>
        <div class="ds-row"><span class="ds-label" style="color:#d97706">🟡 เหลือง</span><span class="ds-val">${colorCount['เหลือง']} ราย (${Math.round(colorCount['เหลือง']/totalColor*100)}%) · ${fmt(colorDebt['เหลือง'])} บาท</span></div>
        <div class="ds-row"><span class="ds-label" style="color:#16a34a">🟢 เขียว</span><span class="ds-val">${colorCount['เขียว']} ราย (${Math.round(colorCount['เขียว']/totalColor*100)}%) · ${fmt(colorDebt['เขียว'])} บาท</span></div>
      `;
      if (totalColor === 1 && colorCount['แดง']+colorCount['เหลือง']+colorCount['เขียว'] === 0) {
        colorBlock.innerHTML = '<div class="ds-note">ไม่พบข้อมูลศักยภาพ (กรอกข้อมูลลูกค้ายังไม่ครบ)</div>';
      }
    }

    // ===== แยกตามชั้นหนี้ =====
    const tierBlock = document.getElementById('debt-tier-block');
    if (tierBlock) {
      const tierCount = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const tierDebt = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const r of data) {
        const t = parseInt(r.max_tier) || 0;
        if (tierCount[t] !== undefined) { tierCount[t]++; tierDebt[t] += (+r.total_debt || 0); }
      }
      const labels = { 1: 'ชั้น 1', 2: 'ชั้น 2', 3: 'ชั้น 3', 4: 'ชั้น 4', 5: 'ชั้น 5' };
      const goodN = tierCount[1], goodD = tierDebt[1];
      const badN = tierCount[2] + tierCount[3] + tierCount[4] + tierCount[5];
      const badD = tierDebt[2] + tierDebt[3] + tierDebt[4] + tierDebt[5];
      tierBlock.innerHTML = `
        <div class="ds-row ds-total"><span class="ds-label">✅ Good Bank (ชั้น 1)</span><span class="ds-val">${goodN.toLocaleString('th-TH')} ราย · ${fmt(goodD)} บาท</span></div>
        <div class="ds-row ds-total"><span class="ds-label" style="color:#d00000">⛔ Bad Bank (ชั้น 2-5)</span><span class="ds-val" style="color:#d00000">${badN.toLocaleString('th-TH')} ราย · ${fmt(badD)} บาท</span></div>
      ` + Object.keys(tierCount).map(t => `
        <div class="ds-row ds-clickable" onclick="DebtSummary.drillDown('tier', '${t}')">
          <span class="ds-label" style="color:${DebtDB.tierColor(t)}">🏷️ ${labels[t]}</span>
          <span class="ds-val">${tierCount[t].toLocaleString('th-TH')} ราย · ${fmt(tierDebt[t])} บาท ▸</span>
        </div>
        <div class="ds-bar"><div class="ds-bar-fill" style="width:${(tierCount[t]/data.length*100)||0}%;background:${t>=2?'#d00000':'#16a34a'}"></div></div>
      `).join('');
    }

    // ===== แยกตามเขต (zone 1-5 จากฐานลูกค้า ผูกกับหนี้ผ่าน CIF) =====
    const zoneBlock = document.getElementById('debt-zone-block');
    if (zoneBlock) {
      if (!window.CustomerDB || !CustomerDB._loaded) {
        zoneBlock.innerHTML = '<div class="ds-note">กำลังโหลดฐานข้อมูลลูกค้า...</div>';
        if (window.CustomerDB && !CustomerDB._loaded) CustomerDB.load().then(() => this.render());
      } else {
        const zoneCount = {};
        const zoneDebt = {};
        const zoneOrder = ['1', '2', '3', '4', '5'];
        for (const r of data) {
          if (parseInt(r.max_tier) !== 1) continue;   // โซนโชว์เฉพาะ Good Bank (ชั้น 1)
          const cust = r.cif ? CustomerDB.getByCif(String(r.cif).trim()) : null;
          let z = cust && cust.zone ? String(cust.zone).trim() : '';
          if (!z) z = 'ไม่ระบุ';   // CIF ไม่มีในฐานลูกค้า หรือ zone ว่าง
          zoneCount[z] = (zoneCount[z] || 0) + 1;
          zoneDebt[z] = (zoneDebt[z] || 0) + (+r.total_debt || 0);
        }
        // เรียง: เขต 1-5 ก่อน แล้วรหัสพิเศษ (9807/76003/...) แล้วไม่ระบุเขตท้ายสุด
        const zoneKeys = Object.keys(zoneCount).sort((a, b) => {
          const ia = zoneOrder.indexOf(a), ib = zoneOrder.indexOf(b);
          if (ia >= 0 && ib >= 0) return ia - ib;
          if (ia >= 0) return -1;
          if (ib >= 0) return 1;
          if (a === 'ไม่ระบุ') return 1;
          if (b === 'ไม่ระบุ') return -1;
          return a.localeCompare(b);
        });
        const zoneTotal = zoneKeys.reduce((s, k) => s + zoneCount[k], 0) || 1;
        zoneBlock.innerHTML = zoneKeys.map(z => `
          <div class="ds-row"><span class="ds-label">🗺️ ${z === 'ไม่ระบุ' ? 'ไม่ระบุเขต' : 'เขต ' + z}</span><span class="ds-val">${zoneCount[z].toLocaleString('th-TH')} ราย · ${fmt(zoneDebt[z])} บาท</span></div>
          <div class="ds-bar"><div class="ds-bar-fill" style="width:${(zoneCount[z] / zoneTotal * 100) || 0}%;background:#0f766e"></div></div>
        `).join('');
      }
    }

    // ===== แยกตามเขต: ถึงกำหนด + 15 เดือน (บล็อก action รวม ดูง่ายแถวเดียวต่อเขต) =====
    // ตัวเลือกเดือนถึงกำหนด: เดือนปัจจุบัน → มี.ค.70 + ทั้งปีบัญชี (default)
    const dueSel = document.getElementById('debt-duemonth-filter');
    if (dueSel) {
      const _now = new Date(), _keys = [];
      let _y = _now.getFullYear(), _m = _now.getMonth() + 1;
      while (_y * 100 + _m <= 202703) {
        _keys.push(String(_m).padStart(2, '0') + '/' + _y);
        if (++_m > 12) { _m = 1; _y++; }
      }
      const _cur = self.selMonth || 'ALL';
      dueSel.innerHTML = `<option value="ALL">ทั้งปีบัญชี</option>` +
        _keys.map(k => `<option value="${k}"${k === _cur ? ' selected' : ''}>${DebtDB.fmtDate('01/' + k)}</option>`).join('');
      dueSel.onchange = () => { self.selMonth = dueSel.value; self.render(); };
    }
    const dueLabel = (self.selMonth && self.selMonth !== 'ALL') ? DebtDB.fmtDate('01/' + self.selMonth) : 'ปีนี้';
    const zdBlock = document.getElementById('debt-zonedue-block');
    if (zdBlock) {
      if (!window.CustomerDB || !CustomerDB._loaded) {
        zdBlock.innerHTML = '<div class="ds-note">กำลังโหลดฐานข้อมูลลูกค้า...</div>';
        if (window.CustomerDB && !CustomerDB._loaded) CustomerDB.load().then(() => this.render());
      } else {
        const yk = (mmyy) => { const p = String(mmyy).split('/'); return (+p[1]) * 100 + (+p[0]); };
        const FYS = yk('06/2026'), FYE = yk('03/2027');   // ปีบัญชีเดียวกับบล็อกรายเดือน
        const zc = {}, zfy = {}, zfyD = {}, zm = {}, zmA = {};
        // ขอบเขตเดือนเกิด 15 เดือนใหม่: เลือกเดือนเดียว → ตรงเดือนนั้น, ทั้งปีบัญชี → มิ.ย.69-มี.ค.70
        const scopeB15 = (b) => {
          if (!b) return false;
          if (self.selMonth && self.selMonth !== 'ALL') return b === self.selMonth;
          const p = String(b).split('/');
          return (+p[1]) * 100 + (+p[0]) >= FYS && (+p[1]) * 100 + (+p[0]) <= FYE;
        };
        const zoneOf = (r) => {
          const cust = r.cif ? CustomerDB.getByCif(String(r.cif).trim()) : null;
          const z = cust && cust.zone ? String(cust.zone).trim() : '';
          return z || 'ไม่ระบุ';
        };
        for (const r of data) {
          if (parseInt(r.max_tier) !== 1) continue;   // โซนโชว์เฉพาะ Good Bank (ชั้น 1)
          const z = zoneOf(r);
          zc[z] = (zc[z] || 0) + 1;
          const k = DebtDB.dueMonthKey(r.earliest_due);
          if (k) {
            const kv = yk(k);
            // เลือกเดือนเดียว → เอาเฉพาะเดือนนั้น, ทั้งปีบัญชี → ช่วง มิ.ย.69-มี.ค.70
            const inScope = (self.selMonth && self.selMonth !== 'ALL') ? (k === self.selMonth) : (kv >= FYS && kv <= FYE);
            if (inScope) {
              zfy[z] = (zfy[z] || 0) + 1;
              zfyD[z] = (zfyD[z] || 0) + (+r.total_debt || 0);
            }
          }
          // 15 เดือนเกิดใหม่ (b15 จากไฟล์หนี้ — คำนวณ 15-เดือนค้างตั้งแต่ตอนอัพ): นับหนี้รวมทั้งก้อน CIF
          let new15 = false;
          for (const c of (r.contracts || [])) { if (scopeB15(c.b15)) { new15 = true; break; } }
          if (new15) {
            zm[z] = (zm[z] || 0) + 1;
            zmA[z] = (zmA[z] || 0) + (+r.total_debt || 0);
          }
        }
        const zdOrder = ['1', '2', '3', '4', '5'];
        const zdKeys = Object.keys(zc).sort((a, b) => {
          const ia = zdOrder.indexOf(a), ib = zdOrder.indexOf(b);
          if (ia >= 0 && ib >= 0) return ia - ib;
          if (ia >= 0) return -1;
          if (ib >= 0) return 1;
          if (a === 'ไม่ระบุ') return 1;
          if (b === 'ไม่ระบุ') return -1;
          return a.localeCompare(b);
        });
        const gv = (o, k) => (o[k] || 0);
        const totFy = zdKeys.reduce((s, k) => s + gv(zfy, k), 0);
        const totFyD = zdKeys.reduce((s, k) => s + gv(zfyD, k), 0);
        const totM = zdKeys.reduce((s, k) => s + gv(zm, k), 0);
        const totMA = zdKeys.reduce((s, k) => s + gv(zmA, k), 0);
        zdBlock.innerHTML = `
          <div class="ds-row ds-total"><span class="ds-label">📊 รวมทุกเขต</span><span class="ds-val">📅 ${dueLabel} ${totFy.toLocaleString('th-TH')} ราย · ${fmt(totFyD)} บาท<br>⏳ เกิดใหม่ ${dueLabel} ${totM.toLocaleString('th-TH')} ราย · หนี้รวม ${fmt(totMA)} บาท</span></div>` +
          zdKeys.map(z => `
          <div class="ds-row"><span class="ds-label">🗺️ ${z === 'ไม่ระบุ' ? 'ไม่ระบุเขต' : 'เขต ' + z}</span><span class="ds-val">📅 ${dueLabel} ${gv(zfy, z).toLocaleString('th-TH')} ราย · ${fmt(gv(zfyD, z))} บาท<br>⏳ เกิดใหม่ ${dueLabel} ${gv(zm, z).toLocaleString('th-TH')} ราย · หนี้รวม ${fmt(gv(zmA, z))} บาท</span></div>
        `).join('');
      }
    }

    // ===== หนี้ถึงกำหนดรายเดือน (ปีบัญชีปัจจุบัน: มิ.ย.69 -> มี.ค.70) =====
    const monthBlock = document.getElementById('debt-month-block');
    if (monthBlock) {
      // key ตัวเลข YYYYMM สำหรับช่วงปีบัญชี
      const ykey = (mmyy) => { const p = String(mmyy).split('/'); return (+p[1]) * 100 + (+p[0]); };
      const FY_START = ykey('06/2026');   // มิ.ย. 2569
      const FY_END = ykey('03/2027');     // มี.ค. 2570
      const monthCount = {};
      const monthDebt = {};    // ยอดหนี้รวมต่อเดือน (total_debt ของ CIF ที่ถึงกำหนดเดือนนั้น)
      const monthOmsom = {};   // จำนวน อสม. ต่อเดือน
      let fyTotal = 0, fyOmsom = 0, fyDebt = 0;
      for (const r of data) {
        const k = DebtDB.dueMonthKey(r.earliest_due);
        if (!k) continue;
        const kv = ykey(k);
        if (kv >= FY_START && kv <= FY_END) {
          monthCount[k] = (monthCount[k] || 0) + 1;
          monthDebt[k] = (monthDebt[k] || 0) + (+r.total_debt || 0);
          fyTotal++;
          fyDebt += (+r.total_debt || 0);
          if (r.is_omsom) {
            fyOmsom++;
            monthOmsom[k] = (monthOmsom[k] || 0) + 1;
          }
        }
      }
      const sortedMonths = Object.keys(monthCount).sort((a, b) => ykey(a) - ykey(b));
      if (sortedMonths.length === 0) {
        monthBlock.innerHTML = '<div class="ds-note">ไม่มีหนี้ถึงกำหนดในปีบัญชีนี้</div>';
      } else {
        // แถวรวม (แยก อสม.) + รายเดือนช่วง มิ.ย.69-มี.ค.70 (วงเล็บจำนวน อสม.)
        const header = `
          <div class="ds-row ds-total"><span class="ds-label">📊 เหลือทั้งปีบัญชี</span><span class="ds-val">${fyTotal.toLocaleString('th-TH')} ราย · ${fmt(fyDebt)} บาท</span></div>
          <div class="ds-row"><span class="ds-label">👤 ลูกค้าทั่วไป</span><span class="ds-val">${(fyTotal - fyOmsom).toLocaleString('th-TH')} ราย</span></div>
          <div class="ds-row"><span class="ds-label">🩺 อสม. (3080/2838/2751)</span><span class="ds-val">${fyOmsom.toLocaleString('th-TH')} ราย</span></div>
        `;
        const rows = sortedMonths.map(k => `
          <div class="ds-row">
            <span class="ds-label">📅 ${DebtDB.fmtDate('01/' + k)}</span>
            <span class="ds-val">${monthCount[k].toLocaleString('th-TH')} ราย · ${fmt(monthDebt[k])} บาท${monthOmsom[k] ? ` (อสม. ${monthOmsom[k].toLocaleString('th-TH')})` : ''}</span>
          </div>
        `).join('');
        monthBlock.innerHTML = `${header}${rows}`;
      }
    }

    // ===== สถานะพิกัด =====
    // Server-authoritative: อ่าน counts.gps จาก /api/sync (D1) — ทุกเครื่องเห็นเลขเดียวกัน
    // ถ้าเรียก API ไม่ได้ (offline) → fallback นับจาก localStorage เครื่องนี้
    const geoBlock = document.getElementById('debt-geo-block');
    if (geoBlock) {
      let withGeo = 0, withoutGeo = 0;
      try {
        const res = await API.get('/api/sync');
        const c = res && res.success ? res.counts : null;
        if (c && c.gps != null && c.customers != null) {
          withGeo = c.gps;
          withoutGeo = Math.max(c.customers - c.gps, 0);
        } else {
          throw new Error('no counts');
        }
      } catch (e) {
        // Fallback: local count
        const hasGeoCif = new Set(
          (typeof Storage !== 'undefined' ? Storage.getActiveCustomers() : [])
            .filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng))
            .map(x => String(x.cif))
        );
        for (const r of data) {
          if (hasGeoCif.has(String(r.cif))) withGeo++;
          else withoutGeo++;
        }
      }
      const pctBase = withGeo + withoutGeo;
      const pct = pctBase ? Math.round(withGeo / pctBase * 100) : 0;
      geoBlock.innerHTML = `
        <div class="ds-row"><span class="ds-label" style="color:#16a34a">📍 มีพิกัดแล้ว</span><span class="ds-val">${withGeo.toLocaleString('th-TH')} ราย (${pct}%)</span></div>
        <div class="ds-bar"><div class="ds-bar-fill" style="width:${pct}%;background:#16a34a"></div></div>
        <div class="ds-row"><span class="ds-label" style="color:#d00000">⚠️ ยังไม่มีพิกัด</span><span class="ds-val">${withoutGeo.toLocaleString('th-TH')} ราย</span></div>
      `;
    }

    // ===== 15 เดือน =====
    const m15Block = document.getElementById('debt-15m-block');
    if (m15Block) {
      let cifM15Y=0, cifM15Amt=0, cifF08=0, cifF09=0, cifF10=0;
      let totM15Amt=0, totP08=0, totP09=0, totP10=0;
      let cntM15Y=0, cntM15Amt=0, cntF08=0, cntF09=0, cntF10=0;
      for (const r of data) {
        let hasY=false, hasAmt=false, hasF08=false, hasF09=false, hasF10=false;
        for (const c of (r.contracts||[])) {
          if (c.m15==='Y') cntM15Y++;
          if ((c.m15_amt||0)>0) cntM15Amt++;
          if (c.f08==='Y') cntF08++;
          if (c.f09==='Y') cntF09++;
          if (c.f10==='Y') cntF10++;
          if (c.m15==='Y' && !hasY) hasY=true;
          if ((c.m15_amt||0)>0 && !hasAmt) hasAmt=true;
          if (c.f08==='Y' && !hasF08) hasF08=true;
          if (c.f09==='Y' && !hasF09) hasF09=true;
          if (c.f10==='Y' && !hasF10) hasF10=true;
        }
        if (hasY) cifM15Y++;
        if (hasAmt) cifM15Amt++;
        if (hasF08) cifF08++;
        if (hasF09) cifF09++;
        if (hasF10) cifF10++;
      }
      for (const r of data) for (const c of (r.contracts||[])) {
        totM15Amt += (+c.m15_amt||0);
        totP08 += (+c.p08||0);
        totP09 += (+c.p09||0);
        totP10 += (+c.p10||0);
      }
      m15Block.innerHTML = `
        <div class="ds-row"><span class="ds-label">⏳ 15เดือนปัจจุบัน (Y)</span><span class="ds-val">${cifM15Y.toLocaleString('th-TH')} ราย · ${cntM15Y} สัญญา</span></div>
        <div class="ds-row"><span class="ds-label">💸 31มี.ค.70 (ต้องชำระ)</span><span class="ds-val">${cifM15Amt.toLocaleString('th-TH')} ราย · ${cntM15Amt} สัญญา</span></div>
        <div class="ds-row" style="margin-top:6px"><span class="ds-label" style="color:#7c3aed">🔮 คาด ส.ค.69</span><span class="ds-val">${cifF08.toLocaleString('th-TH')} ราย · ${cntF08} สัญญา</span></div>
        <div class="ds-row"><span class="ds-label" style="color:#7c3aed">🔮 คาด ก.ย.69</span><span class="ds-val">${cifF09.toLocaleString('th-TH')} ราย · ${cntF09} สัญญา</span></div>
        <div class="ds-row"><span class="ds-label" style="color:#7c3aed">🔮 คาด ต.ค.69</span><span class="ds-val">${cifF10.toLocaleString('th-TH')} ราย · ${cntF10} สัญญา</span></div>
      `;
    }
  },

  _setSub(msg) {
    const sub = document.getElementById('debt-summary-sub');
    if (sub) sub.textContent = msg;
  },

  // ===== Drill-down: show customers filtered by tier =====
  drillDown(type, value) {
    if (type === 'tier') {
      // Switch to customers tab and filter by debt tier
      const customers = Storage.getActiveCustomers();
      const filtered = customers.filter(c => {
        if (!c.cif || !DebtDB._loaded) return false;
        const debt = DebtDB.getByCif(c.cif);
        if (!debt) return false;
        return parseInt(debt.max_tier) === parseInt(value);
      });

      // Show results in a simple alert or switch to customers tab
      if (filtered.length === 0) {
        Utils.toast(`ไม่พบลูกค้าชั้นหนี้ ${value}`);
        return;
      }

      // Switch to customers tab and set filter
      App.switchSheetTab('customers');
      const searchInput = document.getElementById('customer-search');
      if (searchInput) {
        // Use search to filter — set a temporary filter
        searchInput.value = '';
        Customers.currentFilter = 'all';
        Customers.renderList();
        Utils.toast(`📋 แสดงลูกค้าชั้น ${value}: ${filtered.length} ราย — ใช้ค้นหาเพื่อกรองเพิ่ม`);
      }
    }
  },
};

window.DebtSummary = DebtSummary;
