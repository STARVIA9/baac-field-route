// ===== DebtSummary — แสดงภาพรวมหนี้ทั้งสาขา (แท็บ 📊 สรุปหนี้) =====
// ข้อมูลจาก DebtDB (Customer Indicator)

const DebtSummary = {
  render() {
    if (!window.DebtDB || !DebtDB._loaded) {
      this._setSub('ข้อมูลหนี้ยังไม่โหลด');
      return;
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
    for (const c of customers) {
      const db = c.cif && window.CustomerDB && CustomerDB._loaded ? CustomerDB.getByCif(c.cif) : null;
      const p = db ? db.potential : null;
      if (p && colorCount[p] !== undefined) colorCount[p]++;
    }
    if (colorBlock) {
      const totalColor = (colorCount['แดง'] + colorCount['เหลือง'] + colorCount['เขียว']) || 1;
      colorBlock.innerHTML = `
        <div class="ds-row"><span class="ds-label" style="color:#d00000">🔴 แดง</span><span class="ds-val">${colorCount['แดง']} ราย (${Math.round(colorCount['แดง']/totalColor*100)}%)</span></div>
        <div class="ds-row"><span class="ds-label" style="color:#d97706">🟡 เหลือง</span><span class="ds-val">${colorCount['เหลือง']} ราย (${Math.round(colorCount['เหลือง']/totalColor*100)}%)</span></div>
        <div class="ds-row"><span class="ds-label" style="color:#16a34a">🟢 เขียว</span><span class="ds-val">${colorCount['เขียว']} ราย (${Math.round(colorCount['เขียว']/totalColor*100)}%)</span></div>
      `;
      if (totalColor === 1 && colorCount['แดง']+colorCount['เหลือง']+colorCount['เขียว'] === 0) {
        colorBlock.innerHTML = '<div class="ds-note">ไม่พบข้อมูลศักยภาพ (กรอกข้อมูลลูกค้ายังไม่ครบ)</div>';
      }
    }

    // ===== แยกตามชั้นหนี้ =====
    const tierBlock = document.getElementById('debt-tier-block');
    if (tierBlock) {
      const tierCount = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const r of data) {
        const t = parseInt(r.max_tier) || 0;
        if (tierCount[t] !== undefined) tierCount[t]++;
      }
      const labels = { 1: 'ชั้น 1', 2: 'ชั้น 2', 3: 'ชั้น 3', 4: 'ชั้น 4', 5: 'ชั้น 5' };
      tierBlock.innerHTML = Object.keys(tierCount).map(t => `
        <div class="ds-row">
          <span class="ds-label" style="color:${DebtDB.tierColor(t)}">🏷️ ${labels[t]}</span>
          <span class="ds-val">${tierCount[t].toLocaleString('th-TH')} ราย</span>
        </div>
        <div class="ds-bar"><div class="ds-bar-fill" style="width:${(tierCount[t]/data.length*100)||0}%;background:${t>=2?'#d00000':'#16a34a'}"></div></div>
      `).join('');
    }

    // ===== หนี้ถึงกำหนดรายเดือน (ปีบัญชีปัจจุบัน: มิ.ย.69 -> มี.ค.70) =====
    const monthBlock = document.getElementById('debt-month-block');
    if (monthBlock) {
      // key ตัวเลข YYYYMM สำหรับช่วงปีบัญชี
      const ykey = (mmyy) => { const p = String(mmyy).split('/'); return (+p[1]) * 100 + (+p[0]); };
      const FY_START = ykey('06/2026');   // มิ.ย. 2569
      const FY_END = ykey('03/2027');     // มี.ค. 2570
      const monthCount = {};
      let fyTotal = 0, fyOmsom = 0;
      for (const r of data) {
        const k = DebtDB.dueMonthKey(r.earliest_due);
        if (!k) continue;
        const kv = ykey(k);
        if (kv >= FY_START && kv <= FY_END) {
          monthCount[k] = (monthCount[k] || 0) + 1;
          fyTotal++;
          if (r.is_omsom) fyOmsom++;
        }
      }
      const sortedMonths = Object.keys(monthCount).sort((a, b) => ykey(a) - ykey(b));
      if (sortedMonths.length === 0) {
        monthBlock.innerHTML = '<div class="ds-note">ไม่มีหนี้ถึงกำหนดในปีบัญชีนี้</div>';
      } else {
        // แถวรวม (แยก อสม.) + รายเดือนช่วง มิ.ย.69-มี.ค.70
        const header = `
          <div class="ds-row ds-total"><span class="ds-label">📊 เหลือทั้งปีบัญชี</span><span class="ds-val">${fyTotal.toLocaleString('th-TH')} ราย</span></div>
          <div class="ds-row"><span class="ds-label">👤 ลูกค้าทั่วไป</span><span class="ds-val">${(fyTotal - fyOmsom).toLocaleString('th-TH')} ราย</span></div>
          <div class="ds-row"><span class="ds-label">🩺 อสม. (3080/2838/2751)</span><span class="ds-val">${fyOmsom.toLocaleString('th-TH')} ราย</span></div>
        `;
        const rows = sortedMonths.map(k => `
          <div class="ds-row">
            <span class="ds-label">📅 ${DebtDB.fmtDate('01/' + k)}</span>
            <span class="ds-val">${monthCount[k].toLocaleString('th-TH')} ราย</span>
          </div>
        `).join('');
        monthBlock.innerHTML = `${header}${rows}`;
      }
    }

    // ===== สถานะพิกัด =====
    const geoBlock = document.getElementById('debt-geo-block');
    if (geoBlock) {
      const hasGeoCif = new Set(
        (typeof Storage !== 'undefined' ? Storage.getActiveCustomers() : [])
          .filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng))
          .map(c => String(c.cif))
      );
      let withGeo = 0, withoutGeo = 0;
      for (const r of data) {
        if (hasGeoCif.has(String(r.cif))) withGeo++;
        else withoutGeo++;
      }
      const pct = data.length ? Math.round(withGeo / data.length * 100) : 0;
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
};

window.DebtSummary = DebtSummary;
