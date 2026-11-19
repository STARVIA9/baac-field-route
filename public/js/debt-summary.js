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
    const self = this;
    const data = [...DebtDB._byCif.values()];

    // ===== ตัวกรองสาขา (16 ต.ค.69): ผูกหนี้กับสาขา =====
    // 17 พ.ย.69: ใช้ป้ายสาขาที่ติดมากับข้อมูลหนี้ก่อน (r.branch) — CustomerDB มีแค่ 10,000 แรก
    // ทำให้ลูกค้าที่ไม่อยู่ในรายชื่อถูกตัดออกจากยอดรวม (3,126 จาก 3,716 ราย · หาย 394 ล้าน)
    const branchOf = (r) => {
      const own = String((r && r.branch) || '').trim();
      if (own) return own;
      const cust = r.cif && window.CustomerDB && CustomerDB._loaded ? CustomerDB.getByCif(String(r.cif).trim()) : null;
      return cust && cust.branch ? String(cust.branch).trim() : '';
    };
    // dropdown เติมจากสาขาที่มีในฐานลูกค้าจริง + สาขาที่คีย์ไว้ทั้งหมดในระบบ (branches:all)
    const brSel = document.getElementById('debt-branch-filter');
    if (!this._branches) {
      this._branchesAt = Date.now();
      try { fetch('/api/branches').then(r => r.json()).then(j => { this._branches = (j && j.branches) || []; this.render(); }).catch(() => {}); } catch { /* ignore */ }
    }
    if (brSel) {
      // 17 พ.ย.69: เติมจากทุกแหล่งโดยไม่ต้องรอฐานรายชื่อ — branches:all (สาขาที่คีย์ไว้) + คลังหนี้ + ฐานลูกค้า (ถ้าโหลดแล้ว)
      const names = {};
      for (const b of (this._branches || [])) names[String(b.code || '').trim()] = b.name || ('สาขา ' + b.code);
      const seen = new Set();
      for (const b of (this._branches || [])) { const c = String(b.code || '').trim(); if (c) seen.add(c); }
      try { data.forEach(r => { const b = String(r.branch || '').trim(); if (b) seen.add(b); }); } catch { /* ignore */ }
      if (window.CustomerDB && CustomerDB._loaded) {
        CustomerDB._byCif.forEach(r => { const b = String(r.branch || '').trim(); if (b) seen.add(b); });
      }
      const cur = self.selBranch || 'ALL';
      brSel.innerHTML = `<option value="ALL">ทุกสาขา</option>` + [...seen].sort().map(b =>
        `<option value="${b}"${b === cur ? ' selected' : ''}>${names[b] || ('สาขา ' + b)}</option>`).join('');
      if (cur !== 'ALL' && !seen.has(cur)) self.selBranch = 'ALL';
      brSel.onchange = async () => {
        self.selBranch = brSel.value || 'ALL';
        const b = self.selBranch;
        try {
          if (b === 'ALL') {
            if (window.DebtDB && DebtDB.loadAllBranches && DebtDB._partial) await DebtDB.loadAllBranches();
          } else if (window.DebtDB && DebtDB.ensureBranch) {
            await DebtDB.ensureBranch(b);
          }
        } catch { /* ignore */ }
        self.render();
      };
    }
    const B = self.selBranch || 'ALL';
    const fdata = B === 'ALL' ? data : data.filter(r => branchOf(r) === B);

    // Good/Bad ตัวจริงจากไฟล์หนี้ (ช่องโครงการนำร่อง) — ข้อมูลเก่าที่ยังไม่มี gb ให้โชว์ทั้งหมดไปก่อน
    const hasGb = fdata.some(r => r.gb === 'GOOD' || r.gb === 'BAD');

    // ===== ภาพรวม =====
    // 17 พ.ย.69: ตัวเลขหลักยึดจากเซิร์ฟเวอร์ (COUNT/SUM ใน D1) ก่อน — ห้ามขาดแม้โหลดแถวมาไม่ครบ
    let totalCif = fdata.length;
    let totalDebt = fdata.reduce((s, r) => s + (+r.total_debt || 0), 0);
    {
      const st = this._stats;
      if (st && st.success) {
        if (B === 'ALL') {
          if (typeof st.with_debt === 'number') totalCif = st.with_debt;
          if (typeof st.debt_total === 'number') totalDebt = st.debt_total;
        } else {
          const row = (st.by_branch || []).find(x => String(x.branch) === String(B));
          if (row) { totalCif = row.with_debt; totalDebt = row.debt_total; }
        }
      }
    }
    const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 });
    const sub = document.getElementById('debt-summary-sub');
    if (sub) {
      // 17 พ.ย.69: ตัวเลข "ลูกค้าทั้งหมดของสาขา" มาจากเซิร์ฟเวอร์ (COUNT) — ไม่ต้องโหลดรายชื่อทั้งก้อน
      let allLine = '';
      try {
        const st = this._stats;
        if (st && st.success) {
          const b = (B && B !== 'ALL') ? (st.by_branch || []).find(x => String(x.branch) === String(B)) : null;
          const nAll = b ? b.customers : st.total_customers;
          if (nAll != null) allLine = ` · ลูกค้าทั้งสาขา ${Number(nAll).toLocaleString('th-TH')} ราย`;
        }
      } catch { /* ไม่มีตัวเลขรวมก็ไม่เป็นไร */ }
      sub.textContent = `ลูกค้า ${totalCif.toLocaleString('th-TH')} ราย · ${fdata.reduce((s,r)=>s+(+r.num_contracts||0),0).toLocaleString('th-TH')} สัญญา` +
        ` · หนี้รวม ${fmt(totalDebt)} บาท` + (B !== 'ALL' ? ` · สาขา ${B}` : '') + allLine +
        ((window.DebtDB && DebtDB._partial) ? ' · ⏳ ทยอยโหลดสาขาอื่น' : '');
    }
    // ดึงตัวเลขรวมจากเซิร์ฟเวอร์ครั้งเดียว (ไม่บล็อกการวาด) แล้ววาดใหม่
    if (!this._stats || (Date.now() - (this._statsAt || 0)) > 300000) {
      this._statsAt = Date.now();
      try {
        fetch(API.baseUrl() + '/api/customers/stats', { headers: API.headers() })
          .then(r => r.json())
          .then(j => { if (j && j.success) { this._stats = j; this.render(); } })
          .catch(() => {});
      } catch { /* ignore */ }
    }

    // การ์ดภาพรวม
    const ov = document.getElementById('debt-overview-cards');
    if (ov) {
      ov.innerHTML = `
        <div class="dov-card dov-green"><span class="dov-num">${fmt(totalDebt)}</span><span class="dov-label">หนี้รวม (บาท)</span></div>
        <div class="dov-card dov-blue"><span class="dov-num">${totalCif.toLocaleString('th-TH')}</span><span class="dov-label">ลูกค้าหนี้</span></div>
        <div class="dov-card dov-amber"><span class="dov-num">${fdata.reduce((s,r)=>s+(+r.num_contracts||0),0).toLocaleString('th-TH')}</span><span class="dov-label">สัญญา</span></div>
      `;
    }

    // ===== แยกตามกลุ่มสี (เขียว/เหลือง/แดง) =====
    // แหล่งหลัก: ค่าศักยภาพที่ติดมากับไฟล์ Customer Indicator (r.potential ในคลังการ์ดหนี้)
    // — อัปไฟล์หนี้รอบใหม่ = สีของทุกสาขา (รวมบ้านสร้าง) ขึ้นทันที ไม่ต้องรอกรอกฐานลูกค้า
    // แหล่งสำรอง: ฐานลูกค้าเดิม (CustomerDB.potential) สำหรับข้อมูลชุดเก่าที่ยังไม่มีสีในคลังหนี้
    const colorBlock = document.getElementById('debt-color-block');
    const colorCount = { แดง: 0, เหลือง: 0, เขียว: 0 };
    const colorDebt = { แดง: 0, เหลือง: 0, เขียว: 0 };
    let haveDebtColor = false;
    for (const r of fdata) {
      const p = String(r.potential || '').trim();
      if (colorCount[p] !== undefined) {
        colorCount[p]++;
        colorDebt[p] += (+r.total_debt || 0);
        haveDebtColor = true;
      }
    }
    // 19 พ.ย.69: รายชื่อในเครื่องใช้ทั้งบล็อกสี (สำรอง) และบล็อกสถานะพิกัด —
    // เดิมประกาศในปีก if (!haveDebtColor) ทำให้ปีกสถานะพิกัดอ้างไม่ได้ (bcust is not defined)
    const customers = typeof Storage !== 'undefined' ? Storage.getActiveCustomers() : [];
    const bcust = B === 'ALL' ? customers : customers.filter(c => String(c.branch || '').trim() === B);
    if (!haveDebtColor) {
      for (const c of bcust) {
        const db = c.cif && window.CustomerDB && CustomerDB._loaded ? CustomerDB.getByCif(c.cif) : null;
        const p = db ? db.potential : null;
        if (p && colorCount[p] !== undefined) {
          colorCount[p]++;
          const debt = c.cif ? DebtDB.getByCif(c.cif) : null;
          colorDebt[p] += (debt ? +debt.total_debt || 0 : 0);
        }
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
      for (const r of fdata) {
        const t = parseInt(r.max_tier) || 0;
        if (tierCount[t] !== undefined) { tierCount[t]++; tierDebt[t] += (+r.total_debt || 0); }
      }
      const labels = { 1: 'ชั้น 1', 2: 'ชั้น 2', 3: 'ชั้น 3', 4: 'ชั้น 4', 5: 'ชั้น 5' };
      let goodN = 0, goodD = 0, badN = 0, badD = 0;
      for (const r of fdata) {
        if (r.gb === 'BAD') { badN++; badD += (+r.total_debt || 0); }
        else if (!hasGb || r.gb === 'GOOD') { goodN++; goodD += (+r.total_debt || 0); }
      }
      tierBlock.innerHTML = `
        ${hasGb
          ? `<div class="ds-row ds-total"><span class="ds-label">✅ Good Bank</span><span class="ds-val">${goodN.toLocaleString('th-TH')} ราย · ${fmt(goodD)} บาท</span></div>
             <div class="ds-row ds-total"><span class="ds-label" style="color:#d00000">⛔ Bad Bank</span><span class="ds-val" style="color:#d00000">${badN.toLocaleString('th-TH')} ราย · ${fmt(badD)} บาท</span></div>`
          : `<div class="ds-note">อัพไฟล์หนี้รอบใหม่เพื่อดู Good/Bad Bank</div>`}
      ` + Object.keys(tierCount).map(t => `
        <div class="ds-row ds-clickable" onclick="DebtSummary.drillDown('tier', '${t}')">
          <span class="ds-label" style="color:${DebtDB.tierColor(t)}">🏷️ ${labels[t]}</span>
          <span class="ds-val">${tierCount[t].toLocaleString('th-TH')} ราย · ${fmt(tierDebt[t])} บาท ▸</span>
        </div>
        <div class="ds-bar"><div class="ds-bar-fill" style="width:${(tierCount[t]/fdata.length*100)||0}%;background:${t>=2?'#d00000':'#16a34a'}"></div></div>
      `).join('');
    }

    // ===== แยกตามเขต (ใช้ zone ที่ติดมากับข้อมูลหนี้ — ไม่ต้องรอฐานรายชื่อ) =====
    const zoneBlock = document.getElementById('debt-zone-block');
    if (zoneBlock) {
      {
        const zoneCount = {};
        const zoneDebt = {};
        const zoneOrder = ['1', '2', '3', '4', '5'];
        for (const r of fdata) {
          if (hasGb && r.gb !== 'GOOD') continue;   // โซนโชว์เฉพาะ Good Bank (ตามไฟล์หนี้)
          let z = String((r && r.zone) || '').trim();
          if (!z && window.CustomerDB && CustomerDB._loaded) {
            const cust = r.cif ? CustomerDB.getByCif(String(r.cif).trim()) : null;
            z = cust && cust.zone ? String(cust.zone).trim() : '';
          }
          if (!z) z = 'ไม่ระบุ';
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

    // ===== แยกตามเขต: ถึงกำหนด + 15 เดือน (บล็อก action รวม ดูง่ายแถวเดียวต่อเขต) =====
    // ตัวเลือกเดือนถึงกำหนด: เดือนปัจจุบัน → มี.ค.70 + ทั้งปีบัญชี (default)
    const dueSel = document.getElementById('debt-duemonth-filter');
    if (dueSel) {
      const _now = new Date(), _keys = [];
      let _y = _now.getFullYear(), _m = _now.getMonth() + 1;
      while (_y * 100 + _m <= 202703) {
        _keys.push(String(_m).padStart(2, '0') + '/' + _y);
        if (++_m > 12) { _m = 1; _y++; }
      }
      const _cur = self.selMonth || 'ALL';
      dueSel.innerHTML = `<option value="ALL">ทั้งปีบัญชี</option>` +
        _keys.map(k => `<option value="${k}"${k === _cur ? ' selected' : ''}>${DebtDB.fmtDate('01/' + k)}</option>`).join('');
      dueSel.onchange = () => { self.selMonth = dueSel.value; self.render(); };
    }
    const dueLabel = (self.selMonth && self.selMonth !== 'ALL') ? DebtDB.fmtDate('01/' + self.selMonth) : 'ปีนี้';
    const zdBlock = document.getElementById('debt-zonedue-block');
    if (zdBlock) {
      {
        const yk = (mmyy) => { const p = String(mmyy).split('/'); return (+p[1]) * 100 + (+p[0]); };
        const FYS = yk('06/2026'), FYE = yk('03/2027');   // ปีบัญชีเดียวกับบล็อกรายเดือน
        const zc = {}, zfy = {}, zfyD = {};
        const zoneOf = (r) => {
          const own = String((r && r.zone) || '').trim();
          if (own) return own;   // ใช้เขตที่ติดมากับข้อมูลหนี้ก่อน (ไม่ต้องพึ่งฐานรายชื่อ)
          const cust = (window.CustomerDB && CustomerDB._loaded && r.cif) ? CustomerDB.getByCif(String(r.cif).trim()) : null;
          const z = cust && cust.zone ? String(cust.zone).trim() : '';
          return z || 'ไม่ระบุ';
        };
        for (const r of fdata) {
          if (hasGb && r.gb !== 'GOOD') continue;   // โซนโชว์เฉพาะ Good Bank (ตามไฟล์หนี้)
          const z = zoneOf(r);
          zc[z] = (zc[z] || 0) + 1;
          const k = DebtDB.dueMonthKey(r.earliest_due);
          if (k) {
            const kv = yk(k);
            // เลือกเดือนเดียว → เอาเฉพาะเดือนนั้น, ทั้งปีบัญชี → ช่วง มิ.ย.69-มี.ค.70
            const inScope = (self.selMonth && self.selMonth !== 'ALL') ? (k === self.selMonth) : (kv >= FYS && kv <= FYE);
            if (inScope) {
              zfy[z] = (zfy[z] || 0) + 1;
              zfyD[z] = (zfyD[z] || 0) + (+r.total_debt || 0);
            }
          }
        }
        const zdOrder = ['1', '2', '3', '4', '5'];
        const zdKeys = Object.keys(zc).sort((a, b) => {
          const ia = zdOrder.indexOf(a), ib = zdOrder.indexOf(b);
          if (ia >= 0 && ib >= 0) return ia - ib;
          if (ia >= 0) return -1;
          if (ib >= 0) return 1;
          if (a === 'ไม่ระบุ') return 1;
          if (b === 'ไม่ระบุ') return -1;
          return a.localeCompare(b);
        });
        const gv = (o, k) => (o[k] || 0);
        const totFy = zdKeys.reduce((s, k) => s + gv(zfy, k), 0);
        const totFyD = zdKeys.reduce((s, k) => s + gv(zfyD, k), 0);
        zdBlock.innerHTML = `
          <div class="ds-row ds-total"><span class="ds-label">📊 รวมทุกเขต</span><span class="ds-val">📅 ${dueLabel} ${totFy.toLocaleString('th-TH')} ราย · ${fmt(totFyD)} บาท</span></div>` +
          zdKeys.map(z => `
          <div class="ds-row"><span class="ds-label">🗺️ ${z === 'ไม่ระบุ' ? 'ไม่ระบุเขต' : 'เขต ' + z}</span><span class="ds-val">📅 ${dueLabel} ${gv(zfy, z).toLocaleString('th-TH')} ราย · ${fmt(gv(zfyD, z))} บาท</span></div>
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
      for (const r of fdata) {
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
        // เลือกสาขา = เลขนับเฉพาะสาขานั้นจากเครื่องนี้ (ยอดรวม server รวมทุกสาขา)
        if (B !== 'ALL') throw new Error('branch-scope');
        const res = await API.get('/api/sync');
        const c = res && res.success ? res.counts : null;
        if (c && c.gps != null && c.customers != null) {
          withGeo = c.gps;
          withoutGeo = Math.max(c.customers - c.gps, 0);
        } else {
          throw new Error('no counts');
        }
      } catch (e) {
        // Fallback: local count (และโหมดกรองสาขา — นับเฉพาะสาขาที่เลือก)
        const hasGeoCif = new Set(
          bcust
            .filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng))
            .map(x => String(x.cif))
        );
        for (const r of fdata) {
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
  },

  _setSub(msg) {
    const sub = document.getElementById('debt-summary-sub');
    if (sub) sub.textContent = msg;
  },

  // ===== Drill-down: show customers filtered by tier =====
  drillDown(type, value) {
    if (type === 'tier') {
      // Switch to customers tab and filter by debt tier
      const B = this.selBranch || 'ALL';
      const customers = Storage.getActiveCustomers();
      const filtered = customers.filter(c => {
        if (!c.cif || !DebtDB._loaded) return false;
        if (B !== 'ALL' && String(c.branch || '').trim() !== B) return false;
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
        Customers.renderList();
        Utils.toast(`📋 แสดงลูกค้าชั้น ${value}: ${filtered.length} ราย — ใช้ค้นหาเพื่อกรองเพิ่ม`);
      }
    }
  },
};

window.DebtSummary = DebtSummary;
