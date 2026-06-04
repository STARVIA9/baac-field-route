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
