const API = window.location.origin;
let token = localStorage.getItem('token');
let currentPage = 1;
let currentFilter = 'all';
let searchTimer = null;
let editingPlanId = null;
let _custData = null;
let _custPlans = [];
let _custPayments = [];
let _custSms = [];
let _empList = [];
let _stbInventory = [];
let _surrenderRequests = [];

if (!token) window.location.href = 'index.html';

async function api(path, opts = {}) {
  const headers = {'Content-Type': 'application/json'};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  try {
    const r = await fetch(API + path, {...opts, headers: {...headers, ...(opts.headers || {})}});
    if (r.status === 401) { sessionStorage.setItem('logoutMsg', 'Session expired. Please login again.'); localStorage.removeItem('token'); window.location.href = 'index.html'; return; }
    const text = await r.text();
    let d;
    try { d = JSON.parse(text); } catch(e) { throw new Error(r.status + ': ' + text.substring(0, 200)); }
    if (!r.ok) {
      const msg = Array.isArray(d.detail) ? d.detail.map(e => e.msg || e.message || JSON.stringify(e)).join('; ') : (d.detail || d.error || d.message || 'API Error');
      throw new Error(typeof msg === 'object' ? JSON.stringify(msg) : String(msg));
    }
    return d;
  } catch (e) { if (e.message === 'Failed to fetch') toast('Server not reachable', 'error'); throw e; }
}

function toast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  const icons = {success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️'};
  t.innerHTML = '<span class="toast-icon">' + (icons[type] || 'ℹ️') + '</span><span>' + esc(String(msg)) + '</span>';
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-20px)'; setTimeout(() => t.remove(), 400); }, 4000);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escAttr(s) {
  return encodeURIComponent(String(s));
}

function fmtRs(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
function fmtDate(d) { if (!d) return '--'; return new Date(d).toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'}); }

/* ---------- Table Export Helpers ---------- */
function _tableToRows(sel) {
  const table = document.querySelector(sel);
  if (!table) { toast('No table found', 'error'); return null; }
  const rows = [];
  table.querySelectorAll('tr').forEach(tr => {
    const cells = [];
    tr.querySelectorAll('th, td').forEach(td => cells.push(td.textContent.trim()));
    if (cells.length) rows.push(cells);
  });
  return rows;
}

function _rowsToCSV(rows) {
  return rows.map(r => r.map(c => '"' + c.replace(/"/g, '""') + '"').join(',')).join('\r\n');
}

function _rowsToExcel(rows) {
  // Simple HTML-table based XLS that Excel opens natively
  const C = String.fromCharCode; // avoid literal close tags - hosting auto-injects before them
  const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">'
    + '<head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Sheet1</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>'
    + '<body><table border="1">' + rows.map((r, ri) => {
        const tag = ri === 0 ? 'th' : 'td';
        const style = ri === 0 ? ' style="background:#4f46e5;color:#fff;font-weight:bold;padding:8px;"' : ' style="padding:6px;"';
        return '<tr>' + r.map(c => '<' + tag + style + '>' + esc(c) + '</' + tag + '>').join('') + '</tr>';
      }).join('') + '</table>' + C(60) + '/body' + C(62) + C(60) + '/html' + C(62);
  return html;
}

function _downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function exportTableCSV(sel, name) {
  const rows = _tableToRows(sel);
  if (!rows) return;
  _downloadFile('\uFEFF' + _rowsToCSV(rows), name + '.csv', 'text/csv');
  toast('CSV exported: ' + (rows.length - 1) + ' rows', 'success');
}

function exportTableExcel(sel, name) {
  const rows = _tableToRows(sel);
  if (!rows) return;
  _downloadFile(_rowsToExcel(rows), name + '.xls', 'application/vnd.ms-excel');
  toast('Excel exported: ' + (rows.length - 1) + ' rows', 'success');
}

function payTypeBadge(t) {
  if (!t) return '<span class="badge" style="background:#6c757d;color:#fff;font-size:10px">—</span>';
  const map = {regular:'background:#28a745',advance:'background:#007bff',partial:'background:#fd7e14',adjustment:'background:#6f42c1',reconnection:'background:#17a2b8'};
  return '<span class="badge" style="'+(map[t]||'background:#6c757d')+';color:#fff;font-size:10px">'+esc(t)+'</span>';
}

/* ---------- Payments Export Helpers ---------- */
async function _fetchPaymentsForExport() {
  const fromEl = document.getElementById('payDateFrom');
  const toEl = document.getElementById('payDateTo');
  const from = fromEl ? fromEl.value : '';
  const to = toEl ? toEl.value : '';
  if (!from || !to) { toast('Select date range first', 'error'); return null; }
  const data = await api('/api/payments/all?per_page=10000&date_from=' + from + '&date_to=' + to);
  if (!data || !data.payments) { toast('No payments to export', 'error'); return null; }
  return { payments: data.payments, total: data.total || data.payments.length };
}

function _paymentsToCSV(payments) {
  const hdr = ['Date','Customer','ID','Phone','STB','Plan','Amount','Type','Collected By','Note'];
  const rows = [hdr];
  payments.forEach(p => {
    rows.push([
      p.collected_at || p.date || '', p.customer_name || p.name || '', p.customer_id || '',
      p.phone || '', p.stb_no || '', p.plan_name || '', p.amount || '',
      p.payment_type || p.type || '', p.collected_by_name || p.collected_by || '', p.note || ''
    ]);
  });
  return _rowsToCSV(rows);
}

function _paymentsToExcel(payments) {
  const hdr = ['Date','Customer','ID','Phone','STB','Plan','Amount','Type','Collected By','Note'];
  const rows = [hdr];
  payments.forEach(p => {
    rows.push([
      p.collected_at || p.date || '', p.customer_name || p.name || '', p.customer_id || '',
      p.phone || '', p.stb_no || '', p.plan_name || '', p.amount || '',
      p.payment_type || p.type || '', p.collected_by_name || p.collected_by || '', p.note || ''
    ]);
  });
  return _rowsToExcel(rows);
}

async function exportPaymentsCSV() {
  const data = await _fetchPaymentsForExport();
  if (!data) return;
  const fromEl = document.getElementById('payDateFrom');
  const toEl = document.getElementById('payDateTo');
  const fname = 'Payments_' + fromEl.value + '_to_' + toEl.value;
  _downloadFile(_paymentsToCSV(data.payments), fname + '.csv', 'text/csv');
  toast('CSV exported: ' + data.total + ' payments', 'success');
}

async function exportPaymentsExcel() {
  const data = await _fetchPaymentsForExport();
  if (!data) return;
  const fromEl = document.getElementById('payDateFrom');
  const toEl = document.getElementById('payDateTo');
  const fname = 'Payments_' + fromEl.value + '_to_' + toEl.value;
  _downloadFile(_paymentsToExcel(data.payments), fname + '.xls', 'application/vnd.ms-excel');
  toast('Excel exported: ' + data.total + ' payments', 'success');
}

/* ---------- Export All Pages Helpers ---------- */
// Generic: fetch ALL pages from API (paginates automatically), convert to CSV/Excel
async function _exportAll(url, columns, rowMapper, filename, format) {
  try {
    toast('Exporting...', 'info');
    // Force per_page=200 (API max) for pagination
    const base = url.replace(/per_page=\d+/, 'per_page=200');
    const first = await api(base + (base.includes('?') ? '&' : '?') + 'page=1');
    const items = first.customers || first.payments || first.items || [];
    // API returns 'total' (count) not 'total_pages' - calculate it
    const total = first.total || items.length;
    const totalPages = Math.ceil(total / 200);
    // Fetch remaining pages in parallel (batches of 5)
    for (let p = 2; p <= totalPages; p += 5) {
      const batch = [];
      for (let b = 0; b < 5 && (p + b) <= totalPages; b++) {
        batch.push(api(base + (base.includes('?') ? '&' : '?') + 'page=' + (p + b)));
      }
      const results = await Promise.all(batch);
      results.forEach(r => {
        const more = r.customers || r.payments || r.items || [];
        items.push(...more);
      });
    }
    if (!items.length) { toast('No data to export', 'error'); return; }
    const rows = [columns];
    items.forEach((item, i) => rows.push(rowMapper(item, i)));
    if (format === 'csv') {
      _downloadFile('\uFEFF' + _rowsToCSV(rows), filename + '.csv', 'text/csv');
    } else {
      _downloadFile(_rowsToExcel(rows), filename + '.xls', 'application/vnd.ms-excel');
    }
    toast((format === 'csv' ? 'CSV' : 'Excel') + ' exported: ' + items.length + ' rows', 'success');
  } catch (e) { toast('Export failed: ' + e.message, 'error'); }
}

// --- Customers Export ---
function _custExportUrl() {
  const sortBy = document.getElementById('custSortBy').value;
  const sortOrder = document.getElementById('custSortOrder').value;
  const statusFilter = document.getElementById('custStatusFilter').value;
  const planFilter = document.getElementById('custPlanFilter').value;
  // Use name sorting as default (customer_id sort has backend issues with JOINs)
  let url = '/api/customers?per_page=200&sort_by=' + sortBy + '&sort_order=' + sortOrder;
  // Export: show ALL statuses by default (empty string = all in backend)
  if (!statusFilter) url += '&status=';
  else url += '&status=' + statusFilter;
  if (currentFilter === 'paid') { url += '&payment_filter=paid'; }
  else if (currentFilter === 'unpaid') { url += '&payment_filter=unpaid'; }
  else if (currentFilter === 'all' && statusFilter) url += '&status=' + statusFilter;
  if (currentFilter !== 'all' && currentFilter !== '') {
    const from = document.getElementById('paidFrom').value;
    const to = document.getElementById('paidTo').value;
    if (from) url += '&paid_from=' + from;
    if (to) url += '&paid_to=' + to;
  }
  if (currentFilter === 'paid') {
    const fArea = document.getElementById('filterArea').value;
    const fMode = document.getElementById('filterMode').value;
    const fColl = document.getElementById('filterCollector').value;
    const fAmt = document.getElementById('filterAmount').value;
    if (fArea) url += '&paid_area=' + encodeURIComponent(fArea);
    if (fMode) url += '&paid_mode=' + encodeURIComponent(fMode);
    if (fColl) url += '&paid_collected_by=' + encodeURIComponent(fColl);
    if (fAmt) url += '&paid_amount=' + encodeURIComponent(fAmt);
  }
  if (planFilter) url += '&plan_id=' + planFilter;
  return url;
}

async function exportCustomersCSV() {
  _exportAll(_custExportUrl(),
    ['ID','Name','STB','Phone','Area','Status','Paid','Plan','Amount'],
    c => [c.customer_id, c.name, c.stb_no||'', c.phone||'', c.area||'', c.status||'', c.is_paid?'Yes':'No', c.plan_name||'', c.plan_amount||''],
    'Customers', 'csv');
}
async function exportCustomersExcel() {
  _exportAll(_custExportUrl(),
    ['ID','Name','STB','Phone','Area','Status','Paid','Plan','Amount'],
    c => [c.customer_id, c.name, c.stb_no||'', c.phone||'', c.area||'', c.status||'', c.is_paid?'Yes':'No', c.plan_name||'', c.plan_amount||''],
    'Customers', 'excel');
}

// --- Unpaid Export ---
function _unpaidExportUrl() {
  // Works for both standalone page (unpSearch/unpArea) and reports tab (agUnpSearch/agUnpArea/agUnpMso)
  const q = document.getElementById('unpSearch')?.value?.trim() || document.getElementById('agUnpSearch')?.value?.trim() || '';
  const area = document.getElementById('unpArea')?.value || document.getElementById('agUnpArea')?.value || '';
  const mso = document.getElementById('agUnpMso')?.value || '';
  let url = '/api/customers/unpaid?per_page=200';
  if (q) url += '&q=' + encodeURIComponent(q);
  if (area) url += '&area=' + encodeURIComponent(area);
  if (mso) url += '&mso=' + encodeURIComponent(mso);
  if (typeof _unpAsOf !== 'undefined' && _unpAsOf) url += '&as_of=' + encodeURIComponent(_unpAsOf);
  return url;
}

async function exportUnpaidCSV() {
  _exportAll(_unpaidExportUrl(),
    ['S.No','ID','Name','STB','Area','Plan','Amount','Expiry','Gap (months)','Pending'],
    (c,i) => [i+1, c.customer_id, c.name, c.stb_no||'', c.area||'', c.plan_name||'', c.plan_amount||'', c.expiry_date||'', c.gap_months||0, c.pending_amount||0],
    'Unpaid', 'csv');
}
async function exportUnpaidExcel() {
  _exportAll(_unpaidExportUrl(),
    ['S.No','ID','Name','STB','Area','Plan','Amount','Expiry','Gap (months)','Pending'],
    (c,i) => [i+1, c.customer_id, c.name, c.stb_no||'', c.area||'', c.plan_name||'', c.plan_amount||'', c.expiry_date||'', c.gap_months||0, c.pending_amount||0],
    'Unpaid', 'excel');
}

// --- Not Renewed Export ---
function _notRenewedExportUrl() {
  // Works for both standalone page (nrSearch/nrArea/nrMso) and reports tab (agNrSearch/agNrArea/agNrMso)
  const q = document.getElementById('nrSearch')?.value?.trim() || document.getElementById('agNrSearch')?.value?.trim() || '';
  const area = document.getElementById('nrArea')?.value || document.getElementById('agNrArea')?.value || '';
  const mso = document.getElementById('nrMso')?.value || document.getElementById('agNrMso')?.value || '';
  let url = '/api/customers/not-renewed?per_page=200';
  if (q) url += '&q=' + encodeURIComponent(q);
  if (area) url += '&area=' + encodeURIComponent(area);
  if (mso) url += '&mso=' + encodeURIComponent(mso);
  // Check both _nrMonth (standalone) and _agNrMonth (reports tab)
  const nrMonth = (typeof _nrMonth !== 'undefined' && _nrMonth) ? _nrMonth : (typeof _agNrMonth !== 'undefined' && _agNrMonth) ? _agNrMonth : '';
  if (nrMonth) url += '&month=' + encodeURIComponent(nrMonth);
  return url;
}

async function exportNotRenewedCSV() {
  _exportAll(_notRenewedExportUrl(),
    ['S.No','ID','Name','STB','Area','Plan','Amount','Expiry','Last Paid'],
    (c,i) => [i+1, c.customer_id, c.name, c.stb_no||'', c.area||'', c.plan_name||'', c.plan_amount||'', c.expiry_date||'', c.last_paid_date||''],
    'Not_Renewed', 'csv');
}
async function exportNotRenewedExcel() {
  _exportAll(_notRenewedExportUrl(),
    ['S.No','ID','Name','STB','Area','Plan','Amount','Expiry','Last Paid'],
    (c,i) => [i+1, c.customer_id, c.name, c.stb_no||'', c.area||'', c.plan_name||'', c.plan_amount||'', c.expiry_date||'', c.last_paid_date||''],
    'Not_Renewed', 'excel');
}

// --- Reminders Export ---
async function exportRemindersCSV() {
  const filter = document.getElementById('remFilter').value;
  const network = document.getElementById('remNetwork').value;
  let url = '/api/reminders/due?';
  if (filter === 'due_soon') url += 'include_due_soon=true';
  else if (filter === 'overdue') url += 'days_overdue=1';
  else url += 'include_due_soon=true';
  if (network) url += '&network=' + network;
  const data = await api(url);
  const items = data.customers || [];
  if (!items.length) { toast('No reminders to export', 'error'); return; }
  const rows = [['Name','Phone','MSO','Plan','Amount','Expiry','Sent Today']];
  items.forEach(c => rows.push([c.name||'', c.phone||'', c.mso||'GTPL', c.plan_name||'', c.plan_amount||'', c.expiry_date||'', c.sent_today?'Yes':'No']));
  _downloadFile('\uFEFF' + _rowsToCSV(rows), 'Reminders.csv', 'text/csv');
  toast('CSV exported: ' + items.length + ' rows', 'success');
}
async function exportRemindersExcel() {
  const filter = document.getElementById('remFilter').value;
  const network = document.getElementById('remNetwork').value;
  let url = '/api/reminders/due?';
  if (filter === 'due_soon') url += 'include_due_soon=true';
  else if (filter === 'overdue') url += 'days_overdue=1';
  else url += 'include_due_soon=true';
  if (network) url += '&network=' + network;
  const data = await api(url);
  const items = data.customers || [];
  if (!items.length) { toast('No reminders to export', 'error'); return; }
  const rows = [['Name','Phone','MSO','Plan','Amount','Expiry','Sent Today']];
  items.forEach(c => rows.push([c.name||'', c.phone||'', c.mso||'GTPL', c.plan_name||'', c.plan_amount||'', c.expiry_date||'', c.sent_today?'Yes':'No']));
  _downloadFile(_rowsToExcel(rows), 'Reminders.xls', 'application/vnd.ms-excel');
  toast('Excel exported: ' + items.length + ' rows', 'success');
}

// --- My Collections Export ---
function _myCollExportUrl() {
  const { from, to } = getCollDates();
  return `/api/reports/my-collections?from_date=${from}&to_date=${to}&per_page=200`;
}
async function exportMyCollectionsCSV() {
  _exportAll(_myCollExportUrl(),
    ['S.No','Customer','Area','Amount','Mode','Date'],
    (p,i) => [i+1, p.customer_name||'', p.area||'', p.amount||'', p.mode||'', p.date||''],
    'My_Collections', 'csv');
}
async function exportMyCollectionsExcel() {
  _exportAll(_myCollExportUrl(),
    ['S.No','Customer','Area','Amount','Mode','Date'],
    (p,i) => [i+1, p.customer_name||'', p.area||'', p.amount||'', p.mode||'', p.date||''],
    'My_Collections', 'excel');
}

function msoBadge(net) { const n = (net || 'GTPL').toUpperCase(); const cls = n === 'TACTV' ? 'net-tactv' : n === 'SCV' ? 'net-scv' : 'net-gtpl'; return '<span class="net-badge ' + cls + '">' + esc(n) + '</span>'; }

function isMobile() { return window.innerWidth <= 768; }
function detectMSO(stb) { const s = (stb || '').trim(); if (s.startsWith('172') || s.startsWith('173')) return 'TACTV'; if (s.startsWith('5000')) return 'SCV'; return 'GTPL'; }
