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
  // Realistic Thai market rates (km/liter) for common BAAC field vehicles
  VEHICLE_PROFILES: {
    motorcycle: { name: '🏍️ มอเตอร์ไซค์', kmPerLiter: 35, fuelPrice: 35 },  // ~35 baht/L gasohol 95
    car:        { name: '🚗 รถยนต์',       kmPerLiter: 12, fuelPrice: 35 },
    pickup:     { name: '🛻 กระบะ',        kmPerLiter: 10, fuelPrice: 35 },
    eco_car:    { name: '🚙 รถ Eco',       kmPerLiter: 18, fuelPrice: 35 },
  },
  // Default vehicle: motorcycle (most common for BAAC field officers)
  getVehicle() {
    const saved = localStorage.getItem('vehicle_profile');
    return saved && this.VEHICLE_PROFILES[saved]
      ? saved
      : 'motorcycle';
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
};

window.Utils = Utils;
