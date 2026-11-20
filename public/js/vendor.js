var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
const Utils = {
  // Format distance (m → km with 1 decimal)
  formatKm(meters) {
    return (meters / 1e3).toFixed(1);
  },
  // Format duration (seconds → "Xh Ym" or "Y นาที")
  formatDuration(seconds) {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return mins;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h} \u0E0A\u0E21. ${m} \u0E19\u0E32\u0E17\u0E35` : `${h} \u0E0A\u0E31\u0E48\u0E27\u0E42\u0E21\u0E07`;
  },
  // Format Thai date
  formatThaiDate(date) {
    return new Date(date).toLocaleDateString("th-TH", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  },
  // Calculate haversine distance (meters) between two points
  haversine(lat1, lng1, lat2, lng2) {
    const R = 6371e3;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
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
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : r & 3 | 8).toString(16);
    });
  },
  // Toast notification
  toast(msg, type = "success") {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = `toast ${type}`;
    el.classList.remove("hidden");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add("hidden"), 2500);
  },
  // Format PIN display
  maskPin(pin) {
    return "\u2022".repeat(String(pin).length);
  },
  // Number with Thai locale
  formatNum(n) {
    return new Intl.NumberFormat("th-TH").format(n);
  },
  // ===== Vehicle fuel profiles =====
  // kmPerLiter: fixed. fuelPrice: loaded from /fuel-prices.json (Bangchak API)
  VEHICLE_PROFILES: {
    pickup: {
      name: "\u{1F6FB} \u0E01\u0E23\u0E30\u0E1A\u0E30",
      kmPerLiter: 10,
      fuelPrice: 35.69,
      speed: {
        highway: 70,
        road: 45,
        village: 30,
        dirt: 20
      }
    },
    car: {
      name: "\u{1F697} \u0E23\u0E16\u0E40\u0E01\u0E4B\u0E07",
      kmPerLiter: 12,
      fuelPrice: 39.57,
      speed: {
        highway: 80,
        road: 50,
        village: 35,
        dirt: 25
      }
    },
    motorcycle: {
      name: "\u{1F3CD}\uFE0F \u0E21\u0E2D\u0E40\u0E15\u0E2D\u0E23\u0E4C\u0E44\u0E0B\u0E04\u0E4C",
      kmPerLiter: 35,
      fuelPrice: 39.94,
      speed: {
        highway: 60,
        road: 40,
        village: 25,
        dirt: 15
      }
    }
  },
  _fuelPricesLoaded: false,
  _fuelUpdated: null,
  _fuelData: null,
  // Fetch live prices from static JSON (updated by cron)
  async loadFuelPrices() {
    try {
      const resp = await fetch("/fuel-prices.json?t=" + Date.now());
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
      console.log("[Fuel] Prices loaded:", new Date(data.updated).toLocaleDateString("th-TH"));
    } catch (e) {
      console.warn("[Fuel] Cannot load live prices, using defaults:", e.message);
    }
  },
  // Get fuel update date (e.g. "10/06/2569")
  getFuelUpdated() {
    return this._fuelUpdated;
  },
  // Get current fuel price for a vehicle type
  getFuelPrice(vehicleType) {
    const v = this.VEHICLE_PROFILES[vehicleType || this.getVehicle()];
    return v ? v.fuelPrice : null;
  },
  // Default vehicle: pickup (กระบะ)
  getVehicle() {
    const saved = localStorage.getItem("vehicle_profile");
    return saved && this.VEHICLE_PROFILES[saved] ? saved : "pickup";
  },
  setVehicle(profile) {
    if (this.VEHICLE_PROFILES[profile]) {
      localStorage.setItem("vehicle_profile", profile);
    }
  },
  // Calculate fuel cost for a distance (meters)
  // Returns {liters, baht, km}
  calcFuel(distanceMeters, vehicleProfile) {
    const v = this.VEHICLE_PROFILES[vehicleProfile || this.getVehicle()] || this.VEHICLE_PROFILES.motorcycle;
    const km = distanceMeters / 1e3;
    const liters = km / v.kmPerLiter;
    const baht = liters * v.fuelPrice;
    return { km, liters, baht, vehicle: v, profile: vehicleProfile || this.getVehicle() };
  },
  // Format Baht (Thai currency)
  formatBaht(amount) {
    return new Intl.NumberFormat("th-TH", {
      minimumFractionDigits: amount < 100 ? 2 : 0,
      maximumFractionDigits: 2
    }).format(amount);
  },
  // ===== iOS/Android keyboard guard =====
  // ปัญหา: element position:fixed; bottom:X อ้างอิง layout viewport เต็มจอ
  // แต่พอแป้นพิมพ์เปิดบนมือถือ visualViewport หด -> หน้าต่าง/ช่องพิมพ์โดนบัง
  // วิธีแก้: ฟัง visualViewport resize/scroll คำนวณความสูงแป้นพิมพ์ (--kb-h)
  // + ใส่ class keyboard-open บน <html> ให้ CSS ยก panel/modal ขึ้นพ้นแป้นพิมพ์
  initKeyboardGuard() {
    const vv = window.visualViewport;
    if (!vv || typeof vv.addEventListener !== "function") return;
    const root = document.documentElement;
    let raf = null;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));
      root.style.setProperty("--kb-h", kb.toFixed(0) + "px");
      root.classList.toggle("keyboard-open", kb > 60);
    };
    vv.addEventListener("resize", () => {
      if (!raf) raf = requestAnimationFrame(() => {
        raf = null;
        update();
      });
    });
    vv.addEventListener("scroll", update);
    window.addEventListener("focusin", () => setTimeout(update, 350));
    update();
  },
  // ===== Custom confirm dialog =====
  // ปัญหา: window.confirm() บน iOS Safari/WebKit ไม่แสดงป็อปอัพ
  // ขณะแป้นพิมพ์ยังเปิดอยู่ (และบางเวอร์ชัน return false ทันทีเงียบๆ)
  // → ใช้ modal ของแอปเองแทน ใช้ได้ทุกเครื่อง/ทุกจังหวะ
  // รับ: { title, message, confirmText, cancelText, danger }
  // คืน: Promise<boolean>
  confirmDialog({ title = "\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19", message = "", confirmText = "\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19", cancelText = "\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01", danger = false } = {}) {
    return new Promise((resolve) => {
      if (document.activeElement && typeof document.activeElement.blur === "function") {
        document.activeElement.blur();
      }
      const overlay = document.createElement("div");
      overlay.className = "confirm-overlay";
      const card = document.createElement("div");
      card.className = "confirm-card";
      const t = document.createElement("div");
      t.className = "confirm-title";
      t.textContent = title;
      const m = document.createElement("div");
      m.className = "confirm-msg";
      m.style.whiteSpace = "pre-line";
      m.textContent = message;
      const btns = document.createElement("div");
      btns.className = "confirm-btns";
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "confirm-btn cancel";
      cancelBtn.textContent = cancelText;
      const okBtn = document.createElement("button");
      okBtn.className = "confirm-btn ok" + (danger ? " danger" : "");
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
      cancelBtn.addEventListener("click", () => done(false));
      okBtn.addEventListener("click", () => done(true));
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) done(false);
      });
      document.addEventListener("keydown", function onKey(e) {
        if (e.key === "Escape") {
          document.removeEventListener("keydown", onKey);
          done(false);
        }
        if (e.key === "Enter") {
          document.removeEventListener("keydown", onKey);
          done(true);
        }
      });
    });
  }
};
window.Utils = Utils;
const Auth = {
  TOKEN_KEY: "bfr_token",
  USER_KEY: "bfr_user",
  TOKEN_REFRESH_KEY: "bfr_token_refresh",
  SESSION_WARNING_KEY: "bfr_session_warning",
  // ===== Local storage helpers =====
  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },
  getUser() {
    try {
      return JSON.parse(localStorage.getItem(this.USER_KEY));
    } catch (e) {
      return null;
    }
  },
  isLoggedIn() {
    return !!this.getToken() && !!this.getUser() && !this.isTokenExpired();
  },
  // Check if JWT token is expired (decode payload, check exp claim)
  isTokenExpired() {
    const token = this.getToken();
    if (!token) return true;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      return payload.exp ? payload.exp * 1e3 < Date.now() : false;
    } catch (e) {
      return false;
    }
  },
  // Get token expiry time in milliseconds
  getTokenExpiry() {
    const token = this.getToken();
    if (!token) return 0;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      return payload.exp ? payload.exp * 1e3 : 0;
    } catch (e) {
      return 0;
    }
  },
  // Check if token needs refresh (within 30 minutes of expiry)
  needsRefresh() {
    const expiry = this.getTokenExpiry();
    if (!expiry) return false;
    const now = Date.now();
    const thirtyMinutes = 30 * 60 * 1e3;
    return expiry - now < thirtyMinutes && expiry - now > 0;
  },
  // Try to refresh the token
  async refreshToken() {
    try {
      const token = this.getToken();
      if (!token) return false;
      const res = await fetch("/api/refresh-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.token) {
          localStorage.setItem(this.TOKEN_KEY, data.token);
          localStorage.setItem(this.TOKEN_REFRESH_KEY, Date.now().toString());
          console.log("[Auth] Token refreshed successfully");
          return true;
        }
      }
    } catch (err) {
      console.warn("[Auth] Token refresh failed:", err.message);
    }
    return false;
  },
  // Start token refresh timer (check every 5 minutes)
  startRefreshTimer() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
    }
    this._refreshTimer = setInterval(() => {
      if (this.isLoggedIn() && this.needsRefresh()) {
        this.refreshToken();
      }
    }, 5 * 60 * 1e3);
    if (this.isLoggedIn() && this.needsRefresh()) {
      this.refreshToken();
    }
  },
  // Show session timeout warning (5 minutes before expiry)
  showSessionWarning() {
    const expiry = this.getTokenExpiry();
    if (!expiry) return;
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1e3;
    const timeLeft = expiry - now;
    if (timeLeft > 0 && timeLeft <= fiveMinutes) {
      const minutesLeft = Math.ceil(timeLeft / 6e4);
      if (typeof Utils !== "undefined" && Utils.toast) {
        Utils.toast(`\u26A0\uFE0F \u0E40\u0E0B\u0E2A\u0E0A\u0E31\u0E19\u0E08\u0E30\u0E2B\u0E21\u0E14\u0E2D\u0E32\u0E22\u0E38\u0E43\u0E19 ${minutesLeft} \u0E19\u0E32\u0E17\u0E35 \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E07\u0E32\u0E19`, "warn");
      }
      localStorage.setItem(this.SESSION_WARNING_KEY, "true");
    }
  },
  // Start session warning timer
  startSessionWarningTimer() {
    if (this._warningTimer) {
      clearInterval(this._warningTimer);
    }
    this._warningTimer = setInterval(() => {
      if (this.isLoggedIn()) {
        this.showSessionWarning();
      }
    }, 60 * 1e3);
  },
  logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    localStorage.removeItem(this.TOKEN_REFRESH_KEY);
    localStorage.removeItem(this.SESSION_WARNING_KEY);
    localStorage.removeItem("bfr_customers");
    localStorage.removeItem("bfr_login_id");
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
    const ls = document.getElementById("login-screen");
    ls.classList.remove("hidden");
    ls.classList.remove("login-mode");
    document.getElementById("app").classList.add("hidden");
  },
  showApp() {
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    const user = this.getUser();
    if (user) {
      const nameEl = document.getElementById("user-name");
      const branchLabel = user.branchName || user.branch || "";
      nameEl.textContent = branchLabel ? `\u{1F464} ${user.name} \xB7 ${branchLabel}` : `\u{1F464} ${user.name}`;
    }
    this.startRefreshTimer();
    this.startSessionWarningTimer();
  },
  // ===== Login with username/password — ลบแล้ว (17 ต.ค.69 เหลือ PIN อย่างเดียวตามพ่อสั่ง) =====
  // กันโค้ดเก่าเรียกมาแล้วเงียบ: บอกให้ใช้ PIN แทน
  async login(username, password) {
    if (typeof Utils !== "undefined" && Utils.toast) Utils.toast("\u0E40\u0E25\u0E34\u0E01\u0E43\u0E0A\u0E49\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E41\u0E25\u0E49\u0E27 \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E02\u0E49\u0E32\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E14\u0E49\u0E27\u0E22 PIN");
    return false;
  },
  // ===== Login with legacy PIN (fallback) =====
  async loginPIN(pin) {
    try {
      const data = await API.post("/api/login", { pin });
      if (data == null ? void 0 : data.success) return this._finalizeLogin(data, " (PIN) \u{1F31F}");
    } catch (err) {
      console.warn("Primary PIN login failed:", err);
      const legacy = await this._tryLegacyAuth({ pin });
      if (legacy == null ? void 0 : legacy.success) return this._finalizeLogin(legacy, " (PIN) \u{1F31F}");
      Utils.toast("\u0E23\u0E30\u0E1A\u0E1A PIN \u0E02\u0E31\u0E14\u0E02\u0E49\u0E2D\u0E07 \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48");
      return false;
    }
    return false;
  },
  // ===== Staff login: แตะชื่อ + PIN (แผน B วังท่าช้าง) =====
  async loginStaff(username, pin) {
    try {
      const data = await API.post("/api/login", { username, pin });
      if (data == null ? void 0 : data.success) return this._finalizeLogin(data, " \u{1F31F}");
    } catch (err) {
      console.warn("Staff PIN login failed:", err);
      Utils.toast("\u0E0A\u0E37\u0E48\u0E2D\u0E2B\u0E23\u0E37\u0E2D PIN \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
      return false;
    }
    return false;
  },
  // ===== รายชื่อพนักงานสำหรับปุ่มแตะชื่อ (สาธารณะ ไม่ต้อง login) =====
  async loadStaffList() {
    try {
      const data = await API.get("/api/staff");
      if (data == null ? void 0 : data.success) return data.staff || [];
    } catch (err) {
      console.warn("Load staff list failed:", err);
    }
    return [];
  },
  // ===== Internal helpers =====
  _finalizeLogin(data, suffix) {
    localStorage.setItem(this.TOKEN_KEY, data.token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(data.user));
    localStorage.setItem(this.TOKEN_REFRESH_KEY, Date.now().toString());
    this.showApp();
    Utils.toast(`\u0E22\u0E34\u0E19\u0E14\u0E35\u0E15\u0E49\u0E2D\u0E19\u0E23\u0E31\u0E1A\u0E04\u0E38\u0E13 ${data.user.name}${suffix}`);
    return true;
  },
  /**
   * Try legacy /api/auth/login — has hardcoded PIN_TEAM + no PBKDF2.
   * Survives total backend regression on /api/login.
   * Used as automatic fallback, not user-visible.
   */
  async _tryLegacyAuth(payload) {
    try {
      const data = await API.post("/api/auth/login", payload);
      if (data == null ? void 0 : data.success) console.info("[auth] Logged in via legacy fallback");
      return data;
    } catch (e) {
      console.warn("[auth] Legacy fallback also failed:", e);
      return null;
    }
  },
  // ===== Check if current user is admin =====
  isAdmin() {
    const user = this.getUser();
    return user && user.role === "admin";
  },
  // ===== ผู้ดูแลสาขา (branch_admin) — จัดการได้เฉพาะคนในสาขาตัวเอง =====
  isBranchAdmin() {
    const user = this.getUser();
    return user && user.role === "branch_admin";
  },
  // เข้าเมนู "จัดการระบบ" ได้หรือไม่ (แอดมินกลาง หรือ ผู้ดูแลสาขา)
  canManage() {
    const user = this.getUser();
    return !!user && (user.role === "admin" || user.role === "branch_admin");
  },
  // รหัสสาขาที่ผูกอยู่ (ใช้ล็อก dropdown ของผู้ดูแลสาขา)
  myBranch() {
    const user = this.getUser();
    return user && user.branch || "";
  },
  // true = เข้าด้วย PIN (admin PIN / staff PIN) — ไม่มีรหัสผ่านให้เปลี่ยน (16 ต.ค.69)
  // หมายเหตุ: staff ที่ตั้งรหัสครั้งแรกแล้ว login ใหม่จะได้ loginMethod=password เอง
  isPinSession() {
    const user = this.getUser();
    return !!(user && user.loginMethod === "pin");
  }
};
window.Auth = Auth;
const API = {
  // Get API base URL (same-origin in production)
  baseUrl() {
    return window.location.origin;
  },
  // Get auth headers
  headers() {
    const token = Auth.getToken();
    return __spreadValues({
      "Content-Type": "application/json"
    }, token && !token.startsWith("offline_") ? { "Authorization": `Bearer ${token}` } : {});
  },
  // GET request
  async get(path) {
    try {
      const res = await fetch(this.baseUrl() + path, {
        method: "GET",
        headers: this.headers()
      });
      if (!res.ok) {
        if (res.status === 401) {
          Utils.toast("Session \u0E2B\u0E21\u0E14\u0E2D\u0E32\u0E22\u0E38 \u0E01\u0E23\u0E38\u0E13\u0E32 login \u0E43\u0E2B\u0E21\u0E48", "error");
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
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        if (res.status === 401 && !this.isAuthPath(path)) {
          Auth.logout();
        }
        throw await this.errorFromResponse(res);
      }
      return await res.json();
    } catch (err) {
      console.warn(`API POST ${path} failed:`, err.message);
      throw err;
    }
  },
  // อ่านข้อความ error จากเซิร์ฟเวอร์ (ไทย) แทนการโชว์แค่ "HTTP 409"
  // 17 พ.ย.69: เดิม API.post/put/del โยนแค่รหัส HTTP — ผู้ใช้เห็น "HTTP 409" ไม่รู้ว่าซ้ำอะไร
  async errorFromResponse(res) {
    let msg = "";
    try {
      const d = await res.json();
      msg = d && (d.error || d.message || d.detail) || "";
    } catch (e) {
    }
    return new Error(msg || `HTTP ${res.status}`);
  },
  // ===== Login endpoints =====
  // 401 จากประตูเข้าสู่ระบบ = "PIN/รหัสผ่านผิด" ซึ่งเป็นคำตอบปกติ ไม่ใช่ session หมดอายุ
  // ถ้าเรียก Auth.logout() ตรงนี้ หน้าจะรีโหลดทันที แล้ว fallback ของผู้เรียก
  // (Auth.loginPIN → _tryLegacyAuth) จะไม่มีโอกาสทำงาน → ปุ่ม PIN เหมือนกดไม่ติด
  isAuthPath(path) {
    return typeof path === "string" && (path.startsWith("/api/login") || path.startsWith("/api/auth/login"));
  },
  // POST แบบคืนทั้งสถานะและข้อความ — ใช้เมื่อต้องเอาข้อความ error จากเซิร์ฟเวอร์มาโชว์ตรง ๆ
  // (API.post โยน Error ที่มีแค่รหัส HTTP ผู้ใช้จึงเห็น "HTTP 400" แทนข้อความภาษาไทย)
  async postRaw(path, body) {
    const res = await fetch(this.baseUrl() + path, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body)
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
    }
    return { ok: res.ok, status: res.status, data };
  },
  // PUT request
  async put(path, body) {
    const res = await fetch(this.baseUrl() + path, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw await this.errorFromResponse(res);
    return await res.json();
  },
  // DELETE request (optional body for actions that need it)
  async del(path, body) {
    const res = await fetch(this.baseUrl() + path, {
      method: "DELETE",
      headers: this.headers(),
      body: body ? JSON.stringify(body) : void 0
    });
    if (!res.ok) throw await this.errorFromResponse(res);
    return await res.json();
  },
  // ===== Unified sync =====
  // Push local state to cloud
  async syncAll(payload) {
    return this.post("/api/sync", payload);
  },
  // Pull full state from cloud
  // ต้องส่งรหัสเครื่องไปด้วย ไม่งั้นเซิร์ฟเวอร์จะไม่รู้ว่าเส้นทางของเครื่องไหน
  async getAll(deviceId) {
    return this.get("/api/sync" + (deviceId ? "?device=" + encodeURIComponent(deviceId) : ""));
  },
  // Legacy single-customer sync (kept for back-compat)
  async syncCustomers(local) {
    return this.post("/api/customers/sync", { customers: local });
  }
};
window.API = API;
const Storage = {
  KEY_CUSTOMERS: "bfr_customers",
  KEY_ROUTE: "bfr_route",
  KEY_VISITS: "bfr_visits",
  KEY_SYNC_TIME: "bfr_last_sync",
  KEY_SERVER_TIME: "bfr_server_time",
  KEY_USER_TIME: "bfr_user_time",
  KEY_SAVED_ROUTES: "bfr_saved_routes",
  KEY_OVERLAY_TIME: "bfr_overlay_time",
  // ===== เฟส 2-3: รายชื่อเก็บใน IndexedDB (localStorage ~5MB ใส่ 9,132 ราย ~6.9MB ไม่ลง) =====
  // API ภายนอกเหมือนเดิมทุกอย่าง (getCustomers ยัง sync) — ข้างในอ่านจาก _mem
  // ที่โหลดจาก IndexedDB รอบเดียวตอนเปิดแอป (App.init รอ Storage.ready ก่อนวาดจอ)
  _mem: null,
  // รายชื่อในหน่วยความจำ (null = ยังโหลดไม่เสร็จ)
  _idb: null,
  // Promise<DB> เปิดค้างไว้
  _idbOpen() {
    if (this._idb) return this._idb;
    this._idb = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open("bfr", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("kv");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) {
        reject(e);
      }
    });
    return this._idb;
  },
  _idbGet(key) {
    return this._idbOpen().then((db) => new Promise((resolve, reject) => {
      try {
        const tx = db.transaction("kv", "readonly");
        const rq = tx.objectStore("kv").get(key);
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
      } catch (e) {
        reject(e);
      }
    }));
  },
  _idbPut(key, val) {
    return this._idbOpen().then((db) => new Promise((resolve, reject) => {
      try {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) {
        reject(e);
      }
    }));
  },
  // เฟส 2-4: เก็บลงเครื่องเฉพาะ 18 ฟิลด์ที่หน้าแผนที่อ่านจริง (วัดการใช้จริงทุกจุดแล้ว)
  // ตัดทิ้ง: สแนปช็อตหนี้ 9 ฟิลด์ (UI อ่านจากแคชหนี้ DebtDB ไม่ได้อ่านใบนี้),
  //   extra ทั้งก้อน (เลขบัตร/วันเกิด — PII ที่ไม่มีจุดไหนอ่าน), potential/customerClass/debtClass/geo_source (UI อ่านจาก CustomerDB)
  // ปลอดภัยทาง push: เซิร์ฟเวอร์ UPDATE/INSERT แค่ 9 คอลัมน์ที่แก้ได้ (functions/api/sync.js) ไม่แตะฟิลด์ที่ตัด
  _KEEP: ["id", "cif", "name", "nickname", "phone", "address", "lat", "lng", "branch", "zone", "riskLevel", "debtType", "photo", "note", "createdBy", "createdAt", "updatedAt", "deleted"],
  _slim(list) {
    return (list || []).map((c) => {
      var _a;
      const o = {};
      for (const k of this._KEEP) o[k] = (_a = c[k]) != null ? _a : null;
      return o;
    });
  },
  // รวมที่อยู่เต็มจากคอลัมน์แยกของ D1 (บ้านเลขที่ + หมู่ + ตำบล + อำเภอ + จังหวัด + รหัสไปรษณีย์)
  // ถ้าค่าที่เก็บเป็นที่อยู่เต็มอยู่แล้ว (มี ม./ต./อ./จ.) จะคืนค่าเดิม ไม่ต่อซ้ำ
  _fullAddress(r) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    const clean = (v) => String(v == null ? "" : v).replace(/^'+/, "").trim();
    const house = clean(r && r.address);
    if (/ม\.|ต\.|อ\.|จ\./.test(house)) return house;
    const parts = [];
    if (house && house !== "-") parts.push(house);
    const moo = clean(r && ((_b = (_a = r.extra) == null ? void 0 : _a.moo) != null ? _b : r.moo));
    const tambon = clean(r && ((_d = (_c = r.extra) == null ? void 0 : _c.tambon) != null ? _d : r.tambon));
    const amphoe = clean(r && ((_f = (_e = r.extra) == null ? void 0 : _e.amphoe) != null ? _f : r.amphoe));
    const province = clean(r && ((_h = (_g = r.extra) == null ? void 0 : _g.province) != null ? _h : r.province));
    const postcode = clean(r && ((_j = (_i = r.extra) == null ? void 0 : _i.postcode) != null ? _j : r.postcode));
    if (moo) parts.push("\u0E21." + moo);
    if (tambon) parts.push("\u0E15." + tambon);
    if (amphoe) parts.push("\u0E2D." + amphoe);
    if (province) parts.push("\u0E08." + province);
    if (postcode) parts.push(postcode);
    return parts.join(" ");
  },
  // โหลดรายชื่อเข้า _mem ครั้งเดียว + ย้ายของเก่าจาก localStorage (ครั้งเดียวแล้วลบ)
  _loadMem() {
    return this._idbGet("customers").then((seed) => {
      if (Array.isArray(seed)) {
        this._mem = this._slim(seed);
        if (seed.length && (seed[0].extra !== void 0 || seed[0].debtBalance !== void 0)) {
          this._idbPut("customers", this._mem).catch(() => {
          });
        }
        return this._mem;
      }
      let old = null;
      try {
        old = JSON.parse(localStorage.getItem(this.KEY_CUSTOMERS) || "null");
      } catch (e) {
      }
      this._mem = this._slim(Array.isArray(old) ? old : []);
      if (this._mem.length) {
        this._idbPut("customers", this._mem).then(() => {
          try {
            localStorage.removeItem(this.KEY_CUSTOMERS);
          } catch (e) {
          }
        }).catch(() => {
        });
      }
      return this._mem;
    }).catch(() => {
      try {
        this._mem = this._slim(JSON.parse(localStorage.getItem(this.KEY_CUSTOMERS) || "[]"));
      } catch (e) {
        this._mem = [];
      }
      return this._mem;
    });
  },
  // ===== Local persistence (always first — fast, offline) =====
  getCustomers() {
    if (this._mem) return this._mem.slice();
    try {
      return JSON.parse(localStorage.getItem(this.KEY_CUSTOMERS) || "[]");
    } catch (e) {
      return [];
    }
  },
  // Returns only non-deleted customers (for UI display)
  getActiveCustomers() {
    const list = this.getCustomers().filter((c) => !c.deleted);
    try {
      const isSuper = typeof Auth !== "undefined" && Auth.isAdmin ? Auth.isAdmin() : false;
      const own = typeof Auth !== "undefined" && Auth.getUser ? String((Auth.getUser() || {}).branch || "").trim() : "";
      if (!isSuper && own) return list.filter((c) => String(c.branch || "").trim() === own);
    } catch (e) {
    }
    return list;
  },
  // ===== S2: Dirty tracking — push เฉพาะรายการที่แก้จริง =====
  _dirtyCifs: null,
  // Set of CIFs changed locally, awaiting push
  KEY_DIRTY: "bfr_dirty_cifs",
  _loadDirty() {
    if (this._dirtyCifs) return this._dirtyCifs;
    try {
      this._dirtyCifs = new Set(JSON.parse(localStorage.getItem(this.KEY_DIRTY) || "[]"));
    } catch (e) {
      this._dirtyCifs = /* @__PURE__ */ new Set();
    }
    return this._dirtyCifs;
  },
  markDirty(cif) {
    if (!cif) return;
    const s = this._loadDirty();
    s.add(String(cif).trim());
    try {
      localStorage.setItem(this.KEY_DIRTY, JSON.stringify([...s]));
    } catch (e) {
    }
  },
  clearDirty(cifs) {
    const s = this._loadDirty();
    for (const cif of cifs) s.delete(String(cif).trim());
    this._dirtyCifs = s;
    try {
      localStorage.setItem(this.KEY_DIRTY, JSON.stringify([...s]));
    } catch (e) {
    }
  },
  // จำนวนงานที่แก้/เพิ่มในเครื่องแล้วแต่ยังไม่ขึ้นเว็บ — ใช้เตือนตอนเน็ตกลับมา
  pendingCount() {
    return this._loadDirty().size;
  },
  // ล้างรายการค้างทั้งหมด — เรียกหลัง push ทั้งก้อนสำเร็จ (เช่นตอนเน็ตกลับมา)
  clearAllDirty() {
    this._dirtyCifs = /* @__PURE__ */ new Set();
    try {
      localStorage.removeItem(this.KEY_DIRTY);
    } catch (e) {
    }
  },
  saveCustomers(list) {
    const slim = this._slim(list);
    this._mem = slim;
    this._idbPut("customers", slim).catch(() => {
      try {
        localStorage.setItem(this.KEY_CUSTOMERS, JSON.stringify(slim));
      } catch (e) {
        console.error("[Storage] save failed (IDB+localStorage):", e);
        Utils.toast("\u274C \u0E1E\u0E37\u0E49\u0E19\u0E17\u0E35\u0E48\u0E08\u0E31\u0E14\u0E40\u0E01\u0E47\u0E1A\u0E40\u0E15\u0E47\u0E21 \u2014 \u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2D\u0E32\u0E08\u0E44\u0E21\u0E48\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01", "error");
      }
    });
  },
  // ===== Server-first architecture: save → push to KV → confirm =====
  // Returns: { customer, synced: true/false, error?: string }
  async addCustomer(customer) {
    var _a;
    const list = this.getCustomers();
    customer.id = customer.id || Utils.uuid();
    customer.createdAt = customer.createdAt || (/* @__PURE__ */ new Date()).toISOString();
    customer.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    customer.createdBy = ((_a = Auth.getUser()) == null ? void 0 : _a.name) || "unknown";
    customer.riskLevel = customer.riskLevel || "unclassified";
    customer.debtType = customer.debtType || null;
    list.push(customer);
    this.saveCustomers(list);
    if (customer.cif) this.markDirty(customer.cif);
    const result = await this.push();
    if (result && result.success) this.clearDirty([customer.cif]);
    if (result && result.success) {
      return { customer, synced: true };
    } else {
      console.warn("[Storage] addCustomer: server sync failed, saved locally only", (result == null ? void 0 : result.error) || result);
      return { customer, synced: false, error: (result == null ? void 0 : result.error) || "Sync failed" };
    }
  },
  // ===== Bulk import customers from single D1 source → Storage (idempotent) =====
  // Fetch ALL active customers from the unified D1 API (/api/customers) so the
  // single D1 database is the one source of truth for the map, admin, and sync.
  // This replaces the old fragmented static customers-db.json + KV stores with
  // one D1-backed endpoint. Only records with lat/lng render as map markers.
  async importFromStaticDB() {
    var _a, _b, _c, _d, _e, _f;
    let all = [];
    try {
      const PAGE = 1e4;
      let offset = 0;
      for (let i = 0; i < 8; i++) {
        const r = await API.get(`/api/customers?limit=${PAGE}&offset=${offset}`);
        if (!r || !r.success) throw new Error("Failed to load customers from D1");
        const chunk = r.customers || [];
        all = all.concat(chunk);
        if (chunk.length < PAGE) break;
        if (r.total && all.length >= r.total) break;
        offset += PAGE;
      }
    } catch (e) {
      console.warn("[Storage] importFromStaticDB: network error", e.message);
      throw new Error("\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E42\u0E2B\u0E25\u0E14\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E08\u0E32\u0E01\u0E40\u0E0B\u0E34\u0E23\u0E4C\u0E1F\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E44\u0E14\u0E49 \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E2D\u0E34\u0E19\u0E40\u0E17\u0E2D\u0E23\u0E4C\u0E40\u0E19\u0E47\u0E15");
    }
    const db = all;
    const byCif = new Map(this.getActiveCustomers().map((c) => [c.cif, c]).filter(([k]) => k));
    const toImport = db.filter((r) => r.cif && !byCif.has(r.cif));
    const withGPS = toImport.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng)).length;
    const make = (r) => {
      var _a2, _b2;
      return {
        id: r.id || "db_" + r.cif,
        cif: r.cif,
        name: r.name,
        nickname: r.nickname || "",
        phone: r.phone || "",
        address: this._fullAddress(r),
        lat: (_a2 = r.lat) != null ? _a2 : null,
        lng: (_b2 = r.lng) != null ? _b2 : null,
        branch: r.branch || "",
        zone: r.zone || "",
        riskLevel: r.riskLevel || "unclassified",
        debtType: r.debtType || null,
        createdAt: r.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: r.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
        createdBy: r.createdBy || "AutoImport:StaticDB",
        geo_source: r.geo_source || "static_db"
      };
    };
    const list = this.getCustomers();
    for (const r of toImport) list.push(make(r));
    let backfilled = 0;
    for (const r of db) {
      if (!r.cif) continue;
      const old = byCif.get(r.cif);
      if (!old) continue;
      const nAddr = this._fullAddress(r);
      const addrStale = nAddr && old.address !== nAddr && (!old.address || old.address === (r.address || "") || old.address === "-");
      if ((old.branch || "") !== (r.branch || "") || (old.zone || "") !== (r.zone || "") || ((_a = old.lat) != null ? _a : null) !== ((_b = r.lat) != null ? _b : null) || ((_c = old.lng) != null ? _c : null) !== ((_d = r.lng) != null ? _d : null) || addrStale) {
        old.branch = r.branch || "";
        old.zone = r.zone || "";
        old.lat = (_e = r.lat) != null ? _e : null;
        old.lng = (_f = r.lng) != null ? _f : null;
        if (addrStale) old.address = nAddr;
        backfilled++;
      }
    }
    this.saveCustomers(list);
    try {
      await this.applyGpsOverlay();
    } catch (e) {
      console.warn("[Storage] importFromStaticDB: GPS overlay apply failed", e.message);
    }
    return { imported: toImport.length, withGPS, skipped: byCif.size, backfilled, total: db.length };
  },
  // ===== Apply bulk GPS overlay (admin file uploads) — SERVER-AUTHORITATIVE =====
  // Fetches /api/gps-overlay (compact map CIF -> {lat,lng,name}) and applies it.
  // Server wins: coords uploaded to the web overwrite the device copy for EVERY
  // matching record (including user-edited ones) so all devices show identical
  // markers. Only records NOT in the overlay keep their local values.
  // Returns count of customers changed (applied + created).
  async applyGpsOverlay() {
    try {
      const res = await API.get("/api/gps-overlay");
      if (!res || !res.success || !res.overlay) return 0;
      const overlay = res.overlay;
      const list = this.getCustomers();
      const byCif = /* @__PURE__ */ new Map();
      for (const c of list) {
        if (c.cif) byCif.set(String(c.cif).trim(), c);
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      let applied = 0, created = 0;
      for (const [cif, g] of Object.entries(overlay)) {
        if (!g || !(Number.isFinite(g.lat) && Number.isFinite(g.lng))) continue;
        const existing = byCif.get(String(cif).trim());
        if (existing) {
          existing.lat = g.lat;
          existing.lng = g.lng;
          if (g.name && !existing.name) existing.name = g.name;
          existing.updatedAt = now;
          existing.geo_source = "gps-overlay";
          applied++;
        } else {
        }
      }
      if (applied > 0 || created > 0) this.saveCustomers(list);
      if (res.overlayUpdatedAt) {
        localStorage.setItem(this.KEY_OVERLAY_TIME, res.overlayUpdatedAt);
      }
      return applied + created;
    } catch (e) {
      console.warn("[gps-overlay] apply failed:", e.message);
      return 0;
    }
  },
  // Returns: { synced: true/false, error?: string }
  async updateCustomer(id, updates) {
    var _a;
    const list = this.getCustomers();
    const idx = list.findIndex((c) => c.id === id);
    if (idx >= 0) {
      const EDITABLE = /* @__PURE__ */ new Set([
        "name",
        "nickname",
        "phone",
        "address",
        "lat",
        "lng",
        "riskLevel",
        "debtType",
        "photo",
        "note",
        "zone",
        "potential"
      ]);
      const safe = {};
      for (const [k, v] of Object.entries(updates)) {
        if (EDITABLE.has(k)) safe[k] = v;
      }
      if (list[idx].createdBy === "AutoImport:StaticDB") {
        list[idx].createdBy = ((_a = Auth.getUser()) == null ? void 0 : _a.name) || "user";
      }
      list[idx] = __spreadProps(__spreadValues(__spreadValues({}, list[idx]), safe), { updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
      this.saveCustomers(list);
      if (list[idx].cif) this.markDirty(list[idx].cif);
      const result = await this.push();
      if (result && result.success) this.clearDirty([list[idx].cif]);
      if (result && result.success) {
        return { synced: true };
      } else {
        console.warn("[Storage] updateCustomer: server sync failed, saved locally only", (result == null ? void 0 : result.error) || result);
        return { synced: false, error: (result == null ? void 0 : result.error) || "Sync failed" };
      }
    }
    return { synced: false, error: "Customer not found" };
  },
  // ===== Local-first (optimistic) =====
  // ปัญหาเดิม: กดเซฟแล้ว UI รอเน็ต 1–2.5 วิ กว่าหมุดจะขึ้น (วัดจากเว็บจริง 14 ก.ย.69)
  // แนวใหม่: เขียนลงเครื่อง + วาดหมุดก่อน (~20ms) แล้วค่อยส่งขึ้นเว็บเบื้องหลัง
  _EDITABLE_FIELDS: /* @__PURE__ */ new Set([
    "name",
    "nickname",
    "phone",
    "address",
    "lat",
    "lng",
    "riskLevel",
    "debtType",
    "photo",
    "note",
    "zone",
    "potential"
  ]),
  // พิกัดต้องเป็นตัวเลขเสมอ — ค่าจากฟอร์มเป็นข้อความ ("13.77") ทำให้หมุดไม่ขึ้น
  _normCoord(v) {
    if (v === null || v === void 0 || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  },
  // เขียนลง localStorage เท่านั้น (ไม่ยิงเน็ต) — คืน record ที่บันทึกแล้ว
  updateCustomerLocal(id, updates) {
    const list = this.getCustomers();
    const idx = list.findIndex((c) => c.id === id);
    if (idx < 0) return null;
    if (list[idx].createdBy === "AutoImport:StaticDB") {
      list[idx].createdBy = (typeof Auth !== "undefined" && Auth.getUser && Auth.getUser() ? Auth.getUser().name : "") || "user";
    }
    const safe = {};
    for (const [k, v] of Object.entries(updates || {})) {
      if (this._EDITABLE_FIELDS.has(k)) safe[k] = v;
    }
    if ("lat" in safe || "lng" in safe) {
      safe.lat = this._normCoord(safe.lat !== void 0 ? safe.lat : list[idx].lat);
      safe.lng = this._normCoord(safe.lng !== void 0 ? safe.lng : list[idx].lng);
    }
    list[idx] = __spreadProps(__spreadValues(__spreadValues({}, list[idx]), safe), { updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    this.saveCustomers(list);
    if (list[idx].cif) this.markDirty(list[idx].cif);
    return list[idx];
  },
  // เพิ่มลูกค้าใหม่ลงเครื่องก่อน (ยังไม่ยิงเน็ต)
  addCustomerLocal(customer) {
    const list = this.getCustomers();
    customer.id = customer.id || Utils.uuid();
    customer.createdAt = customer.createdAt || (/* @__PURE__ */ new Date()).toISOString();
    customer.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    customer.createdBy = (typeof Auth !== "undefined" && Auth.getUser && Auth.getUser() ? Auth.getUser().name : "") || "unknown";
    customer.riskLevel = customer.riskLevel || "unclassified";
    customer.debtType = customer.debtType || null;
    if ("lat" in customer || "lng" in customer) {
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
    if (!navigator.onLine) return { synced: false, error: "offline" };
    let ok = false;
    let err = "";
    if (cif) {
      try {
        const res = await fetch(API.baseUrl() + "/api/customers/" + encodeURIComponent(cif), {
          method: "PUT",
          headers: API.headers(),
          body: JSON.stringify(fields || {})
        });
        const data = await res.json().catch(() => ({}));
        ok = res.ok && !!data.success;
        if (!ok) err = data.error || "HTTP " + res.status;
      } catch (e) {
        err = e.message;
      }
    }
    if (!ok) {
      const r = await this.push();
      ok = !!(r && r.success);
      err = ok ? "" : r && r.error || err || "sync failed";
    }
    if (ok && cif) this.clearDirty([cif]);
    this._notifyListeners(ok ? { status: "saved" } : { status: "error", error: err });
    return { synced: ok, error: err };
  },
  // ===== Phase 1 + Nickname/Photo: Migrate old customers to new schema =====
  // ลูกค้าเดิมที่ไม่มี riskLevel → 'unclassified' (marker แสดง "?" ไม่มีสี)
  // ลูกค้าเดิมที่ไม่มี debtType → null
  // Phase 2: เพิ่ม nickname + photo (รูปถ่าย base64)
  migrateCustomers() {
    const list = this.getCustomers();
    let changed = false;
    list.forEach((c) => {
      if (!c.riskLevel) {
        c.riskLevel = "unclassified";
        c.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        changed = true;
      }
      if (c.debtType === void 0) {
        c.debtType = null;
        changed = true;
      }
      if (c.nickname === void 0) {
        c.nickname = "";
        changed = true;
      }
      if (c.photo === void 0) {
        c.photo = null;
        changed = true;
      }
      if (typeof c.lat === "string" || typeof c.lng === "string") {
        const nlat = this._normCoord(c.lat);
        const nlng = this._normCoord(c.lng);
        if (nlat !== null && nlng !== null) {
          c.lat = nlat;
          c.lng = nlng;
          changed = true;
        }
      }
    });
    if (changed) {
      this.saveCustomers(list);
      console.log("[Storage] Migrated", list.length, "customers to new schema");
    }
    return list;
  },
  async deleteCustomer(id) {
    var _a;
    const list = this.getCustomers();
    const idx = list.findIndex((c) => c.id === id);
    if (idx >= 0) {
      if (list[idx].createdBy === "AutoImport:StaticDB") {
        list[idx].createdBy = ((_a = Auth.getUser()) == null ? void 0 : _a.name) || "user";
      }
      list[idx].deleted = true;
      list[idx].updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      this.saveCustomers(list);
      if (list[idx].cif) this.markDirty(list[idx].cif);
      const result = await this.push();
      if (result && result.success && list[idx].cif) this.clearDirty([list[idx].cif]);
      return { synced: !!(result && result.success), error: result == null ? void 0 : result.error };
    }
    return { synced: false, error: "Not found" };
  },
  // ===== แยกเส้นทางตาม "ผู้ใช้ + เครื่องนี้" =====
  // ปัญหาเดิม: ทุกเครื่องใช้คีย์เดียวกัน (bfr_route) → 10 คนใช้พร้อมกัน เส้นทางทับกัน
  KEY_DEVICE: "bfr_device_id",
  // รหัสประจำเครื่องนี้ (สร้างครั้งเดียว เก็บถาวรใน localStorage ของเครื่องนั้น)
  deviceId() {
    try {
      let id = localStorage.getItem(this.KEY_DEVICE);
      if (!id) {
        id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        localStorage.setItem(this.KEY_DEVICE, id);
      }
      return id;
    } catch (e) {
      return "dunknown";
    }
  },
  // รหัสผู้ใช้ (ต้องตรงกับที่เซิร์ฟเวอร์ใช้: username → sub)
  // login ด้วย PIN ผู้ดูแลได้ username 'admin' → สโคปตรงกับที่เซิร์ฟเวอร์คิด
  _userId() {
    const u = typeof Auth !== "undefined" && Auth.getUser ? Auth.getUser() : null;
    let who = u && u.username ? String(u.username) : "";
    if (!who) {
      try {
        const t = typeof Auth !== "undefined" && Auth.getToken ? Auth.getToken() : "";
        if (t && t.indexOf(".") > 0) {
          const p = JSON.parse(atob(t.split(".")[1]));
          who = p.username || p.sub || "";
        }
      } catch (e) {
      }
    }
    if (!who && u && u.name) who = String(u.name);
    return String(who || "guest").replace(/[^A-Za-z0-9._-]/g, "") || "guest";
  },
  // สโคปของเครื่องนี้ = ผู้ใช้ + รหัสเครื่อง (ต้องตรงกับเซิร์ฟเวอร์: routes:user:<scope>)
  routeScope() {
    return this._userId() + "_" + this.deviceId();
  },
  _routeSuffix() {
    return "_" + this.routeScope();
  },
  // สโคป visit: ใช้แค่ username (ตาม user ไม่ว่าใช้เครื่องอะไร)
  _visitSuffix() {
    return "_" + this._userId();
  },
  _visitsKey() {
    return this.KEY_VISITS + this._visitSuffix();
  },
  // คีย์เดิมก่อนแยกตามเครื่อง — ใช้ย้ายข้อมูลครั้งแรก แล้วลบทิ้ง
  _legacyKeys(base) {
    const u = typeof Auth !== "undefined" && Auth.getUser ? Auth.getUser() : null;
    const who = u && u.username ? String(u.username).replace(/[^A-Za-z0-9._-]/g, "") : "";
    return who ? [base + "_" + who, base] : [base];
  },
  // อ่านคีย์ของเครื่องนี้; ถ้ายังว่างให้ย้ายจากคีย์เดิม (ครั้งเดียว) แล้วลบคีย์เดิม
  _readScoped(key, legacyKeys) {
    try {
      const cur = localStorage.getItem(key);
      if (cur !== null && cur !== "[]" && cur !== "") return JSON.parse(cur);
      for (const lk of legacyKeys) {
        if (lk === key) continue;
        const v = localStorage.getItem(lk);
        if (v !== null && v !== "[]" && v !== "") {
          localStorage.setItem(key, v);
          localStorage.removeItem(lk);
          return JSON.parse(v);
        }
      }
    } catch (e) {
    }
    return [];
  },
  getRoute() {
    this._routeKey = this.KEY_ROUTE + this._routeSuffix();
    try {
      return this._readScoped(this._routeKey, this._legacyKeys(this.KEY_ROUTE));
    } catch (e) {
      return [];
    }
  },
  async saveRoute(list) {
    this._routeKey = this.KEY_ROUTE + this._routeSuffix();
    localStorage.setItem(this._routeKey, JSON.stringify(list));
    clearTimeout(this._routePushTimer);
    this._routePushTimer = setTimeout(() => {
      this.push().catch(() => {
      });
    }, 2500);
  },
  addToRoute(customerId) {
    const route = this.getRoute();
    if (!route.includes(customerId)) {
      const c = this.getCustomers().find((x) => x.id === customerId);
      if (!c || !(Number.isFinite(c.lat) && Number.isFinite(c.lng))) return false;
      route.push(customerId);
      this.saveRoute(route);
    }
    return true;
  },
  removeFromRoute(customerId) {
    this.saveRoute(this.getRoute().filter((id) => id !== customerId));
  },
  getVisits() {
    let visits = {};
    try {
      const raw = localStorage.getItem(this._visitsKey());
      if (raw && raw !== "{}") visits = JSON.parse(raw);
    } catch (e) {
      visits = {};
    }
    if (!visits || Object.keys(visits).length === 0) {
      try {
        const legacyRaw = localStorage.getItem(this.KEY_VISITS);
        if (legacyRaw && legacyRaw !== "{}") {
          const legacyVisits = JSON.parse(legacyRaw);
          if (Object.keys(legacyVisits).length > 0) {
            visits = legacyVisits;
            localStorage.setItem(this._visitsKey(), JSON.stringify(visits));
            localStorage.removeItem(this.KEY_VISITS);
          }
        }
      } catch (e) {
      }
    }
    return visits;
  },
  async saveVisit(customerId, visit) {
    var _a;
    const visits = this.getVisits();
    visits[customerId] = __spreadProps(__spreadValues({}, visit), {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      by: ((_a = Auth.getUser()) == null ? void 0 : _a.name) || "unknown"
    });
    localStorage.setItem(this._visitsKey(), JSON.stringify(visits));
    const result = await this.push();
    return { synced: !!(result && result.success), error: result == null ? void 0 : result.error };
  },
  // ===== ส่งคลังเส้นทางขึ้นเว็บเฉพาะตอนที่มีการเปลี่ยน =====
  // เดิม: ทุกครั้งที่ push จะแนบคลังทั้งก้อน (เส้นทางถนนในคลัง ~87 KB/ชุด) ขึ้นเน็ตทุกรอบ
  // ใหม่: แนบเฉพาะเมื่อลายเซ็นคลังต่างจากครั้งที่ส่งสำเร็จล่าสุด (ไม่เปลี่ยน = ส่ง [] )
  // ปลอดภัยเพราะเซิร์ฟเวอร์ merge แบบเพิ่ม (mergeById) — ส่ง [] ไม่ลบข้อมูลเดิม
  KEY_ROUTES_SIG: "bfr_routes_sig",
  _routesSig(list) {
    try {
      return JSON.stringify((list || []).map((r) => [r.id, r.savedAt, (r.stops || []).length, r.distance, String(r.name || "")]));
    } catch (e) {
      return "";
    }
  },
  _routesChangedSinceSync() {
    try {
      return localStorage.getItem(this.KEY_ROUTES_SIG) !== this._routesSig(this.getSavedRoutes());
    } catch (e) {
      return true;
    }
  },
  _markRoutesSynced(list) {
    try {
      localStorage.setItem(this.KEY_ROUTES_SIG, this._routesSig(list || this.getSavedRoutes()));
    } catch (e) {
    }
  },
  getSavedRoutes() {
    this._savedRoutesKey = this.KEY_SAVED_ROUTES + this._routeSuffix();
    try {
      return this._readScoped(this._savedRoutesKey, this._legacyKeys(this.KEY_SAVED_ROUTES));
    } catch (e) {
      return [];
    }
  },
  async saveSavedRoute(route) {
    var _a;
    const list = this.getSavedRoutes();
    route.id = route.id || Utils.uuid();
    route.savedAt = route.savedAt || (/* @__PURE__ */ new Date()).toISOString();
    route.savedBy = ((_a = Auth.getUser()) == null ? void 0 : _a.name) || "unknown";
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
    if (!navigator.onLine) return { skipped: "offline" };
    if (this._pushInFlight) {
      this._pushDirty = true;
      return this._pushInFlight;
    }
    this._pushDirty = false;
    this._pushInFlight = (async () => {
      try {
        this._notifyListeners({ status: "syncing" });
        const res = await API.syncAll(this._buildPayload());
        if (res && res.success) {
          localStorage.setItem(this.KEY_SYNC_TIME, (/* @__PURE__ */ new Date()).toISOString());
          this._markRoutesSynced();
          this._notifyListeners({ status: "synced", serverTime: res.serverTime });
        }
        return res;
      } catch (err) {
        this._notifyListeners({ status: "error", error: err.message });
        return { error: err.message };
      } finally {
        this._pushInFlight = null;
        if (this._pushDirty) {
          this._pushDirty = false;
          this.push().catch((e) => console.warn("[Storage] coalesced push failed:", e.message));
        }
      }
    })();
    return this._pushInFlight;
  },
  // Build sync payload (shared by push + retrySync)
  _buildPayload() {
    const all = this.getCustomers();
    const dirty = this._loadDirty();
    let customers;
    if (dirty.size > 0) {
      customers = all.filter((c) => c.cif && dirty.has(String(c.cif).trim()) && c.createdBy !== "AutoImport:StaticDB");
      if (customers.length === 0 && this._forceFullPushOnce) {
        customers = all.filter((c) => c.createdBy !== "AutoImport:StaticDB");
        this._forceFullPushOnce = false;
      }
    } else {
      customers = [];
    }
    const routesToSend = this._routesChangedSinceSync() ? this.getSavedRoutes() : [];
    return {
      customers,
      visits: this.getVisits(),
      savedRoutes: routesToSend,
      // รหัสเครื่องนี้ → เซิร์ฟเวอร์แยกเส้นทางต่อผู้ใช้+เครื่อง (routes:user:<scope>)
      deviceId: this.deviceId()
    };
  },
  // Pull remote changes (called by polling timer + manual refresh)
  async pull() {
    if (!navigator.onLine) return { skipped: "offline" };
    if (this._pullInFlight) return this._pullInFlight;
    this._pullInFlight = (async () => {
      try {
        this._notifyListeners({ status: "syncing" });
        const res = await API.getAll(this.deviceId());
        if (res && res.success) {
          this._mergeRemote(res);
          localStorage.setItem(this.KEY_SERVER_TIME, res.serverTime);
          if (res.userUpdatedAt) localStorage.setItem(this.KEY_USER_TIME, res.userUpdatedAt);
          localStorage.setItem(this.KEY_SYNC_TIME, (/* @__PURE__ */ new Date()).toISOString());
          this._notifyListeners({
            status: "synced",
            serverTime: res.serverTime,
            counts: res.counts
          });
        }
        return res;
      } catch (err) {
        this._notifyListeners({ status: "error", error: err.message });
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
    this._savedRoutesKey = this.KEY_SAVED_ROUTES + this._routeSuffix();
    localStorage.setItem(this._savedRoutesKey, JSON.stringify(mergedRoutes));
    if (localSavedRoutes.length === 0 && mergedRoutes.length > 0) this._markRoutesSynced(mergedRoutes);
    if (typeof App !== "undefined" && App._onRemoteUpdate) {
      App._onRemoteUpdate(remote);
    }
  },
  // Full sync (push then pull)
  async sync() {
    if (!navigator.onLine) return { skipped: "offline" };
    const pushResult = await this.push();
    const pullResult = await this.pull();
    if (pullResult && pullResult.success) {
      return pullResult;
    }
    return pushResult;
  },
  // Manual retry — forces push of all local data then pull
  async retrySync() {
    this._pushInFlight = null;
    this._pullInFlight = null;
    this._pushDirty = false;
    this._notifyListeners({ status: "syncing", action: "retry" });
    return this.sync();
  },
  // Subscribe to sync status updates
  onSyncEvent(cb) {
    this._listeners.push(cb);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== cb);
    };
  },
  _notifyListeners(event) {
    for (const cb of this._listeners) {
      try {
        cb(event);
      } catch (e) {
        console.warn("sync listener error:", e);
      }
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
        const lastUser = localStorage.getItem(this.KEY_USER_TIME);
        const probeOverlay = localStorage.getItem(this.KEY_OVERLAY_TIME);
        let hasNew = true;
        try {
          const pRes = await fetch(API.baseUrl() + "/api/sync?probe=1", { headers: API.headers() });
          if (pRes.ok) {
            const p = await pRes.json();
            if (p && p.success) {
              const overlayChanged = !!(p.overlayUpdatedAt && p.overlayUpdatedAt !== probeOverlay);
              const newer = !!(p.serverTime && (!lastServer || p.serverTime > lastServer));
              const userChanged = !!(p.userUpdatedAt && p.userUpdatedAt !== lastUser);
              hasNew = overlayChanged || newer || userChanged;
            }
          }
        } catch (e) {
        }
        if (!hasNew) return;
        const res = await fetch(API.baseUrl() + "/api/sync?since=" + encodeURIComponent(lastServer || "") + "&device=" + encodeURIComponent(this.deviceId()), {
          headers: API.headers()
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            let changed = false;
            const localOverlayTime = localStorage.getItem(this.KEY_OVERLAY_TIME);
            if (data.overlayUpdatedAt && data.overlayUpdatedAt !== localOverlayTime) {
              const n = await this.applyGpsOverlay();
              if (n > 0) changed = true;
              else localStorage.setItem(this.KEY_OVERLAY_TIME, data.overlayUpdatedAt);
            }
            const userChangedNow = !!(data.userUpdatedAt && data.userUpdatedAt !== localStorage.getItem(this.KEY_USER_TIME));
            if (data.serverTime && data.serverTime !== lastServer || userChangedNow) {
              this._mergeRemote(data);
              if (data.serverTime) localStorage.setItem(this.KEY_SERVER_TIME, data.serverTime);
              if (data.userUpdatedAt) localStorage.setItem(this.KEY_USER_TIME, data.userUpdatedAt);
              localStorage.setItem(this.KEY_SYNC_TIME, (/* @__PURE__ */ new Date()).toISOString());
              changed = true;
            }
            if (changed) {
              this._notifyListeners({
                status: "synced",
                serverTime: data.serverTime,
                counts: data.counts
              });
            }
          }
        }
      } catch (e) {
      }
    };
    return tick();
  },
  // รอบเช็คปรับตามการใช้งาน (เฟส 2): เปิดจอดู = 20 วิ · พับจอ/สลับแท็บ = 120 วิ
  // (จอซ่อนแล้วยังเช็คถี่ = เผาโควตาเปล่า — ช้าลง 6 เท่าตอนไม่ได้ดู กลับมาดูเช็คทันที)
  _pollBaseMs: 2e4,
  _pollSlowMs: 12e4,
  _pollActive: false,
  _visBound: false,
  _effectiveInterval() {
    try {
      return typeof document !== "undefined" && document.hidden ? this._pollSlowMs : this._pollBaseMs;
    } catch (e) {
      return this._pollBaseMs;
    }
  },
  _clearPollTimer() {
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = null;
    }
  },
  startPolling(intervalMs = 2e4, slowMs = 12e4) {
    this._pollBaseMs = intervalMs;
    this._pollSlowMs = slowMs;
    this._pollActive = true;
    if (!this._visBound && typeof document !== "undefined" && document.addEventListener) {
      this._visBound = true;
      document.addEventListener("visibilitychange", () => {
        if (!this._pollActive) return;
        this._clearPollTimer();
        this._pollingTimer = setInterval(() => this.pollOnce(), this._effectiveInterval());
        if (!document.hidden) this.pollOnce();
      });
    }
    this.pollOnce();
    this._clearPollTimer();
    this._pollingTimer = setInterval(() => this.pollOnce(), this._effectiveInterval());
  },
  stopPolling() {
    this._pollActive = false;
    this._clearPollTimer();
  },
  // ===== Reload customers from D1 (clear seed + re-import) =====
  async reloadStaticDB() {
    const list = this.getCustomers();
    const kept = list.filter((c) => c.createdBy !== "AutoImport:StaticDB");
    const removed = list.length - kept.length;
    this.saveCustomers(kept);
    console.log(`[Storage] Cleared ${removed} seed GPS records`);
    if (typeof CustomerDB !== "undefined") {
      CustomerDB._loaded = false;
      await CustomerDB.load();
    }
    const result = await this.importFromStaticDB();
    await this.applyGpsOverlay();
    let debtTotal = 0;
    if (typeof DebtDB !== "undefined" && DebtDB.load) {
      DebtDB._loaded = false;
      await DebtDB.load();
      debtTotal = DebtDB._byCif ? DebtDB._byCif.size : 0;
    }
    return { removed, imported: (result == null ? void 0 : result.imported) || 0, backfilled: (result == null ? void 0 : result.backfilled) || 0, total: (result == null ? void 0 : result.total) || 0, debt: debtTotal };
  }
};
function mergeByUpdatedAt(local, remote) {
  const byId = /* @__PURE__ */ new Map();
  for (const c of local) {
    if (c.id) byId.set(c.id, c);
  }
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
      if (newTime >= oldTime && c.deleted === false) {
        byId.set(c.id, c);
      }
    } else {
      const oldTime = new Date(old.updatedAt || old.createdAt || 0).getTime();
      const newTime = new Date(c.updatedAt || c.createdAt || 0).getTime();
      byId.set(c.id, newTime >= oldTime ? c : old);
    }
  }
  return Array.from(byId.values());
}
function mergeVisitsByTimestamp(local, remote) {
  const merged = __spreadValues({}, local);
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
try {
  Storage.ready = Storage._loadMem();
} catch (e) {
  Storage.ready = Promise.resolve([]);
}
const Fuel = {
  KEY_PRICES: "bfr_fuel_prices",
  KEY_PRICES_DATE: "bfr_fuel_prices_date",
  // Vehicle catalog (3 types per BAAC ops spec)
  // km/L = average fuel consumption; baht/L = price (cache-able)
  VEHICLES: {
    motorcycle: {
      id: "motorcycle",
      label: "\u{1F3CD}\uFE0F \u0E21\u0E2D\u0E40\u0E15\u0E2D\u0E23\u0E4C\u0E44\u0E0B\u0E14\u0E4C",
      kmPerLiter: 35,
      fuelType: "gasohol95"
    },
    car: {
      id: "car",
      label: "\u{1F697} \u0E23\u0E16\u0E40\u0E01\u0E4B\u0E07",
      kmPerLiter: 12,
      fuelType: "gasohol95"
    },
    pickup: {
      id: "pickup",
      label: "\u{1F6FB} \u0E01\u0E23\u0E30\u0E1A\u0E30",
      kmPerLiter: 10,
      fuelType: "diesel"
    }
  },
  // Fuel type catalog (label + default price ฿/L — sync กับ Bangchak 17/09/2569)
  FUEL_TYPES: {
    diesel: { id: "diesel", label: "\u0E14\u0E35\u0E40\u0E0B\u0E25 (B7)", defaultPrice: 35.69 },
    gasohol95: { id: "gasohol95", label: "\u0E41\u0E01\u0E4A\u0E2A\u0E42\u0E0B\u0E2E\u0E2D\u0E25\u0E4C 95", defaultPrice: 39.94 },
    gasohol91: { id: "gasohol91", label: "\u0E41\u0E01\u0E4A\u0E2A\u0E42\u0E0B\u0E2E\u0E2D\u0E25\u0E4C 91", defaultPrice: 39.57 }
  },
  // ===== Get vehicle =====
  getVehicle(id) {
    return this.VEHICLES[id] || this.VEHICLES.car;
  },
  // ===== Get fuel price (admin cache → fuel-prices.json → default) =====
  // fuel-prices.json อัพเดทอัตโนมัติทุกวันจาก Bangchak API — report.js ใช้ทางนี้
  // (กันรายงานคำนวณด้วยราคาตั้งต้นเก่า ถ้าไฟล์ JSON มีของใหม่จะชนะ default เสมอ)
  _JSON_KEY: { diesel: "pickup", gasohol95: "motorcycle", gasohol91: "car" },
  getPrice(fuelTypeId) {
    const cache = this._getCache();
    const fuel = this.FUEL_TYPES[fuelTypeId] || this.FUEL_TYPES.gasohol95;
    if (cache[fuelTypeId] && cache[fuelTypeId] > 0) {
      return cache[fuelTypeId];
    }
    try {
      const live = typeof Utils !== "undefined" && Utils._fuelData && Utils._fuelData.fuels || null;
      const info = live && live[this._JSON_KEY[fuelTypeId] || "motorcycle"];
      if (info && info.price > 0) return info.price;
    } catch (e) {
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
      liters,
      baht,
      kmPerLiter: v.kmPerLiter,
      pricePerLiter,
      fuelType: v.fuelType,
      fuelLabel: this.FUEL_TYPES[v.fuelType].label
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
        defaultPrice: fuel.defaultPrice
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
      return JSON.parse(localStorage.getItem(this.KEY_PRICES) || "{}");
    } catch (e) {
      return {};
    }
  },
  _saveCache(cache) {
    localStorage.setItem(this.KEY_PRICES, JSON.stringify(cache));
    localStorage.setItem(this.KEY_PRICES_DATE, (/* @__PURE__ */ new Date()).toISOString());
  }
};
window.Fuel = Fuel;
const CustomerDB = {
  _data: null,
  // Full array
  _byCif: null,
  // Map: CIF → record
  _loading: false,
  _loaded: false,
  // Load database from static JSON — deferred via requestIdleCallback
  load() {
    if (this._loaded) return Promise.resolve(this._data);
    if (this._loading) return this._loadPromise;
    this._loading = true;
    this._loadPromise = new Promise((resolve) => {
      const doLoad = async () => {
        try {
          const PAGE = 1e4;
          let all = [];
          let offset = 0;
          for (let page = 0; page < 6; page++) {
            const res = await fetch(API.baseUrl() + `/api/customers?limit=${PAGE}&offset=${offset}`, { headers: API.headers() });
            if (!res.ok) throw new Error("Failed to load customer database");
            const payload = await res.json();
            const chunk = Array.isArray(payload.customers) ? payload.customers : [];
            all = all.concat(chunk);
            if (chunk.length < PAGE) break;
            offset += PAGE;
            if (payload.total && all.length >= payload.total) break;
          }
          this._data = all;
          this._byCif = /* @__PURE__ */ new Map();
          for (const r of this._data) {
            this._byCif.set(r.cif, r);
          }
          this._loaded = true;
          console.log(`[CustomerDB] Loaded ${this._data.length} customers`);
          try {
            document.dispatchEvent(new CustomEvent("customerdb:loaded"));
          } catch (e) {
          }
        } catch (err) {
          console.warn("[CustomerDB] Load failed:", err.message);
          this._data = [];
          this._byCif = /* @__PURE__ */ new Map();
        }
        this._loading = false;
        resolve(this._data);
      };
      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(doLoad, { timeout: 3e3 });
      } else {
        setTimeout(doLoad, 100);
      }
    });
    return this._loadPromise;
  },
  // โหลดเมื่อจำเป็น (17 พ.ย.69): เปิดแอปไม่ต้องโหลดฐานรายชื่อทั้งก้อน (11,785 แถว ~6MB)
  // ค่อยโหลดตอนผู้ใช้เปิดแท็บลูกค้า/ค้นหา/เปิดการ์ด — ตัวเลขสรุปใช้ข้อมูลหนี้ + /api/customers/stats แทน
  ensure() {
    if (this._loaded) return Promise.resolve(this._data || []);
    return this.load();
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
    if (!potential) return "";
    const colors = { "\u0E41\u0E14\u0E07": "\u{1F534}", "\u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E07": "\u{1F7E1}", "\u0E40\u0E02\u0E35\u0E22\u0E27": "\u{1F7E2}" };
    return (colors[potential] || "") + " " + potential;
  },
  // Format customer class badge
  formatClass(cls) {
    if (!cls) return "";
    const badges = {
      "AAA+": "\u2B50\u2B50\u2B50",
      "AAA": "\u2B50\u2B50",
      "AA": "\u2B50",
      "A": "\u{1F7E2}",
      "B": "\u{1F7E1}",
      "1": "\u{1F534}"
    };
    return (badges[cls] || "") + " " + cls;
  },
  // Build full address string (รองรับทั้ง r.moo ตรงๆ และ r.extra.moo จาก API)
  fullAddress(r) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    if (!r) return "";
    const clean = (v) => String(v == null ? "" : v).replace(/^'+/, "").trim();
    const house = clean(r.address);
    if (/ม\.|ต\.|อ\.|จ\./.test(house)) return house;
    const parts = [];
    if (house && house !== "-") parts.push(house);
    const moo = clean((_b = (_a = r.extra) == null ? void 0 : _a.moo) != null ? _b : r.moo);
    const tambon = clean((_d = (_c = r.extra) == null ? void 0 : _c.tambon) != null ? _d : r.tambon);
    const amphoe = clean((_f = (_e = r.extra) == null ? void 0 : _e.amphoe) != null ? _f : r.amphoe);
    const province = clean((_h = (_g = r.extra) == null ? void 0 : _g.province) != null ? _h : r.province);
    const postcode = clean((_j = (_i = r.extra) == null ? void 0 : _i.postcode) != null ? _j : r.postcode);
    if (moo) parts.push("\u0E21." + moo);
    if (tambon) parts.push("\u0E15." + tambon);
    if (amphoe) parts.push("\u0E2D." + amphoe);
    if (province) parts.push("\u0E08." + province);
    if (postcode) parts.push(postcode);
    return parts.join(" ");
  }
};
window.CustomerDB = CustomerDB;
const DebtDB = {
  _byCif: null,
  _loaded: false,
  _loading: false,
  _fromCache: false,
  // true = รอบนี้ใช้แคชในเครื่อง ไม่ได้โหลดใหม่ (ดูในแท็บสุขภาพได้)
  KEY_DEBT_UPDATED: "bfr_debt_updated",
  CACHE_STORE: "bfr-debt-v1",
  // ขอบเขตแคชรายคน (staff คนละสาขาเห็นข้อมูลคนละชุด — ห้ามใช้แคชข้ามกัน)
  _cacheScope() {
    try {
      if (typeof Auth !== "undefined" && Auth.getUser) {
        const u = Auth.getUser();
        return String(u && (u.id || u.username) || "anon");
      }
    } catch (e) {
    }
    return "anon";
  },
  _cacheKey(branch) {
    const base = API.baseUrl() + "/api/debt-data?scope=" + encodeURIComponent(this._cacheScope());
    return branch ? base + "&branch=" + encodeURIComponent(branch) : base;
  },
  _stamp() {
    try {
      return localStorage.getItem(this.KEY_DEBT_UPDATED) || "";
    } catch (e) {
      return "";
    }
  },
  _saveStamp(v) {
    try {
      if (v) localStorage.setItem(this.KEY_DEBT_UPDATED, v);
    } catch (e) {
    }
  },
  // ถามเวอร์ชันเซิร์ฟเวอร์อย่างเดียว (เบามาก — ไม่โหลดข้อมูล 7MB)
  async _serverVersion() {
    try {
      const res = await fetch(API.baseUrl() + "/api/debt-data?v=1", { headers: API.headers() });
      if (!res.ok) return null;
      const j = await res.json();
      return j && j.success ? j.updated || null : null;
    } catch (e) {
      return null;
    }
  },
  async _readCache(key) {
    try {
      if (typeof caches === "undefined") return null;
      const hit = await (await caches.open(this.CACHE_STORE)).match(key);
      if (!hit) return null;
      const data = await hit.json();
      return Array.isArray(data) ? data : null;
    } catch (e) {
      return null;
    }
  },
  // เก็บสำเนาลงเครื่อง + ลบของคนอื่นในเครื่องนี้ (กันแคชบวม + กันหยิบข้ามสาขา)
  // หมายเหตุ: เรียกด้วย res.clone() ก่อน res.json() เสมอ (body อ่านได้ครั้งเดียว)
  async _writeCache(key, copy) {
    try {
      if (typeof caches === "undefined" || !copy) return;
      const c = await caches.open(this.CACHE_STORE);
      const scopeTag = key.split("?scope=")[1] || "";
      for (const r of await c.keys()) {
        if (r.url === key) continue;
        if (scopeTag && r.url.indexOf("?scope=" + scopeTag.split("&")[0]) >= 0) await c.delete(r);
      }
      await c.put(key, copy);
    } catch (e) {
    }
  },
  _fill(data, tag) {
    let rows = Array.isArray(data) ? data : [];
    try {
      const isSuper = typeof Auth !== "undefined" && Auth.isAdmin ? Auth.isAdmin() : false;
      const own = typeof Auth !== "undefined" && Auth.getUser ? String((Auth.getUser() || {}).branch || "").trim() : "";
      if (!isSuper && own) {
        const before = rows.length;
        rows = rows.filter((r) => String(r && r.branch || "").trim() === own);
        if (before !== rows.length) console.warn(`[DebtDB] \u0E01\u0E23\u0E2D\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E15\u0E48\u0E32\u0E07\u0E2A\u0E32\u0E02\u0E32\u0E2D\u0E2D\u0E01 ${before - rows.length} \u0E23\u0E32\u0E22`);
      }
    } catch (e) {
    }
    this._byCif = /* @__PURE__ */ new Map();
    for (const r of rows) this._byCif.set(r.cif, r);
    this._loaded = true;
    this._loadedAt = Date.now();
    console.log(`[DebtDB] Loaded ${rows.length} customers` + tag);
  },
  async load() {
    if (this._loaded) return true;
    if (this._loading) return false;
    this._loading = true;
    try {
      const isSuper = typeof Auth !== "undefined" && Auth.isAdmin ? Auth.isAdmin() : false;
      if (isSuper && typeof Auth !== "undefined" && Auth.getUser && Auth.getUser()) {
        await this._loadAdminPrimary();
      } else {
        await this._loadScope("", "/api/debt-data", {});
      }
    } catch (err) {
      console.warn("[DebtDB] Load failed:", err.message);
      this._byCif = /* @__PURE__ */ new Map();
    }
    this._loading = false;
    return this._loaded;
  },
  // โหลดชุดเดียว (ไม่ระบุสาขา = ตามสิทธิ์ผู้ใช้) — ใช้ทั้งผู้ใช้ทั่วไปและแอดมินกรณีโหลดรวม
  async _loadScope(branch, url, headers, force) {
    const key = this._cacheKey(branch);
    const want = this._cacheScope() + "|" + await this._serverVersion();
    if (!force && want && this._stamp() === want) {
      const cached = await this._readCache(key);
      if (cached) {
        this._fromCache = true;
        this._fill(cached, " (\u0E08\u0E32\u0E01\u0E41\u0E04\u0E0A\u0E43\u0E19\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07 \u2014 \u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2B\u0E19\u0E35\u0E49\u0E44\u0E21\u0E48\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19)");
        return true;
      }
    }
    this._fromCache = false;
    const res = await fetch(url, { headers: API.headers() });
    if (!res.ok) throw new Error("Failed to load debt data");
    const copy = res.clone();
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("debt data not array");
    const up = res.headers.get("X-Debt-Updated");
    if (up) this._saveStamp(this._cacheScope() + "|" + up);
    await this._writeCache(key, copy);
    this._fill(data, res.headers.get("X-Debt-Source") === "kv" ? " (from KV)" : "");
    return true;
  },
  // แอดมิน: โหลดเฉพาะสาขาหลักก่อน (เร็ว) แล้วค่อยโหลดสาขาอื่นเมื่อจำเป็น
  async _loadAdminPrimary() {
    let stats = null;
    try {
      const r = await fetch(API.baseUrl() + "/api/customers/stats", { headers: API.headers() });
      const j = await r.json();
      if (j && j.success) stats = j;
    } catch (e) {
    }
    this._stats = stats;
    if (!stats) {
      return this._loadScope("", API.baseUrl() + "/api/debt-data", {});
    }
    const rowsB = stats && stats.by_branch || [];
    this._branchesAll = rowsB.filter((b) => (+b.with_debt || 0) > 0).map((b) => String(b.branch));
    this._branchesLoaded = /* @__PURE__ */ new Set();
    const own = String((Auth.getUser() || {}).branch || "").trim();
    let primary = this._branchesAll.indexOf(own) >= 0 ? own : "";
    if (!primary) {
      let best = -1;
      for (const b of rowsB) {
        const n = +b.with_debt || 0;
        if (n > best) {
          best = n;
          primary = String(b.branch);
        }
      }
    }
    this._primaryBranch = primary;
    this._partial = this._branchesAll.length > (primary ? 1 : 0);
    if (!primary) {
      this._byCif = /* @__PURE__ */ new Map();
      this._loaded = true;
      this._loadedAt = Date.now();
      return;
    }
    await this._loadScope(primary, API.baseUrl() + "/api/debt-data?branch=" + encodeURIComponent(primary));
    this._branchesLoaded = /* @__PURE__ */ new Set([primary]);
  },
  // โหลดสาขาเพิ่ม (เมื่อผู้ใช้เลือกสาขาที่ยังไม่มีในเครื่อง) — รวมเข้าคลังเดิม
  async ensureBranch(branch, force) {
    const b = String(branch || "").trim();
    if (!b || b === "ALL") return false;
    if (!this._branchesLoaded) this._branchesLoaded = /* @__PURE__ */ new Set();
    if (!force && this._branchesLoaded.has(b)) return true;
    try {
      const res = await fetch(API.baseUrl() + "/api/debt-data?branch=" + encodeURIComponent(b), { headers: API.headers() });
      if (!res.ok) return false;
      const rows = await res.json();
      if (!Array.isArray(rows)) return false;
      if (!this._byCif) this._byCif = /* @__PURE__ */ new Map();
      for (const r of rows) this._byCif.set(r.cif, r);
      this._branchesLoaded.add(b);
      this._loadedAt = Date.now();
      this._partial = (this._branchesAll || []).some((x) => !this._branchesLoaded.has(x));
      return true;
    } catch (e) {
      return false;
    }
  },
  // โหลดทุกสาขาที่ยังขาด (ผู้ใช้เลือก "ทุกสาขา")
  async loadAllBranches() {
    const all = this._branchesAll || [];
    for (const b of all) {
      if (!this._branchesLoaded || !this._branchesLoaded.has(b)) await this.ensureBranch(b);
    }
    this._partial = false;
    return true;
  },
  // re-fetch ข้อมูลล่าสุด (หลังแอดมินอัพหนี้ใหม่ → หน้าสรุปเห็นเลขใหม่
  // โดยไม่ต้องรีเฟรชหน้า) — ไม่บล็อก ล้มเหลวเงียบ
  async refresh() {
    try {
      if (this._branchesLoaded && this._branchesLoaded.size) {
        const list = [...this._branchesLoaded];
        this._branchesLoaded = /* @__PURE__ */ new Set();
        for (const b of list) {
          if (this._byCif) {
            const rows = [...this._byCif.values()].filter((r) => String(r.branch || "").trim() !== b);
            this._byCif = new Map(rows.map((r) => [r.cif, r]));
          }
          await this.ensureBranch(b, true);
        }
        this._loadedAt = Date.now();
        return true;
      }
      return await this._loadScope("", API.baseUrl() + "/api/debt-data", {}, true);
    } catch (err) {
      console.warn("[DebtDB] refresh failed:", err.message);
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
    return n.toLocaleString("th-TH", { maximumFractionDigits: 0 }) + " \u0E1A\u0E32\u0E17";
  },
  // รูปแบบวันที่ dd/mm/yyyy -> เดือนไทย
  fmtDate(d) {
    if (!d) return "";
    const m = String(d).match(/(\d+)\/(\d+)\/(\d+)/);
    if (!m) return d;
    const th = ["\u0E21.\u0E04.", "\u0E01.\u0E1E.", "\u0E21\u0E35.\u0E04.", "\u0E40\u0E21.\u0E22.", "\u0E1E.\u0E04.", "\u0E21\u0E34.\u0E22.", "\u0E01.\u0E04.", "\u0E2A.\u0E04.", "\u0E01.\u0E22.", "\u0E15.\u0E04.", "\u0E1E.\u0E22.", "\u0E18.\u0E04."];
    return th[parseInt(m[2]) - 1] + " " + (parseInt(m[3]) + 543);
  },
  // key สำหรับกรองเดือน: 'MM/YYYY' (ใช้ใน dropdown)
  dueMonthKey(d) {
    if (!d) return "";
    const m = String(d).match(/(\d+)\/(\d+)\/(\d+)/);
    if (!m) return "";
    return m[2] + "/" + m[3];
  },
  // สีตามชั้นหนี้
  tierColor(t) {
    t = parseInt(t) || 0;
    if (t >= 5) return "#b30000";
    if (t >= 4) return "#d00000";
    if (t >= 3) return "#ff7a00";
    if (t >= 2) return "#ffaa00";
    return "#1f8a4c";
  },
  // แสดงชั้นหนี้เป็น badge
  tierBadge(t) {
    t = parseInt(t) || 0;
    if (!t) return '<span class="meta-badge gray">\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38</span>';
    const labels = { 1: "\u0E0A\u0E31\u0E49\u0E19 1", 2: "\u0E0A\u0E31\u0E49\u0E19 2", 3: "\u0E0A\u0E31\u0E49\u0E19 3", 4: "\u0E0A\u0E31\u0E49\u0E19 4", 5: "\u0E0A\u0E31\u0E49\u0E19 5" };
    return `<span class="meta-badge red-debt">${labels[t] || t}</span>`;
  },
  // แถบสรุปหนี้สำหรับการ์ด (popup + list)
  summaryHTML(debt) {
    if (!debt) return "";
    const urgent = debt.max_tier >= 2;
    const color = this.tierColor(debt.max_tier);
    return `
      ${DebtUI.zoomBarHTML()}
      <div class="debt-summary ${urgent ? "debt-urgent" : ""}" style="border-left-color:${color}">
        <div class="debt-row">
          <span class="debt-label">\u{1F4B0} \u0E2B\u0E19\u0E35\u0E49\u0E23\u0E27\u0E21</span>
          <span class="debt-val">${this.fmtMoney(debt.total_debt)}</span>
        </div>
        <div class="debt-row">
          <span class="debt-label">\u{1F4E6} \u0E2A\u0E31\u0E0D\u0E0D\u0E32</span>
          <span class="debt-val">${debt.num_contracts} \u0E2A\u0E31\u0E0D\u0E0D\u0E32 \xB7 \u0E0A\u0E31\u0E49\u0E19\u0E2A\u0E39\u0E07\u0E2A\u0E38\u0E14 ${debt.max_tier || "-"}</span>
        </div>
        <div class="debt-row">
          <span class="debt-label">\u{1F4C5} \u0E16\u0E36\u0E07\u0E01\u0E33\u0E2B\u0E19\u0E14\u0E40\u0E23\u0E47\u0E27\u0E2A\u0E38\u0E14</span>
          <span class="debt-val">${this.fmtDate(debt.earliest_due) || "-"}</span>
        </div>
      </div>
    `;
  },
  // รายการสัญญา (โชว์ 3 ตัวแรก + ปุ่มดูอีก)
  contractsHTML(debt, showAll) {
    if (!debt || !debt.contracts || debt.contracts.length === 0) return "";
    const shown = showAll ? debt.contracts : debt.contracts.slice(0, 3);
    const hasMore = debt.contracts.length > 3 && !showAll;
    const fmtBaht = (n) => Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 }) + " \u0E1A\u0E32\u0E17";
    const rows = shown.map((c, i) => {
      const t = parseInt(c.t) || 0;
      const urgent = t >= 2;
      let m15line = "";
      if (c.m15 === "Y") m15line += '<div class="dc-line" style="color:#92400e">\u23F3 <b>15 \u0E40\u0E14\u0E37\u0E2D\u0E19: \u0E15\u0E49\u0E2D\u0E07\u0E0A\u0E33\u0E23\u0E30</b></div>';
      if (c.m15_amt > 0) m15line += `<div class="dc-line" style="color:#b91c1c">\u{1F4B8} 15\u0E40\u0E14\u0E37\u0E2D\u0E19 31\u0E21\u0E35.\u0E04.70 \u0E02\u0E31\u0E49\u0E19\u0E15\u0E48\u0E33 ${fmtBaht(c.m15_amt)}</div>`;
      let subLine = "";
      if (c.sub && !["", "0", "1", "2", "3"].includes(String(c.sub).trim()) && /[A-Za-z]/.test(c.sub)) {
        subLine = `<div class="dc-line" style="color:#0f766e">\u{1F6DF} \u0E1E\u0E31\u0E01\u0E2B\u0E19\u0E35\u0E49 (${this.escapeHTML(c.sub)})</div>`;
      }
      let fore = "";
      if (c.f08 === "Y" || c.f09 === "Y" || c.f10 === "Y") {
        const parts = [];
        if (c.f08 === "Y") parts.push(`\u0E2A.\u0E04.69${c.p08 > 0 ? " " + fmtBaht(c.p08) : ""}`);
        if (c.f09 === "Y") parts.push(`\u0E01.\u0E22.69${c.p09 > 0 ? " " + fmtBaht(c.p09) : ""}`);
        if (c.f10 === "Y") parts.push(`\u0E15.\u0E04.69${c.p10 > 0 ? " " + fmtBaht(c.p10) : ""}`);
        fore = `<div class="dc-line" style="color:#7c3aed">\u{1F52E} \u0E04\u0E32\u0E14 15\u0E40\u0E14\u0E37\u0E2D\u0E19: ${parts.join(" \xB7 ")}</div>`;
      }
      return `
        <div class="debt-contract ${urgent ? "debt-contract-urgent" : ""}">
          <div class="dc-head">
            <span class="dc-no">\u0E2A\u0E31\u0E0D\u0E0D\u0E32 ${i + 1}</span>
            <span class="dc-tier" style="color:${this.tierColor(t)}">${t ? "\u0E0A\u0E31\u0E49\u0E19 " + t : "\u0E0A\u0E31\u0E49\u0E19 -"}</span>
          </div>
          <div class="dc-line">\u{1F3F7}\uFE0F \u0E40\u0E25\u0E02\u0E2A\u0E31\u0E0D\u0E0D\u0E32 ${this.escapeHTML(c.c)}</div>
          <div class="dc-line">\u{1F4B0} ${this.fmtMoney(c.d)}</div>
          <div class="dc-line">\u{1F4C5} \u0E16\u0E36\u0E07 ${this.fmtDate(c.due) || "-"}</div>
          ${c.reserve ? `<div class="dc-line">\u{1F6E1}\uFE0F \u0E01\u0E31\u0E19\u0E2A\u0E33\u0E23\u0E2D\u0E07 ${this.escapeHTML(c.reserve)}%</div>` : ""}
          ${m15line}
          ${subLine}
          ${fore}
        </div>
      `;
    }).join("");
    const btn = hasMore ? `<button class="debt-more" onclick="DebtUI.expand('${debt.cif}')">\u0E14\u0E39\u0E2A\u0E31\u0E0D\u0E0D\u0E32\u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14 (${debt.contracts.length} \u0E2A\u0E31\u0E0D\u0E0D\u0E32) \u25BE</button>` : "";
    return `<div class="debt-contracts">${rows}${btn}</div>`;
  },
  escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[m]);
  }
};
window.DebtDB = DebtDB;
const DebtUI = {
  KEY_ZOOM: "bfr_debt_zoom",
  // สถานะซูมตัวอักษรการ์ดหนี้ (จำข้ามการเปิด/ปิดแอป)
  isZoomOn() {
    try {
      return localStorage.getItem(this.KEY_ZOOM) === "1";
    } catch (e) {
      return false;
    }
  },
  // แถบปุ่ม 🔍 ในการ์ดหนี้ — ใช้ร่วมกันทั้ง popup บนแผนที่และหน้าจัดการข้อมูลลูกค้า
  zoomBarHTML() {
    return `<div class="debt-zoom-bar"><button type="button" class="debt-zoom-btn" onclick="DebtUI.toggleZoom(this)">${this.isZoomOn() ? "\u{1F50E} \u0E22\u0E48\u0E2D\u0E15\u0E31\u0E27\u0E2D\u0E31\u0E01\u0E29\u0E23" : "\u{1F50D} \u0E02\u0E22\u0E32\u0E22\u0E15\u0E31\u0E27\u0E2D\u0E31\u0E01\u0E29\u0E23"}</button></div>`;
  },
  // ติดคลาส debt-zoom ที่ body → CSS ขยายตัวอักษรทุกการ์ดหนี้ที่เปิดอยู่
  _paint(on) {
    if (document.body) document.body.classList.toggle("debt-zoom", on);
    document.querySelectorAll(".debt-zoom-btn").forEach((b) => {
      b.textContent = on ? "\u{1F50E} \u0E22\u0E48\u0E2D\u0E15\u0E31\u0E27\u0E2D\u0E31\u0E01\u0E29\u0E23" : "\u{1F50D} \u0E02\u0E22\u0E32\u0E22\u0E15\u0E31\u0E27\u0E2D\u0E31\u0E01\u0E29\u0E23";
    });
  },
  toggleZoom(btn) {
    const on = !this.isZoomOn();
    try {
      localStorage.setItem(this.KEY_ZOOM, on ? "1" : "0");
    } catch (e) {
    }
    this._paint(on);
    if (btn && btn.blur) btn.blur();
  },
  // เรียกตอนโหลดหน้า — ถ้าเคยเปิดซูมไว้ ให้การ์ดหนี้ใหญ่ทันที
  init() {
    this._paint(this.isZoomOn());
  },
  // พับ/ขยายรายการสัญญาในการ์ด popup (เริ่มพับไว้ — จอเล็กไม่ล้น)
  // กดครั้งแรกค่อยวาดรายการ (lazy) แล้วสลับซ่อน/โชว์
  toggleContracts(cif, btn) {
    const box = document.getElementById("debt-contracts-" + cif);
    if (!box) return;
    if (!box.dataset.filled) {
      const debt = DebtDB.getByCif(cif);
      if (!debt) return;
      box.innerHTML = DebtDB.contractsHTML(debt, true);
      box.dataset.filled = "1";
    }
    const opening = box.classList.contains("hidden");
    box.classList.toggle("hidden");
    if (btn) {
      const n = box.querySelectorAll(".debt-contract").length || ((DebtDB.getByCif(cif) || {}).contracts || []).length;
      btn.innerHTML = opening ? `\u{1F4C4} \u0E0B\u0E48\u0E2D\u0E19\u0E2A\u0E31\u0E0D\u0E0D\u0E32 (${n} \u0E2A\u0E31\u0E0D\u0E0D\u0E32) \u25B4` : `\u{1F4C4} \u0E14\u0E39\u0E2A\u0E31\u0E0D\u0E0D\u0E32 (${n} \u0E2A\u0E31\u0E0D\u0E0D\u0E32) \u25BE`;
      if (btn.blur) btn.blur();
    }
  },
  // ชื่อเก่า (ปุ่มใน contractsHTML แบบย่อเรียกใช้) — ชี้มาที่ตัวใหม่
  expand(cif) {
    this.toggleContracts(cif, null);
  }
};
window.DebtUI = DebtUI;
if (document.body) {
  DebtUI.init();
} else {
  document.addEventListener("DOMContentLoaded", () => DebtUI.init());
}
const DebtSummary = {
  async render() {
    if (!window.DebtDB || !DebtDB._loaded) {
      this._setSub("\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2B\u0E19\u0E35\u0E49\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E42\u0E2B\u0E25\u0E14");
      if (window.DebtDB && !DebtDB._loaded) DebtDB.load().then(() => this.render());
      return;
    }
    const staleMs = Date.now() - (DebtDB._loadedAt || 0);
    if (staleMs > 12e4) {
      DebtDB._loadedAt = Date.now();
      DebtDB.refresh().then((ok) => {
        if (ok) this.render();
      });
    }
    const self = this;
    const data = [...DebtDB._byCif.values()];
    const branchOf = (r) => {
      const own = String(r && r.branch || "").trim();
      if (own) return own;
      const cust = r.cif && window.CustomerDB && CustomerDB._loaded ? CustomerDB.getByCif(String(r.cif).trim()) : null;
      return cust && cust.branch ? String(cust.branch).trim() : "";
    };
    const brSel = document.getElementById("debt-branch-filter");
    if (!this._branches) {
      this._branchesAt = Date.now();
      try {
        fetch("/api/branches").then((r) => r.json()).then((j) => {
          this._branches = j && j.branches || [];
          this.render();
        }).catch(() => {
        });
      } catch (e) {
      }
    }
    if (brSel) {
      const names = {};
      for (const b of this._branches || []) names[String(b.code || "").trim()] = b.name || "\u0E2A\u0E32\u0E02\u0E32 " + b.code;
      const seen = /* @__PURE__ */ new Set();
      for (const b of this._branches || []) {
        const c = String(b.code || "").trim();
        if (c) seen.add(c);
      }
      try {
        data.forEach((r) => {
          const b = String(r.branch || "").trim();
          if (b) seen.add(b);
        });
      } catch (e) {
      }
      if (window.CustomerDB && CustomerDB._loaded) {
        CustomerDB._byCif.forEach((r) => {
          const b = String(r.branch || "").trim();
          if (b) seen.add(b);
        });
      }
      const cur = self.selBranch || "ALL";
      brSel.innerHTML = `<option value="ALL">\u0E17\u0E38\u0E01\u0E2A\u0E32\u0E02\u0E32</option>` + [...seen].sort().map((b) => `<option value="${b}"${b === cur ? " selected" : ""}>${names[b] || "\u0E2A\u0E32\u0E02\u0E32 " + b}</option>`).join("");
      if (cur !== "ALL" && !seen.has(cur)) self.selBranch = "ALL";
      brSel.onchange = async () => {
        self.selBranch = brSel.value || "ALL";
        const b = self.selBranch;
        try {
          if (b === "ALL") {
            if (window.DebtDB && DebtDB.loadAllBranches && DebtDB._partial) await DebtDB.loadAllBranches();
          } else if (window.DebtDB && DebtDB.ensureBranch) {
            await DebtDB.ensureBranch(b);
          }
        } catch (e) {
        }
        self.render();
      };
    }
    const B = self.selBranch || "ALL";
    const fdata = B === "ALL" ? data : data.filter((r) => branchOf(r) === B);
    const hasGb = fdata.some((r) => r.gb === "GOOD" || r.gb === "BAD");
    let totalCif = fdata.length;
    let totalDebt = fdata.reduce((s, r) => s + (+r.total_debt || 0), 0);
    {
      const st = this._stats;
      if (st && st.success) {
        if (B === "ALL") {
          if (typeof st.with_debt === "number") totalCif = st.with_debt;
          if (typeof st.debt_total === "number") totalDebt = st.debt_total;
        } else {
          const row = (st.by_branch || []).find((x) => String(x.branch) === String(B));
          if (row) {
            totalCif = row.with_debt;
            totalDebt = row.debt_total;
          }
        }
      }
    }
    const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
    const sub = document.getElementById("debt-summary-sub");
    if (sub) {
      let allLine = "";
      try {
        const st = this._stats;
        if (st && st.success) {
          const b = B && B !== "ALL" ? (st.by_branch || []).find((x) => String(x.branch) === String(B)) : null;
          const nAll = b ? b.customers : st.total_customers;
          if (nAll != null) allLine = ` \xB7 \u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E17\u0E31\u0E49\u0E07\u0E2A\u0E32\u0E02\u0E32 ${Number(nAll).toLocaleString("th-TH")} \u0E23\u0E32\u0E22`;
        }
      } catch (e) {
      }
      sub.textContent = `\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32 ${totalCif.toLocaleString("th-TH")} \u0E23\u0E32\u0E22 \xB7 ${fdata.reduce((s, r) => s + (+r.num_contracts || 0), 0).toLocaleString("th-TH")} \u0E2A\u0E31\u0E0D\u0E0D\u0E32 \xB7 \u0E2B\u0E19\u0E35\u0E49\u0E23\u0E27\u0E21 ${fmt(totalDebt)} \u0E1A\u0E32\u0E17` + (B !== "ALL" ? ` \xB7 \u0E2A\u0E32\u0E02\u0E32 ${B}` : "") + allLine + (window.DebtDB && DebtDB._partial ? " \xB7 \u23F3 \u0E17\u0E22\u0E2D\u0E22\u0E42\u0E2B\u0E25\u0E14\u0E2A\u0E32\u0E02\u0E32\u0E2D\u0E37\u0E48\u0E19" : "");
    }
    if (!this._stats || Date.now() - (this._statsAt || 0) > 3e5) {
      this._statsAt = Date.now();
      try {
        fetch(API.baseUrl() + "/api/customers/stats", { headers: API.headers() }).then((r) => r.json()).then((j) => {
          if (j && j.success) {
            this._stats = j;
            this.render();
          }
        }).catch(() => {
        });
      } catch (e) {
      }
    }
    const ov = document.getElementById("debt-overview-cards");
    if (ov) {
      ov.innerHTML = `
        <div class="dov-card dov-green"><span class="dov-num">${fmt(totalDebt)}</span><span class="dov-label">\u0E2B\u0E19\u0E35\u0E49\u0E23\u0E27\u0E21 (\u0E1A\u0E32\u0E17)</span></div>
        <div class="dov-card dov-blue"><span class="dov-num">${totalCif.toLocaleString("th-TH")}</span><span class="dov-label">\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E2B\u0E19\u0E35\u0E49</span></div>
        <div class="dov-card dov-amber"><span class="dov-num">${fdata.reduce((s, r) => s + (+r.num_contracts || 0), 0).toLocaleString("th-TH")}</span><span class="dov-label">\u0E2A\u0E31\u0E0D\u0E0D\u0E32</span></div>
      `;
    }
    const colorBlock = document.getElementById("debt-color-block");
    const colorCount = { \u0E41\u0E14\u0E07: 0, \u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E07: 0, \u0E40\u0E02\u0E35\u0E22\u0E27: 0 };
    const colorDebt = { \u0E41\u0E14\u0E07: 0, \u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E07: 0, \u0E40\u0E02\u0E35\u0E22\u0E27: 0 };
    let haveDebtColor = false;
    for (const r of fdata) {
      const p = String(r.potential || "").trim();
      if (colorCount[p] !== void 0) {
        colorCount[p]++;
        colorDebt[p] += +r.total_debt || 0;
        haveDebtColor = true;
      }
    }
    const customers = typeof Storage !== "undefined" ? Storage.getActiveCustomers() : [];
    const bcust = B === "ALL" ? customers : customers.filter((c) => String(c.branch || "").trim() === B);
    if (!haveDebtColor) {
      for (const c of bcust) {
        const db = c.cif && window.CustomerDB && CustomerDB._loaded ? CustomerDB.getByCif(c.cif) : null;
        const p = db ? db.potential : null;
        if (p && colorCount[p] !== void 0) {
          colorCount[p]++;
          const debt = c.cif ? DebtDB.getByCif(c.cif) : null;
          colorDebt[p] += debt ? +debt.total_debt || 0 : 0;
        }
      }
    }
    if (colorBlock) {
      const totalColor = colorCount["\u0E41\u0E14\u0E07"] + colorCount["\u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E07"] + colorCount["\u0E40\u0E02\u0E35\u0E22\u0E27"] || 1;
      colorBlock.innerHTML = `
        <div class="ds-row"><span class="ds-label" style="color:#d00000">\u{1F534} \u0E41\u0E14\u0E07</span><span class="ds-val">${colorCount["\u0E41\u0E14\u0E07"]} \u0E23\u0E32\u0E22 (${Math.round(colorCount["\u0E41\u0E14\u0E07"] / totalColor * 100)}%) \xB7 ${fmt(colorDebt["\u0E41\u0E14\u0E07"])} \u0E1A\u0E32\u0E17</span></div>
        <div class="ds-row"><span class="ds-label" style="color:#d97706">\u{1F7E1} \u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E07</span><span class="ds-val">${colorCount["\u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E07"]} \u0E23\u0E32\u0E22 (${Math.round(colorCount["\u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E07"] / totalColor * 100)}%) \xB7 ${fmt(colorDebt["\u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E07"])} \u0E1A\u0E32\u0E17</span></div>
        <div class="ds-row"><span class="ds-label" style="color:#16a34a">\u{1F7E2} \u0E40\u0E02\u0E35\u0E22\u0E27</span><span class="ds-val">${colorCount["\u0E40\u0E02\u0E35\u0E22\u0E27"]} \u0E23\u0E32\u0E22 (${Math.round(colorCount["\u0E40\u0E02\u0E35\u0E22\u0E27"] / totalColor * 100)}%) \xB7 ${fmt(colorDebt["\u0E40\u0E02\u0E35\u0E22\u0E27"])} \u0E1A\u0E32\u0E17</span></div>
      `;
      if (totalColor === 1 && colorCount["\u0E41\u0E14\u0E07"] + colorCount["\u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E07"] + colorCount["\u0E40\u0E02\u0E35\u0E22\u0E27"] === 0) {
        colorBlock.innerHTML = '<div class="ds-note">\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E28\u0E31\u0E01\u0E22\u0E20\u0E32\u0E1E (\u0E01\u0E23\u0E2D\u0E01\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E04\u0E23\u0E1A)</div>';
      }
    }
    const tierBlock = document.getElementById("debt-tier-block");
    if (tierBlock) {
      const tierCount = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const tierDebt = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const r of fdata) {
        const t = parseInt(r.max_tier) || 0;
        if (tierCount[t] !== void 0) {
          tierCount[t]++;
          tierDebt[t] += +r.total_debt || 0;
        }
      }
      const labels = { 1: "\u0E0A\u0E31\u0E49\u0E19 1", 2: "\u0E0A\u0E31\u0E49\u0E19 2", 3: "\u0E0A\u0E31\u0E49\u0E19 3", 4: "\u0E0A\u0E31\u0E49\u0E19 4", 5: "\u0E0A\u0E31\u0E49\u0E19 5" };
      let goodN = 0, goodD = 0, badN = 0, badD = 0;
      for (const r of fdata) {
        if (r.gb === "BAD") {
          badN++;
          badD += +r.total_debt || 0;
        } else if (!hasGb || r.gb === "GOOD") {
          goodN++;
          goodD += +r.total_debt || 0;
        }
      }
      tierBlock.innerHTML = `
        ${hasGb ? `<div class="ds-row ds-total"><span class="ds-label">\u2705 Good Bank</span><span class="ds-val">${goodN.toLocaleString("th-TH")} \u0E23\u0E32\u0E22 \xB7 ${fmt(goodD)} \u0E1A\u0E32\u0E17</span></div>
             <div class="ds-row ds-total"><span class="ds-label" style="color:#d00000">\u26D4 Bad Bank</span><span class="ds-val" style="color:#d00000">${badN.toLocaleString("th-TH")} \u0E23\u0E32\u0E22 \xB7 ${fmt(badD)} \u0E1A\u0E32\u0E17</span></div>` : `<div class="ds-note">\u0E2D\u0E31\u0E1E\u0E44\u0E1F\u0E25\u0E4C\u0E2B\u0E19\u0E35\u0E49\u0E23\u0E2D\u0E1A\u0E43\u0E2B\u0E21\u0E48\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E14\u0E39 Good/Bad Bank</div>`}
      ` + Object.keys(tierCount).map((t) => `
        <div class="ds-row ds-clickable" onclick="DebtSummary.drillDown('tier', '${t}')">
          <span class="ds-label" style="color:${DebtDB.tierColor(t)}">\u{1F3F7}\uFE0F ${labels[t]}</span>
          <span class="ds-val">${tierCount[t].toLocaleString("th-TH")} \u0E23\u0E32\u0E22 \xB7 ${fmt(tierDebt[t])} \u0E1A\u0E32\u0E17 \u25B8</span>
        </div>
        <div class="ds-bar"><div class="ds-bar-fill" style="width:${tierCount[t] / fdata.length * 100 || 0}%;background:${t >= 2 ? "#d00000" : "#16a34a"}"></div></div>
      `).join("");
    }
    const zoneBlock = document.getElementById("debt-zone-block");
    if (zoneBlock) {
      {
        const zoneCount = {};
        const zoneDebt = {};
        const zoneOrder = ["1", "2", "3", "4", "5"];
        for (const r of fdata) {
          if (hasGb && r.gb !== "GOOD") continue;
          let z = String(r && r.zone || "").trim();
          if (!z && window.CustomerDB && CustomerDB._loaded) {
            const cust = r.cif ? CustomerDB.getByCif(String(r.cif).trim()) : null;
            z = cust && cust.zone ? String(cust.zone).trim() : "";
          }
          if (!z) z = "\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38";
          zoneCount[z] = (zoneCount[z] || 0) + 1;
          zoneDebt[z] = (zoneDebt[z] || 0) + (+r.total_debt || 0);
        }
        const zoneKeys = Object.keys(zoneCount).sort((a, b) => {
          const ia = zoneOrder.indexOf(a), ib = zoneOrder.indexOf(b);
          if (ia >= 0 && ib >= 0) return ia - ib;
          if (ia >= 0) return -1;
          if (ib >= 0) return 1;
          if (a === "\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38") return 1;
          if (b === "\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38") return -1;
          return a.localeCompare(b);
        });
        const zoneTotal = zoneKeys.reduce((s, k) => s + zoneCount[k], 0) || 1;
        zoneBlock.innerHTML = zoneKeys.map((z) => `
          <div class="ds-row"><span class="ds-label">\u{1F5FA}\uFE0F ${z === "\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38" ? "\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38\u0E40\u0E02\u0E15" : "\u0E40\u0E02\u0E15 " + z}</span><span class="ds-val">${zoneCount[z].toLocaleString("th-TH")} \u0E23\u0E32\u0E22 \xB7 ${fmt(zoneDebt[z])} \u0E1A\u0E32\u0E17</span></div>
          <div class="ds-bar"><div class="ds-bar-fill" style="width:${zoneCount[z] / zoneTotal * 100 || 0}%;background:#0f766e"></div></div>
        `).join("");
      }
    }
    const dueSel = document.getElementById("debt-duemonth-filter");
    if (dueSel) {
      const _now = /* @__PURE__ */ new Date(), _keys = [];
      let _y = _now.getFullYear(), _m = _now.getMonth() + 1;
      while (_y * 100 + _m <= 202703) {
        _keys.push(String(_m).padStart(2, "0") + "/" + _y);
        if (++_m > 12) {
          _m = 1;
          _y++;
        }
      }
      const _cur = self.selMonth || "ALL";
      dueSel.innerHTML = `<option value="ALL">\u0E17\u0E31\u0E49\u0E07\u0E1B\u0E35\u0E1A\u0E31\u0E0D\u0E0A\u0E35</option>` + _keys.map((k) => `<option value="${k}"${k === _cur ? " selected" : ""}>${DebtDB.fmtDate("01/" + k)}</option>`).join("");
      dueSel.onchange = () => {
        self.selMonth = dueSel.value;
        self.render();
      };
    }
    const dueLabel = self.selMonth && self.selMonth !== "ALL" ? DebtDB.fmtDate("01/" + self.selMonth) : "\u0E1B\u0E35\u0E19\u0E35\u0E49";
    const zdBlock = document.getElementById("debt-zonedue-block");
    if (zdBlock) {
      {
        const yk = (mmyy) => {
          const p = String(mmyy).split("/");
          return +p[1] * 100 + +p[0];
        };
        const FYS = yk("06/2026"), FYE = yk("03/2027");
        const zc = {}, zfy = {}, zfyD = {};
        const zoneOf = (r) => {
          const own = String(r && r.zone || "").trim();
          if (own) return own;
          const cust = window.CustomerDB && CustomerDB._loaded && r.cif ? CustomerDB.getByCif(String(r.cif).trim()) : null;
          const z = cust && cust.zone ? String(cust.zone).trim() : "";
          return z || "\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38";
        };
        for (const r of fdata) {
          if (hasGb && r.gb !== "GOOD") continue;
          const z = zoneOf(r);
          zc[z] = (zc[z] || 0) + 1;
          const k = DebtDB.dueMonthKey(r.earliest_due);
          if (k) {
            const kv = yk(k);
            const inScope = self.selMonth && self.selMonth !== "ALL" ? k === self.selMonth : kv >= FYS && kv <= FYE;
            if (inScope) {
              zfy[z] = (zfy[z] || 0) + 1;
              zfyD[z] = (zfyD[z] || 0) + (+r.total_debt || 0);
            }
          }
        }
        const zdOrder = ["1", "2", "3", "4", "5"];
        const zdKeys = Object.keys(zc).sort((a, b) => {
          const ia = zdOrder.indexOf(a), ib = zdOrder.indexOf(b);
          if (ia >= 0 && ib >= 0) return ia - ib;
          if (ia >= 0) return -1;
          if (ib >= 0) return 1;
          if (a === "\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38") return 1;
          if (b === "\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38") return -1;
          return a.localeCompare(b);
        });
        const gv = (o, k) => o[k] || 0;
        const totFy = zdKeys.reduce((s, k) => s + gv(zfy, k), 0);
        const totFyD = zdKeys.reduce((s, k) => s + gv(zfyD, k), 0);
        zdBlock.innerHTML = `
          <div class="ds-row ds-total"><span class="ds-label">\u{1F4CA} \u0E23\u0E27\u0E21\u0E17\u0E38\u0E01\u0E40\u0E02\u0E15</span><span class="ds-val">\u{1F4C5} ${dueLabel} ${totFy.toLocaleString("th-TH")} \u0E23\u0E32\u0E22 \xB7 ${fmt(totFyD)} \u0E1A\u0E32\u0E17</span></div>` + zdKeys.map((z) => `
          <div class="ds-row"><span class="ds-label">\u{1F5FA}\uFE0F ${z === "\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38" ? "\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38\u0E40\u0E02\u0E15" : "\u0E40\u0E02\u0E15 " + z}</span><span class="ds-val">\u{1F4C5} ${dueLabel} ${gv(zfy, z).toLocaleString("th-TH")} \u0E23\u0E32\u0E22 \xB7 ${fmt(gv(zfyD, z))} \u0E1A\u0E32\u0E17</span></div>
        `).join("");
      }
    }
    const monthBlock = document.getElementById("debt-month-block");
    if (monthBlock) {
      const ykey = (mmyy) => {
        const p = String(mmyy).split("/");
        return +p[1] * 100 + +p[0];
      };
      const FY_START = ykey("06/2026");
      const FY_END = ykey("03/2027");
      const monthCount = {};
      const monthDebt = {};
      const monthOmsom = {};
      let fyTotal = 0, fyOmsom = 0, fyDebt = 0;
      for (const r of fdata) {
        const k = DebtDB.dueMonthKey(r.earliest_due);
        if (!k) continue;
        const kv = ykey(k);
        if (kv >= FY_START && kv <= FY_END) {
          monthCount[k] = (monthCount[k] || 0) + 1;
          monthDebt[k] = (monthDebt[k] || 0) + (+r.total_debt || 0);
          fyTotal++;
          fyDebt += +r.total_debt || 0;
          if (r.is_omsom) {
            fyOmsom++;
            monthOmsom[k] = (monthOmsom[k] || 0) + 1;
          }
        }
      }
      const sortedMonths = Object.keys(monthCount).sort((a, b) => ykey(a) - ykey(b));
      if (sortedMonths.length === 0) {
        monthBlock.innerHTML = '<div class="ds-note">\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2B\u0E19\u0E35\u0E49\u0E16\u0E36\u0E07\u0E01\u0E33\u0E2B\u0E19\u0E14\u0E43\u0E19\u0E1B\u0E35\u0E1A\u0E31\u0E0D\u0E0A\u0E35\u0E19\u0E35\u0E49</div>';
      } else {
        const header = `
          <div class="ds-row ds-total"><span class="ds-label">\u{1F4CA} \u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E17\u0E31\u0E49\u0E07\u0E1B\u0E35\u0E1A\u0E31\u0E0D\u0E0A\u0E35</span><span class="ds-val">${fyTotal.toLocaleString("th-TH")} \u0E23\u0E32\u0E22 \xB7 ${fmt(fyDebt)} \u0E1A\u0E32\u0E17</span></div>
          <div class="ds-row"><span class="ds-label">\u{1F464} \u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E17\u0E31\u0E48\u0E27\u0E44\u0E1B</span><span class="ds-val">${(fyTotal - fyOmsom).toLocaleString("th-TH")} \u0E23\u0E32\u0E22</span></div>
          <div class="ds-row"><span class="ds-label">\u{1FA7A} \u0E2D\u0E2A\u0E21. (3080/2838/2751)</span><span class="ds-val">${fyOmsom.toLocaleString("th-TH")} \u0E23\u0E32\u0E22</span></div>
        `;
        const rows = sortedMonths.map((k) => `
          <div class="ds-row">
            <span class="ds-label">\u{1F4C5} ${DebtDB.fmtDate("01/" + k)}</span>
            <span class="ds-val">${monthCount[k].toLocaleString("th-TH")} \u0E23\u0E32\u0E22 \xB7 ${fmt(monthDebt[k])} \u0E1A\u0E32\u0E17${monthOmsom[k] ? ` (\u0E2D\u0E2A\u0E21. ${monthOmsom[k].toLocaleString("th-TH")})` : ""}</span>
          </div>
        `).join("");
        monthBlock.innerHTML = `${header}${rows}`;
      }
    }
    const geoBlock = document.getElementById("debt-geo-block");
    if (geoBlock) {
      let withGeo = 0, withoutGeo = 0;
      try {
        if (B !== "ALL") throw new Error("branch-scope");
        const res = await API.get("/api/sync");
        const c = res && res.success ? res.counts : null;
        if (c && c.gps != null && c.customers != null) {
          withGeo = c.gps;
          withoutGeo = Math.max(c.customers - c.gps, 0);
        } else {
          throw new Error("no counts");
        }
      } catch (e) {
        const hasGeoCif = new Set(
          bcust.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng)).map((x) => String(x.cif))
        );
        for (const r of fdata) {
          if (hasGeoCif.has(String(r.cif))) withGeo++;
          else withoutGeo++;
        }
      }
      const pctBase = withGeo + withoutGeo;
      const pct = pctBase ? Math.round(withGeo / pctBase * 100) : 0;
      geoBlock.innerHTML = `
        <div class="ds-row"><span class="ds-label" style="color:#16a34a">\u{1F4CD} \u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14\u0E41\u0E25\u0E49\u0E27</span><span class="ds-val">${withGeo.toLocaleString("th-TH")} \u0E23\u0E32\u0E22 (${pct}%)</span></div>
        <div class="ds-bar"><div class="ds-bar-fill" style="width:${pct}%;background:#16a34a"></div></div>
        <div class="ds-row"><span class="ds-label" style="color:#d00000">\u26A0\uFE0F \u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1E\u0E34\u0E01\u0E31\u0E14</span><span class="ds-val">${withoutGeo.toLocaleString("th-TH")} \u0E23\u0E32\u0E22</span></div>
      `;
    }
  },
  _setSub(msg) {
    const sub = document.getElementById("debt-summary-sub");
    if (sub) sub.textContent = msg;
  },
  // ===== Drill-down: show customers filtered by tier =====
  drillDown(type, value) {
    if (type === "tier") {
      const B = this.selBranch || "ALL";
      const customers = Storage.getActiveCustomers();
      const filtered = customers.filter((c) => {
        if (!c.cif || !DebtDB._loaded) return false;
        if (B !== "ALL" && String(c.branch || "").trim() !== B) return false;
        const debt = DebtDB.getByCif(c.cif);
        if (!debt) return false;
        return parseInt(debt.max_tier) === parseInt(value);
      });
      if (filtered.length === 0) {
        Utils.toast(`\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E0A\u0E31\u0E49\u0E19\u0E2B\u0E19\u0E35\u0E49 ${value}`);
        return;
      }
      App.switchSheetTab("customers");
      const searchInput = document.getElementById("customer-search");
      if (searchInput) {
        searchInput.value = "";
        Customers.renderList();
        Utils.toast(`\u{1F4CB} \u0E41\u0E2A\u0E14\u0E07\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E0A\u0E31\u0E49\u0E19 ${value}: ${filtered.length} \u0E23\u0E32\u0E22 \u2014 \u0E43\u0E0A\u0E49\u0E04\u0E49\u0E19\u0E2B\u0E32\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E01\u0E23\u0E2D\u0E07\u0E40\u0E1E\u0E34\u0E48\u0E21`);
      }
    }
  }
};
window.DebtSummary = DebtSummary;
