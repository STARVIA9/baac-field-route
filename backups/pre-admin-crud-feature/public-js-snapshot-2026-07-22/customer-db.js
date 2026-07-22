// ===== Customer Database — search from imported BAAC customer data =====

const CustomerDB = {
  _data: null,      // Full array
  _byCif: null,     // Map: CIF → record
  _loading: false,
  _loaded: false,

  // Load database from static JSON
  async load() {
    if (this._loaded) return this._data;
    if (this._loading) return this._data;
    this._loading = true;
    try {
      const res = await fetch('/customers-db.json');
      if (!res.ok) throw new Error('Failed to load customer database');
      this._data = await res.json();
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
    return this._data;
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
