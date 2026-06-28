// ===== Authentication — username/password + legacy PIN fallback =====

const Auth = {
  TOKEN_KEY: 'bfr_token',
  USER_KEY: 'bfr_user',

  // ===== Local storage helpers =====
  getToken() { return localStorage.getItem(this.TOKEN_KEY); },

  getUser() {
    try { return JSON.parse(localStorage.getItem(this.USER_KEY)); }
    catch { return null; }
  },

  isLoggedIn() { return !!this.getToken() && !!this.getUser(); },

  logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
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
  },

  // ===== Login with username/password (primary) =====
  async login(username, password) {
    // Try primary endpoint first
    let data;
    try {
      data = await API.post('/api/login', { username, password });
    } catch (err) {
      console.warn('Primary login failed:', err);
      // Fallback 1: legacy /api/auth/login (still works even if /api/login is broken)
      data = await this._tryLegacyAuth({ username, password });
      if (data?.success) return this._finalizeLogin(data, '🌟');
      Utils.toast('เซิร์ฟเวอร์ขัดข้อง — กรุณาลองใหม่หรือใช้ PIN');
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
