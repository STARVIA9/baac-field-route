// ===== Authentication (PIN code → JWT) =====

const Auth = {
  TOKEN_KEY: 'bfr_token',
  USER_KEY: 'bfr_user',
  PIN_TEAM: {
    '0000': { name: 'Admin', role: 'admin' },
    '1001': { name: 'สมชาย ใจดี', role: 'user' },
    '1002': { name: 'สมหญิง รักไทย', role: 'user' },
    '1003': { name: 'ประยุทธ์ มั่นคง', role: 'user' },
    '1004': { name: 'มาลี สดใส', role: 'user' },
  },

  // Get stored token
  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  // Get stored user info
  getUser() {
    try {
      return JSON.parse(localStorage.getItem(this.USER_KEY));
    } catch {
      return null;
    }
  },

  // Check if logged in
  isLoggedIn() {
    return !!this.getToken() && !!this.getUser();
  },

  // Logout
  logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    location.reload();
  },

  // Show login screen
  showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  },

  // Show main app
  showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    const user = this.getUser();
    if (user) {
      document.getElementById('user-name').textContent = `👤 ${user.name}`;
    }
  },

  // Login with PIN
  async login(pin) {
    // Try server first
    try {
      const data = await API.post('/api/auth/login', { pin });
      if (data.success) {
        localStorage.setItem(this.TOKEN_KEY, data.token);
        localStorage.setItem(this.USER_KEY, JSON.stringify(data.user));
        this.showApp();
        Utils.toast(`ยินดีต้อนรับคุณ ${data.user.name} 🌟`);
        return true;
      }
    } catch (err) {
      console.warn('Server login failed, trying local:', err);
    }

    // Fallback: local PIN check (offline mode)
    const user = this.PIN_TEAM[pin];
    if (user) {
      const token = 'offline_' + btoa(pin + ':' + Date.now());
      localStorage.setItem(this.TOKEN_KEY, token);
      localStorage.setItem(this.USER_KEY, JSON.stringify({ ...user, pin, offline: true }));
      this.showApp();
      Utils.toast(`ยินดีต้อนรับคุณ ${user.name} (offline) 🌟`);
      return true;
    }
    return false;
  },
};

window.Auth = Auth;
