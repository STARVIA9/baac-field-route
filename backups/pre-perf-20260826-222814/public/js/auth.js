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
