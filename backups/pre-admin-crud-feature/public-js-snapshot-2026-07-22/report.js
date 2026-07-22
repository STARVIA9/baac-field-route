// ===== Report: generate + export follow-up report =====
// Phase 7-9: BAAC debt follow-up report
// - Per day breakdown (visits + GPS + ค่าน้ำมัน)
// - เบี้ยเลี้ยง 160฿/วัน เมื่อ ≥10 upcoming OR ≥5 overdue
// - Export: HTML print, CSV, Share text

const Report = {
  // ===== Constants =====
  ALLOWANCE_PER_DAY: 160,
  THRESHOLD_UPCOMING: 10,  // หนี้ถึงกำหนด ≥ 10 ราย → ได้เบี้ยเลี้ยง
  THRESHOLD_OVERDUE: 5,    // หนี้ค้าง ≥ 5 ราย → ได้เบี้ยเลี้ยง

  // ===== Open report modal =====
  open() {
    document.getElementById('report-modal').classList.remove('hidden');
    // Set default range to "this week"
    this.setRange('week');
  },

  close() {
    document.getElementById('report-modal').classList.add('hidden');
  },

  // ===== Set date range =====
  setRange(range) {
    const today = new Date();
    let from, to = new Date(today);
    to.setHours(23, 59, 59, 999);
    if (range === 'today') {
      from = new Date(today);
      from.setHours(0, 0, 0, 0);
    } else if (range === 'week') {
      from = new Date(today);
      from.setDate(today.getDate() - today.getDay()); // start of week (Sunday)
      from.setHours(0, 0, 0, 0);
    } else if (range === 'month') {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (range === 'custom') {
      // Use the input fields
      const fromEl = document.getElementById('report-from');
      const toEl = document.getElementById('report-to');
      from = fromEl.value ? new Date(fromEl.value + 'T00:00:00') : new Date(today);
      to = toEl.value ? new Date(toEl.value + 'T23:59:59') : new Date(today);
    }
    document.getElementById('report-range-label').textContent =
      `${Utils.formatThaiDate(from)} – ${Utils.formatThaiDate(to)}`;
    document.getElementById('report-from').value = from.toISOString().slice(0, 10);
    document.getElementById('report-to').value = to.toISOString().slice(0, 10);
    // Show/hide custom inputs
    document.getElementById('custom-range').classList.toggle('hidden', range !== 'custom');
    return { from, to };
  },

  // ===== Generate report =====
  generate() {
    const range = this.setRange(document.getElementById('report-range').value);
    const vehicleId = document.getElementById('report-vehicle').value;
    const from = range.from;
    const to = range.to;
    const customers = Storage.getActiveCustomers();
    const visits = Storage.getVisits();

    // Group visits by day (using timestamp)
    const byDay = {};
    for (const [cid, visit] of Object.entries(visits)) {
      const ts = new Date(visit.timestamp);
      if (ts < from || ts > to) continue;
      const dayKey = ts.toISOString().slice(0, 10); // YYYY-MM-DD
      if (!byDay[dayKey]) byDay[dayKey] = [];
      const customer = customers.find(c => c.id === cid);
      if (customer) {
        byDay[dayKey].push({ customer, visit });
      }
    }
    const dayKeys = Object.keys(byDay).sort();

    // Build report
    const reportData = {
      from, to, vehicleId,
      vehicleLabel: Fuel.getVehicle(vehicleId).label,
      fuelType: Fuel.getVehicle(vehicleId).fuelType,
      fuelPrice: Fuel.getPrice(Fuel.getVehicle(vehicleId).fuelType),
      kmPerLiter: Fuel.getVehicle(vehicleId).kmPerLiter,
      days: [],
      totals: {
        days: 0,
        totalVisits: 0,
        totalUpcoming: 0,
        totalOverdue: 0,
        totalDistance: 0,
        totalFuelBaht: 0,
        totalAllowance: 0,
        qualifyingDays: 0,
      },
    };

    for (const dayKey of dayKeys) {
      const dayVisits = byDay[dayKey];
      const upcoming = dayVisits.filter(v => v.customer.debtType === 'current').length;
      const overdue = dayVisits.filter(v => v.customer.debtType === 'overdue').length;
      const qualifies = upcoming >= this.THRESHOLD_UPCOMING || overdue >= this.THRESHOLD_OVERDUE;
      const allowance = qualifies ? this.ALLOWANCE_PER_DAY : 0;
      // Distance estimate: avg 8 km between visits (rough — actual OSRM would need route)
      const distance = dayVisits.length * 8;
      const fuel = Fuel.calculate(distance, vehicleId);
      reportData.days.push({
        date: dayKey,
        dateLabel: Utils.formatThaiDate(new Date(dayKey)),
        visits: dayVisits,
        upcoming, overdue, qualifies, allowance,
        distance, fuel,
      });
      reportData.totals.days++;
      reportData.totals.totalVisits += dayVisits.length;
      reportData.totals.totalUpcoming += upcoming;
      reportData.totals.totalOverdue += overdue;
      reportData.totals.totalDistance += distance;
      reportData.totals.totalFuelBaht += fuel.baht;
      reportData.totals.totalAllowance += allowance;
      if (qualifies) reportData.totals.qualifyingDays++;
    }

    this._currentReport = reportData;
    this._renderPreview(reportData);
  },

  // ===== Render preview in modal =====
  _renderPreview(data) {
    const preview = document.getElementById('report-preview');
    const exportBtns = document.getElementById('export-buttons');
    if (data.days.length === 0) {
      preview.innerHTML = '<p class="empty-state">ไม่พบ visit ในช่วงวันที่เลือก</p>';
      exportBtns.classList.add('hidden');
      return;
    }
    exportBtns.classList.remove('hidden');

    const t = data.totals;
    let html = `
      <div class="report-summary">
        <h3>📊 สรุปภาพรวม</h3>
        <div class="report-summary-grid">
          <div class="summary-item"><span class="summary-num">${t.days}</span><span class="summary-label">วันทำงาน</span></div>
          <div class="summary-item"><span class="summary-num">${t.totalVisits}</span><span class="summary-label">ครั้งที่ติดตาม</span></div>
          <div class="summary-item"><span class="summary-num">${t.totalUpcoming}</span><span class="summary-label">หนี้ถึงกำหนด</span></div>
          <div class="summary-item"><span class="summary-num">${t.totalOverdue}</span><span class="summary-label">หนี้ค้าง</span></div>
          <div class="summary-item"><span class="summary-num">${t.qualifyingDays}</span><span class="summary-label">วันที่เบิกได้</span></div>
          <div class="summary-item highlight"><span class="summary-num">${Utils.formatBaht(t.totalAllowance)}</span><span class="summary-label">เบี้ยเลี้ยงรวม</span></div>
        </div>
        <div class="report-fuel-cost">
          <span>⛽ ${data.vehicleLabel} · ${data.kmPerLiter} กม./ลิตร · ${Utils.formatBaht(data.fuelPrice)}/ลิตร</span>
          <span>📏 ระยะทางประมาณการ: ${Utils.formatKm(t.totalDistance)} กม.</span>
          <span>💰 ค่าน้ำมันประมาณการ: ${Utils.formatBaht(t.totalFuelBaht)}</span>
        </div>
      </div>
      <div class="report-days">
        <h3>📅 รายละเอียดรายวัน</h3>
    `;
    for (const day of data.days) {
      const dayClass = day.qualifies ? 'day-qualifies' : 'day-no-qualify';
      const allowanceBadge = day.qualifies
        ? `<span class="badge-yes">✅ เบิกได้ ${Utils.formatBaht(day.allowance)}</span>`
        : `<span class="badge-no">❌ ไม่ถึงเกณฑ์</span>`;
      html += `
        <div class="report-day ${dayClass}">
          <div class="report-day-header">
            <strong>${day.dateLabel}</strong>
            ${allowanceBadge}
            <span class="day-stats">📅 ${day.upcoming} ถึงกำหนด · ⚠️ ${day.overdue} ค้าง · 👥 ${day.visits.length} ราย</span>
          </div>
          <table class="report-day-table">
            <thead><tr><th>ลูกค้า</th><th>สถานะ</th><th>เวลา</th><th>พิกัด</th><th>หมายเหตุ</th></tr></thead>
            <tbody>
      `;
      for (const v of day.visits) {
        const c = v.customer;
        const status = this._statusBadge(v.visit.status);
        const time = v.visit.timestamp ? new Date(v.visit.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-';
        const coords = v.visit.lat && v.visit.lng
          ? `<a href="https://www.google.com/maps?q=${v.visit.lat},${v.visit.lng}" target="_blank">📍 ${v.visit.lat.toFixed(4)}, ${v.visit.lng.toFixed(4)}</a>`
          : '-';
        const note = v.visit.note ? this._escapeHTML(v.visit.note) : '-';
        html += `
          <tr>
            <td>
              <div class="td-name">${this._escapeHTML(c.name)}</div>
              <div class="td-sub">${c.phone || ''}</div>
            </td>
            <td>${status}</td>
            <td>${time}</td>
            <td>${coords}</td>
            <td>${note}</td>
          </tr>
        `;
      }
      html += `</tbody></table></div>`;
    }
    html += '</div>';
    preview.innerHTML = html;
  },

  // ===== Export: HTML (printable) =====
  exportHTML() {
    if (!this._currentReport) return;
    const data = this._currentReport;
    const officer = Auth.getUser()?.name || 'ไม่ระบุ';
    const t = data.totals;
    const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>รายงานติดตามหนี้ - ${officer}</title>
<style>
  body { font-family: 'Sarabun', sans-serif; padding: 24px; max-width: 900px; margin: 0 auto; color: #1a202c; }
  h1 { color: #0a8f3c; border-bottom: 3px solid #0a8f3c; padding-bottom: 8px; }
  h2 { color: #076b2d; margin-top: 32px; border-left: 4px solid #0a8f3c; padding-left: 8px; }
  h3 { color: #334155; margin-top: 20px; }
  .meta { background: #f1f5f9; padding: 12px; border-radius: 6px; margin-bottom: 16px; font-size: 14px; }
  .meta strong { color: #0a8f3c; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  th { background: #0a8f3c; color: white; padding: 8px; text-align: left; }
  td { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 12px 0; }
  .summary-card { background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 10px; text-align: center; }
  .summary-card.highlight { background: #fef3c7; border-color: #fcd34d; }
  .summary-num { display: block; font-size: 24px; font-weight: 700; color: #0a8f3c; }
  .summary-card.highlight .summary-num { color: #b45309; }
  .summary-label { display: block; font-size: 11px; color: #64748b; }
  .day-qualifies { border-left: 4px solid #10b981; padding-left: 8px; margin: 12px 0; }
  .day-no-qualify { border-left: 4px solid #cbd5e1; padding-left: 8px; margin: 12px 0; opacity: 0.85; }
  .badge-yes { background: #10b981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
  .badge-no { background: #94a3b8; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
  .signature { margin-top: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .signature-box { text-align: center; padding-top: 60px; border-top: 1px solid #64748b; }
  @media print { body { padding: 0; } .no-print { display: none; } }
  .no-print { text-align: center; margin: 20px 0; }
  .no-print button { padding: 10px 24px; background: #0a8f3c; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; margin: 0 4px; }
</style>
</head>
<body>
  <h1>📋 รายงานการติดตามหนี้</h1>
  <div class="meta">
    <div><strong>เจ้าหน้าที่:</strong> ${this._escapeHTML(officer)}</div>
    <div><strong>ช่วงวันที่:</strong> ${Utils.formatThaiDate(data.from)} – ${Utils.formatThaiDate(data.to)}</div>
    <div><strong>ยานพาหนะ:</strong> ${this._escapeHTML(data.vehicleLabel)} (${data.kmPerLiter} กม./ลิตร, ${Utils.formatBaht(data.fuelPrice)}/ลิตร)</div>
    <div><strong>วันที่ออกรายงาน:</strong> ${Utils.formatThaiDate(new Date())}</div>
  </div>

  <h2>📊 สรุปภาพรวม</h2>
  <div class="summary-grid">
    <div class="summary-card"><span class="summary-num">${t.days}</span><span class="summary-label">วันทำงาน</span></div>
    <div class="summary-card"><span class="summary-num">${t.totalVisits}</span><span class="summary-label">ครั้งที่ติดตาม</span></div>
    <div class="summary-card"><span class="summary-num">${t.totalUpcoming}</span><span class="summary-label">หนี้ถึงกำหนด</span></div>
    <div class="summary-card"><span class="summary-num">${t.totalOverdue}</span><span class="summary-label">หนี้ค้าง</span></div>
    <div class="summary-card"><span class="summary-num">${t.qualifyingDays}</span><span class="summary-label">วันที่เบิกได้</span></div>
    <div class="summary-card highlight"><span class="summary-num">${Utils.formatBaht(t.totalAllowance)}</span><span class="summary-label">เบี้ยเลี้ยงรวม</span></div>
  </div>
  <p>⛽ ค่าน้ำมันประมาณการ: ${Utils.formatBaht(t.totalFuelBaht)} (ระยะทาง ${Utils.formatKm(t.totalDistance)} กม.)</p>

  <h2>📅 รายละเอียดรายวัน</h2>
  ${data.days.map(day => `
    <div class="${day.qualifies ? 'day-qualifies' : 'day-no-qualify'}">
      <h3>${day.dateLabel} ${day.qualifies ? '<span class="badge-yes">✅ เบิกได้ ' + Utils.formatBaht(day.allowance) + '</span>' : '<span class="badge-no">❌ ไม่ถึงเกณฑ์</span>'}</h3>
      <p>📅 ${day.upcoming} ถึงกำหนด · ⚠️ ${day.overdue} ค้าง · 👥 ${day.visits.length} ราย</p>
      <table>
        <thead><tr><th>ลูกค้า</th><th>สถานะ</th><th>เวลา</th><th>พิกัด</th><th>หมายเหตุ</th></tr></thead>
        <tbody>
          ${day.visits.map(v => `
            <tr>
              <td>${this._escapeHTML(v.customer.name)}<br><small>${this._escapeHTML(v.customer.phone || '')}</small></td>
              <td>${this._statusLabel(v.visit.status)}</td>
              <td>${v.visit.timestamp ? new Date(v.visit.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
              <td>${v.visit.lat && v.visit.lng ? v.visit.lat.toFixed(4) + ', ' + v.visit.lng.toFixed(4) : '-'}</td>
              <td>${this._escapeHTML(v.visit.note || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `).join('')}

  <div class="signature">
    <div class="signature-box">ลงชื่อ .....................................<br><small>ผู้ติดตาม (${this._escapeHTML(officer)})</small></div>
    <div class="signature-box">ลงชื่อ .....................................<br><small>หัวหน้างาน</small></div>
  </div>

  <div class="no-print">
    <button onclick="window.print()">🖨️ พิมพ์</button>
    <button onclick="window.close()">✖️ ปิด</button>
  </div>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    Utils.toast('📄 เปิดรายงาน HTML แล้ว');
  },

  // ===== Export: CSV =====
  exportCSV() {
    if (!this._currentReport) return;
    const data = this._currentReport;
    const t = data.totals;
    const rows = [
      ['รายงานการติดตามหนี้'],
      ['เจ้าหน้าที่', Auth.getUser()?.name || ''],
      ['ช่วงวันที่', `${Utils.formatThaiDate(data.from)} – ${Utils.formatThaiDate(data.to)}`],
      ['ยานพาหนะ', `${data.vehicleLabel} (${data.kmPerLiter} กม./ลิตร, ${data.fuelPrice}฿/ลิตร)`],
      [],
      ['สรุปภาพรวม'],
      ['วันทำงาน', t.days],
      ['ครั้งที่ติดตาม', t.totalVisits],
      ['หนี้ถึงกำหนด', t.totalUpcoming],
      ['หนี้ค้าง', t.totalOverdue],
      ['วันที่เบิกได้', t.qualifyingDays],
      ['เบี้ยเลี้ยงรวม (฿)', t.totalAllowance],
      ['ค่าน้ำมันประมาณการ (฿)', Math.round(t.totalFuelBaht)],
      ['ระยะทางประมาณการ (กม.)', Math.round(t.totalDistance)],
      [],
      ['รายละเอียดรายวัน'],
      ['วันที่', 'ชื่อลูกค้า', 'เบอร์โทร', 'ประเภทหนี้', 'ระดับความเสี่ยง', 'สถานะเข้าพบ', 'เวลา', 'ละติจูด', 'ลองจิจูด', 'หมายเหตุ', 'เบิกเบี้ยเลี้ยงได้'],
    ];
    for (const day of data.days) {
      for (const v of day.visits) {
        const c = v.customer;
        rows.push([
          day.dateLabel,
          c.name || '',
          c.phone || '',
          c.debtType === 'current' ? 'หนี้ถึงกำหนด' : (c.debtType === 'overdue' ? 'หนี้ค้าง' : '-'),
          this._riskLabel(c.riskLevel),
          this._statusLabel(v.visit.status),
          v.visit.timestamp ? new Date(v.visit.timestamp).toLocaleTimeString('th-TH') : '',
          v.visit.lat || '',
          v.visit.lng || '',
          v.visit.note || '',
          day.qualifies ? 'ได้ ' + Utils.formatBaht(day.allowance) : 'ไม่ได้',
        ]);
      }
    }
    // Add UTF-8 BOM for Excel
    const csv = '\ufeff' + rows.map(r => r.map(cell => {
      const s = String(cell);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    Utils.toast('📊 ดาวน์โหลด CSV แล้ว');
  },

  // ===== Export: Share text =====
  shareText() {
    if (!this._currentReport) return;
    const data = this._currentReport;
    const t = data.totals;
    const officer = Auth.getUser()?.name || '';
    const lines = [
      `📋 *รายงานติดตามหนี้*`,
      `👤 เจ้าหน้าที่: ${officer}`,
      `📅 ช่วง: ${Utils.formatThaiDate(data.from)} – ${Utils.formatThaiDate(data.to)}`,
      `🚗 ${data.vehicleLabel}`,
      ``,
      `📊 *สรุป*`,
      `• ${t.days} วันทำงาน · ${t.totalVisits} ครั้ง`,
      `• หนี้ถึงกำหนด: ${t.totalUpcoming} ราย`,
      `• หนี้ค้าง: ${t.totalOverdue} ราย`,
      `• วันที่เบิกได้: ${t.qualifyingDays}/${t.days}`,
      `• *เบี้ยเลี้ยงรวม: ${Utils.formatBaht(t.totalAllowance)}*`,
      `• ค่าน้ำมันประมาณการ: ${Utils.formatBaht(t.totalFuelBaht)}`,
      ``,
    ];
    for (const day of data.days) {
      lines.push(`📅 *${day.dateLabel}* ${day.qualifies ? '✅ เบิกได้' : '❌'}`);
      lines.push(`  ถึงกำหนด: ${day.upcoming} · ค้าง: ${day.overdue} · ราย: ${day.visits.length}`);
      for (const v of day.visits.slice(0, 5)) {
        const status = this._statusEmoji(v.visit.status);
        const coords = v.visit.lat ? ` 📍${v.visit.lat.toFixed(3)},${v.visit.lng.toFixed(3)}` : '';
        lines.push(`  ${status} ${v.customer.name}${coords}`);
      }
      if (day.visits.length > 5) lines.push(`  ... +${day.visits.length - 5} ราย`);
    }
    const text = lines.join('\n');
    if (navigator.share) {
      navigator.share({ title: 'รายงานติดตามหนี้', text }).catch(() => {
        this._copyToClipboard(text);
      });
    } else {
      this._copyToClipboard(text);
    }
  },

  _copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => Utils.toast('📋 คัดลอกรายงานแล้ว'));
    } else {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      Utils.toast('📋 คัดลอกรายงานแล้ว');
    }
  },

  // ===== Helpers =====
  _statusBadge(status) {
    const label = this._statusLabel(status);
    const cls = {
      visited: 'badge-yes',
      interested: 'badge-yes',
      no_answer: 'badge-no',
      not_home: 'badge-no',
      not_interested: 'badge-no',
      reschedule: 'badge-warn',
    }[status] || 'badge-warn';
    return `<span class="${cls}">${label}</span>`;
  },
  _statusLabel(status) {
    return {
      visited: '✅ เยี่ยมสำเร็จ',
      no_answer: '❌ ไม่พบลูกค้า',
      not_home: '🚪 ไม่อยู่บ้าน',
      reschedule: '📅 นัดใหม่',
      interested: '💚 สนใจ',
      not_interested: '🚫 ไม่สนใจ',
      pending: '⏳ รอ',
    }[status] || status || '-';
  },
  _statusEmoji(status) {
    return {
      visited: '✅', no_answer: '❌', not_home: '🚪',
      reschedule: '📅', interested: '💚', not_interested: '🚫', pending: '⏳',
    }[status] || '•';
  },
  _riskLabel(level) {
    return {
      good: '🟢 ดี',
      warning: '🟡 เริ่มมีปัญหา',
      bad: '🔴 มีปัญหามาก',
      unclassified: '❓ ยังไม่จัด',
    }[level] || '-';
  },
  _escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },
};

window.Report = Report;
