// ===== Main App — orchestration + event handlers =====

// ===== Office location (single source of truth) =====
// Used as: initial map view, mini-map default, quick-route / route-planner
// start point. Update here and every screen picks it up automatically.
// Was previously hardcoded as Bangkok coords [13.7563, 100.5018] in 7 places
// — that's why the map kept centering on Bangkok even though the comment
// said "BAAC Wang Tha Chang".
const OFFICE_LOCATION = {
  lat: 13.7760801,
  lng: 101.8907475,
  name: 'BAAC สาขาวังท่าช้าง',
  accuracy: 50, // meters — used for the GPS pin accuracy circle
};
window.OFFICE_LOCATION = OFFICE_LOCATION;

const App = {
  // Known server version (updated on every fetch from version.json)
  _knownVersion: null,
  _versionCheckTimer: null,

  // Init
  async init() {
    // attachEvents + version watcher MUST bind even before login resolves.
    // afterLogin is async (network/sync) and can be slow or throw — if we await
    // it first, header/panel buttons (help/report/change-password/refresh/logout)
    // never get their listeners until login fully settles. Bind early instead.
    this.attachEvents();
    this.startVersionWatcher();
    // ยก panel/modal พ้นแป้นพิมพ์มือถือ (iOS keyboard guardian)
    if (typeof Utils !== 'undefined' && Utils.initKeyboardGuard) Utils.initKeyboardGuard();
    // แจ้งเตือนถ้าเพิ่งกดปุ่มอัปเดตแล้ว reload เสร็จ
    this._notifyUpdateCompleted();
    try {
      if (Auth.isLoggedIn()) {
        Auth.showApp();
        await this.afterLogin();
      } else {
        Auth.showLogin();
        // เปิดมาเจอช่อง PIN เลย — พนักงานใช้ PIN เป็นหลัก ไม่ต้องกด "เข้าสู่ระบบด้วย PIN" ก่อน
        try {
          document.getElementById('login-screen').classList.add('login-mode');
          const pinForm = document.getElementById('pin-form');
          if (pinForm) {
            pinForm.classList.remove('hidden');
            const toggleBtn = document.getElementById('toggle-pin-login');
            if (toggleBtn) toggleBtn.textContent = 'ซ่อน PIN';
          }
        } catch {}
      }
    } catch (e) {
      console.warn('[App.init] afterLogin error:', e?.message);
    }
  },

  // ===== แจ้งเตือน "อัปเดตเสร็จแล้ว" หลัง reload จากปุ่ม 🔄 =====
  _notifyUpdateCompleted() {
    const flag = sessionStorage.getItem('bfr_update_done');
    if (!flag) return;
    sessionStorage.removeItem('bfr_update_done');
    if (typeof Utils !== 'undefined' && Utils.toast) {
      setTimeout(() => {
        Utils.toast('✅ อัปเดตเว็บเป็นเวอร์ชันใหม่เรียบร้อย', 'success');
      }, 800);
    }
  },

  // ===== Version watcher (auto-detect new deploys) =====
  async fetchServerVersion() {
    try {
      const res = await fetch('/version.json?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.version || null;
    } catch (e) {
      return null;
    }
  },

  // ===== Show current version in header label =====
  _renderVersionLabel(ver) {
    const el = document.getElementById('version-label');
    if (!el) return;
    el.textContent = `v${ver}`;
    // กดที่ label = อัปเดตเป็นเวอร์ชันล่าสุดทันที
    if (!el.dataset.bound) {
      el.dataset.bound = '1';
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => App.applyUpdate());
    }
  },

  // ===== Initialize header components =====
  _initHeader() {
    // Set user avatar initial
    const user = Auth.getUser();
    if (user && user.name) {
      const initial = user.name.charAt(0).toUpperCase();
      const avatarEl = document.getElementById('avatar-initial');
      if (avatarEl) avatarEl.textContent = initial;
    }

    // More menu toggle
    const moreBtn = document.getElementById('more-menu-btn');
    const moreDropdown = document.getElementById('more-menu-dropdown');
    if (moreBtn && moreDropdown) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moreDropdown.classList.toggle('active');
      });
      
      // Close on outside click
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.header-more-menu')) {
          moreDropdown.classList.remove('active');
        }
      });
      
      // Close on item click
      moreDropdown.querySelectorAll('.more-menu-item').forEach(item => {
        item.addEventListener('click', () => {
          moreDropdown.classList.remove('active');
        });
      });
    }

    // Sync badge click
    const syncBadge = document.getElementById('sync-badge-header');
    if (syncBadge) {
      syncBadge.addEventListener('click', () => {
        if (typeof Storage !== 'undefined' && Storage.retrySync) {
          Storage.retrySync();
        }
      });
    }
  },

  async checkForUpdate() {
    const serverVer = await this.fetchServerVersion();
    if (!serverVer) return false;
    const stored = localStorage.getItem('app_version') || '0';
    const btn = document.getElementById('refresh-btn');
    const label = document.getElementById('version-label');
    if (serverVer !== stored && this._knownVersion !== null) {
      // New version detected (don't show on first load)
      if (btn) {
        btn.classList.add('has-update');
        btn.title = `เวอร์ชันใหม่ ${serverVer} พร้อมใช้งาน! (กดเพื่ออัพเดท)`;
      }
      if (label) {
        label.textContent = `v${serverVer}`;
        label.classList.add('has-update');
        label.title = 'เวอร์ชันใหม่พร้อมใช้งาน — กดเพื่ออัปเดต';
      }
      // ===== AUTO-UPDATE: สั่ง SW ใหม่เข้าควบคุมทันที =====
      // ไม่ต้องรอให้ผู้ใช้กดปุ่ม — เว็บอัปเดตตัวเองอัตโนมัติ
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
          if (reg.waiting) {
            // SW ใหม่กำลังรอ → สั่งเข้าควบคุมทันที
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          } else {
            // ตรวจหา SW ใหม่
            reg.update();
          }
        });
      }
      // Auto-notify with banner (auto-reload after 8 seconds — fallback ถ้า SW ไม่ reload)
      if (!this._updateNotified && typeof Utils !== 'undefined') {
        this._updateNotified = true;
        this._showUpdateToast(serverVer);
      }
      return true;
    }
    if (btn) {
      btn.classList.remove('has-update');
      btn.title = 'กดเพื่ออัปเดตเว็บเป็นเวอร์ชันล่าสุด (เคลียร์ cache)';
    }
    if (label) {
      label.classList.remove('has-update');
      label.textContent = `v${stored}`;
      label.title = 'เวอร์ชันปัจจุบันของเว็บ';
    }
    return false;
  },

  _showUpdateToast(newVer) {
    // Build a persistent toast banner at top of screen
    const existing = document.getElementById('update-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
      background: #0a8f3c; color: #fff; text-align: center;
      padding: 12px 16px; font-size: 15px; font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      cursor: pointer; display: flex; align-items: center;
      justify-content: center; gap: 10px;
    `;
    banner.innerHTML = `
      <span>🔄 อัปเดตเวอร์ชัน ${newVer} — กดเพื่อโหลดใหม่ทันที</span>
      <span style="background:rgba(255,255,255,0.2);padding:4px 10px;border-radius:4px;font-size:13px" id="update-countdown">⏳ 8 วิ</span>
    `;
    banner.addEventListener('click', () => {
      if (typeof App !== 'undefined') App.applyUpdate();
    });
    document.body.prepend(banner);

    // Countdown then auto-reload
    let sec = 8;
    const countEl = document.getElementById('update-countdown');
    this._updateTimer = setInterval(() => {
      sec--;
      if (countEl) countEl.textContent = `⏳ ${sec} วิ`;
      if (sec <= 0) {
        clearInterval(this._updateTimer);
        if (typeof App !== 'undefined') App.applyUpdate();
      }
    }, 1000);
  },

  startVersionWatcher() {
    // Set known version on first load
    this.fetchServerVersion().then(v => {
      if (v) {
        this._knownVersion = v;
        localStorage.setItem('app_version', v);
        this._renderVersionLabel(v);
      }
    });
    // Check every 60 seconds (เร็วขึ้นจาก 5 นาที)
    if (this._versionCheckTimer) clearInterval(this._versionCheckTimer);
    this._versionCheckTimer = setInterval(() => this.checkForUpdate(), 60 * 1000);
    // Also re-check when tab regains focus
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.checkForUpdate();
    });
    // ===== AUTO-UPDATE: เมื่อ SW ใหม่เข้าควบคุม → reload อัตโนมัติ =====
    // ไม่ต้องรอให้ผู้ใช้กดปุ่ม — เว็บอัปเดตตัวเองทันที
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // SW ใหม่เข้าควบคุมแล้ว → reload หน้า (ใช้ flag กัน reload ซ้ำ)
        if (!this._swReloading) {
          this._swReloading = true;
          sessionStorage.setItem('bfr_update_done', '1');
          window.location.reload();
        }
      });
    }
  },

  // After login — load data
  async afterLogin() {
    // Phase 1: Migrate old customers to new schema (riskLevel + debtType)
    Storage.migrateCustomers();

    // Initialize header components (avatar, more menu, sync badge)
    this._initHeader();

    Customers.initMap();
    // Initial load: NO fitBounds — เปิดมาเห็นจังหวัดปราจีนบุรี zoom 12 ตาม default
    // (fitBounds ดัน view ไปยึด marker GPS ทั้งหมด ทำให้ไม่เห็นภาพรวมจังหวัด)
    Customers.renderAll();
    Visit.render();
    Route.attachEvents();
    this.updateRouteUI();
    this.updateAdminUI();
    // Init bottom sheet (map-as-canvas mode)
    this.initBottomSheet();
    this.renderTodayRoute();

    // Load customer database (async, non-blocking)
    CustomerDB.load();
    // Load debt database (ข้อมูลหนี้ Customer Indicator) — async, non-blocking
    if (typeof DebtDB !== 'undefined') {
      DebtDB.load().then(() => {
        if (Customers.initDebtFilter) Customers.initDebtFilter();
        // re-render ให้ popup/รายชื่อที่โชว์ "กำลังโหลด..." อัปเดตเป็นข้อมูลจริง
        if (Customers.renderAll) Customers.renderAll();
      }).catch(() => {});
    }

    // Init floating map search bar (Google Maps-style)
    if (typeof MapSearch !== 'undefined') MapSearch.init();
    // Q-FILTER 8ก.ย.69: แผงตัวกรองพับได้ (default พับเหลือแค่ค้นหา)
    if (typeof FilterPanel !== 'undefined') FilterPanel.init();

    // Auto-import static DB on first run (empty localStorage — new device / cleared cache)
    if (Storage.getCustomers().length === 0) {
      try {
        const r = await Storage.importFromStaticDB();
        if (r && r.imported > 0) {
          Customers.renderAll(undefined, { fitBounds: true });
          Utils.toast(`📥 โหลดลูกค้า ${r.imported} รายการจากฐานข้อมูลกลาง (${r.withGPS} มีพิกัด)`);
        }
      } catch (e) {
        console.warn('[afterLogin] auto-import failed:', e.message);
      }
    } else {
      // Existing device: re-apply server GPS overlay so coords match the web
      // (server-authoritative — uploaded coords overwrite this device's copy)
      try {
        const n = await Storage.applyGpsOverlay();
        if (n > 0) {
          Customers.renderAll();
          Utils.toast(`📍 อัพเดทพิกัดจากเว็บ ${n} รายการ`);
        }
      } catch (e) {
        console.warn('[afterLogin] gps-overlay apply failed:', e.message);
      }
    }

    // Initial sync (push local + pull remote)
    const sync = await Storage.sync();
    if (sync && sync.success) {
      const c = sync.counts || {};
      Utils.toast(`☁️ Sync: ${c.customers ?? 0} ลูกค้า, ${c.visits ?? 0} visits, ${c.savedRoutes ?? 0} เส้นทาง`);
      Customers.renderAll();
      this.updateRouteUI();
    } else if (sync && sync.error) {
      Utils.toast('⚠️ Sync ไม่สำเร็จ — ใช้ข้อมูล local', 'warn');
    }

    // Start real-time polling — 20 วิ/รอบ (เดิม 60): เครื่องอื่นเห็นหมุด/ข้อมูลใหม่ไวกว่า
    // ต้นทุนจริง ~1 rows_read/รอบ ตอนไม่มีข้อมูลใหม่ (etag cache hit) → ยังห่างโควตา D1 5M/วันมาก
    this._wireSyncEvents();
    Storage.startPolling(20000);
    // กลับเข้าแอป / เน็ตกลับมา → เช็คข้อมูลใหม่ทันที ไม่ต้องรอรอบถัดไป
    if (!this._pollNowBound) {
      this._pollNowBound = true;
      const pollNow = () => { if (!document.hidden && navigator.onLine) Storage.pollOnce(); };
      document.addEventListener('visibilitychange', () => { if (!document.hidden) pollNow(); });
      window.addEventListener('focus', pollNow);
      // เน็ตกลับมา → ส่งงานที่ทำค้างไว้ในเครื่องก่อน แล้วค่อยเช็คของใหม่
      // (เดิมทำแค่ poll = ดึงของใหม่ งานที่ปักหมุด/บันทึกตอนเน็ตหลุดไม่ถูกส่งขึ้นเว็บ
      //  จนกว่าจะมีการบันทึกครั้งถัดไป — ถ้าเครื่อง/เบราว์เซอร์ล้างข้อมูลก็หายถาวร)
      window.addEventListener('online', async () => {
        if (!navigator.onLine) return;
        const pending = Storage.pendingCount();
        if (pending > 0) Utils.toast(`📤 เน็ตกลับมาแล้ว — กำลังส่งงานค้าง ${pending} รายการ`);
        const res = await Storage.push();
        if (res && res.success) {
          Storage.clearAllDirty();   // ส่งขึ้นเว็บครบแล้ว → ล้างตัวนับงานค้าง
          if (pending > 0) Utils.toast(`✅ ส่งงานค้างขึ้นเว็บแล้ว ${pending} รายการ`);
        } else if (res && res.error) {
          Utils.toast('⚠️ ยังส่งงานค้างไม่สำเร็จ — จะลองใหม่เมื่อเน็ตกลับมา', 'error');
        }
        pollNow();
      });
    }

    // ป๊อบอัพถามก่อนว่า "วันนี้ทำอะไร" (จำไว้ไม่ถามอีกได้)
    this.showStartModePopup();

    // Deep link: เปิด baacroute.shop/#debtsummary → ข้ามไปแท็บสรุปหนี้ทันทีหลัง login
    try {
      if (typeof location !== 'undefined' && location.hash === '#debtsummary') {
        this.switchSheetTab('debtsummary');
        if (window.DebtSummary) DebtSummary.render();
      }
    } catch (e) { /* ไม่ขวาง login */ }
  },

  // ===== ป๊อบอัพ "วันนี้ทำอะไร" — โผล่หลัง login (ข้ามได้ถ้าเคยติ๊กจำไว้) =====
  // force=true = เปิดจากเมนู "🏠 เริ่มตรงนี้" (ข้ามธงจำไว้ได้)
  showStartModePopup(force) {
    try {
      if (!force && localStorage.getItem('bfr_start_mode_skip') === '1') return;
      if (document.getElementById('start-mode-overlay')) return;
    } catch { return; }
    const overlay = document.createElement('div');
    overlay.id = 'start-mode-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:360px;width:100%;padding:24px 20px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.3);">
        <div style="font-size:20px;font-weight:700;margin-bottom:4px;">วันนี้ทำอะไร?</div>
        <div style="font-size:14px;color:#666;margin-bottom:14px;">เลือกแล้วเว็บพาไปหน้านั้นเลย</div>
        <button data-mode="gps" style="display:block;width:100%;margin:8px 0;padding:14px;min-height:56px;border-radius:12px;border:1px solid #ddd;background:#f1f8f1;font-size:18px;cursor:pointer;">📍 ดูลูกค้า / เก็บพิกัด</button>
        <button data-mode="route" style="display:block;width:100%;margin:8px 0;padding:14px;min-height:56px;border-radius:12px;border:1px solid #ddd;background:#eef4ff;font-size:18px;cursor:pointer;">🧭 ออกพื้นที่</button>
        <button data-mode="summary" style="display:block;width:100%;margin:8px 0;padding:14px;min-height:56px;border-radius:12px;border:1px solid #ddd;background:#fff8ec;font-size:18px;cursor:pointer;">📊 ดูสรุป</button>
        <button data-close="1" style="display:block;width:100%;margin:8px 0 0;padding:12px;min-height:50px;border-radius:12px;border:1px solid #ccc;background:#fff;font-size:16px;color:#555;cursor:pointer;">ไว้ทีหลัง ✕</button>
        <label style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;font-size:14px;color:#666;cursor:pointer;min-height:44px;">
          <input type="checkbox" id="start-mode-remember" style="width:22px;height:22px;"> จำไว้ ไม่ถามอีก
        </label>
      </div>`;
    const close = (mode) => {
      try {
        if (overlay.querySelector('#start-mode-remember')?.checked && mode) {
          localStorage.setItem('bfr_start_mode_skip', '1');
          localStorage.setItem('bfr_start_mode', mode);
        }
      } catch {}
      overlay.remove();
      if (mode === 'gps') this.switchTab('customers');
      else if (mode === 'route') this.switchSheetTab('plan');
      else if (mode === 'summary') this.switchSheetTab('debtsummary');
    };
    overlay.querySelectorAll('button[data-mode]').forEach(b => {
      b.addEventListener('click', () => close(b.dataset.mode));
    });
    overlay.querySelector('button[data-close]')?.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  },

  // Listen for sync events to update UI badge
  _wireSyncEvents() {
    this._unsubSync = Storage.onSyncEvent((evt) => {
      this._updateSyncBadge(evt);
      if (evt.status === 'synced' && evt.counts) {
        // Re-render to show new data
        Customers.renderAll();
        if (typeof Visit !== 'undefined') Visit.render();
        this.updateRouteUI();
      }
    });
  },

  // ให้ส่วนอื่นสั่งสถานะบนจอได้ (saving = กำลังบันทึก, saved = เสร็จแล้ว, error)
  // ใช้ป้ายลอยมุมขวาล่างตัวเดียวกับ sync badge
  setSaveStatus(state) {
    try {
      if (state === 'saving') this._updateSyncBadge({ status: 'saving' });
      else if (state === 'saved') this._updateSyncBadge({ status: 'saved' });
      else this._updateSyncBadge({ status: 'error', error: 'save-failed' });
    } catch (e) { /* ไม่ขวางการบันทึก */ }
  },

  _updateSyncBadge(evt) {
    let badge = document.getElementById('sync-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'sync-badge';
      badge.style.cssText = 'position:fixed;bottom:8px;right:8px;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600;z-index:9999;background:#4caf50;color:white;box-shadow:0 2px 6px rgba(0,0,0,0.2);transition:opacity 0.3s;cursor:pointer;';
      badge.title = 'กดเพื่อ retry sync';
      badge.addEventListener('click', () => Storage.retrySync());
      document.body.appendChild(badge);
    }
    badge.style.display = '';
    if (evt.status === 'saving') {
      badge.textContent = '⏳ กำลังบันทึกพิกัด...';
      badge.style.background = '#ff9800';
      badge.style.cursor = 'wait';
    } else if (evt.status === 'saved') {
      badge.textContent = '✅ บันทึกพิกัดแล้ว';
      badge.style.background = '#4caf50';
      badge.style.cursor = 'pointer';
      // ซ่อนเองใน 5 วิ (ไม่ให้ป้ายบังจอ)
      clearTimeout(this._badgeHideTimer);
      this._badgeHideTimer = setTimeout(() => {
        const b = document.getElementById('sync-badge');
        if (b && b.textContent.indexOf('✅ บันทึกพิกัด') === 0) b.style.display = 'none';
      }, 5000);
    } else if (evt.status === 'syncing') {
      badge.textContent = evt.action === 'retry' ? '🔄 กำลัง sync ใหม่...' : '🔄 Syncing...';
      badge.style.background = '#ff9800';
      badge.style.cursor = 'wait';
    } else if (evt.status === 'synced' && evt.counts) {
      const c = evt.counts;
      badge.textContent = `☁️ Sync: ${c.customers ?? 0} คน, ${c.visits ?? 0} visits`;
      badge.style.background = '#4caf50';
      badge.style.cursor = 'pointer';
    } else if (evt.status === 'error') {
      badge.textContent = '⚠️ Sync ล้มเหลว — กดเพื่อลองใหม่';
      badge.style.background = '#f44336';
      badge.style.cursor = 'pointer';
    }
  },

  // Called by Storage when remote data changes — re-render
  _onRemoteUpdate(remote) {
    Customers.renderAll();
    if (typeof Visit !== 'undefined') Visit.render();
    this.updateRouteUI();
  },

  // Attach all event handlers (null-safe — missing elements won't crash the rest)
  attachEvents() {
    const $ = (id) => document.getElementById(id);
    const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };

    // Login form (username/password)
    on('login-form', 'submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      const errEl = document.getElementById('login-error');
      errEl.textContent = '';
      const btn = document.getElementById('login-btn');
      
      // Show loading state
      setLoginLoading(btn, true);
      
      const ok = await Auth.login(username, password);
      if (ok) {
        // Save remember me preference
        saveRememberMe(username);
        await this.afterLogin();
      } else {
        errEl.textContent = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
      }
      
      // Hide loading state
      setLoginLoading(btn, false);
      btn.textContent = 'เข้าสู่ระบบ';
    });

    // PIN fallback toggle
    on('toggle-pin-login', 'click', () => {
      const pinForm = document.getElementById('pin-form');
      const toggleBtn = document.getElementById('toggle-pin-login');
      if (!pinForm || !toggleBtn) return;
      pinForm.classList.toggle('hidden');
      toggleBtn.textContent = pinForm.classList.contains('hidden') ? 'เข้าสู่ระบบด้วย PIN' : 'ซ่อน PIN';
      if (!pinForm.classList.contains('hidden')) {
        setTimeout(() => { const pi = document.getElementById('pin-input'); if (pi) pi.focus(); }, 100);
      }
    });

    // PIN form (legacy fallback)
    on('pin-form', 'submit', async (e) => {
      e.preventDefault();
      const pin = document.getElementById('pin-input').value;
      const errEl = document.getElementById('pin-error');
      errEl.textContent = '';
      const btn = document.getElementById('pin-btn');
      setLoginLoading(btn, true);
      const ok = await Auth.loginPIN(pin);
      if (ok) { await this.afterLogin(); } else { errEl.textContent = 'PIN ไม่ถูกต้อง'; }
      setLoginLoading(btn, false);
      btn.textContent = 'เข้าสู่ระบบ (PIN)';
    });

    // Logout
    on('logout-btn', 'click', () => { if (confirm('ออกจากระบบ?')) Auth.logout(); });

    // 🏠 เปิดป๊อบอัพ "วันนี้ทำอะไร" อีกครั้ง (จากเมนู ⋮ — กันคนติ๊ก "จำไว้" แล้วหลง)
    on('start-mode-btn', 'click', () => this.showStartModePopup(true));

    // Admin buttons
    on('admin-users-btn', 'click', () => this.openAdminUsers());
    on('admin-data-btn', 'click', () => { window.location.href = '/admin.html'; });

    // Change password
    on('change-password-btn', 'click', () => this.openChangePassword());
    on('close-change-password', 'click', () => { const m = document.getElementById('change-password-modal'); if (m) m.classList.add('hidden'); });
    on('change-password-modal', 'click', (e) => { if (e.target.id === 'change-password-modal') e.target.classList.add('hidden'); });
    on('change-password-form-standalone', 'submit', (e) => { e.preventDefault(); this.submitChangePasswordStandalone(); });
    on('change-password-form', 'submit', (e) => { e.preventDefault(); this.submitChangePassword(); });

    // === Sheet tabs ===
    document.querySelectorAll('.sheet-tab').forEach(t => {
      t.addEventListener('click', () => this.switchSheetTab(t.dataset.sheet));
    });

    // Customer search
    const customerSearch = document.getElementById('customer-search');
    if (customerSearch) {
      customerSearch.addEventListener('input', Utils.debounce(() => Customers.renderList(), 150));
    }

    // Customer sort
    const customerSort = document.getElementById('customer-sort');
    if (customerSort) {
      customerSort.addEventListener('change', () => Customers.renderList());
    }

    // Zone filter (เขตสินเชื่อ — T3)
    const customerZone = document.getElementById('customer-zone');
    if (customerZone) {
      customerZone.addEventListener('change', () => Customers.renderList());
    }

    // FAB buttons
    on('fab-add-customer', 'click', () => this.openAddCustomerModal());
    on('fab-my-location', 'click', () => this.useGPS());

    // Zoom controls (custom — replaces hidden top-left Leaflet control)
    on('fab-zoom-in', 'click', () => Customers.map && Customers.map.zoomIn());
    on('fab-zoom-out', 'click', () => Customers.map && Customers.map.zoomOut());

    // Modal close
    on('close-add-modal', 'click', () => this.closeAddCustomerModal());
    on('add-customer-modal', 'click', (e) => { if (e.target.id === 'add-customer-modal') this.closeAddCustomerModal(); });

    // GPS button
    on('btn-use-gps', 'click', () => this.useGPS(true));

    // Pick on main map
    on('btn-pick-on-main-map', 'click', () => this.pickOnMainMap());

    // Add customer form
    on('add-customer-form', 'submit', (e) => {
      e.preventDefault();
      this.saveCustomer(e.target);
    });
    // Photo upload (capture or file)
    const photoInput = document.getElementById('photo-input');
    if (photoInput) {
      photoInput.addEventListener('change', (e) => this.handlePhotoUpload(e.target.files[0]));
    }

    // Customer DB search
    this._initDBSearch();

    // Visit modal
    on('close-visit-modal', 'click', () => Visit.closeLog());
    on('btn-cancel-visit', 'click', () => Visit.closeLog());
    on('visit-log-form', 'submit', (e) => { e.preventDefault(); Visit.submit(e.target); });
    on('visit-log-modal', 'click', (e) => { if (e.target.id === 'visit-log-modal') Visit.closeLog(); });
    on('btn-capture-gps', 'click', () => Visit.captureGPS());

    // Route: start mode
    on('route-start-mode', 'change', (e) => { const cs = document.getElementById('custom-start'); if (cs) cs.classList.toggle('hidden', e.target.value !== 'custom'); });

    // Calculate route
    on('btn-calculate-route', 'click', () => this.calculateRoute());

    // Open Google Maps
    on('btn-open-gmaps', 'click', () => Route.openGoogleMaps());

    // Save route
    on('btn-save-route', 'click', () => Route.saveRoute());

    // Report + Help modals
    on('report-btn', 'click', () => Report.open());
    on('help-btn', 'click', () => App.openHelp());
    on('close-help-modal', 'click', () => App.closeHelp());
    on('btn-close-help', 'click', () => App.closeHelp());
    on('close-report-modal', 'click', () => Report.close());
    on('report-modal', 'click', (e) => { if (e.target.id === 'report-modal') Report.close(); });
    on('report-range', 'change', () => { const rr = document.getElementById('report-range'); if (rr) Report.setRange(rr.value); });
    on('btn-generate-report', 'click', () => Report.generate());
    on('btn-export-html', 'click', () => Report.exportHTML());
    on('btn-export-pdf', 'click', () => Report.exportPDF());
    on('btn-export-csv', 'click', () => Report.exportCSV());
    on('btn-export-share', 'click', () => Report.shareText());
  },

  // ===== Bottom Sheet (Map-as-Canvas) =====

  // Init sheet interaction (drag + click handle)
  initBottomSheet() {
    const sheet = document.getElementById('bottom-sheet');
    if (!sheet) return;

    // Click handle to toggle peek/half
    document.getElementById('sheet-handle').addEventListener('click', (e) => {
      e.stopPropagation();
      if (sheet.classList.contains('sheet-half') || sheet.classList.contains('sheet-full')) {
        this.setSheetState('peek');
      } else {
        this.setSheetState('half');
      }
    });

    // Drag interaction — handle ONLY. Content always scrolls freely.
    let startY = 0, startTranslate = 0, isDragging = false;
    const handle = document.getElementById('sheet-handle');

    const _readTransform = (el) => {
      const m = window.getComputedStyle(el).transform;
      if (m && m !== 'none') {
        const vals = m.split(/[(),\s]+/).filter(v => v !== '');
        const idx = m.startsWith('matrix3d') ? 13 : 5;
        return parseFloat(vals[idx]) || 0;
      }
      return 0;
    };

    const onStart = (e) => {
      // ลากได้ทั้งแถบ handle (ส่วนหัวปัจจุบัน) — คลิกตรงไหนก็ลากได้ ไม่แน่นเกินไป
      if (!e.target.closest('.sheet-handle')) return;
      isDragging = true;
      startY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
      startTranslate = _readTransform(sheet);
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${startTranslate}px)`;
      ['sheet-collapsed','sheet-peek','sheet-half','sheet-full'].forEach(c => sheet.classList.remove(c));
    };

    const onMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const y = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
      const dy = y - startY;
      const newT = Math.max(0, startTranslate + dy);
      sheet.style.transform = `translateY(${newT}px)`;
    };

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      sheet.style.transition = '';
      const t = _readTransform(sheet);
      sheet.style.transform = '';
      const sheetH = sheet.offsetHeight;
      const pct = t / sheetH;
      if (pct < 0.15) this.setSheetState('full');
      else if (pct < 0.55) this.setSheetState('half');
      else if (pct < 0.85) this.setSheetState('peek');
      else this.setSheetState('collapsed');
    };

    handle.addEventListener('touchstart', onStart, {passive: true});
    handle.addEventListener('touchmove', onMove, {passive: false});
    handle.addEventListener('touchend', onEnd);
    handle.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
  },

  // Set bottom sheet state
  setSheetState(state) {
    const sheet = document.getElementById('bottom-sheet');
    if (!sheet) return;
    ['sheet-collapsed','sheet-peek','sheet-half','sheet-full'].forEach(c => sheet.classList.remove(c));
    if (state && state !== 'default') sheet.classList.add('sheet-' + state);
    // Q-FILTER 8ก.ย.69: แถบล่างสำคัญ (half/full) → พับแผงบนอัตโนมัติ กันบังจอเล็ก
    if ((state === 'half' || state === 'full') && typeof FilterPanel !== 'undefined' && FilterPanel.collapse) {
      FilterPanel.collapse();
    }
    // Q2 FIX: ไม่ซ่อน FAB — CSS ยกตำแหน่งขึ้นตามความสูง sheet (body:has selector)
    
    // Haptic feedback on state change (if supported)
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  },

  // Legacy switchTab — adapts to new map-as-canvas layout
  switchTab(name) {
    if (name === 'map') {
      this.setSheetState('peek');
      this.switchSheetTab('route');
      setTimeout(() => Customers.map && Customers.map.invalidateSize(), 50);
      return;
    }
    const sheetNames = { customers: 'customers', route: 'route', visit: 'visit' };
    this.switchSheetTab(sheetNames[name] || name);
    this.setSheetState('half');
  },

  // Switch bottom sheet content tab
  switchSheetTab(name) {
    document.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sheet-content').forEach(p => p.classList.remove('active'));
    const tab = document.querySelector(`.sheet-tab[data-sheet="${name}"]`);
    if (tab) tab.classList.add('active');
    const idMap = { route: 'sheet-route', customers: 'tab-customers', plan: 'tab-route', visit: 'tab-visit', debtsummary: 'sheet-debtsummary' };
    const pane = document.getElementById(idMap[name] || 'sheet-route');
    if (pane) pane.classList.add('active');
    if (name !== 'route') this.setSheetState('half');
    // วาดเนื้อหาใหม่ทุกครั้งที่เปิดแท็บ — เดิมสลับแค่คลาส CSS ทำให้เปิดแท็บ "เข้าพบ"/"ลูกค้า"
    // แล้วเห็นหน้าว่างทั้งที่มีข้อมูล (ต้องเรียก render เองจากที่อื่นถึงจะขึ้น)
    if (name === 'visit' && typeof Visit !== 'undefined') Visit.render();
    if (name === 'customers' && typeof Customers !== 'undefined') Customers.renderList();
    // Render debt summary เมื่อเปิดแท็บสรุปหนี้
    if (name === 'debtsummary' && typeof DebtDB !== 'undefined' && DebtDB._loaded && window.DebtSummary) {
      DebtSummary.render();
    }
  },

  // Render today's visits in the route pane
  renderTodayRoute() {
    const container = document.getElementById('today-visits');
    if (!container) return;

    const customers = Storage.getActiveCustomers();
    const routeIds = Storage.getRoute();
    const routeCusts = routeIds.map(id => customers.find(c => c.id === id)).filter(Boolean);

    if (!routeCusts.length) {
      container.innerHTML = '<p class="empty-state">ไม่มีเส้นทางวันนี้ — ไปที่ <strong>วางแผน</strong> เพื่อสร้างเส้นทาง</p>';
      this._updateRouteProgress(null);
      return;
    }

    // Use calculated result order if available
    const result = Route.currentResult;
    let ordered = routeCusts;
    if (result && result.stops && result.stops.length > 0) {
      ordered = result.stops;
    }

    // Check visits for pending/completed status
    const visits = Storage.getVisits();
    const visitedCifs = new Set(Object.keys(visits));
    const pending = ordered.filter(c => !visitedCifs.has(c.cif || c.id));

    let html = '<div class="visits-list">';
    ordered.forEach((c, i) => html += this._visitCard(c, i + 1));
    html += '</div>';

    container.innerHTML = html;

    // Click on visit card → open visit modal
    container.querySelectorAll('.visit-card').forEach(card => {
      card.addEventListener('click', () => {
        const cif = card.dataset.cif;
        const id = card.dataset.id;
        if (window.Visit && typeof Visit.openForCustomer === 'function') {
          Visit.openForCustomer(cif || id);
        }
      });
    });

    // Update header progress
    const done = ordered.length - pending.length;
    if (result && result.distance) {
      document.getElementById('route-progress').textContent = `${done}/${ordered.length} · ${Utils.formatKm(result.distance)}`;
    } else {
      document.getElementById('route-progress').textContent = `${done}/${ordered.length} ✅`;
    }
  },

  // Render a single visit card (used by renderTodayRoute)
  _visitCard(c, order) {
    const name = c.name || c.customerName || 'ไม่ระบุชื่อ';
    const branch = c.branch || '';
    // Check if visited
    const visits = Storage.getVisits();
    const visited = visits[c.cif || c.id];
    const debtType = c.debtType || '';
    let badge = '';
    if (visited) {
      badge = '<span class="visit-badge" style="background:#d1fae5;color:#065f46">✅ เยี่ยมแล้ว</span>';
    } else if (debtType === 'overdue') {
      badge = '<span class="visit-badge badge-overdue">⚠️ ค้าง</span>';
    } else if (debtType === 'current') {
      badge = '<span class="visit-badge badge-current">📅 ถึงกำหนด</span>';
    }
    const lat = c.lat || c.latitude || '';
    const lng = c.lng || c.longitude || '';
    const dist = (lat && lng) ? '' : '';
    return `<div class="visit-card" data-cif="${this.escapeHTML(c.cif || '')}" data-id="${this.escapeHTML(c.id || '')}">
      <div class="visit-order">${order}</div>
      <div class="visit-info">
        <div class="visit-name">${this.escapeHTML(name)}</div>
        <div class="visit-branch">${this.escapeHTML(branch)}</div>
      </div>
      <div class="visit-meta">
        ${badge}
      </div>
    </div>`;
  },

  // Update route progress badge in overlay header
  _updateRouteProgress(stats) {
    const el = document.getElementById('route-progress');
    if (!el) return;
    if (!stats) { el.textContent = ''; return; }
    el.textContent = `${stats.completed || 0}/${stats.total} ✅`;
  },

  // Open add customer modal
  openAddCustomerModal() {
    document.getElementById('add-customer-modal').classList.remove('hidden');
    document.getElementById('add-modal-title').textContent = '➕ เพิ่มลูกค้าใหม่';
    const form = document.getElementById('add-customer-form');
    // จำพิกัดไว้ก่อน reset (กันทับพิกัดที่จิ้มมาจากแผนที่หลัก)
    const latKeep = document.getElementById('new-lat').value;
    const lngKeep = document.getElementById('new-lng').value;
    form.dataset.editId = '';
    form.reset();
    if (latKeep && lngKeep) {
      document.getElementById('new-lat').value = latKeep;
      document.getElementById('new-lng').value = lngKeep;
    }
    this._resetPhotoPreview();
    // Reset DB search
    const dbInput = document.getElementById('db-search-input');
    const dbResults = document.getElementById('db-search-results');
    const dbInfo = document.getElementById('db-filled-info');
    if (dbInput) dbInput.value = '';
    if (dbResults) { dbResults.innerHTML = ''; dbResults.classList.remove('active'); }
    if (dbInfo) { dbInfo.innerHTML = ''; dbInfo.classList.remove('active'); }
    this._renderAddGpsDisplay();
    // Init mini-map after modal visible
    if (latKeep && lngKeep) {
      const la = parseFloat(latKeep), ln = parseFloat(lngKeep);
      setTimeout(() => this.initMiniMap(isNaN(la) ? undefined : la, isNaN(ln) ? undefined : ln), 100);
    } else {
      setTimeout(() => this.initMiniMap(), 100);
    }
  },

  // ===== Photo upload (capture/file → resize → base64) =====
  _resetPhotoPreview() {
    const preview = document.getElementById('photo-preview');
    const dataInput = document.getElementById('photo-data');
    const removeBtn = document.getElementById('btn-remove-photo');
    if (preview) preview.innerHTML = '<div class="photo-empty">📷 ยังไม่มีรูป — แตะเพื่อเลือก/ถ่าย</div>';
    if (dataInput) dataInput.value = '';
    if (removeBtn) removeBtn.classList.add('hidden');
  },

  _showPhotoPreview(dataUrl) {
    const preview = document.getElementById('photo-preview');
    const dataInput = document.getElementById('photo-data');
    const removeBtn = document.getElementById('btn-remove-photo');
    if (preview) {
      preview.innerHTML = `<img src="${dataUrl}" alt="customer photo" class="photo-img">`;
    }
    if (dataInput) dataInput.value = dataUrl;
    if (removeBtn) removeBtn.classList.remove('hidden');
    // เปิดกล่องรูปให้เห็นรูปที่เลือก
    const details = document.querySelector('#add-customer-modal .photo-details');
    if (details) details.open = true;
  },

  // Resize image to max 800px, JPEG quality 0.7 → base64 dataURL
  async _resizeImage(file, maxSize = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = Math.round(height * (maxSize / width));
              width = maxSize;
            } else {
              width = Math.round(width * (maxSize / height));
              height = maxSize;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          // Always output JPEG to keep size small
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  async handlePhotoUpload(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      Utils.toast('กรุณาเลือกไฟล์รูปภาพ', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      Utils.toast('รูปใหญ่เกิน 10MB — กรุณาเลือกรูปอื่น', 'error');
      return;
    }
    Utils.toast('📷 กำลังย่อรูป...');
    try {
      const dataUrl = await this._resizeImage(file, 800, 0.7);
      const sizeKB = Math.round(dataUrl.length * 0.75 / 1024);
      this._showPhotoPreview(dataUrl);
      Utils.toast(`✅ ย่อรูปเสร็จ (~${sizeKB} KB)`);
    } catch (err) {
      Utils.toast('ไม่สามารถประมวลผลรูปได้: ' + err.message, 'error');
    }
  },

  removePhoto() {
    this._resetPhotoPreview();
    const fileInput = document.getElementById('photo-input');
    if (fileInput) fileInput.value = '';
    Utils.toast('🗑️ ลบรูปแล้ว');
  },

  // ===== Help modal — explain how to use the app =====
  openHelp() {
    document.getElementById('help-modal').classList.remove('hidden');
  },
  closeHelp() {
    document.getElementById('help-modal').classList.add('hidden');
  },

  // ===== Customer DB Search (auto-fill from imported data) =====
  _initDBSearch() {
    const input = document.getElementById('db-search-input');
    const results = document.getElementById('db-search-results');
    if (!input || !results) return;

    let debounceTimer = null;
    let highlightIdx = -1;

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const q = input.value.trim();
        if (q.length < 2) {
          results.classList.remove('active');
          results.innerHTML = '';
          return;
        }
        const matches = CustomerDB.search(q, 15);
        if (matches.length === 0) {
          results.innerHTML = '<div class="db-search-hint">❌ ไม่พบข้อมูล</div>';
          results.classList.add('active');
          return;
        }
        highlightIdx = -1;
        results.innerHTML = matches.map((r, i) => `
          <div class="db-search-item" data-idx="${i}" data-cif="${r.cif}">
            <div class="db-name">${this._esc(r.name)}</div>
            <div class="db-meta">
              <span>CIF: ${r.cif}</span>
              ${r.customer_class ? `<span class="badge badge-blue">${r.customer_class}</span>` : ''}
              ${r.potential ? `<span class="badge ${r.potential === 'แดง' ? 'badge-red' : r.potential === 'เหลือง' ? 'badge-yellow' : 'badge-green'}">${r.potential}</span>` : ''}
              ${r.zone ? `<span class="badge badge-gray">เขต ${r.zone}</span>` : ''}
              ${r.tambon ? `<span>${r.tambon}</span>` : ''}
              ${r.lat ? `<span class="badge badge-green">📍</span>` : ''}
            </div>
          </div>
        `).join('');
        results.classList.add('active');

        // Click handlers
        results.querySelectorAll('.db-search-item').forEach(el => {
          el.addEventListener('click', () => {
            const cif = el.dataset.cif;
            const rec = CustomerDB.getByCif(cif);
            if (rec) this._fillFromDB(rec);
          });
        });
      }, 200);
    });

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
      const items = results.querySelectorAll('.db-search-item');
      if (!items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightIdx = Math.min(highlightIdx + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle('highlighted', i === highlightIdx));
        items[highlightIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightIdx = Math.max(highlightIdx - 1, 0);
        items.forEach((el, i) => el.classList.toggle('highlighted', i === highlightIdx));
        items[highlightIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && highlightIdx >= 0) {
        e.preventDefault();
        const cif = items[highlightIdx]?.dataset.cif;
        const rec = cif && CustomerDB.getByCif(cif);
        if (rec) this._fillFromDB(rec);
      } else if (e.key === 'Escape') {
        results.classList.remove('active');
      }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.db-search-container')) {
        results.classList.remove('active');
      }
    });
  },

  _fillFromDB(rec) {
    // CLOSE search results FIRST — before any form changes, so even if
    // something below throws, the dropdown is already gone.
    const results = document.getElementById('db-search-results');
    if (results) {
      results.classList.remove('active');
      results.innerHTML = '';          // clear DOM for safety
    }

    // Set search input to show selected customer name
    const searchInput = document.getElementById('db-search-input');
    if (searchInput) {
      searchInput.value = `${rec.name} (CIF: ${rec.cif})`;
    }

    const form = document.getElementById('add-customer-form');
    if (!form) return;

    try {
      // Auto-fill form fields
      if (rec.cif) form.elements.cif.value = rec.cif;
      if (rec.name) form.elements.name.value = rec.name;
      if (rec.phone) form.elements.phone.value = rec.phone.replace(/\s/g, '');
      // Build full address
      const addr = CustomerDB.fullAddress(rec);
      if (addr) form.elements.address.value = addr;

      // Auto-fill coordinates from DB (Nominatim geocoded)
      if (rec.lat && rec.lng) {
        document.getElementById('new-lat').value = rec.lat;
        document.getElementById('new-lng').value = rec.lng;
        this._renderAddGpsDisplay();
        // Update mini-map with the location
        setTimeout(() => this.initMiniMap(rec.lat, rec.lng), 150);
      }
    } catch (e) {
      console.warn('[App] _fillFromDB field-fill error:', e);
    }

    // Show filled info
    const info = document.getElementById('db-filled-info');
    if (info) {
      const badges = [];
      if (rec.zone) badges.push(`เขต ${rec.zone}`);
      if (rec.customer_class) badges.push(`ชั้น ${rec.customer_class}`);
      if (rec.potential) badges.push(`ศักยภาพ ${rec.potential}`);
      if (rec.dob) badges.push(`เกิด ${rec.dob}`);
      if (rec.lat) badges.push(`📍 มีพิกัดแล้ว`);
      info.innerHTML = `✅ <strong>${this._esc(rec.name)}</strong> · CIF ${rec.cif}${badges.length ? ' · ' + badges.join(' · ') : ''}`;
      info.classList.add('active');
    }

    Utils.toast('📋 กรอกข้อมูลอัตโนมัติจากฐานข้อมูลแล้ว' + (rec.lat ? ' (มีพิกัด 📍)' : ''));
  },

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  },

  // ===== Confirm Delete (custom modal with customer details) =====
  confirmDelete(customer) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirm-delete-modal');
      const nameEl = document.getElementById('confirm-del-name');
      const detailsEl = document.getElementById('confirm-del-details');
      const photoEl = document.getElementById('confirm-del-photo');
      const btnYes = document.getElementById('btn-confirm-del-yes');
      const btnNo = document.getElementById('btn-confirm-del-no');
      const btnX = document.getElementById('close-confirm-del');

      nameEl.textContent = customer.name || '(ไม่มีชื่อ)';

      // Build details line
      const details = [];
      if (customer.cif) details.push('CIF: ' + customer.cif);
      if (customer.phone) details.push('📞 ' + customer.phone);
      if (customer.nickname) details.push('🏷️ ' + customer.nickname);
      detailsEl.textContent = details.length ? details.join(' · ') : '—';

      // Show photo if exists
      if (customer.photo) {
        photoEl.innerHTML = `<img src="${customer.photo}" alt="photo" class="confirm-del-photo-img">`;
        photoEl.style.display = 'block';
      } else {
        photoEl.innerHTML = '';
        photoEl.style.display = 'none';
      }

      // Show modal
      modal.classList.remove('hidden');

      // Cleanup function
      const cleanup = (result) => {
        modal.classList.add('hidden');
        btnYes.removeEventListener('click', yesHandler);
        btnNo.removeEventListener('click', noHandler);
        btnX.removeEventListener('click', noHandler);
        modal.removeEventListener('click', backdropHandler);
        resolve(result);
      };
      const yesHandler = () => cleanup(true);
      const noHandler = () => cleanup(false);
      const backdropHandler = (e) => { if (e.target.id === 'confirm-delete-modal') cleanup(false); };

      btnYes.addEventListener('click', yesHandler);
      btnNo.addEventListener('click', noHandler);
      btnX.addEventListener('click', noHandler);
      modal.addEventListener('click', backdropHandler);
    });
  },

  // Init mini-map in add customer modal
  initMiniMap(prefillLat, prefillLng) {
    const container = document.getElementById('mini-map');
    if (!container) return;
    // Remove existing if any
    if (this._miniMap) {
      this._miniMap.remove();
      this._miniMap = null;
      this._miniMarker = null;
    }
    // Default to office location if no prefilled coords
    const lat = prefillLat ?? OFFICE_LOCATION.lat;
    const lng = prefillLng ?? OFFICE_LOCATION.lng;
    this._miniMap = L.map('mini-map', {
      zoomControl: true,
      // Mobile fix: explicit touch gestures
      tap: true,
      bounceAtZoomLimits: false,
      // iOS Safari sometimes needs this
      worldCopyJump: false,
      // Use CSS-driven sizing (important for invalidateSize)
      preferCanvas: false,
    }).setView([lat, lng], 14);

    // 2 base layers: roadmap (default) + satellite
    this._miniBaseLayers = {
      roadmap: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM',
        maxZoom: 19,
      }),
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri',
        maxZoom: 19,
      }),
    };
    this._miniBaseLayers.roadmap.addTo(this._miniMap);
    this._miniCurrentLayer = 'roadmap';
    this._addMiniLayerToggle();

    // Click to set location
    this._miniMap.on('click', (e) => {
      this.setMiniMapLocation(e.latlng.lat, e.latlng.lng);
    });

    // Mobile: disable text selection while dragging
    this._miniMap.getContainer().style.webkitUserSelect = 'none';
    this._miniMap.getContainer().style.userSelect = 'none';

    // If prefilled, add marker immediately
    if (prefillLat !== undefined && prefillLng !== undefined) {
      this.setMiniMapLocation(prefillLat, prefillLng);
    }

    // Force size recalc (modal may have just shown)
    setTimeout(() => this._miniMap.invalidateSize(), 200);
  },

  // ===== Mini-map layer toggle (roadmap ↔ satellite) =====
  _addMiniLayerToggle() {
    const LayerToggle = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'layer-toggle layer-toggle-mini leaflet-bar');
        div.innerHTML = `
          <button class="layer-btn active" data-layer="roadmap" title="แผนที่ถนน">🗺️</button>
          <button class="layer-btn" data-layer="satellite" title="ภาพดาวเทียม">🛰️</button>
        `;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        div.querySelectorAll('.layer-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            L.DomEvent.stop(e);
            App.switchMiniBaseLayer(btn.dataset.layer);
          });
        });
        return div;
      },
    });
    new LayerToggle({ position: 'topright' }).addTo(this._miniMap);
  },

  switchMiniBaseLayer(layerName) {
    if (!this._miniBaseLayers[layerName] || layerName === this._miniCurrentLayer) return;
    this._miniMap.removeLayer(this._miniBaseLayers[this._miniCurrentLayer]);
    this._miniBaseLayers[layerName].addTo(this._miniMap);
    this._miniCurrentLayer = layerName;
    const buttons = document.querySelectorAll('.layer-toggle-mini .layer-btn');
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layer === layerName);
    });
  },

  // Set location on mini-map (add/move marker)
  setMiniMapLocation(lat, lng) {
    document.getElementById('new-lat').value = lat.toFixed(6);
    document.getElementById('new-lng').value = lng.toFixed(6);
    this._renderAddGpsDisplay();
    if (this._miniMarker) {
      this._miniMarker.setLatLng([lat, lng]);
    } else {
      this._miniMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: '<div class="mini-map-pin">📍</div>',
          iconSize: [32, 32],
          iconAnchor: [16, 32],
        }),
      }).addTo(this._miniMap);
    }
    this._miniMap.panTo([lat, lng]);
  },

  // Render GPS status strip in add-customer modal (hidden lat/lng → readable)
  _renderAddGpsDisplay() {
    const el = document.getElementById('add-gps-display');
    if (!el) return;
    const lat = document.getElementById('new-lat')?.value;
    const lng = document.getElementById('new-lng')?.value;
    if (lat && lng) {
      el.innerHTML = `<div class="gps-captured"><span class="gps-coord">📍 ${parseFloat(lat).toFixed(6)}, ${parseFloat(lng).toFixed(6)}</span></div>`;
    } else {
      el.innerHTML = '<span class="gps-empty">ยังไม่ได้เลือก — จิ้มแผนที่หรือกดปุ่ม GPS</span>';
    }
  },

  // Pick location on main map (close modal temporarily)
  pickOnMainMap() {
    // Save form data
    const form = document.getElementById('add-customer-form');
    const draft = Object.fromEntries(new FormData(form));
    sessionStorage.setItem('add-customer-draft', JSON.stringify(draft));
    this.closeAddCustomerModal();
    // Switch to map tab
    this.switchTab('map');
    Utils.toast('🗺️ คลิกบนแผนที่หลักเพื่อเลือกตำแหน่ง → กด "กลับมาเพิ่มลูกค้า"');
    // Set flag to re-open modal on next map click
    window._pickMode = true;
  },

  // Restore draft and re-open modal
  restoreAddCustomerModal() {
    const draft = sessionStorage.getItem('add-customer-draft');
    if (!draft) {
      this.openAddCustomerModal();
      return;
    }
    const data = JSON.parse(draft);
    const form = document.getElementById('add-customer-form');
    Object.entries(data).forEach(([k, v]) => {
      const el = form.elements[k];
      if (el) el.value = v;
    });
    document.getElementById('add-customer-modal').classList.remove('hidden');
    sessionStorage.removeItem('add-customer-draft');
    setTimeout(() => {
      const lat = parseFloat(data.lat);
      const lng = parseFloat(data.lng);
      if (!isNaN(lat) && !isNaN(lng)) {
        this.initMiniMap(lat, lng);
      } else {
        this.initMiniMap();
        this._renderAddGpsDisplay();
      }
    }, 100);
  },

  closeAddCustomerModal() {
    document.getElementById('add-customer-modal').classList.add('hidden');
  },

  // Save customer (add or edit) — Local-first: ขึ้นจอทันที แล้วส่งขึ้นเว็บเบื้องหลัง
  async saveCustomer(form) {
    const data = Object.fromEntries(new FormData(form));
    const editId = form.dataset.editId;
    const isEdit = !!editId;
    let savedCustomer;

    // ===== 1) บันทึกลงเครื่อง + วาดหมุดทันที (~20ms) =====
    // ค่าจากช่องฟอร์มเป็นข้อความ — addCustomerLocal/updateCustomerLocal แปลงเป็นตัวเลขให้
    // (เดิมพิกัดเป็นข้อความ → หมุดไม่ขึ้นบนแผนที่จนกว่าข้อมูลใหม่จะมาจากเซิร์ฟเวอร์)
    if (isEdit) {
      savedCustomer = Storage.updateCustomerLocal(editId, data)
        || Storage.getCustomers().find(c => c.id === editId);
    } else {
      savedCustomer = Storage.addCustomerLocal(data);
    }
    this.closeAddCustomerModal();
    // Re-render markers WITHOUT fitBounds — preserve whatever view the user
    // was on. This stops the map from yanking away after every save.
    Customers._lastMarkerHash = null;   // หมุด/พิกัดใหม่ → ต้องวาดใหม่แน่ๆ
    Customers.renderAll();
    // Gentle flyTo the saved customer so the user can see where it landed
    // without a jarring full-bounds reset.
    if (savedCustomer && savedCustomer.lat && savedCustomer.lng && Customers.map) {
      const newLatLng = L.latLng(parseFloat(savedCustomer.lat), parseFloat(savedCustomer.lng));
      const currentCenter = Customers.map.getCenter();
      // Only fly if the new pin is off-screen or way off-center
      const isVisible = Customers.map.getBounds().contains(newLatLng);
      const tooFarOut = Customers.map.getZoom() < 16;   // ระดับนี้หมุดถูกยัดอยู่ในกลุ่ม → มองไม่เห็น
      if (!isVisible || tooFarOut || currentCenter.distanceTo(newLatLng) > 500) {
        Customers.map.flyTo(newLatLng, 17, { duration: 0.6 });
      }
      if (Customers._flashPin) Customers._flashPin(newLatLng);   // กระพริบให้เห็นว่าหมุดอยู่ตรงนี้
    }

    // ===== 2) ส่งขึ้นเว็บเบื้องหลัง + แจ้งสถานะบนจอ =====
    this.setSaveStatus('saving');
    Utils.toast(isEdit ? '✏️ แก้ไขแล้ว · กำลังบันทึกขึ้นเว็บ...' : '📝 เพิ่มลูกค้าแล้ว · กำลังบันทึกขึ้นเว็บ...', 'info');
    const settled = (isEdit && savedCustomer && savedCustomer.cif)
      ? await Storage.uploadCustomer(savedCustomer.cif, this._customerUploadFields(data))
      : await Storage.push().then((r) => ({ synced: !!(r && r.success), error: r && r.error }));
    if (settled && settled.synced) {
      this.setSaveStatus('saved');
      Utils.toast(isEdit ? '✅ แก้ไขลูกค้าแล้ว · ส่งขึ้นเว็บเรียบร้อย' : '✅ เพิ่มลูกค้าแล้ว · ส่งขึ้นเว็บเรียบร้อย');
    } else {
      this.setSaveStatus('error');
      Utils.toast('⚠️ บันทึกในเครื่องนี้แล้ว แต่ยังส่งขึ้นเว็บไม่สำเร็จ · กดปุ่ม sync ล่างขวาเพื่อลองใหม่', 'error');
    }
  },

  // เตรียมข้อมูลจากฟอร์มก่อนส่งขึ้นเว็บ
  // - ตัดช่องที่เซิร์ฟเวอร์ไม่รับ (cif/debtNote)
  // - ช่องพิกัดว่าง = ไม่แตะพิกัดเดิม (กัน lat/lng กลายเป็น 0 แล้วหมุดเด้งไปกลางทะเล)
  // - แปลงพิกัดจากข้อความ ("13.77") เป็นตัวเลข → หมุดขึ้นทันที
  _customerUploadFields(data) {
    const f = { ...data };
    delete f.cif;
    delete f.debtNote;
    const nlat = Storage._normCoord(f.lat);
    const nlng = Storage._normCoord(f.lng);
    if (nlat === null || nlng === null) { delete f.lat; delete f.lng; }
    else { f.lat = nlat; f.lng = nlng; }
    return f;
  },

  // Use GPS
  useGPS(forForm = false) {
    if (!navigator.geolocation) {
      Utils.toast('เบราว์เซอร์ไม่รองรับ GPS', 'error');
      return;
    }

    // ===== Form mode: just set lat/lng inputs (no map pin needed) =====
    if (forForm) {
      Utils.toast('📍 กำลังค้นหาตำแหน่ง...');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          window._lastGPS = { lat, lng };
          document.getElementById('new-lat').value = lat.toFixed(6);
          document.getElementById('new-lng').value = lng.toFixed(6);
          this._renderAddGpsDisplay();
          Utils.toast('📍 ใช้ตำแหน่งปัจจุบันแล้ว');
        },
        (err) => {
          Utils.toast('ไม่สามารถเข้าถึง GPS: ' + err.message, 'error');
        },
        { enableHighAccuracy: true, timeout: 10000 },
      );
      return;
    }

    // ===== Main-map mode: Google-Maps style "My Location" =====
    // Toggle: first click starts tracking, click again stops it
    if (this._gpsWatchId !== null) {
      this._stopGPS();
      return;
    }

    if (!Customers.map) {
      Utils.toast('แผนที่ยังไม่พร้อม', 'error');
      return;
    }

    Utils.toast('📍 กำลังค้นหาตำแหน่ง...');

    // Initial fix to position the camera quickly
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this._updateGPSMarker(pos.coords);
        Customers.map.setView([pos.coords.latitude, pos.coords.longitude], 16);
      },
      (err) => {
        // ignore — watchPosition will keep trying
        console.warn('GPS initial fix failed:', err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );

    // Live tracking — pin follows user like Google Maps
    this._gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => this._updateGPSMarker(pos.coords),
      (err) => Utils.toast('GPS ผิดพลาด: ' + err.message, 'error'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );

    // Visual feedback: pulse the FAB while tracking
    const fab = document.getElementById('fab-my-location');
    if (fab) fab.classList.add('tracking');
  },

  // Update or create the single GPS pin + accuracy circle (Google-Maps style)
  _updateGPSMarker(coords) {
    const lat = coords.latitude;
    const lng = coords.longitude;
    const acc = coords.accuracy || 0; // meters

    window._lastGPS = { lat, lng, accuracy: acc };

    if (!Customers.map) return;

    if (!this._gpsMarker) {
      // First time — create pin + circle
      this._gpsMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: '<div class="gps-dot">'
              + '<div class="gps-arrow-wrap"><div class="gps-arrow"></div></div>'
              + '<div class="gps-dot-inner"></div>'
              + '</div>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        zIndexOffset: 1000,
        interactive: false,
      }).addTo(Customers.map);
      this._gpsCircle = L.circle([lat, lng], {
        radius: acc,
        color: '#4285F4',
        fillColor: '#4285F4',
        fillOpacity: 0.15,
        weight: 1,
        interactive: false,
      }).addTo(Customers.map);
    } else {
      // Subsequent updates — move pin + resize circle
      this._gpsMarker.setLatLng([lat, lng]);
      this._gpsCircle.setLatLng([lat, lng]);
      if (acc > 0) this._gpsCircle.setRadius(acc);
    }

    // Heading arrow (Google-Maps style). Only visible when device reports
    // a real heading (mobile w/ compass). On desktop coords.heading is null.
    const el = this._gpsMarker.getElement();
    if (el) {
      const wrap = el.querySelector('.gps-arrow-wrap');
      const hasHeading = coords.heading !== null && coords.heading !== undefined
                         && !isNaN(coords.heading);
      if (wrap) {
        if (hasHeading) {
          wrap.style.transform = `rotate(${coords.heading}deg)`;
          el.classList.add('has-heading');
        } else {
          el.classList.remove('has-heading');
        }
      }
    }

    // First-fix only: zoom in. Don't auto-pan on every watch tick —
    // that would yank the map while the user is exploring.
    if (this._gpsFirstFix === undefined) {
      this._gpsFirstFix = false;
      Customers.map.setView([lat, lng], 16);
    }
  },

  // Stop tracking + clean up pin + circle
  _stopGPS() {
    if (this._gpsWatchId !== null && this._gpsWatchId !== undefined) {
      navigator.geolocation.clearWatch(this._gpsWatchId);
    }
    this._gpsWatchId = null;
    this._gpsFirstFix = undefined;

    if (this._gpsMarker) { Customers.map.removeLayer(this._gpsMarker); this._gpsMarker = null; }
    if (this._gpsCircle) { Customers.map.removeLayer(this._gpsCircle); this._gpsCircle = null; }

    const fab = document.getElementById('fab-my-location');
    if (fab) fab.classList.remove('tracking');
    Utils.toast('ปิดติดตาม GPS แล้ว');
  },

  // Update route tab UI — render selected chips with drag&drop + ▲▼ reorder
  updateRouteUI() {
    const route = Storage.getRoute();
    const customers = Storage.getActiveCustomers();
    const routeCustomers = route.map(id => customers.find(c => c.id === id)).filter(Boolean);
    const el = document.getElementById('route-chips');
    const countEl = document.getElementById('route-count');
    const btnCalculate = document.getElementById('btn-calculate-route');
    const btnOptimize = document.getElementById('btn-optimize-route');

    if (countEl) countEl.textContent = routeCustomers.length;

    if (routeCustomers.length === 0) {
      if (el) el.innerHTML = '<p class="empty-state">เลือกลูกค้าจากช่องค้นหาด้านบน หรือกด "เพิ่มในเส้นทางวันนี้" จากแท็บลูกค้า</p>';
      if (btnCalculate) btnCalculate.disabled = true;
      if (btnOptimize) btnOptimize.disabled = true;
      return;
    }

    if (el) {
      el.innerHTML = routeCustomers.map((c, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === routeCustomers.length - 1;
        return `
          <span class="route-chip" draggable="true" data-id="${this.escapeHTML(c.id)}" data-idx="${idx}"
                ondragstart="Route.dragStart(event, ${idx})"
                ondragover="Route.dragOver(event)"
                ondrop="Route.drop(event, ${idx})"
                ondragend="Route.dragEnd(event)">
            <span class="route-chip-num">${idx + 1}</span>
            <span class="route-chip-cif">${this.escapeHTML(c.cif || '-')}</span>
            ${this.escapeHTML(c.name)}
            <span class="route-chip-order">
              <button onclick="Route.move(${idx}, -1)" ${isFirst ? 'disabled' : ''} title="เลื่อนขึ้น">▲</button>
              <button onclick="Route.move(${idx}, 1)" ${isLast ? 'disabled' : ''} title="เลื่อนลง">▼</button>
            </span>
            <button class="route-chip-remove" onclick="Route.toggle('${this.escapeHTML(c.id)}')" title="เอาออก">×</button>
          </span>
        `;
      }).join('');
    }

    if (btnCalculate) btnCalculate.disabled = false;
    if (btnOptimize) btnOptimize.disabled = false;
    this.renderTodayRoute();
  },

  // Calculate route
  // useTSP = false (default) = use the manual order from chips
  // useTSP = true = call TSP.plan() to auto-optimize (opt-in)
  async calculateRoute(useTSP = false) {
    const route = Storage.getRoute();
    if (route.length === 0) return;
    const start = Route.getStartCoords();
    const end = Route.getEndCoords();

    // Manual order (default) or TSP optimize (opt-in)
    const ordered = useTSP ? TSP.plan(start, route, end) : route;

    // 🎯 TSP คิดลำดับใหม่ → บันทึกกลับเป็น "เส้นทางวันนี้"
    // เดิม: ลำดับใหม่ถูกใช้คำนวณครั้งเดียวแล้วหายไป → ชิปด้านบนกับแท็บ "เข้าพบ" ยังเรียงเก่า (ขัดกับผลที่โชว์)
    let reordered = false;
    if (useTSP && ordered.length === route.length && ordered.join('|') !== route.join('|')) {
      Storage.saveRoute(ordered);
      this.updateRouteUI();
      reordered = true;
    }

    // Get real route from OSRM
    const result = await Route.calculate(start, ordered, end);
    if (result) {
      result.autoOrdered = reordered;
      result.autoOrderTried = useTSP;
      Route.showResult(result);
      this.switchTab('map'); // show route on map
      const routeType = result.isOpenPath ? ' (เปิด)' : '';
      const tspNote = reordered ? ' · 🎯 จัดลำดับให้ใหม่แล้ว' : (useTSP ? ' · ลำดับเดิมสั้นที่สุดอยู่แล้ว' : '');
      Utils.toast(`✅ เส้นทาง${routeType}${tspNote} — ${Utils.formatKm(result.distance)} กม. / ${result.fuel ? Utils.formatBaht(result.fuel.baht) : '?'} บาท`);
    }
  },

  // ===== Admin: Show/hide admin button based on role =====
  updateAdminUI() {
    const isAdmin = Auth.isAdmin();
    const userBtn = document.getElementById('admin-users-btn');
    const dataBtn = document.getElementById('admin-data-btn');
    if (userBtn) userBtn.style.display = isAdmin ? '' : 'none';
    if (dataBtn) dataBtn.style.display = isAdmin ? '' : 'none';
  },

  // ===== Admin: Open management modal =====
  async openAdminUsers() {
    const modal = document.getElementById('admin-users-modal');
    modal.classList.remove('hidden');

    // Tab switching
    modal.querySelectorAll('.admin-tab').forEach(tab => {
      tab.onclick = () => {
        modal.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        modal.querySelectorAll('.admin-tab-pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('admin-tab-' + tab.dataset.adminTab).classList.add('active');
      };
    });

    // Load branches into select (always refresh)
    const branchSelect = document.getElementById('new-branch');
    branchSelect.innerHTML = '<option value="">— เลือกสาขา —</option>';
    try {
      const res = await API.get('/api/branches');
      if (res.success && res.branches) {
        window._adminBranches = res.branches;
        res.branches.forEach(b => {
          const opt = document.createElement('option');
          opt.value = b.code;
          opt.textContent = b.name;
          branchSelect.appendChild(opt);
        });
      }
    } catch (e) {
      console.warn('Failed to load branches:', e);
    }

    // Load data
    await this.loadAdminUsers();
    await this.loadAdminBranches();

    // Close handler
    document.getElementById('close-admin-users').onclick = () => modal.classList.add('hidden');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };

    // Add user form
    document.getElementById('admin-add-user-form').onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('admin-user-error');
      errEl.textContent = '';
      const username = document.getElementById('new-username').value.trim();
      const password = document.getElementById('new-password').value;
      const displayName = document.getElementById('new-display-name').value.trim();
      const branch = document.getElementById('new-branch').value;

      try {
        const res = await API.post('/api/admin/users', { username, password, displayName, branch });
        if (res.success) {
          Utils.toast(`✅ สร้างผู้ใช้ "${displayName}" สำเร็จ`);
          document.getElementById('admin-add-user-form').reset();
          await this.loadAdminUsers();
        }
      } catch (err) {
        errEl.textContent = err.message || 'สร้างผู้ใช้ไม่สำเร็จ';
      }
    };

    // Bulk import customers from static DB
    const importBtn = document.getElementById('btn-import-static-db');
    if (importBtn) {
      importBtn.onclick = async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('import-static-error');
        const successEl = document.getElementById('import-static-success');
        errEl.style.display = 'none';
        successEl.style.display = 'none';
        errEl.textContent = '';
        importBtn.disabled = true;
        const originalText = importBtn.textContent;
        importBtn.textContent = '⏳ กำลังนำเข้า...';
        try {
          if (typeof Storage === 'undefined' || !Storage.importFromStaticDB) {
            throw new Error('ฟังก์ชันนำเข้ายังโหลดไม่เสร็จ');
          }
          const result = await Storage.importFromStaticDB();
          successEl.textContent = `✅ นำเข้า ${result.imported} รายการ · ${result.withGPS} มีพิกัด · ข้าม ${result.skipped} ที่ซ้ำ`;
          successEl.style.display = 'block';
          Utils.toast(`📥 นำเข้า ${result.imported} ลูกค้าแล้ว`);
          // Re-render map to show new markers
          if (typeof Customers !== 'undefined' && Customers.renderAll) {
            setTimeout(() => Customers.renderAll(), 500);
          }
        } catch (err) {
          errEl.textContent = err.message || 'นำเข้าไม่สำเร็จ';
          errEl.style.display = 'block';
          Utils.toast('❌ นำเข้าไม่สำเร็จ', 'error');
        } finally {
          importBtn.disabled = false;
          importBtn.textContent = originalText;
        }
      };
    }

    // Add branch form
    document.getElementById('admin-add-branch-form').onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('admin-branch-error');
      errEl.textContent = '';
      const code = document.getElementById('new-branch-code').value.trim().toUpperCase();
      const name = document.getElementById('new-branch-name').value.trim();

      try {
        const res = await API.post('/api/admin/branches', { code, name });
        if (res.success) {
          Utils.toast(`✅ เพิ่มสาขา "${name}" สำเร็จ`);
          document.getElementById('admin-add-branch-form').reset();
          await this.loadAdminBranches();
          // Refresh branch selects
          const branchSelect = document.getElementById('new-branch');
          const opt = document.createElement('option');
          opt.value = code;
          opt.textContent = name;
          branchSelect.appendChild(opt);
        }
      } catch (err) {
        errEl.textContent = err.message || 'เพิ่มสาขาไม่สำเร็จ';
      }
    };

    // Change PIN form
    document.getElementById('admin-change-pin-form').onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('admin-pin-error');
      const successEl = document.getElementById('admin-pin-success');
      errEl.textContent = '';
      successEl.style.display = 'none';

      const currentPin = document.getElementById('current-pin').value;
      const newPin = document.getElementById('new-pin').value;
      const confirmPin = document.getElementById('confirm-pin').value;

      if (newPin !== confirmPin) {
        errEl.textContent = 'PIN ใหม่ไม่ตรงกัน';
        return;
      }
      if (newPin.length < 4) {
        errEl.textContent = 'PIN ใหม่ต้องมีอย่างน้อย 4 หลัก';
        return;
      }

      try {
        const res = await API.post('/api/admin/pin', { currentPin, newPin });
        if (res.success) {
          Utils.toast('🔐 เปลี่ยน PIN สำเร็จ');
          successEl.textContent = '✅ เปลี่ยน PIN สำเร็จแล้ว';
          successEl.style.display = 'block';
          document.getElementById('admin-change-pin-form').reset();
        }
      } catch (err) {
        errEl.textContent = err.message || 'เปลี่ยน PIN ไม่สำเร็จ';
      }
    };

    // ===== Data Export (CSV) =====
    const exportBtn = document.getElementById('btn-export-customers');
    if (exportBtn) {
      exportBtn.onclick = () => this.exportCustomersCSV();
    }

    // ===== Debt Import: อัปโหลด Customer Indicator =====
    this.initDebtImport();
  },

  // ===== Debt Import: อัปโหลด Customer Indicator =====
  initDebtImport() {
    const uploadBtn = document.getElementById('debt-upload-btn');
    const fileInput = document.getElementById('debt-file-input');
    const fileName = document.getElementById('debt-file-name');
    const progress = document.getElementById('debt-progress');
    const progressText = document.getElementById('debt-progress-text');
    const result = document.getElementById('debt-result');
    const resultStats = document.getElementById('debt-result-stats');
    const resultTime = document.getElementById('debt-result-time');
    const lastUpdate = document.getElementById('debt-last-update-time');

    if (!uploadBtn || !fileInput) return;

    // โหลดวันที่อัปเดตหนี้ล่าสุด
    this.loadDebtLastUpdate();

    // ปุ่มเลือกไฟล์
    uploadBtn.onclick = () => fileInput.click();
    
    // เมื่อเลือกไฟล์
    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      if (!file) return;
      
      fileName.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
      
      // ซ่อนผลลัพธ์เก่า + แสดง progress
      result.style.display = 'none';
      progress.style.display = 'block';
      progressText.textContent = 'กำลังอัปโหลดไฟล์...';
      uploadBtn.disabled = true;
      uploadBtn.textContent = '⏳ กำลังประมวลผล...';
      
      try {
        // สร้าง FormData
        const formData = new FormData();
        formData.append('file', file);
        
        progressText.textContent = 'กำลังอัปโหลดและประมวลผลข้อมูลหนี้...';
        
        // ส่งไปยัง API
        const token = Auth.getToken();
        const res = await fetch('/api/debt-import', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData,
        });
        
        const data = await res.json();
        
        if (!res.ok) {
          throw new Error(data.error || 'อัปโหลดไม่สำเร็จ');
        }
        
        // แสดงผลลัพธ์
        progress.style.display = 'none';
        result.style.display = 'block';
        
        resultStats.innerHTML = `
          📋 สัญญาทั้งหมด: <strong>${data.total_contracts.toLocaleString()}</strong> รายการ<br>
          👥 CIF ไม่ซ้ำ: <strong>${data.unique_cifs.toLocaleString()}</strong> ราย<br>
          ✅ อัปเดตสำเร็จ: <strong>${data.updated.toLocaleString()}</strong> ราย<br>
          ${data.added > 0 ? `🆕 สร้างใหม่: <strong>${data.added.toLocaleString()}</strong> ราย<br>` : ''}
          ${data.not_found > 0 ? `⚠️ ไม่พบ CIF ในระบบ: <strong>${data.not_found.toLocaleString()}</strong> ราย` : ''}
        `;
        
        resultTime.textContent = `อัปเดตเมื่อ: ${new Date(data.debt_updated_at).toLocaleString('th-TH')}`;
        
        // อัปเดตวันที่ล่าสุด
        if (lastUpdate) {
          lastUpdate.textContent = new Date(data.debt_updated_at).toLocaleString('th-TH');
        }
        
        Utils.toast(`📊 อัปเดตหนี้สำเร็จ ${data.updated} ราย${data.added > 0 ? ` +${data.added} ใหม่` : ''}`);
        
        // รีเฟรชข้อมูลลูกค้าบนแผนที่
        if (typeof Customers !== 'undefined' && Customers.renderAll) {
          setTimeout(() => Customers.renderAll(), 500);
        }
        
      } catch (err) {
        progress.style.display = 'none';
        result.style.display = 'block';
        resultStats.innerHTML = `<span style="color:var(--danger)">❌ ${err.message}</span>`;
        resultTime.textContent = '';
        Utils.toast('❌ อัปเดตหนี้ไม่สำเร็จ', 'error');
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = '📂 เลือกไฟล์ Customer Indicator';
        fileInput.value = ''; // reset file input
      }
    };
  },

  // ===== Debt Import: โหลดวันที่อัปเดตหนี้ล่าสุด =====
  async loadDebtLastUpdate() {
    const lastUpdate = document.getElementById('debt-last-update-time');
    if (!lastUpdate) return;
    
    try {
      // ดึงข้อมูลลูกค้า 1 รายเพื่อเช็ค debt_updated_at
      const token = Auth.getToken();
      const res = await fetch('/api/customers?limit=1', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      
      if (data.success && data.customers && data.customers.length > 0) {
        const debtUpdated = data.customers[0].debt_updated_at;
        if (debtUpdated) {
          lastUpdate.textContent = new Date(debtUpdated).toLocaleString('th-TH');
        } else {
          lastUpdate.textContent = 'ยังไม่เคยอัปเดต';
        }
      }
    } catch (err) {
      console.warn('Failed to load debt last update:', err);
      lastUpdate.textContent = '-';
    }
  },

  // ===== Export Customers as CSV =====
  exportCustomersCSV() {
    const customers = Storage.getActiveCustomers();
    if (!customers.length) {
      Utils.toast('⚠️ ไม่มีข้อมูลลูกค้าให้ export', 'error');
      return;
    }

    // Build CSV
    const headers = ['CIF', 'ชื่อ', 'ชื่อเล่น', 'เบอร์โทร', 'ที่อยู่', 'Latitude', 'Longitude', 'ระดับความเสี่ยง', 'ประเภทหนี้', 'สร้างโดย', 'วันที่สร้าง'];
    const rows = customers.map(c => [
      c.cif || '',
      c.name || '',
      c.nickname || '',
      c.phone || '',
      c.address || '',
      c.lat || '',
      c.lng || '',
      c.riskLevel || '',
      c.debtType || '',
      c.createdBy || '',
      c.createdAt || '',
    ]);

    // Escape CSV values
    const escapeCSV = (val) => {
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(escapeCSV).join(','))
    ].join('\n');

    // Download
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `baac-customers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    Utils.toast(`📊 Export ${customers.length} ลูกค้าเป็น CSV แล้ว`);
  },

  // ===== Admin: Load user list =====
  async loadAdminUsers() {
    const listEl = document.getElementById('admin-users-list');
    try {
      const res = await API.get('/api/admin/users');
      if (!res.success || !res.users.length) {
        listEl.innerHTML = '<p class="text-muted">ยังไม่มีผู้ใช้ — เพิ่มคนแรกด้านล่างเลย</p>';
        return;
      }
      listEl.innerHTML = res.users.map(u => `
        <div class="admin-user-card">
          <div class="admin-user-info">
            <span class="admin-user-name">${this.escapeHTML(u.displayName)}</span>
            <span class="admin-user-meta">${this.escapeHTML(u.username)} · ${this.escapeHTML(u.branchName)} · ${u.role === 'admin' ? '👑 Admin' : '👤 User'}</span>
          </div>
          <button class="btn-danger-sm" onclick="App.deleteAdminUser('${u.id}', '${this.escapeHTML(u.displayName)}')">🗑️</button>
        </div>
      `).join('');
    } catch (err) {
      listEl.innerHTML = `<p class="login-error">โหลดรายชื่อไม่สำเร็จ: ${err.message}</p>`;
    }
  },

  // ===== Admin: Delete user =====
  async deleteAdminUser(id, name) {
    if (!confirm(`ลบผู้ใช้ "${name}"?`)) return;
    try {
      const token = Auth.getToken();
      const res = await fetch(API.baseUrl() + '/api/admin/users', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) {
        Utils.toast(`🗑️ ลบผู้ใช้ "${name}" แล้ว`);
        await this.loadAdminUsers();
      } else {
        Utils.toast(data.error || 'ลบไม่สำเร็จ', 'error');
      }
    } catch (err) {
      Utils.toast('ลบไม่สำเร็จ: ' + err.message, 'error');
    }
  },

  // ===== Change Password (self-service for all users) =====
  openChangePassword() {
    const modal = document.getElementById('change-password-modal');
    document.getElementById('change-password-form-standalone').reset();
    document.getElementById('cp-error-standalone').textContent = '';
    document.getElementById('cp-success-standalone').style.display = 'none';
    modal.classList.remove('hidden');
  },

  async submitChangePassword() {
    const errEl = document.getElementById('cp-error');
    const successEl = document.getElementById('cp-success');
    errEl.textContent = '';
    successEl.style.display = 'none';

    const currentPassword = document.getElementById('cp-current').value;
    const newPassword = document.getElementById('cp-new').value;
    const confirmPassword = document.getElementById('cp-confirm').value;

    if (newPassword !== confirmPassword) {
      errEl.textContent = 'รหัสผ่านใหม่ไม่ตรงกัน';
      return;
    }
    if (newPassword.length < 4) {
      errEl.textContent = 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร';
      return;
    }

    const btn = document.getElementById('btn-change-password');
    btn.disabled = true;
    btn.textContent = 'กำลังเปลี่ยน...';

    try {
      // postRaw เพื่อเอาข้อความ error ภาษาไทยจากเซิร์ฟเวอร์มาโชว์ (API.post ให้แค่ "HTTP 400")
      const res = await API.postRaw('/api/change-password', { currentPassword, newPassword });
      if (res.ok && res.data && res.data.success) {
        successEl.textContent = 'เปลี่ยนรหัสผ่านสำเร็จ ✅';
        successEl.style.display = 'block';
        document.getElementById('cp-current').value = '';
        document.getElementById('cp-new').value = '';
        document.getElementById('cp-confirm').value = '';
        Utils.toast('🔑 เปลี่ยนรหัสผ่านสำเร็จ');
      } else {
        errEl.textContent = (res.data && res.data.error) || `เปลี่ยนรหัสไม่สำเร็จ (${res.status})`;
      }
    } catch (err) {
      errEl.textContent = err.message || 'เปลี่ยนรหัสไม่สำเร็จ';
    } finally {
      btn.disabled = false;
      btn.textContent = 'เปลี่ยนรหัสผ่าน';
    }
  },

  // Standalone change password (for non-admin users via header button)
  async submitChangePasswordStandalone() {
    const errEl = document.getElementById('cp-error-standalone');
    const successEl = document.getElementById('cp-success-standalone');
    errEl.textContent = '';
    successEl.style.display = 'none';

    const currentPassword = document.getElementById('cp-current-standalone').value;
    const newPassword = document.getElementById('cp-new-standalone').value;
    const confirmPassword = document.getElementById('cp-confirm-standalone').value;

    if (newPassword !== confirmPassword) {
      errEl.textContent = 'รหัสผ่านใหม่ไม่ตรงกัน';
      return;
    }
    if (newPassword.length < 4) {
      errEl.textContent = 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร';
      return;
    }

    try {
      // postRaw เพื่อเอาข้อความ error ภาษาไทยจากเซิร์ฟเวอร์มาโชว์ (API.post ให้แค่ "HTTP 400")
      const res = await API.postRaw('/api/change-password', { currentPassword, newPassword });
      if (res.ok && res.data && res.data.success) {
        successEl.textContent = 'เปลี่ยนรหัสผ่านสำเร็จ ✅';
        successEl.style.display = 'block';
        document.getElementById('cp-current-standalone').value = '';
        document.getElementById('cp-new-standalone').value = '';
        document.getElementById('cp-confirm-standalone').value = '';
        Utils.toast('🔑 เปลี่ยนรหัสผ่านสำเร็จ');
      } else {
        errEl.textContent = (res.data && res.data.error) || `เปลี่ยนรหัสไม่สำเร็จ (${res.status})`;
      }
    } catch (err) {
      errEl.textContent = err.message || 'เปลี่ยนรหัสไม่สำเร็จ';
    }
  },

  // ===== Admin: Load branch list =====
  async loadAdminBranches() {
    const listEl = document.getElementById('admin-branches-list');
    try {
      const res = await API.get('/api/admin/branches');
      if (!res.success || !res.branches.length) {
        listEl.innerHTML = '<p class="text-muted">ยังไม่มีสาขา</p>';
        return;
      }
      listEl.innerHTML = res.branches.map(b => `
        <div class="admin-user-card">
          <div class="admin-user-info">
            <span class="admin-user-name">${this.escapeHTML(b.name)}</span>
            <span class="admin-user-meta">${this.escapeHTML(b.code)}</span>
          </div>
          <button class="btn-danger-sm" onclick="App.deleteAdminBranch('${this.escapeHTML(b.code)}', '${this.escapeHTML(b.name)}')">🗑️</button>
        </div>
      `).join('');
    } catch (err) {
      listEl.innerHTML = `<p class="login-error">โหลดสาขาไม่สำเร็จ: ${err.message}</p>`;
    }
  },

  // ===== Admin: Delete branch =====
  async deleteAdminBranch(code, name) {
    if (!confirm(`ลบสาขา "${name}" (${code})?`)) return;
    try {
      const token = Auth.getToken();
      const res = await fetch(API.baseUrl() + '/api/admin/branches', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.success) {
        Utils.toast(`🗑️ ลบสาขา "${name}" แล้ว`);
        await this.loadAdminBranches();
        // Remove from user form select
        const sel = document.getElementById('new-branch');
        const opt = sel.querySelector(`option[value="${code}"]`);
        if (opt) opt.remove();
      } else {
        Utils.toast(data.error || 'ลบไม่สำเร็จ', 'error');
      }
    } catch (err) {
      Utils.toast('ลบไม่สำเร็จ: ' + err.message, 'error');
    }
  },

  escapeHTML(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  },

  // ===== Hard refresh — bypass HTTP cache + unregister SW + clear caches =====
  async hardRefresh() {
    const btn = document.getElementById('refresh-btn');
    if (btn) {
      btn.classList.add('spinning');
      btn.disabled = true;
    }

    try {
      // 1) Unregister service worker (PWA) so next load fetches fresh
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          try { await r.unregister(); } catch (e) {}
        }
      }

      // 2) Clear all Cache Storage entries
      if ('caches' in window) {
        const names = await caches.keys();
        for (const n of names) {
          try { await caches.delete(n); } catch (e) {}
        }
      }

      // 3) Pull fresh server version before reload
      const newVer = await this.fetchServerVersion();
      if (newVer) localStorage.setItem('app_version', newVer);
      // ตั้ง flag ให้หน้าใหม่รู้ว่าเพิ่งอัปเดตเสร็จ — จะได้แจ้งเตือนหลัง reload
      sessionStorage.setItem('bfr_update_done', newVer || '1');

      // 4) Show toast + reload bypassing HTTP cache
      if (typeof Utils !== 'undefined' && Utils.toast) {
        Utils.toast('🔄 กำลังรีเฟรช...');
      }
      setTimeout(() => {
        // Bypass HTTP cache with query string + reload
        const url = new URL(window.location.href);
        url.searchParams.set('_v', Date.now());
        window.location.replace(url.toString());
      }, 400);
    } catch (e) {
      console.error('Hard refresh failed:', e);
      // Fallback: simple reload with cache buster
      window.location.reload();
    }
  },

  // ===== Update available — prompt user =====
  async applyUpdate() {
    // Cancel any pending update notification
    if (this._updateTimer) {
      clearInterval(this._updateTimer);
      this._updateTimer = null;
    }
    const banner = document.getElementById('update-banner');
    if (banner) banner.remove();
    this._updateNotified = false;

    const newVer = await this.fetchServerVersion();
    if (newVer) {
      if (typeof Utils !== 'undefined' && Utils.toast) {
        Utils.toast('✨ อัพเดทเป็นเวอร์ชัน ' + newVer);
      }
    }
    this.hardRefresh();
  },
};

// ===== Service Worker registration (PWA) =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  });
}

// ===== Boot =====
document.addEventListener('DOMContentLoaded', () => App.init());

// ===== Refresh button binding (early, before login too) =====
document.addEventListener('DOMContentLoaded', () => {
  // Restore saved vehicle (route + report)
  const savedVehicle = Utils.getVehicle();
  const routeVehicle = document.getElementById('route-vehicle');
  if (routeVehicle) routeVehicle.value = savedVehicle;
  if (routeVehicle) {
    routeVehicle.addEventListener('change', () => Utils.setVehicle(routeVehicle.value));
  }
  const reportVehicle = document.getElementById('report-vehicle');
  if (reportVehicle) reportVehicle.value = savedVehicle;

  // Load live fuel prices from Bangchak (non-blocking)
  Utils.loadFuelPrices();

  // End mode → show customer dropdown if 'customer' selected
  const endMode = document.getElementById('route-end-mode');
  const endCustomer = document.getElementById('route-end-customer');
  if (endMode && endCustomer) {
    // Populate customer dropdown
    const populateEndCustomers = () => {
      const customers = Storage.getActiveCustomers();
      endCustomer.innerHTML = '<option value="">-- เลือกลูกค้า --</option>' +
        customers.map(c => `<option value="${c.id}">${this.escapeHTML(c.name)} (${this.escapeHTML(c.cif || '-')})</option>`).join('');
    };
    populateEndCustomers();
    // Refresh list when customers change
    document.addEventListener('customersUpdated', populateEndCustomers);

    endMode.addEventListener('change', () => {
      if (endMode.value === 'customer') {
        endCustomer.classList.remove('hidden');
      } else {
        endCustomer.classList.add('hidden');
      }
    });
  }

  // ===== Refresh button binding — กดเดียว = อัปเดตเป็นเวอร์ชันล่าสุดจริง =====
  const btn = document.getElementById('refresh-btn');
  if (btn) {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      btn.classList.add('spinning');
      try {
        if (btn.classList.contains('has-update')) {
          // มีเวอร์ชันใหม่จาก watcher → อัปเดตทันที (ล้าง SW/cache + reload)
          App.applyUpdate();
          return;
        }
        // ยังไม่มี has-update: กดปุ๊บ = ดึงเวอร์ชันล่าสุดเสมอ
        // 1) push ข้อมูลเครื่องขึ้นเว็บก่อน (กันข้อมูลหายตอน reload)
        try {
          const result = await Storage.retrySync();
          if (result && result.success) {
            const c = result.counts || {};
            if (typeof Utils !== 'undefined') {
              Utils.toast(`🔄 Sync สำเร็จ — ${c.customers ?? '?'} ลูกค้า, ${c.visits ?? '?'} visits`);
            }
          } else if (result && result.error) {
            if (typeof Utils !== 'undefined') {
              Utils.toast(`⚠️ Sync ล้มเหลว: ${result.error} — ข้อมูลยังอยู่ในเครื่องนี้`, 'error');
            }
          }
        } catch (err) {
          console.warn('retrySync failed, continuing to refresh:', err);
        }
        // 2) hard refresh — เคลียร์ service worker + cache แล้วโหลดเวอร์ชันใหม่ล่าสุด
        App.hardRefresh();
      } finally {
        btn.classList.remove('spinning');
      }
    });
    // Long-press (or hold 1s) = full hard refresh
    let longPressTimer;
    btn.addEventListener('pointerdown', () => {
      longPressTimer = setTimeout(() => {
        App.hardRefresh();
      }, 1200);
    });
    btn.addEventListener('pointerup', () => clearTimeout(longPressTimer));
    btn.addEventListener('pointerleave', () => clearTimeout(longPressTimer));
  }

  // ===== Update DB button — reload customer data from static DB =====
  const updateBtn = document.getElementById('update-db-btn');
  if (updateBtn) {
    updateBtn.addEventListener('click', async () => {
      updateBtn.classList.add('spinning');
      updateBtn.disabled = true;
      try {
        if (typeof Storage === 'undefined' || !Storage.reloadStaticDB) {
          throw new Error('ฟังก์ชันอัพเดทยังไม่พร้อม');
        }
        const result = await Storage.reloadStaticDB();
        if (typeof Utils !== 'undefined') {
          Utils.toast(`✅ อัพเดทแล้ว: ลบ ${result.removed} รายการเก่า, นำเข้า ${result.imported} รายการใหม่ (${result.total} ในระบบ)`);
        }
        // Re-render everything
        if (typeof Customers !== 'undefined') Customers.renderAll();
        if (typeof Visit !== 'undefined') Visit.render();
        if (typeof App !== 'undefined') App.updateRouteUI();
      } catch (err) {
        if (typeof Utils !== 'undefined') {
          Utils.toast(`❌ อัพเดทล้มเหลว: ${err.message}`, 'error');
        }
        console.error('[UpdateDB]', err);
      } finally {
        updateBtn.classList.remove('spinning');
        updateBtn.disabled = false;
      }
    });
  }

  // Keyboard shortcut: F5 or Ctrl/Cmd+R triggers hard refresh
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'r')) {
      e.preventDefault();
      App.hardRefresh();
    }
  });
});

// ===== Global error handler — show user-friendly message instead of silent failure =====
(function() {
  const originalHandler = window.onerror;
  window.onerror = function(msg, source, line, col, error) {
    // Log to console for debugging
    console.error('[Global Error]', msg, 'at', source, line, col, error);
    // Show user-friendly toast if Utils loaded
    try {
      if (typeof Utils !== 'undefined' && Utils.toast) {
        // Check if it's a known non-critical error we can auto-recover from
        const errStr = String(msg || error?.message || '');
        const warnOnly = errStr.includes('ResizeObserver') ||
                         errStr.includes('Cancelled') ||
                         errStr.includes('AbortError');
        if (!warnOnly) {
          Utils.toast('⚠️ เกิดข้อผิดพลาดเล็กน้อย — กด 🔄 เพื่อรีเฟรชถ้าใช้งานไม่ได้', 'error');
        }
      }
    } catch (_) {}
    // Call original handler if exists
    if (typeof originalHandler === 'function') {
      return originalHandler.call(window, msg, source, line, col, error);
    }
    return true; // Prevent default browser error display
  };

  // Also catch unhandled promise rejections
  window.addEventListener('unhandledrejection', function(e) {
    console.error('[Unhandled Promise]', e.reason);
    try {
      if (typeof Utils !== 'undefined' && Utils.toast) {
        const errStr = String(e.reason?.message || e.reason || '');
        if (!errStr.includes('AbortError') && !errStr.includes('Cancelled')) {
          Utils.toast('⚠️ เกิดข้อผิดพลาด — ถ้าใช้ไม่ได้ลองกด 🔄 รีเฟรช', 'error');
        }
      }
    } catch (_) {}
  });
})();

// ===== Collapsible debt-filter panel (8 ก.ย.69) =====
// default พับเหลือแค่แถบค้นหา — กางเมื่อคลิก ▼, พับเมื่อคลิก ▲ หรือเมื่อแถบล่างขึ้นมา (half/full)
const FilterPanel = {
  _panel: null,
  _toggle: null,

  init() {
    this._panel = document.getElementById('map-debt-filter');
    this._toggle = document.getElementById('mdf-toggle');
    if (!this._panel || !this._toggle) return;
    // default: พับ (HTML มี mdf-collapsed อยู่แล้ว — กันกรณี cache เก่าไม่มี class)
    if (!this._panel.classList.contains('mdf-collapsed') && !this._hasActiveFilter()) {
      this._panel.classList.add('mdf-collapsed');
    }
    this._syncToggle();
    this._toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    // เปลี่ยนฟิลเตอร์ → อัพเดทสีปุ่ม (บอกว่ามีตัวกรอง active)
    this._panel.querySelectorAll('select').forEach(sel => {
      sel.addEventListener('change', () => this._syncToggle());
    });
    const resetBtn = document.getElementById('debt-filter-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => setTimeout(() => this._syncToggle(), 0));
  },

  isCollapsed() {
    return this._panel ? this._panel.classList.contains('mdf-collapsed') : true;
  },

  expand() {
    if (!this._panel) return;
    this._panel.classList.remove('mdf-collapsed');
    this._syncToggle();
    // แผงบนสำคัญ → หุบแถบล่างลงเหลือ peek กันทับซ้อน
    if (typeof App !== 'undefined' && App.setSheetState) {
      const sheet = document.getElementById('bottom-sheet');
      if (sheet && (sheet.classList.contains('sheet-half') || sheet.classList.contains('sheet-full'))) {
        App.setSheetState('peek');
      }
    }
  },

  collapse() {
    if (!this._panel) return;
    if (!this.isCollapsed()) {
      this._panel.classList.add('mdf-collapsed');
      this._syncToggle();
      // ซ่อนผลค้นหาที่ค้าง กันลอยทับแผนที่
      const r = document.getElementById('msb-results');
      if (r) r.classList.add('hidden');
    } else {
      this._syncToggle();
    }
  },

  toggle() {
    if (this.isCollapsed()) this.expand();
    else this.collapse();
  },

  _hasActiveFilter() {
    const ids = ['debt-month-filter', 'debt-tier-filter', 'map-zone-filter', 'debt-omsom-filter', 'debt-15m-filter'];
    return ids.some(id => {
      const el = document.getElementById(id);
      return el && el.value !== '';
    });
  },

  _syncToggle() {
    if (!this._toggle) return;
    const collapsed = this.isCollapsed();
    this._toggle.textContent = collapsed ? '▼' : '▲';
    this._toggle.setAttribute('aria-expanded', String(!collapsed));
    this._toggle.classList.toggle('has-active', this._hasActiveFilter());
  },
};

// ===== Floating Map Search Bar (Google Maps-style) =====
// ค้นหาลูกค้าบนแผนที่ด้วยชื่อ/CIF/เบอร์ — flyTo + open popup
const MapSearch = {
  _input: null,
  _results: null,
  _clearBtn: null,
  _allCustomersCache: null,
  _refreshTimer: null,

  init() {
    this._input = document.getElementById('map-search');
    this._results = document.getElementById('msb-results');
    this._clearBtn = document.getElementById('msb-clear');
    if (!this._input || !this._results) return;

    this._input.addEventListener('input', () => this._onInput());
    this._input.addEventListener('focus', () => { if (this._input.value) this._onInput(); });
    this._clearBtn.addEventListener('click', () => this._clear());

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
      const bar = document.getElementById('map-debt-filter');
      if (bar && !bar.contains(e.target)) this._hideResults();
    });

    // Refresh cache every 30s (customers may change via sync/import)
    this._refreshTimer = setInterval(() => { this._allCustomersCache = null; }, 30000);
  },

  _getCustomers() {
    if (this._allCustomersCache) return this._allCustomersCache;
    if (typeof Storage !== 'undefined' && Storage.getActiveCustomers) {
      this._allCustomersCache = Storage.getActiveCustomers();
    } else {
      this._allCustomersCache = [];
    }
    return this._allCustomersCache;
  },

  _onInput() {
    const q = this._input.value.trim();
    this._clearBtn.classList.toggle('hidden', !q);

    if (!q || q.length < 1) { this._hideResults(); return; }

    const query = q.toLowerCase();
    const customers = this._getCustomers();

    // Match: name, nickname, CIF, phone (exact + partial)
    const matches = customers.filter(c => {
      const name = (c.name || '').toLowerCase();
      const nick = (c.nickname || '').toLowerCase();
      const cif = String(c.cif || '');
      const phone = String(c.phone || '');
      return name.includes(query) || nick.includes(query) || cif.includes(query) || phone.includes(query);
    });
    const top = matches.slice(0, 6);

    if (top.length === 0) {
      this._results.innerHTML = '<div class="msb-no-results">ไม่พบลูกค้าที่ตรงกับ "<strong>' + this._esc(q) + '</strong>"</div>';
      this._results.classList.remove('hidden');
      return;
    }

    const riskColors = { 'แดง': '#d32f2f', 'เหลือง': '#e6a817', 'เขียว': '#16a34a' };
    this._results.innerHTML = top.map(c => {
      const color = riskColors[c.riskLevel] || '#9e9e9e';
      const sub = [c.cif ? 'CIF:' + c.cif : '', c.phone, c.nickname].filter(Boolean).join(' · ');
      const id = c.id || c.cif;
      return '<div class="msb-result-item" data-id="' + this._escAttr(id) + '" role="option">' +
        '<span class="msb-result-dot" style="background:' + color + '"></span>' +
        '<div class="msb-result-info">' +
          '<div class="msb-result-name">' + this._esc(c.name || 'ไม่มีชื่อ') + '</div>' +
          '<div class="msb-result-meta">' + this._esc(sub || '-') + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    // Bind clicks
    const self = this;
    this._results.querySelectorAll('.msb-result-item').forEach(el => {
      el.addEventListener('click', () => self._select(el.dataset.id));
    });

    this._results.classList.remove('hidden');
  },

  _select(id) {
    const customers = this._getCustomers();
    const c = customers.find(x => (x.id === id) || String(x.cif) === id);
    if (!c) return;

    if (!c.lat || !c.lng) {
      if (typeof Utils !== 'undefined') Utils.toast('⚠️ ลูกค้านี้ไม่มีพิกัดบนแผนที่', 'warn');
      this._clear();
      this._hideResults();
      return;
    }

    // Collapse bottom sheet to show full map
    if (typeof App !== 'undefined' && App.setSheetState) App.setSheetState('peek');

    // Fly to marker + open popup (reuse Customers pattern)
    if (typeof Customers !== 'undefined' && Customers.map) {
      Customers.map.flyTo([c.lat, c.lng], 17, { duration: 0.8 });
      setTimeout(() => {
        if (Customers.markers && Customers.markers[c.id]) {
          Customers.map.openPopup(Customers.markers[c.id]);
        } else if (Customers.markers) {
          // Try by cif
          for (const [mid, m] of Object.entries(Customers.markers)) {
            if (mid === c.id || String(mid) === String(c.id || c.cif)) {
              Customers.map.openPopup(m);
              break;
            }
          }
        }
      }, 900);
    }

    this._clear();
    this._hideResults();
    this._input.blur(); // hide mobile keyboard
  },

  _clear() {
    if (this._input) this._input.value = '';
    if (this._clearBtn) this._clearBtn.classList.add('hidden');
    this._hideResults();
  },

  _hideResults() {
    if (this._results) this._results.classList.add('hidden');
  },

  _esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },

  _escAttr(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  },
};
