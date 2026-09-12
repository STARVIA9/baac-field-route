// ===== DebtSummary — แสดงภาพรวมหนี้ทั้งสาขา (แท็บ 📊 สรุปหนี้) =====
// ข้อมูลจาก DebtDB (Customer Indicator)

const DebtSummary = {
  async render() {
    if (!window.DebtDB || !DebtDB._loaded) {
      this._setSub('ข้อมูลหนี้ยังไม่โหลด');
      if (window.DebtDB && !DebtDB._loaded) DebtDB.load().then(() => this.render());
      return;
    }
    // อัพหนี้ใหม่ระหว่างเปิดแอปค้างไว้ → refresh เงียบๆ ถ้า cache เก่าเกิน 2 นาที
    const staleMs = Date.now() - (DebtDB._loadedAt || 0);
    if (staleMs > 120000) {
      DebtDB._loadedAt = Date.now(); // กัน refresh ซ้ำเป็น loop
      DebtDB.refresh().then((ok) => { if (ok) this.render(); });
    }
    const data = [...DebtDB._byCif.values()];

    // ===== ภาพรวม =====
    const totalCif = data.length;
    const totalDebt = data.reduce((s, r) => s + (+r.total_debt || 0), 0);

    const self = this;
    const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 });
    const sub = document.getElementById('debt-summary-sub');
    if (sub) sub.textContent = `ลูกค้า ${totalCif.toLocaleString('th-TH')} ราย · ${data.reduce((s,r)=>s+(+r.num_contracts||0),0).toLocaleString('th-TH')} สัญญา` +
      ` · หนี้รวม ${fmt(totalDebt)} บาท`;

    // การ์ดภาพรวม
    const ov = document.getElementById('debt-overview-cards');
    if (ov) {
      ov.innerHTML = `
        <div class="dov-card dov-green"><span class="dov-num">${fmt(totalDebt)}</span><span class="dov-label">หนี้รวม (บาท)</span></div>
        <div class="dov-card dov-blue"><span class="dov-num">${totalCif.toLocaleString('th-TH')}</span><span class="dov-label">ลูกค้าหนี้</span></div>
        <div class="dov-card dov-amber"><span class="dov-num">${data.reduce((s,r)=>s+(+r.num_contracts||0),0).toLocaleString('th-TH')}</span><span class="dov-label">สัญญา</span></div>
      `;
    }

    // ===== แยกตามกลุ่มสี (จาก Customer Indicator via CustomerDB potential) =====
    // ใช้ debt-data ไม่มี color ตรงๆ -> ใช้ customer list (Storage) หา potential
    // แต่ summary นี้อิงข้อมูลหนี้เป็นหลัก; เรียงตามชั้นหนี้แทน และให้ block สีใช้จาก Storage
    const colorBlock = document.getElementById('debt-color-block');
    const customers = typeof Storage !== 'undefined' ? Storage.getActiveCustomers() : [];
    const colorCount = { แดง: 0, เหลือง: 0, เขียว: 0 };
    const colorDebt = { แดง: 0, เหลือง: 0, เขียว: 0 };
    for (const c of customers) {
      const db = c.cif && window.CustomerDB && CustomerDB._loaded ? CustomerDB.getByCif(c.cif) : null;
      const p = db ? db.potential : null;
      if (p && colorCount[p] !== undefined) {
        colorCount[p]++;
        const debt = c.cif ? DebtDB.getByCif(c.cif) : null;
        colorDebt[p] += (debt ? +debt.total_debt || 0 : 0);
      }
    }
    if (colorBlock) {
      const totalColor = (colorCount['แดง'] + colorCount['เหลือง'] + colorCount['เขียว']) || 1;
      colorBlock.innerHTML = `
        <div class="ds-row"><span class="ds-label" style="color:#d00000">🔴 แดง</span><span class="ds-val">${colorCount['แดง']} ราย (${Math.round(colorCount['แดง']/totalColor*100)}%) · ${fmt(colorDebt['แดง'])} บาท</span></div>
        <div class="ds-row"><span class="ds-label" style="color:#d97706">🟡 เหลือง</span><span class="ds-val">${colorCount['เหลือง']} ราย (${Math.round(colorCount['เหลือง']/totalColor*100)}%) · ${fmt(colorDebt['เหลือง'])} บาท</span></div>
        <div class="ds-row"><span class="ds-label" style="color:#16a34a">🟢 เขียว</span><span class="ds-val">${colorCount['เขียว']} ราย (${Math.round(colorCount['เขียว']/totalColor*100)}%) · ${fmt(colorDebt['เขียว'])} บาท</span></div>
      `;
      if (totalColor === 1 && colorCount['แดง']+colorCount['เหลือง']+colorCount['เขียว'] === 0) {
        colorBlock.innerHTML = '<div class="ds-note">ไม่พบข้อมูลศักยภาพ (กรอกข้อมูลลูกค้ายังไม่ครบ)</div>';
      }
    }

    // ===== แยกตามชั้นหนี้ =====
    const tierBlock = document.getElementById('debt-tier-block');
    if (tierBlock) {
      const tierCount = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const tierDebt = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const r of data) {
        const t = parseInt(r.max_tier) || 0;
        if (tierCount[t] !== undefined) { tierCount[t]++; tierDebt[t] += (+r.total_debt || 0); }
      }
      const labels = { 1: 'ชั้น 1', 2: 'ชั้น 2', 3: 'ชั้น 3', 4: 'ชั้น 4', 5: 'ชั้น 5' };
      tierBlock.innerHTML = Object.keys(tierCount).map(t => `
        <div class="ds-row ds-clickable" onclick="DebtSummary.drillDown('tier', '${t}')">
          <span class="ds-label" style="color:${DebtDB.tierColor(t)}">🏷️ ${labels[t]}</span>
          <span class="ds-val">${tierCount[t].toLocaleString('th-TH')} ราย · ${fmt(tierDebt[t])} บาท ▸</span>
        </div>
        <div class="ds-bar"><div class="ds-bar-fill" style="width:${(tierCount[t]/data.length*100)||0}%;background:${t>=2?'#d00000':'#16a34a'}"></div></div>
      `).join('');
    }

    // ===== แยกตามเขต (zone 1-5 จากฐานลูกค้า ผูกกับหนี้ผ่าน CIF) =====
    const zoneBlock = document.getElementById('debt-zone-block');
    if (zoneBlock) {
      if (!window.CustomerDB || !CustomerDB._loaded) {
        zoneBlock.innerHTML = '<div class="ds-note">กำลังโหลดฐานข้อมูลลูกค้า...</div>';
        if (window.CustomerDB && !CustomerDB._loaded) CustomerDB.load().then(() => this.render());
      } else {
        const zoneCount = {};
        const zoneDebt = {};
        const zoneOrder = ['1', '2', '3', '4', '5'];
        for (const r of data) {
          const cust = r.cif ? CustomerDB.getByCif(String(r.cif).trim()) : null;
          let z = cust && cust.zone ? String(cust.zone).trim() : '';
          if (!z) z = 'ไม่ระบุ';   // CIF ไม่มีในฐานลูกค้า หรือ zone ว่าง
          zoneCount[z] = (zoneCount[z] || 0) + 1;
          zoneDebt[z] = (zoneDebt[z] || 0) + (+r.total_debt || 0);
        }
        // เรียง: เขต 1-5 ก่อน แล้วรหัสพิเศษ (9807/76003/...) แล้วไม่ระบุเขตท้ายสุด
        const zoneKeys = Object.keys(zoneCount).sort((a, b) => {
          const ia = zoneOrder.indexOf(a), ib = zoneOrder.indexOf(b);
          if (ia >= 0 && ib >= 0) return ia - ib;
          if (ia >= 0) return -1;
          if (ib >= 0) return 1;
          if (a === 'ไม่ระบุ') return 1;
          if (b === 'ไม่ระบุ') return -1;
          return a.localeCompare(b);
        });
        const zoneTotal = zoneKeys.reduce((s, k) => s + zoneCount[k], 0) || 1;
        zoneBlock.innerHTML = zoneKeys.map(z => `
          <div class="ds-row"><span class="ds-label">🗺️ ${z === 'ไม่ระบุ' ? 'ไม่ระบุเขต' : 'เขต ' + z}</span><span class="ds-val">${zoneCount[z].toLocaleString('th-TH')} ราย · ${fmt(zoneDebt[z])} บาท</span></div>
          <div class="ds-bar"><div class="ds-bar-fill" style="width:${(zoneCount[z] / zoneTotal * 100) || 0}%;background:#0f766e"></div></div>
        `).join('');
      }
    }

    // ===== หนี้ถึงกำหนดรายเดือน (ปีบัญชีปัจจุบัน: มิ.ย.69 -> มี.ค.70) =====
    const monthBlock = document.getElementById('debt-month-block');
    if (monthBlock) {
      // key ตัวเลข YYYYMM สำหรับช่วงปีบัญชี
      const ykey = (mmyy) => { const p = String(mmyy).split('/'); return (+p[1]) * 100 + (+p[0]); };
      const FY_START = ykey('06/2026');   // มิ.ย. 2569
      const FY_END = ykey('03/2027');     // มี.ค. 2570
      const monthCount = {};
      const monthDebt = {};    // ยอดหนี้รวมต่อเดือน (total_debt ของ CIF ที่ถึงกำหนดเดือนนั้น)
      const monthOmsom = {};   // จำนวน อสม. ต่อเดือน
      let fyTotal = 0, fyOmsom = 0, fyDebt = 0;
      for (const r of data) {
        const k = DebtDB.dueMonthKey(r.earliest_due);
        if (!k) continue;
        const kv = ykey(k);
        if (kv >= FY_START && kv <= FY_END) {
          monthCount[k] = (monthCount[k] || 0) + 1;
          monthDebt[k] = (monthDebt[k] || 0) + (+r.total_debt || 0);
          fyTotal++;
          fyDebt += (+r.total_debt || 0);
          if (r.is_omsom) {
            fyOmsom++;
            monthOmsom[k] = (monthOmsom[k] || 0) + 1;
          }
        }
      }
      const sortedMonths = Object.keys(monthCount).sort((a, b) => ykey(a) - ykey(b));
      if (sortedMonths.length === 0) {
        monthBlock.innerHTML = '<div class="ds-note">ไม่มีหนี้ถึงกำหนดในปีบัญชีนี้</div>';
      } else {
        // แถวรวม (แยก อสม.) + รายเดือนช่วง มิ.ย.69-มี.ค.70 (วงเล็บจำนวน อสม.)
        const header = `
          <div class="ds-row ds-total"><span class="ds-label">📊 เหลือทั้งปีบัญชี</span><span class="ds-val">${fyTotal.toLocaleString('th-TH')} ราย · ${fmt(fyDebt)} บาท</span></div>
          <div class="ds-row"><span class="ds-label">👤 ลูกค้าทั่วไป</span><span class="ds-val">${(fyTotal - fyOmsom).toLocaleString('th-TH')} ราย</span></div>
          <div class="ds-row"><span class="ds-label">🩺 อสม. (3080/2838/2751)</span><span class="ds-val">${fyOmsom.toLocaleString('th-TH')} ราย</span></div>
        `;
        const rows = sortedMonths.map(k => `
          <div class="ds-row">
            <span class="ds-label">📅 ${DebtDB.fmtDate('01/' + k)}</span>
            <span class="ds-val">${monthCount[k].toLocaleString('th-TH')} ราย · ${fmt(monthDebt[k])} บาท${monthOmsom[k] ? ` (อสม. ${monthOmsom[k].toLocaleString('th-TH')})` : ''}</span>
          </div>
        `).join('');
        monthBlock.innerHTML = `${header}${rows}`;
      }
    }

    // ===== สถานะพิกัด =====
    // Server-authoritative: อ่าน counts.gps จาก /api/sync (D1) — ทุกเครื่องเห็นเลขเดียวกัน
    // ถ้าเรียก API ไม่ได้ (offline) → fallback นับจาก localStorage เครื่องนี้
    const geoBlock = document.getElementById('debt-geo-block');
    if (geoBlock) {
      let withGeo = 0, withoutGeo = 0;
      try {
        const res = await API.get('/api/sync');
        const c = res && res.success ? res.counts : null;
        if (c && c.gps != null && c.customers != null) {
          withGeo = c.gps;
          withoutGeo = Math.max(c.customers - c.gps, 0);
        } else {
          throw new Error('no counts');
        }
      } catch (e) {
        // Fallback: local count
        const hasGeoCif = new Set(
          (typeof Storage !== 'undefined' ? Storage.getActiveCustomers() : [])
            .filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng))
            .map(x => String(x.cif))
        );
        for (const r of data) {
          if (hasGeoCif.has(String(r.cif))) withGeo++;
          else withoutGeo++;
        }
      }
      const pctBase = withGeo + withoutGeo;
      const pct = pctBase ? Math.round(withGeo / pctBase * 100) : 0;
      geoBlock.innerHTML = `
        <div class="ds-row"><span class="ds-label" style="color:#16a34a">📍 มีพิกัดแล้ว</span><span class="ds-val">${withGeo.toLocaleString('th-TH')} ราย (${pct}%)</span></div>
        <div class="ds-bar"><div class="ds-bar-fill" style="width:${pct}%;background:#16a34a"></div></div>
        <div class="ds-row"><span class="ds-label" style="color:#d00000">⚠️ ยังไม่มีพิกัด</span><span class="ds-val">${withoutGeo.toLocaleString('th-TH')} ราย</span></div>
      `;
    }

    // ===== 15 เดือน =====
    const m15Block = document.getElementById('debt-15m-block');
    if (m15Block) {
      let cifM15Y=0, cifM15Amt=0, cifF08=0, cifF09=0, cifF10=0;
      let totM15Amt=0, totP08=0, totP09=0, totP10=0;
      let cntM15Y=0, cntM15Amt=0, cntF08=0, cntF09=0, cntF10=0;
      for (const r of data) {
        let hasY=false, hasAmt=false, hasF08=false, hasF09=false, hasF10=false;
        for (const c of (r.contracts||[])) {
          if (c.m15==='Y') cntM15Y++;
          if ((c.m15_amt||0)>0) cntM15Amt++;
          if (c.f08==='Y') cntF08++;
          if (c.f09==='Y') cntF09++;
          if (c.f10==='Y') cntF10++;
          if (c.m15==='Y' && !hasY) hasY=true;
          if ((c.m15_amt||0)>0 && !hasAmt) hasAmt=true;
          if (c.f08==='Y' && !hasF08) hasF08=true;
          if (c.f09==='Y' && !hasF09) hasF09=true;
          if (c.f10==='Y' && !hasF10) hasF10=true;
        }
        if (hasY) cifM15Y++;
        if (hasAmt) cifM15Amt++;
        if (hasF08) cifF08++;
        if (hasF09) cifF09++;
        if (hasF10) cifF10++;
      }
      for (const r of data) for (const c of (r.contracts||[])) {
        totM15Amt += (+c.m15_amt||0);
        totP08 += (+c.p08||0);
        totP09 += (+c.p09||0);
        totP10 += (+c.p10||0);
      }
      m15Block.innerHTML = `
        <div class="ds-row"><span class="ds-label">⏳ 15เดือนปัจจุบัน (Y)</span><span class="ds-val">${cifM15Y.toLocaleString('th-TH')} ราย · ${cntM15Y} สัญญา</span></div>
        <div class="ds-row"><span class="ds-label">💸 31มี.ค.70 ขั้นต่ำ</span><span class="ds-val">${cifM15Amt.toLocaleString('th-TH')} ราย · ${cntM15Amt} สัญญา · ${fmt(totM15Amt)} บาท</span></div>
        <div class="ds-row" style="margin-top:6px"><span class="ds-label" style="color:#7c3aed">🔮 คาด ส.ค.69</span><span class="ds-val">${cifF08.toLocaleString('th-TH')} ราย · ${cntF08} สัญญา · ${fmt(totP08)} บาท</span></div>
        <div class="ds-row"><span class="ds-label" style="color:#7c3aed">🔮 คาด ก.ย.69</span><span class="ds-val">${cifF09.toLocaleString('th-TH')} ราย · ${cntF09} สัญญา · ${fmt(totP09)} บาท</span></div>
        <div class="ds-row"><span class="ds-label" style="color:#7c3aed">🔮 คาด ต.ค.69</span><span class="ds-val">${cifF10.toLocaleString('th-TH')} ราย · ${cntF10} สัญญา · ${fmt(totP10)} บาท</span></div>
      `;
    }
  },

  _setSub(msg) {
    const sub = document.getElementById('debt-summary-sub');
    if (sub) sub.textContent = msg;
  },

  // ===== Drill-down: show customers filtered by tier =====
  drillDown(type, value) {
    if (type === 'tier') {
      // Switch to customers tab and filter by debt tier
      const customers = Storage.getActiveCustomers();
      const filtered = customers.filter(c => {
        if (!c.cif || !DebtDB._loaded) return false;
        const debt = DebtDB.getByCif(c.cif);
        if (!debt) return false;
        return parseInt(debt.max_tier) === parseInt(value);
      });

      // Show results in a simple alert or switch to customers tab
      if (filtered.length === 0) {
        Utils.toast(`ไม่พบลูกค้าชั้นหนี้ ${value}`);
        return;
      }

      // Switch to customers tab and set filter
      App.switchSheetTab('customers');
      const searchInput = document.getElementById('customer-search');
      if (searchInput) {
        // Use search to filter — set a temporary filter
        searchInput.value = '';
        Customers.currentFilter = 'all';
        Customers.renderList();
        Utils.toast(`📋 แสดงลูกค้าชั้น ${value}: ${filtered.length} ราย — ใช้ค้นหาเพื่อกรองเพิ่ม`);
      }
    }
  },
};

window.DebtSummary = DebtSummary;
