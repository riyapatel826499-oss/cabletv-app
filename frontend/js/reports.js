// REPORTS
async function loadReports() {
  // Pre-load employees so collector dropdown is always populated
  if (!_empList || !_empList.length) {
    try { const d = await api('/api/employees'); _empList = d.employees || []; } catch(e) {}
  }
  try {
    const isAdminOrMaster = _userRole === 'master' || _userRole === 'admin';
    const adminEl = document.getElementById('reportsAdmin');
    const agentEl = document.getElementById('reportsAgent');
    const analyticsBtn = document.getElementById('btnAnalytics');

    // All roles see the tabs (Paid/Unpaid/Not Renewed)
    if (agentEl) agentEl.style.display = '';
    if (analyticsBtn) analyticsBtn.style.display = isAdminOrMaster ? '' : 'none';

    // Load tab data
    agRptTab('paid', document.querySelector('#agRptTabs .cust-tab'));

    // Pre-load analytics data for admin/master (hidden until toggled)
    if (isAdminOrMaster) {

    const s = await api('/api/dashboard/stats');
    document.getElementById('rptTotalAmt').textContent = fmtRs(s.total_collected);
    document.getElementById('rptUnpaid').textContent = s.unpaid_this_month || 0;
    const hist = await api('/api/payments/history');
    const items = hist.items || hist.payments || hist || [];
    const modes = {};
    let cashCount = 0, digitalCount = 0, otherCount = 0;
    const digitalModes = ['GPay','PhonePe','UPI','Card','Online'];
    items.forEach(p => {
      const m = (p.mode || p.payment_type || 'Other');
      modes[m] = (modes[m] || 0) + (p.amount || p.collection_amount || 0);
      if (m === 'Cash') cashCount++;
      else if (digitalModes.includes(m)) digitalCount++;
      else otherCount++;
    });
    document.getElementById('rptCash').textContent = cashCount;
    document.getElementById('rptDigital').textContent = digitalCount;
    const modeChart = document.getElementById('modeChart');
    const modeKeys = Object.keys(modes);
    if (modeKeys.length) {
      const maxM = Math.max(...Object.values(modes), 1);
      modeChart.innerHTML = modeKeys.map(m => {
        const h = Math.max(8, (modes[m] / maxM) * 120);
        let c1, c2;
        if (m === 'Cash') { c1 = '#f59e0b'; c2 = '#d97706'; }
        else if (digitalModes.includes(m)) { c1 = '#6366f1'; c2 = '#8b5cf6'; }
        else { c1 = '#9ca3af'; c2 = '#6b7280'; }
        return '<div class="bar-item"><div class="bar-value">' + fmtRs(modes[m]) + '</div><div class="bar" style="height:' + h + 'px;background:linear-gradient(180deg,' + c1 + ',' + c2 + ')"></div><div class="bar-label">' + esc(m) + '</div></div>';
      }).join('');
    } else { modeChart.innerHTML = '<div class="empty-state"><p>No payment data</p></div>'; }
    // Area collection chart loaded separately
    loadAreaCollection();
    // All-time collector + MSO on Reports page
    loadRptCollectorAndMso();
    } // end if isAdminOrMaster
  } catch (e) { toast('Failed to load reports', 'error'); }
}

function toggleAnalytics() {
  const el = document.getElementById('reportsAdmin');
  el.style.display = el.style.display === 'none' ? '' : 'none';
}

// ===== AGENT REPORTS (Paid / Unpaid / Not Renewed) =====
let _agPaidDebounce = null;
let _agUnpDebounce = null;
let _agNrDebounce = null;
let _agNrMonth = '';

function debounceAgPaid() { clearTimeout(_agPaidDebounce); _agPaidDebounce = setTimeout(() => agLoadPaid(1), 400); }
function debounceAgUnp() { clearTimeout(_agUnpDebounce); _agUnpDebounce = setTimeout(() => agLoadUnpaid(1), 400); }
function debounceAgNr() { clearTimeout(_agNrDebounce); _agNrDebounce = setTimeout(() => agLoadNR(1), 400); }

function agRptTab(tab, btn) {
  document.querySelectorAll('#agRptTabs .cust-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('agRptPaid').style.display = tab === 'paid' ? '' : 'none';
  document.getElementById('agRptUnpaid').style.display = tab === 'unpaid' ? '' : 'none';
  document.getElementById('agRptNR').style.display = tab === 'notrenewed' ? '' : 'none';
  if (tab === 'paid') {
    // Set default to Today if no date selected yet
    const fromEl = document.getElementById('agPaidFrom');
    if (!fromEl.value) agPaidDateQuick('today');
    else agLoadPaid(1);
  }
  else if (tab === 'unpaid') agLoadUnpaid(1);
  else if (tab === 'notrenewed') agLoadNR(1);
}

// ── Paid ──
function agPaidDateQuick(preset) {
  const now = new Date();
  let from, to;
  if (preset === 'today') {
    from = to = now.toISOString().split('T')[0];
  } else if (preset === 'yesterday') {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    from = to = y.toISOString().split('T')[0];
  } else if (preset === 'month') {
    from = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    to = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${lastDay}`;
  }
  document.getElementById('agPaidFrom').value = from;
  document.getElementById('agPaidTo').value = to;
  // Highlight active button
  ['agPaidToday','agPaidYesterday','agPaidMonth'].forEach(id => {
    const b = document.getElementById(id);
    b.className = 'btn btn-sm ' + (id === 'agPaid' + preset.charAt(0).toUpperCase() + preset.slice(1) ? 'btn-primary' : 'btn-outline');
  });
  agLoadPaid(1);
}

function agLoadPaid(page = 1) {
  const perPage = document.getElementById('agPaidPerPage').value;
  const dateFrom = document.getElementById('agPaidFrom').value;
  const dateTo = document.getElementById('agPaidTo').value;
  const q = document.getElementById('agPaidSearch').value.trim();
  const mso = document.getElementById('agPaidMso').value;

  let url = `/api/payments/all?page=${page}&per_page=${perPage}`;
  if (dateFrom) url += '&date_from=' + encodeURIComponent(dateFrom);
  if (dateTo) url += '&date_to=' + encodeURIComponent(dateTo);
  if (q) url += '&q=' + encodeURIComponent(q);
  if (mso) url += '&mso=' + encodeURIComponent(mso);

  api(url).then(data => {
    const payments = data.payments || [];
    document.getElementById('agPaidCount').textContent = data.total || 0;
    document.getElementById('agPaidAmt').textContent = fmtRs(data.total_amount || 0);

    // Populate area dropdown from results (always refresh)
    {
      const prevArea = document.getElementById('agPaidArea').value;
      const areas = [...new Set(payments.map(p => p.area).filter(Boolean))].sort();
      const sel = document.getElementById('agPaidArea');
      sel.innerHTML = '<option value="">All Areas</option>';
      areas.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; sel.appendChild(o); });
      if (prevArea && sel.querySelector('option[value="' + prevArea + '"]')) sel.value = prevArea;
    }

    // Populate collector dropdown from employees + results (always all collectors)
    {
      const prevColl = document.getElementById('agPaidCollector').value;
      const resultColls = [...new Set(payments.map(p => p.collector).filter(Boolean))];
      const empColls = (_empList || []).map(e => e.name).filter(Boolean);
      const allColls = [...new Set([...empColls, ...resultColls])].sort();
      const sel = document.getElementById('agPaidCollector');
      sel.innerHTML = '<option value="">All Collectors</option>';
      allColls.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });
      if (prevColl && sel.querySelector('option[value="' + prevColl + '"]')) sel.value = prevColl;
    }

    // Apply client-side area and collector filters
    const areaFilter = document.getElementById('agPaidArea').value;
    const collFilter = document.getElementById('agPaidCollector').value;
    let filtered = payments;
    if (areaFilter) filtered = filtered.filter(p => p.area === areaFilter);
    if (collFilter) filtered = filtered.filter(p => p.collector === collFilter);

    // Update stats to reflect filtered results
    document.getElementById('agPaidCount').textContent = filtered.length;
    document.getElementById('agPaidAmt').textContent = fmtRs(filtered.reduce((s, p) => s + (p.amount || 0), 0));

    const tbody = document.getElementById('agPaidBody');
    const canDelete = (_userRole === 'admin' || _userRole === 'master');
    const canGtpl = (_userRole === 'admin' || _userRole === 'master' || _userRole === 'support');
    // Show/hide delete column header
    const delTh = document.getElementById('agPaidDelTh');
    if (delTh) delTh.textContent = canDelete ? '🗑' : '';
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="' + (canDelete ? 13 : 12) + '" class="empty-state">No payments found</td></tr>';
    } else {
      tbody.innerHTML = filtered.map((p, i) => {
        const phone = p.customer_phone || '';
        const stb = esc(p.stb_no || '-');
        const stbCell = stb !== '-' ? '<span class="stb-badge" onclick="navigator.clipboard.writeText(\'' + esc(p.stb_no) + '\');toast(\'STB copied!\',\'success\')" title="Click to copy">' + stb + '</span>' : '-';
        const dt = p.date ? new Date(p.date + (p.date.endsWith('Z') ? '' : 'Z')).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}) : '-';
        const isLocal = p.source !== 'paypakka';
        const localId = p.id || p.payment_id;
        let delCell = '';
        if (canDelete && isLocal && localId) {
          delCell = '<td><button class="btn btn-sm btn-danger" onclick="agDeletePayment(' + localId + ',\'' + escAttr(p.customer_name || '') + '\')" title="Delete this payment">🗑</button></td>';
        } else if (canDelete) {
          delCell = '<td><span class="badge" style="background:#6c757d;color:#fff;font-size:10px">Paypakka</span></td>';
        }
        // GTPL Activate button
        let gtplCell = '';
        if (canGtpl && p.stb_no && p.stb_no.startsWith('338')) {
          gtplCell = '<td><button class="btn btn-sm" style="background:#28a745;color:#fff;border:none;padding:2px 8px;font-size:11px" onclick="gtplActivate(\'' + esc(p.stb_no) + '\',\'' + escAttr(p.customer_name || '') + '\')" title="Activate on GTPL">✅ Activate</button></td>';
        } else {
          gtplCell = '<td></td>';
        }

        return '<tr>' +
          '<td>' + ((data.page - 1) * parseInt(perPage) + i + 1) + '</td>' +
          '<td><strong>' + esc(p.customer_name || '--') + '</strong><br><span style="font-size:11px;color:var(--text-light)">' + esc(p.customer_id || '') + '</span></td>' +
          '<td>' + stbCell + '</td>' +
          '<td>' + esc(p.mso || '-') + '</td>' +
          '<td>' + esc(p.area || '-') + '</td>' +
          '<td>' + esc(p.plan_name || p.month_year || '-') + '</td>' +
          '<td><strong>' + fmtRs(p.amount) + '</strong></td>' +
          '<td><span class="badge badge-primary">' + esc(p.payment_mode || '--') + '</span></td>' +
          '<td style="font-size:12px">' + dt + '</td>' +
          '<td style="font-size:12px">' + esc(p.collector || '-') + '</td>' +
          '<td>' + (p.latitude && p.longitude ? '<a href="https://www.google.com/maps?q=' + p.latitude + ',' + p.longitude + '" target="_blank" class="btn btn-outline btn-sm" title="View location">📍</a>' : '-') + '</td>' +
          gtplCell +
          delCell +
          '</tr>';
      }).join('');
    }

    // Mobile card view for Reports Paid tab
    const mobPaidEl = document.getElementById('mobAgPaid');
    if (mobPaidEl) {
      if (!filtered.length) {
        mobPaidEl.innerHTML = '<div style="text-align:center;padding:30px 16px;color:var(--text-light)"><div style="font-size:40px;margin-bottom:8px">📭</div>No payments found</div>';
      } else {
        mobPaidEl.innerHTML = filtered.map(p => {
          const dt = p.date ? new Date(p.date + (p.date.endsWith('Z') ? '' : 'Z')).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}) : '-';
          const isLocal = p.source !== 'paypakka';
          const localId = p.id || p.payment_id;
          // STB touch-to-copy
          let stbHtml = '';
          if (p.stb_no) {
            stbHtml = '<div class="rcard-stb-wrap"><div class="rcard-stb" onclick="copyStbMobile(this,\'' + escAttr(p.stb_no) + '\')" title="Touch to copy"><span class="copy-icon">📋</span>' + esc(p.stb_no) + '</div></div>';
          }
          // Tags
          let tags = '';
          tags += '<span class="rcard-tag mode">' + esc(p.payment_mode || '--') + '</span>';
          if (p.area) tags += '<span class="rcard-tag area">📍 ' + esc(p.area) + '</span>';
          if (p.plan_name) tags += '<span class="rcard-tag plan">📦 ' + esc(p.plan_name) + '</span>';
          else if (p.month_year) tags += '<span class="rcard-tag plan">📅 ' + esc(p.month_year) + '</span>';
          // Footer
          let footerRight = '';
          if (canGtpl && p.stb_no && p.stb_no.startsWith('338')) {
            footerRight += '<button class="btn btn-sm" style="background:#28a745;color:#fff;border:none;padding:2px 8px;font-size:11px" onclick="gtplActivate(\'' + esc(p.stb_no) + '\',\'' + escAttr(p.customer_name || '') + '\')" title="Activate on GTPL">✅ Activate</button>';
          }
          if (p.latitude && p.longitude) footerRight += '<a href="https://www.google.com/maps?q=' + p.latitude + ',' + p.longitude + '" target="_blank" class="rcard-loc" title="View location">📍</a>';
          if (canDelete && isLocal && localId) footerRight += '<button class="rcard-del" onclick="agDeletePayment(' + localId + ',\'' + escAttr(p.customer_name || '') + '\')" title="Delete">🗑️</button>';
          else if (canDelete) footerRight += '<span class="badge" style="background:#6c757d;color:#fff;font-size:9px">PP</span>';

          return '<div class="rcard">'
            + '<div class="rcard-header">'
            + '<div class="rcard-cust">'
            + '<div class="rcard-name">' + esc(p.customer_name || '--') + '</div>'
            + '<div class="rcard-id">' + esc(p.customer_id || '') + '</div>'
            + '</div>'
            + '<div class="rcard-amt">₹' + (p.amount || 0) + '</div>'
            + '</div>'
            + stbHtml
            + '<div class="rcard-tags">' + tags + '</div>'
            + '<div class="rcard-footer">'
            + '<div class="rcard-footer-left">👤 ' + esc(p.collector || '-') + ' · ' + dt + '</div>'
            + '<div class="rcard-footer-right">' + footerRight + '</div>'
            + '</div>'
            + '</div>';
        }).join('');
      }
    }

    // Pagination
    const pag = document.getElementById('agPaidPagination');
    if (!data.total_pages || data.total_pages <= 1) { pag.innerHTML = ''; return; }
    let html = '';
    if (data.page > 1) html += '<button onclick="agLoadPaid(' + (data.page-1) + ')" class="btn btn-outline btn-sm">← Prev</button> ';
    html += '<span style="margin:0 8px;font-size:13px;color:var(--text-light)">' + ((data.page-1)*parseInt(perPage)+1) + '-' + Math.min(data.page*parseInt(perPage), data.total) + ' of ' + data.total + '</span> ';
    if (data.page < data.total_pages) html += '<button onclick="agLoadPaid(' + (data.page+1) + ')" class="btn btn-outline btn-sm">Next →</button>';
    pag.innerHTML = html;
  }).catch(() => {
    document.getElementById('agPaidBody').innerHTML = '<tr><td colspan="10" class="empty-state">Failed to load</td></tr>';
  });
}

// ── Delete Payment (admin/master only) ──
async function agDeletePayment(paymentId, customerName) {
  const confirmed = confirm('⚠️ Delete this payment?\n\nCustomer: ' + customerName + '\nPayment ID: ' + paymentId + '\n\nThe expiry date will be automatically adjusted after deletion.');
  if (!confirmed) return;

  try {
    const res = await api('/api/payments/' + paymentId, { method: 'DELETE' });

    if (res.old_expiry && res.new_expiry && res.old_expiry !== res.new_expiry) {
      const oldDate = new Date(res.old_expiry).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
      const newDate = new Date(res.new_expiry).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
      alert('✅ Payment deleted!\n\n📅 Expiry Updated:\n   Old: ' + oldDate + '\n   New: ' + newDate + '\n\nRemaining payments: ' + res.remaining_payments);
    } else {
      toast('Payment deleted successfully', 'success');
    }

    // Reload paid list
    agLoadPaid(1);
    // Also refresh dashboard stats
    if (typeof loadDashboard === 'function') loadDashboard();
  } catch (e) {
    toast('Failed to delete: ' + (e.message || 'Unknown error'), 'error');
  }
}

// ── Export Paid Report (ALL filtered data, not just current page) ──
async function agExportPaid(format) {
  const dateFrom = document.getElementById('agPaidFrom').value;
  const dateTo = document.getElementById('agPaidTo').value;
  const q = document.getElementById('agPaidSearch').value.trim();
  const mso = document.getElementById('agPaidMso').value;
  const areaFilter = document.getElementById('agPaidArea').value;

  if (!dateFrom || !dateTo) { toast('Select date range first', 'error'); return; }

  toast('Exporting...', 'info');
  let url = `/api/payments/all?per_page=100000&export=true&date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`;
  if (q) url += '&q=' + encodeURIComponent(q);
  if (mso) url += '&mso=' + encodeURIComponent(mso);

  try {
    const data = await api(url);
    if (!data || !data.payments || !data.payments.length) { toast('No payments to export', 'error'); return; }
    let payments = data.payments;
    // Apply client-side area filter too
    if (areaFilter) payments = payments.filter(p => p.area === areaFilter);

    const headers = ['S.No','Customer ID','Customer Name','Phone','STB','MSO','Area','Plan','Amount','Payment Mode','Date & Time','Collected By','Source'];
    const rows = payments.map((p, i) => {
      const dt = p.date ? new Date(p.date + (p.date.endsWith('Z') ? '' : 'Z')).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}) : '';
      return [i+1, p.customer_id||'', p.customer_name||'', p.customer_phone||'', p.stb_no||'', p.mso||'', p.area||'', p.plan_name||p.month_year||'', p.amount||0, p.payment_mode||'', dt, p.collector||'', p.source||''];
    });

    if (format === 'csv') {
      const csvRows = [headers.join(','), ...rows.map(r => r.map(c => '"'+String(c).replace(/"/g,'""')+'"').join(','))];
      const bom = '\uFEFF';
      _downloadFile(bom + csvRows.join('\n'), 'Paid_Report.csv', 'text/csv');
      toast('CSV exported: ' + rows.length + ' rows', 'success');
    } else {
      // XLSX via HTML table approach (opens in Excel)
      let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Paid Report</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table border="1">';
      html += '<tr>' + headers.map(h => '<th style="background:#4472C4;color:#fff;font-weight:bold;padding:6px">' + h + '</th>').join('') + '</tr>';
      rows.forEach(r => { html += '<tr>' + r.map(c => '<td style="padding:4px">' + esc(String(c)) + '</td>').join('') + '</tr>'; });
      html += '</table></body></html>';
      _downloadFile(html, 'Paid_Report.xls', 'application/vnd.ms-excel');
      toast('Excel exported: ' + rows.length + ' rows', 'success');
    }
  } catch(e) {
    toast('Export failed: ' + (e.message||'Unknown error'), 'error');
  }
}

// ── Unpaid ──
function agLoadUnpaid(page = 1) {
  const q = document.getElementById('agUnpSearch').value.trim();
  const area = document.getElementById('agUnpArea').value;
  const mso = document.getElementById('agUnpMso').value;
  const perPage = document.getElementById('agUnpPerPage').value;

  let url = `/api/customers/unpaid?page=${page}&per_page=${perPage}`;
  if (q) url += '&q=' + encodeURIComponent(q);
  if (area) url += '&area=' + encodeURIComponent(area);
  if (mso) url += '&mso=' + encodeURIComponent(mso);

  api(url).then(data => {
    const totalPending = (data.customers || []).reduce((s, c) => s + (c.pending_amount || 0), 0);
    document.getElementById('agUnpCount').textContent = data.total || 0;
    document.getElementById('agUnpAmt').textContent = fmtRs(totalPending);

    // Populate area dropdown
    if (data.areas && data.areas.length > 0 && document.getElementById('agUnpArea').options.length <= 1) {
      const sel = document.getElementById('agUnpArea');
      data.areas.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; sel.appendChild(o); });
    }

    // Populate MSO dropdown
    if (data.msos && data.msos.length > 0 && document.getElementById('agUnpMso').options.length <= 1) {
      const sel = document.getElementById('agUnpMso');
      data.msos.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m; sel.appendChild(o); });
    }

    const tbody = document.getElementById('agUnpBody');
    const custs = data.customers || [];
    if (!custs.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">✅ No unpaid customers!</td></tr>';
    } else {
      tbody.innerHTML = custs.map((c, i) => {
        const phone = c.phone || '';
        const gapBadge = c.gap_months > 3
          ? '<span style="color:var(--danger);font-weight:700">' + c.gap_months + 'mo</span>'
          : c.gap_months > 0
            ? '<span style="color:var(--warning);font-weight:600">' + c.gap_months + 'mo</span>'
            : '<span style="color:var(--success)">Current</span>';
        const networkBadge = c.network && c.network !== 'GTPL'
          ? ' <span style="font-size:10px;background:#e0e7ff;color:#4338ca;padding:1px 5px;border-radius:4px">' + esc(c.network) + '</span>'
          : '';
        return '<tr>' +
          '<td>' + ((page - 1) * parseInt(perPage) + i + 1) + '</td>' +
          '<td><strong>' + esc(c.name) + '</strong><br><span style="font-size:11px;color:var(--text-light)">' + esc(c.customer_id) + networkBadge + '</span></td>' +
          '<td style="font-family:monospace;font-size:12px">' + esc(c.stb_no || '-') + '</td>' +
          '<td>' + esc(c.area || '-') + '</td>' +
          '<td>' + esc(c.plan_name || '-') + '<br><span style="font-size:11px;color:var(--text-light)">₹' + c.plan_amount + '</span></td>' +
          '<td style="font-size:12px">' + (c.expiry_date || '-') + '</td>' +
          '<td>' + gapBadge + '</td>' +
          '<td><strong>' + fmtRs(c.pending_amount) + '</strong></td>' +
          '<td>' + (phone ? '<a href="tel:' + esc(phone.replace(/[^0-9+]/g,'')) + '" class="btn btn-outline btn-sm" title="Call ' + esc(phone) + '">📞</a>' : '-') + '</td>' +
          '</tr>';
      }).join('');
    }

    // Pagination
    const pag = document.getElementById('agUnpPagination');
    if (!data.total_pages || data.total_pages <= 1) { pag.innerHTML = ''; return; }
    let html = '';
    if (page > 1) html += '<button onclick="agLoadUnpaid(' + (page-1) + ')" class="btn btn-outline btn-sm">← Prev</button> ';
    html += '<span style="margin:0 8px;font-size:13px;color:var(--text-light)">' + ((page-1)*parseInt(perPage)+1) + '-' + Math.min(page*parseInt(perPage), data.total) + ' of ' + data.total + '</span> ';
    if (page < data.total_pages) html += '<button onclick="agLoadUnpaid(' + (page+1) + ')" class="btn btn-outline btn-sm">Next →</button>';
    pag.innerHTML = html;
  }).catch(() => {
    document.getElementById('agUnpBody').innerHTML = '<tr><td colspan="9" class="empty-state">Failed to load</td></tr>';
  });
}

// ── Not Renewed ──
function agSetNrMonth(period, btn) {
  document.querySelectorAll('[data-anr]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const now = new Date();
  let m, y;
  if (period === 'this') { m = now.getMonth() + 1; y = now.getFullYear(); }
  else if (period === 'last1') { m = now.getMonth(); y = now.getFullYear(); if (m === 0) { m = 12; y--; } }
  else if (period === 'last2') { m = now.getMonth() - 1; y = now.getFullYear(); if (m <= 0) { m += 12; y--; } }
  _agNrMonth = y + '-' + String(m).padStart(2, '0');
  document.getElementById('agNrMonthPicker').value = '';
  agLoadNR(1);
}

function agSetNrMonthCustom(val) {
  document.querySelectorAll('[data-anr]').forEach(b => b.classList.remove('active'));
  _agNrMonth = val;
  agLoadNR(1);
}

function agLoadNR(page = 1) {
  const q = document.getElementById('agNrSearch').value.trim();
  const area = document.getElementById('agNrArea').value;
  const mso = document.getElementById('agNrMso').value;
  const perPage = document.getElementById('agNrPerPage').value;

  let url = `/api/customers/not-renewed?page=${page}&per_page=${perPage}`;
  if (q) url += '&q=' + encodeURIComponent(q);
  if (area) url += '&area=' + encodeURIComponent(area);
  if (mso) url += '&mso=' + encodeURIComponent(mso);
  if (_agNrMonth) url += '&month=' + encodeURIComponent(_agNrMonth);

  api(url).then(data => {
    const custs = data.customers || [];
    const totalRev = data.lost_revenue || 0;
    document.getElementById('agNrCount').textContent = data.total || 0;
    document.getElementById('agNrAmt').textContent = fmtRs(totalRev);

    // Populate area dropdown
    if (data.areas && data.areas.length > 0 && document.getElementById('agNrArea').options.length <= 1) {
      const sel = document.getElementById('agNrArea');
      data.areas.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; sel.appendChild(o); });
    }

    // Populate MSO dropdown
    if (data.msos && data.msos.length > 0 && document.getElementById('agNrMso').options.length <= 1) {
      const sel = document.getElementById('agNrMso');
      data.msos.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m; sel.appendChild(o); });
    }

    const tbody = document.getElementById('agNrBody');
    if (!custs.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">✅ No dropped customers!</td></tr>';
    } else {
      tbody.innerHTML = custs.map((c, i) => {
        const phone = c.phone || '';
        const networkBadge = c.network && c.network !== 'GTPL'
          ? ' <span style="font-size:10px;background:#e0e7ff;color:#4338ca;padding:1px 5px;border-radius:4px">' + esc(c.network) + '</span>'
          : '';
        const lastPaid = c.last_paid_date ? fmtDate(c.last_paid_date) : '<span style="color:var(--text-light)">—</span>';
        return '<tr>' +
          '<td>' + ((page - 1) * parseInt(perPage) + i + 1) + '</td>' +
          '<td><strong>' + esc(c.name) + '</strong><br><span style="font-size:11px;color:var(--text-light)">' + esc(c.customer_id) + networkBadge + '</span></td>' +
          '<td style="font-family:monospace;font-size:12px">' + esc(c.stb_no || '-') + '</td>' +
          '<td>' + esc(c.area || '-') + '</td>' +
          '<td>' + esc(c.plan_name || '-') + '<br><span style="font-size:11px;color:var(--text-light)">₹' + c.plan_amount + '</span></td>' +
          '<td style="font-size:12px">' + lastPaid + '</td>' +
          '<td style="font-size:12px">' + (c.expiry_date || '-') + '</td>' +
          '<td>' + (phone ? '<a href="tel:' + esc(phone.replace(/[^0-9+]/g,'')) + '" class="btn btn-outline btn-sm" title="Call ' + esc(phone) + '">📞</a>' : '-') + '</td>' +
          '</tr>';
      }).join('');
    }

    // Pagination
    const pag = document.getElementById('agNrPagination');
    if (!data.total_pages || data.total_pages <= 1) { pag.innerHTML = ''; return; }
    let html = '';
    if (page > 1) html += '<button onclick="agLoadNR(' + (page-1) + ')" class="btn btn-outline btn-sm">← Prev</button> ';
    html += '<span style="margin:0 8px;font-size:13px;color:var(--text-light)">' + ((page-1)*parseInt(perPage)+1) + '-' + Math.min(page*parseInt(perPage), data.total) + ' of ' + data.total + '</span> ';
    if (page < data.total_pages) html += '<button onclick="agLoadNR(' + (page+1) + ')" class="btn btn-outline btn-sm">Next →</button>';
    pag.innerHTML = html;
  }).catch(() => {
    document.getElementById('agNrBody').innerHTML = '<tr><td colspan="8" class="empty-state">Failed to load</td></tr>';
  });
}

async function loadRptCollectorAndMso() {
  // All-time collector performance
  try {
    const cpData = await api('/api/reports/collector-performance');
    const cpEl = document.getElementById('rptCollectorChart');
    const collectors = cpData.collectors || [];
    if (collectors.length) {
      const maxColl = Math.max(...collectors.map(c => c.total_collected), 1);
      const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444'];
      let html = '<div style="display:flex;flex-direction:column;gap:10px">';
      collectors.forEach((c, i) => {
        const pct = Math.max(5, (c.total_collected / maxColl) * 100);
        const color = colors[i % colors.length];
        html += '<div style="display:flex;align-items:center;gap:10px">';
        html += '<div style="min-width:140px;font-size:13px;font-weight:600">' + esc(c.name || 'Unknown') + '</div>';
        html += '<div style="flex:1;background:var(--bg-card);border-radius:6px;overflow:hidden;height:26px;position:relative">';
        html += '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,' + color + ',' + color + 'cc);border-radius:6px;display:flex;align-items:center;justify-content:flex-end;padding-right:8px">';
        if (pct > 25) html += '<span style="color:#fff;font-size:12px;font-weight:600">' + fmtRs(c.total_collected) + '</span>';
        html += '</div>';
        if (pct <= 25) html += '<span style="position:absolute;left:' + (pct+2) + '%;top:50%;transform:translateY(-50%);font-size:12px;font-weight:600">' + fmtRs(c.total_collected) + '</span>';
        html += '</div>';
        html += '<div style="min-width:80px;text-align:right;font-size:12px;color:var(--text-light)">' + c.payment_count + ' payments</div>';
        html += '</div>';
      });
      html += '<div style="text-align:right;font-size:12px;color:var(--text-light);padding-top:4px;border-top:1px solid var(--border)">Total: ' + fmtRs(cpData.total_amount) + ' · ' + cpData.total_payments + ' payments</div>';
      html += '</div>';
      cpEl.innerHTML = html;
    } else { cpEl.innerHTML = '<div class="empty-state"><p>No collection data</p></div>'; }
  } catch(e) { document.getElementById('rptCollectorChart').innerHTML = '<div class="empty-state"><p>Failed to load</p></div>'; }

  // All-time MSO summary
  try {
    const msoData = await api('/api/reports/mso-summary');
    const msoEl = document.getElementById('rptMsoChart');
    const msos = msoData.msos || [];
    if (msos.length) {
      const msoColors = {'GTPL':'#6366f1','TACTV':'#10b981','SCV':'#f59e0b','JAISD':'#ec4899'};
      let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px">';
      msos.forEach(m => {
        const color = msoColors[m.name] || '#8b5cf6';
        html += '<div style="border:1px solid var(--border);border-radius:10px;padding:16px;border-left:4px solid ' + color + '">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
        html += '<strong style="font-size:15px">' + esc(m.name) + '</strong>';
        html += '<span style="font-size:13px;font-weight:600;color:' + color + '">' + m.active_customers + ' active</span>';
        html += '</div>';
        html += '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-light);flex-wrap:wrap;gap:4px">';
        html += '<span>' + m.total_customers + ' conn.</span>';
        html += '<span>' + fmtRs(m.total_collected) + '</span>';
        html += '</div>';
        const activePct = m.total_customers > 0 ? Math.round((m.active_customers / m.total_customers) * 100) : 0;
        html += '<div style="margin-top:8px;background:var(--bg-card);border-radius:4px;height:6px;overflow:hidden">';
        html += '<div style="width:' + activePct + '%;height:100%;background:' + color + ';border-radius:4px"></div>';
        html += '</div></div>';
      });
      html += '</div>';
      msoEl.innerHTML = html;
    } else { msoEl.innerHTML = '<div class="empty-state"><p>No MSO data</p></div>'; }
  } catch(e) { document.getElementById('rptMsoChart').innerHTML = '<div class="empty-state"><p>Failed to load</p></div>'; }
}

async function loadAreaCollection() {
  const chart = document.getElementById('areaCollChart');
  try {
    const fromEl = document.getElementById('areaFrom');
    const toEl = document.getElementById('areaTo');
    // Default: current month
    const now = new Date();
    if (!fromEl.value) fromEl.value = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-01';
    if (!toEl.value) {
      const lastDay = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
      toEl.value = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + lastDay;
    }
    let url = '/api/reports/area-collection?from_date=' + fromEl.value + '&to_date=' + toEl.value;
    const data = await api(url);
    const areas = data.areas || [];
    if (!areas.length) { chart.innerHTML = '<div class="empty-state"><p>No collection data for this period</p></div>'; return; }
    const maxAmt = Math.max(...areas.map(a => a.total_amount), 1);
    const colors = ['#6366f1','#8b5cf6','#a78bfa','#c4b5fd','#818cf8','#6366f1','#4f46e5','#7c3aed','#9333ea','#a855f7'];
    let html = '<div style="display:flex;flex-direction:column;gap:8px">';
    html += '<div style="display:flex;justify-content:space-between;padding:0 4px 6px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-light)"><span>Area</span><span>' + fmtRs(data.total_amount) + ' total · ' + data.total_areas + ' areas</span></div>';
    areas.forEach((a, i) => {
      const pct = Math.max(3, (a.total_amount / maxAmt) * 100);
      const color = colors[i % colors.length];
      html += '<div style="display:flex;align-items:center;gap:10px;padding:4px 0">';
      html += '<div style="min-width:140px;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(a.area) + '">' + esc(a.area) + '</div>';
      html += '<div style="flex:1;background:var(--bg-card);border-radius:6px;overflow:hidden;height:28px;position:relative">';
      html += '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,' + color + ',' + color + 'cc);border-radius:6px;transition:width .3s;display:flex;align-items:center;justify-content:flex-end;padding-right:8px">';
      if (pct > 25) html += '<span style="color:#fff;font-size:12px;font-weight:600">' + fmtRs(a.total_amount) + '</span>';
      html += '</div>';
      if (pct <= 25) html += '<span style="position:absolute;left:' + (pct + 2) + '%;top:50%;transform:translateY(-50%);font-size:12px;font-weight:600;color:var(--text)">' + fmtRs(a.total_amount) + '</span>';
      html += '</div>';
      html += '<div style="min-width:50px;text-align:right;font-size:12px;color:var(--text-light)">' + a.customer_count + ' cust</div>';
      html += '</div>';
    });
    html += '</div>';
    chart.innerHTML = html;
  } catch (e) { chart.innerHTML = '<div class="empty-state"><p>Failed to load area data</p></div>'; }
}

// PLANS
function filterCustomersByPlan(planId) {
  showPage('customers');
  setTimeout(() => {
    const planSel = document.getElementById('custPlanFilter');
    if (planSel) {
      planSel.value = planId;
      loadCustomers(1);
    }
  }, 300);
}

async function loadPlans() {
  try {
    const data = await api('/api/plans');
    const plans = data.plans || data.items || data || [];
    const tbody = document.getElementById('plansBody');
    if (plans.length) {
      tbody.innerHTML = plans.map(p => {
        const custCount = p.active_customers || 0;
        const custBadge = custCount > 0
          ? '<button class="btn btn-outline btn-sm" style="color:var(--primary)" onclick="filterCustomersByPlan(' + p.id + ')" title="Click to view customers">' + custCount + ' 👥</button>'
          : '<span style="color:var(--text-light)">0</span>';
        return '<tr><td><strong>' + esc(p.name || '--') + '</strong></td><td>' + msoBadge(p.network) + '</td><td><strong>' + fmtRs(p.amount || p.price) + '</strong></td><td>' + fmtRs(p.mso_cost || 0) + '</td><td>' + fmtRs(p.mso_cost_late || 0) + '</td><td>Monthly</td><td>' + esc(p.description || '--') + '</td><td><span class="badge ' + (p.status === 'Active' ? 'badge-success' : 'badge-danger') + '">' + esc(p.status || 'Active') + '</span></td><td>' + custBadge + '</td><td><button class="btn btn-outline btn-sm" onclick="openPlanModal(' + (p.id || '') + ',\'' + escAttr(p.name || '').replace(/'/g, "\\'") + '\',' + (p.amount || p.price || 0) + ',\'' + escAttr(p.description || '').replace(/'/g, "\\'") + '\',\'' + escAttr(p.network || 'GTPL') + '\',' + (p.mso_cost || 0) + ',' + (p.mso_cost_late || 0) + ')">✏️</button><button class="btn btn-outline btn-sm" style="color:var(--danger)" onclick="deletePlan(' + (p.id || '') + ',\'' + escAttr(p.name || '').replace(/'/g, "\\'") + '\')">🗑</button></td></tr>';
      }).join('');
    } else { tbody.innerHTML = '<tr><td colspan="10" class="empty-state"><p>No plans yet. Add your first plan!</p></td></tr>'; }
  } catch (e) { toast('Failed to load plans', 'error'); }
}

function openPlanModal(id, name, price, desc, network, msoCost, msoCostLate) {
  editingPlanId = id || null;
  document.getElementById('planModalTitle').textContent = id ? 'Edit Plan' : 'Add Plan';
  document.getElementById('planName').value = name || '';
  document.getElementById('planMSO').value = network || 'GTPL';
  document.getElementById('planPrice').value = price || '';
  document.getElementById('planMsoCost').value = msoCost || 0;
  document.getElementById('planMsoCostLate').value = msoCostLate || 0;
  document.getElementById('planDesc').value = desc || '';
  document.getElementById('planModalOverlay').classList.add('show');
}

function closePlanModal() { document.getElementById('planModalOverlay').classList.remove('show'); editingPlanId = null; }

async function savePlan(e) {
  e.preventDefault();
  const data = {name: document.getElementById('planName').value, amount: parseFloat(document.getElementById('planPrice').value), validity_days: 30, description: document.getElementById('planDesc').value, network: document.getElementById('planMSO').value, mso_cost: parseFloat(document.getElementById('planMsoCost').value) || 0, mso_cost_late: parseFloat(document.getElementById('planMsoCostLate').value) || 0};
  try {
    if (editingPlanId) await api('/api/plans/' + editingPlanId, {method: 'PUT', body: JSON.stringify(data)});
    else await api('/api/plans', {method: 'POST', body: JSON.stringify(data)});
    toast(editingPlanId ? 'Plan updated!' : 'Plan added!', 'success'); closePlanModal(); loadPlans();
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
}

async function deletePlan(id, name) {
  try {
    await api('/api/plans/' + id, {method: 'DELETE'});
    toast('Plan deleted', 'success'); loadPlans();
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('active customer')) {
      toast(msg, 'error');
      if (confirm(msg + '\n\nView these customers?')) {
        showPage('customers');
        // Set plan filter after a short delay to let the page load
        setTimeout(() => {
          const planSel = document.getElementById('custPlanFilter');
          if (planSel) { planSel.value = id; loadCustomers(1); }
        }, 500);
      }
    } else {
      toast('Delete failed: ' + msg, 'error');
    }
  }
}

// ── REMINDERS ─────────────────────────────────────────────────────────────
let _remCustomers = [];

async function loadReminders() {
  const filter = document.getElementById('remFilter').value;
  const network = document.getElementById('remNetwork').value;
  let url = '/api/reminders/due?';
  if (filter === 'due_soon') url += 'include_due_soon=true';
  else if (filter === 'overdue') url += 'days_overdue=1';
  else url += 'include_due_soon=true'; // all
  if (network) url += '&network=' + network;

  const data = await api(url);
  _remCustomers = data.customers || [];
  document.getElementById('remSentToday').textContent = data.sent_today_count;
  document.getElementById('remRemaining').textContent = data.remaining_today;
  document.getElementById('remUnpaid').textContent = data.total;

  const tbody = document.getElementById('remBody');
  tbody.innerHTML = _remCustomers.map(c => {
    const netClass = (c.mso || 'GTPL').toLowerCase();
    const expDate = new Date(c.expiry_date);
    const isExpired = expDate < new Date();
    const esc = s => (s||'').replace(/</g,'&lt;');
    return `<tr>
      <td><input type="checkbox" class="rem-check" data-cid="${esc(c.customer_id)}" onchange="updateRemCount()"></td>
      <td>${esc(c.name)}</td>
      <td>${esc(c.phone)}</td>
      <td><span class="net-badge net-${esc(netClass)}">${esc(c.mso || 'GTPL')}</span></td>
      <td>${esc(c.plan_name || '-')}</td>
      <td>₹${c.plan_amount || 0}</td>
      <td style="color:${isExpired ? 'var(--danger)' : 'var(--text)'}">${c.expiry_date}</td>
      <td>${c.sent_today ? '<span class="badge badge-success">Sent Today</span>' : '<span class="badge badge-warning">Pending</span>'}</td>
    </tr>`;
  }).join('');

  updateRemCount();
  loadReminderHistory();
}

async function loadReminderHistory() {
  const data = await api('/api/reminders/history?limit=20');
  const tbody = document.getElementById('remHistoryBody');
  const hist = data.history || [];
  if (!hist.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No reminders sent yet</td></tr>'; return; }
  const esc = s => (s||'').replace(/</g,'&lt;');
  tbody.innerHTML = hist.map(h => `<tr>
    <td>${esc(h.sent_at)}</td>
    <td>${esc(h.customer_name || 'Unknown')}</td>
    <td>${esc(h.phone)}</td>
    <td><span class="badge badge-success">${esc(h.status)}</span></td>
  </tr>`).join('');
}

function remToggleAll(checked) {
  document.querySelectorAll('.rem-check').forEach(cb => cb.checked = checked);
  updateRemCount();
}
function remSelectAll() { remToggleAll(true); }
function remSelectNone() { remToggleAll(false); }

function updateRemCount() {
  const checked = document.querySelectorAll('.rem-check:checked');
  document.getElementById('remSelectedCount').textContent = checked.length;
}

async function sendReminders() {
  const checked = document.querySelectorAll('.rem-check:checked');
  if (!checked.length) { toast('Select at least one customer', 'error'); return; }
  const ids = Array.from(checked).map(cb => cb.dataset.cid);
  if (!confirm(`Send WhatsApp reminder to ${ids.length} customer(s)?\n\nUses CARE number (7708551139).\nDaily limit: 15 messages.`)) return;

  toast('Sending reminders...', 'info');
  try {
    const result = await api('/api/reminders/send', {
      method: 'POST',
      body: JSON.stringify({ customer_ids: ids })
    });
    const r = result;
    toast(`Sent: ${r.sent_count}, Failed: ${r.failed_count}`, r.failed_count > 0 ? 'warning' : 'success');

    // Show results
    const resDiv = document.getElementById('remResults');
    const resBody = document.getElementById('remResultsBody');
    resDiv.style.display = 'block';
    const esc = s => (s||'').replace(/</g,'&lt;');
    resBody.innerHTML = `<table><thead><tr><th>Customer</th><th>Phone</th><th>Status</th></tr></thead><tbody>` +
      (r.results || []).map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.phone)}</td><td><span class="badge badge-${x.status==='sent'?'success':'danger'}">${esc(x.status)}</span></td></tr>`).join('') +
      `</tbody></table>`;

    loadReminders();
  } catch (err) { toast('Failed: ' + err.message, 'error'); }
}

