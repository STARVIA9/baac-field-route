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

  // DELETE request
  async del(path) {
    const res = await fetch(this.baseUrl() + path, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  },

  // Sync customers (push local changes to server)
  async syncCustomers(local) {
    return this.post('/api/customers/sync', { customers: local });
  },
};

window.API = API;
