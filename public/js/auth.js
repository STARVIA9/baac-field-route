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
    document.getElementById('login-screen').classList.remove('hidden');
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
    try {
      const data = await API.post('/api/login', { username, password });
      if (data.success) {
        localStorage.setItem(this.TOKEN_KEY, data.token);
        localStorage.setItem(this.USER_KEY, JSON.stringify(data.user));
        this.showApp();
        Utils.toast(`ยินดีต้อนรับคุณ ${data.user.name} 🌟`);
        return true;
      }
    } catch (err) {
      console.warn('Server login failed:', err);
    }
    return false;
  },

  // ===== Login with legacy PIN (fallback) =====
  async loginPIN(pin) {
    try {
      const data = await API.post('/api/login', { pin });
      if (data.success) {
        localStorage.setItem(this.TOKEN_KEY, data.token);
        localStorage.setItem(this.USER_KEY, JSON.stringify(data.user));
        this.showApp();
        Utils.toast(`ยินดีต้อนรับคุณ ${data.user.name} (PIN) 🌟`);
        return true;
      }
    } catch (err) {
      console.warn('PIN login failed:', err);
    }
    return false;
  },

  // ===== Check if current user is admin =====
  isAdmin() {
    const user = this.getUser();
    return user && user.role === 'admin';
  },
};

window.Auth = Auth;
