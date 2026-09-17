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
  // kmPerLiter: fixed. fuelPrice: loaded from /fuel-prices.json (Bangchak API)
    VEHICLE_PROFILES: {
    pickup: {
      name: "🛻 กระบะ",
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
      name: "🚗 รถเก๋ง",
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
      name: "🏍️ มอเตอร์ไซค์",
      kmPerLiter: 35,
      fuelPrice: 39.94,
      speed: {
        highway: 60,
        road: 40,
        village: 25,
        dirt: 15
      }
    },
  },
  _fuelPricesLoaded: false,
  _fuelUpdated: null,
  _fuelData: null,
  // Fetch live prices from static JSON (updated by cron)
  async loadFuelPrices() {
    try {
      const resp = await fetch('/fuel-prices.json?t=' + Date.now());
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
      console.log('[Fuel] Prices loaded:', new Date(data.updated).toLocaleDateString('th-TH'));
    } catch (e) {
      console.warn('[Fuel] Cannot load live prices, using defaults:', e.message);
    }
  },
  // Get fuel update date (e.g. "10/06/2569")
  getFuelUpdated() { return this._fuelUpdated; },
  // Get current fuel price for a vehicle type
  getFuelPrice(vehicleType) {
    const v = this.VEHICLE_PROFILES[vehicleType || this.getVehicle()];
    return v ? v.fuelPrice : null;
  },
  // Default vehicle: pickup (กระบะ)
  getVehicle() {
    const saved = localStorage.getItem('vehicle_profile');
    return saved && this.VEHICLE_PROFILES[saved]
      ? saved
      : 'pickup';
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

  // ===== iOS/Android keyboard guard =====
  // ปัญหา: element position:fixed; bottom:X อ้างอิง layout viewport เต็มจอ
  // แต่พอแป้นพิมพ์เปิดบนมือถือ visualViewport หด -> หน้าต่าง/ช่องพิมพ์โดนบัง
  // วิธีแก้: ฟัง visualViewport resize/scroll คำนวณความสูงแป้นพิมพ์ (--kb-h)
  // + ใส่ class keyboard-open บน <html> ให้ CSS ยก panel/modal ขึ้นพ้นแป้นพิมพ์
  initKeyboardGuard() {
    const vv = window.visualViewport;
    if (!vv || typeof vv.addEventListener !== 'function') return; // ไม่ support → ข้าม
    const root = document.documentElement;
    let raf = null;
    const update = () => {
      // ความสูงแป้นพิมพ์ = layout viewport − visual viewport (bottom-anchored)
      const kb = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));
      root.style.setProperty('--kb-h', kb.toFixed(0) + 'px');
      root.classList.toggle('keyboard-open', kb > 60);
    };
    vv.addEventListener('resize', () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = null; update(); });
    });
    // iOS Safari เลื่อน visualViewport เองตอนแป้นพิมพ์เปิด → ฟัง scroll ด้วย
    vv.addEventListener('scroll', update);
    // กัน focus input แล้ว keyboard ขึ้นช้า (delay ~300ms) คำนวณซ้ำรอบหนึ่ง
    window.addEventListener('focusin', () => setTimeout(update, 350));
    update();
  },

  // ===== Custom confirm dialog =====
  // ปัญหา: window.confirm() บน iOS Safari/WebKit ไม่แสดงป็อปอัพ
  // ขณะแป้นพิมพ์ยังเปิดอยู่ (และบางเวอร์ชัน return false ทันทีเงียบๆ)
  // → ใช้ modal ของแอปเองแทน ใช้ได้ทุกเครื่อง/ทุกจังหวะ
  // รับ: { title, message, confirmText, cancelText, danger }
  // คืน: Promise<boolean>
  confirmDialog({ title = 'ยืนยัน', message = '', confirmText = 'ยืนยัน', cancelText = 'ยกเลิก', danger = false } = {}) {
    return new Promise((resolve) => {
      // ปิดแป้นพิมพ์ก่อน (กัน iOS keyboard ค้างบัง modal ใหม่)
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }

      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      const card = document.createElement('div');
      card.className = 'confirm-card';
      const t = document.createElement('div');
      t.className = 'confirm-title';
      t.textContent = title;
      const m = document.createElement('div');
      m.className = 'confirm-msg';
      // \n ในข้อความ → ขึ้นบรรทัดใหม่ (เลียนแบบ confirm เดิม)
      m.style.whiteSpace = 'pre-line';
      m.textContent = message;
      const btns = document.createElement('div');
      btns.className = 'confirm-btns';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'confirm-btn cancel';
      cancelBtn.textContent = cancelText;
      const okBtn = document.createElement('button');
      okBtn.className = 'confirm-btn ok' + (danger ? ' danger' : '');
      okBtn.textContent = confirmText;

      btns.appendChild(cancelBtn);
      btns.appendChild(okBtn);
      card.appendChild(t);
      card.appendChild(m);
      card.appendChild(btns);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      // โฟกัสปุ่มยืนยันให้กด Enter ได้
      setTimeout(() => okBtn.focus(), 50);

      const done = (v) => {
        overlay.remove();
        resolve(v);
      };
      cancelBtn.addEventListener('click', () => done(false));
      okBtn.addEventListener('click', () => done(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
      document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); done(false); }
        if (e.key === 'Enter') { document.removeEventListener('keydown', onKey); done(true); }
      });
    });
  },
};

window.Utils = Utils;
