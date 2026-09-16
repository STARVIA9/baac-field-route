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
        if (res.status === 401 && !this.isAuthPath(path)) {
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

  // ===== Login endpoints =====
  // 401 จากประตูเข้าสู่ระบบ = "PIN/รหัสผ่านผิด" ซึ่งเป็นคำตอบปกติ ไม่ใช่ session หมดอายุ
  // ถ้าเรียก Auth.logout() ตรงนี้ หน้าจะรีโหลดทันที แล้ว fallback ของผู้เรียก
  // (Auth.loginPIN → _tryLegacyAuth) จะไม่มีโอกาสทำงาน → ปุ่ม PIN เหมือนกดไม่ติด
  isAuthPath(path) {
    return typeof path === 'string'
      && (path.startsWith('/api/login') || path.startsWith('/api/auth/login'));
  },

  // POST แบบคืนทั้งสถานะและข้อความ — ใช้เมื่อต้องเอาข้อความ error จากเซิร์ฟเวอร์มาโชว์ตรง ๆ
  // (API.post โยน Error ที่มีแค่รหัส HTTP ผู้ใช้จึงเห็น "HTTP 400" แทนข้อความภาษาไทย)
  async postRaw(path, body) {
    const res = await fetch(this.baseUrl() + path, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    return { ok: res.ok, status: res.status, data };
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
  // ต้องส่งรหัสเครื่องไปด้วย ไม่งั้นเซิร์ฟเวอร์จะไม่รู้ว่าเส้นทางของเครื่องไหน
  async getAll(deviceId) {
    return this.get('/api/sync' + (deviceId ? '?device=' + encodeURIComponent(deviceId) : ''));
  },

  // Legacy single-customer sync (kept for back-compat)
  async syncCustomers(local) {
    return this.post('/api/customers/sync', { customers: local });
  },
};

window.API = API;
