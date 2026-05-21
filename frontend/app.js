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
    if (!r.ok) throw new Error(d.detail || d.error || d.message || 'API Error');
    return d;
  } catch (e) { if (e.message === 'Failed to fetch') toast('Server not reachable', 'error'); throw e; }
}

function toast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  const icons = {success: '✅', error: '❌', info: 'ℹ️'};
  t.innerHTML = (icons[type] || 'ℹ️') + ' ' + esc(String(msg));
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(100%)'; setTimeout(() => t.remove(), 300); }, 3500);
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

function msoBadge(net) { const n = (net || 'GTPL').toUpperCase(); const cls = n === 'TACTV' ? 'net-tactv' : n === 'SCV' ? 'net-scv' : 'net-gtpl'; return '<span class="net-badge ' + cls + '">' + esc(n) + '</span>'; }

function isMobile() { return window.innerWidth <= 768; }
function detectMSO(stb) { const s = (stb || '').trim(); if (s.startsWith('172') || s.startsWith('173')) return 'TACTV'; if (s.startsWith('5000')) return 'SCV'; return 'GTPL'; }

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => { n.classList.toggle('active', n.dataset.page === page); });
  document.getElementById('sidebar').classList.remove('open');
  const titles = {'dashboard': 'Dashboard', 'customers': 'Customers', 'add-customer': 'Add Customer', 'plans': 'Plans', 'payments': 'Payments', 'unpaid': 'Unpaid Customers', 'not-renewed': 'Not Renewed', 'employees': 'Employees', 'surrender-req': 'Surrender Requests', 'service-requests': 'Service Requests', 'reports': 'Reports', 'reminders': 'Payment Reminders', 'audit': 'Audit Log', 'settings': 'Settings', 'operators': 'Operators'};
  document.getElementById('pageTitle').textContent = titles[page] || page;
  if (page === 'dashboard') loadDashboard();
  if (page === 'customers') { loadCustomers(1); loadPaidFilters(); loadPlanOptions('GTPL'); loadCustPlanFilter(); }
  if (page === 'add-customer') { initAddCustomerForRole(); }
  if (page === 'plans') loadPlans();
  if (page === 'payments') { initPaymentForm(); }
  if (page === 'employees') loadEmployees();
  if (page === 'surrender-req') loadSurrenderRequests();
  if (page === 'service-requests') loadServiceRequests();
  if (page === 'reports') loadReports();
  if (page === 'reminders') loadReminders();
  if (page === 'my-collections') loadMyCollections(1);
  if (page === 'unpaid') loadUnpaid(1);
  if (page === 'not-renewed') loadNotRenewed(1);
  if (page === 'settings') { initSettingsPage(); }
  if (page === 'operators') loadOperators();
  if (page === 'audit') loadAuditLog(1);
}

// ===== MOBILE BOTTOM NAV =====
function mobNav(page, el) {
  document.querySelectorAll('.mob-nav-item').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  if (page === 'more') {
    openMobSheet();
    return;
  }
  document.getElementById('sidebar').classList.remove('open');
  showPage(page);
}

function openMobSheet() {
  const sheet = document.getElementById('mobMoreSheet');
  sheet.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeMobSheet() {
  const sheet = document.getElementById('mobMoreSheet');
  sheet.classList.remove('open');
  document.body.style.overflow = '';
}

// Override showPage to update mobile nav active state
const _origShowPage2 = showPage;
showPage = function(page) {
  // For agents, redirect "reports" to "my-collections"
  if (page === 'reports' && (_userRole === 'collection_agent' || _userRole === 'agent')) {
    page = 'my-collections';
  }
  _origShowPage2(page);
  const pageMap = {'dashboard':0,'payments':1,'customers':2,'unpaid':3};
  const idx = pageMap[page];
  document.querySelectorAll('.mob-nav-item').forEach((b,i) => b.classList.toggle('active', i === idx));
};

// On mobile, auto-navigate to Payments (agent's primary task)
if (isMobile() && token) {
  setTimeout(() => {
    showPage('payments');
    const mobBtns = document.querySelectorAll('.mob-nav-item');
    mobBtns[0].classList.remove('active');
    mobBtns[1].classList.add('active');
  }, 150);
}

async function syncPaypakka() {
  const btn = document.getElementById('btnSyncPP');
  const token = prompt('Enter Paypakka JWT token:\n(Get it from app.paypakka.com → DevTools → Network → any XHR → x-access-token header)');
  if (!token || !token.trim()) { toast('Sync cancelled', 'info'); return; }
  btn.disabled = true;
  btn.innerHTML = '🔄 Syncing...';
  try {
    const r = await api('/api/paypakka/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.trim() })
    });
    if (r.new_payments > 0) {
      toast('✅ ' + r.new_payments + ' new Paypakka payment(s) synced! Telegram notified.', 'success');
      loadDashboard();
    } else {
      toast('✅ Sync complete — no new payments found', 'info');
    }
  } catch (e) {
    toast('Sync failed: ' + (e.message || 'Unknown error'), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔄 Sync Paypakka';
  }
}

async function loadDashboard() {
  if (_userRole === 'master') {
    document.getElementById('masterDashboard').style.display = '';
    document.getElementById('lcoDashboard').style.display = 'none';
    try {
      const s = await api('/api/dashboard/master');
      document.getElementById('mStatOperators').textContent = s.total_operators || 0;
      document.getElementById('mStatCustomers').textContent = s.total_customers || 0;
      document.getElementById('mStatCollected').textContent = fmtRs(s.total_collected);
      document.getElementById('mStatPaid').textContent = s.total_paid || 0;
      document.getElementById('mStatEfficiency').textContent = (s.collection_efficiency || 0).toFixed(1) + '%';
      document.getElementById('mStatMonth').textContent = 'Month: ' + (s.month || '--');
      const tbody = document.getElementById('masterOpTable');
      const ops = s.operators || [];
      if (ops.length) {
        tbody.innerHTML = ops.map(o => {
          const statusCls = o.status === 'active' ? 'badge-success' : 'badge-warning';
          return '<tr><td><strong>' + esc(o.business_name) + '</strong><br><small style="color:var(--text-light)">' + esc(o.owner_name || '') + '</small></td>' +
            '<td>' + msoBadge(o.mso) + '</td>' +
            '<td>' + esc(o.area || '--') + '</td>' +
            '<td><strong>' + (o.customer_count || 0) + '</strong></td>' +
            '<td>' + (o.connection_count || 0) + '</td>' +
            '<td>' + (o.paid_local || 0) + '</td>' +
            '<td><strong>' + fmtRs(o.collected_local || 0) + '</strong></td>' +
            '<td><span class="badge ' + statusCls + '">' + esc(o.status) + '</span></td>' +
            '<td><code>' + esc(o.customer_prefix || '--') + '</code></td></tr>';
        }).join('');
      } else { tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><p>No operators yet</p></td></tr>'; }
    } catch (e) { toast('Failed to load master dashboard', 'error'); }
  } else {
    document.getElementById('masterDashboard').style.display = 'none';
    const isAgentRole = _userRole === 'service_agent' || _userRole === 'collection_agent' || _userRole === 'agent';

    if (isAgentRole) {
      // Agent dashboard — only their own data
      document.getElementById('lcoDashboard').style.display = 'none';
      document.getElementById('agentDashboard').style.display = '';
      try {
        const s = await api('/api/dashboard/stats');
        document.getElementById('agStatCollected').textContent = fmtRs(s.my_collected || 0);
        document.getElementById('agStatPayments').textContent = s.my_payments || 0;
        document.getElementById('agStatMonth').textContent = 'Month: ' + (s.month || '--');
        const tbody = document.getElementById('agRecentPaymentsBody');
        if (s.recent_payments && s.recent_payments.length) {
          tbody.innerHTML = s.recent_payments.map(p => {
            const stb = p.stb_no ? esc(p.stb_no) : '--';
            const stbCell = p.stb_no ? '<td><span style="cursor:pointer;font-family:monospace;font-size:12px;background:var(--bg-card);padding:2px 8px;border-radius:4px;border:1px solid var(--border)" onclick="navigator.clipboard.writeText(\'' + escAttr(p.stb_no) + '\');this.style.background=\'var(--primary)\';this.style.color=\'#fff\';setTimeout(()=>{this.style.background=\'var(--bg-card)\';this.style.color=\'inherit\'},600)" title="Click to copy">' + stb + '</span></td>' : '<td>--</td>';
            return '<tr><td><strong>' + esc(p.customer_name || '--') + '</strong><br><small style="color:var(--text-light)">' + esc(p.customer_id || '') + '</small></td>' + stbCell + '<td>' + esc(p.area || '--') + '</td><td><strong>' + fmtRs(p.amount) + '</strong></td><td><span class="badge badge-primary">' + esc(p.mode || '--') + '</span></td><td>' + fmtDate(p.date) + '</td></tr>';
          }).join('');
        } else { tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>No recent payments</p></td></tr>'; }
        // Mobile card view
        const mobPay = document.getElementById('mobAgRecentPayments');
        if (mobPay) {
          if (s.recent_payments && s.recent_payments.length) {
            mobPay.innerHTML = s.recent_payments.map(p =>
              '<div class="mob-pay-card">' +
              '<div class="mob-pay-top"><span class="mob-pay-name">' + esc(p.customer_name || '--') + '</span><span class="mob-pay-amt">' + fmtRs(p.amount) + '</span></div>' +
              '<div class="mob-pay-details">' +
              '<span>' + esc(p.mode || '--') + '</span>' +
              '<span>' + fmtDate(p.date) + '</span>' +
              (p.area ? '<span>' + esc(p.area) + '</span>' : '') +
              '</div></div>'
            ).join('');
          } else {
            mobPay.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-light)">No recent payments</div>';
          }
        }
      } catch (e) { toast('Failed to load dashboard', 'error'); }
    } else {
      // Admin/Support — full LCO dashboard
      document.getElementById('lcoDashboard').style.display = '';
      document.getElementById('agentDashboard').style.display = 'none';
  try {
    const s = await api('/api/dashboard/stats');
    document.getElementById('statTotal').textContent = s.total_customers || 0;
    document.getElementById('statPaid').textContent = s.paid_this_month || 0;
    document.getElementById('statPaidAmt').textContent = fmtRs(s.total_collected) + ' collected';
    document.getElementById('statUnpaid').textContent = s.unpaid_this_month || 0;
    document.getElementById('statEfficiency').textContent = (s.collection_efficiency || 0).toFixed(1) + '%';
    document.getElementById('statMonth').textContent = 'Month: ' + (s.month || '--');
    const tbody = document.getElementById('recentPaymentsBody');
    if (s.recent_payments && s.recent_payments.length) {
      tbody.innerHTML = s.recent_payments.map(p => {
        const stb = p.stb_no ? esc(p.stb_no) : '--';
        const stbCell = p.stb_no ? '<td><span style="cursor:pointer;font-family:monospace;font-size:12px;background:var(--bg-card);padding:2px 8px;border-radius:4px;border:1px solid var(--border)" onclick="navigator.clipboard.writeText(\'' + escAttr(p.stb_no) + '\');this.style.background=\'var(--primary)\';this.style.color=\'#fff\';setTimeout(()=>{this.style.background=\'var(--bg-card)\';this.style.color=\'inherit\'},600)" title="Click to copy">' + stb + '</span></td>' : '<td>--</td>';
        return '<tr><td><strong>' + esc(p.customer_name || '--') + '</strong><br><small style="color:var(--text-light)">' + esc(p.customer_id || '') + '</small></td>' + stbCell + '<td>' + esc(p.area || '--') + '</td><td><strong>' + fmtRs(p.amount) + '</strong></td><td><span class="badge badge-primary">' + esc(p.mode || '--') + '</span></td><td>' + esc(p.collector_name || '--') + '</td><td>' + fmtDate(p.date) + '</td></tr>';
      }).join('');
    } else { tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>No recent payments</p></td></tr>'; }
    // Mobile card view for recent payments
    const mobPay = document.getElementById('mobRecentPayments');
    if (mobPay) {
      if (s.recent_payments && s.recent_payments.length) {
        mobPay.innerHTML = s.recent_payments.map(p => 
          '<div class="mob-pay-card">' +
          '<div class="mob-pay-top"><span class="mob-pay-name">' + esc(p.customer_name || '--') + '</span><span class="mob-pay-amt">' + fmtRs(p.amount) + '</span></div>' +
          '<div class="mob-pay-details">' +
          '<span>' + esc(p.mode || '--') + '</span>' +
          '<span>' + esc(p.collector_name || '--') + '</span>' +
          '<span>' + fmtDate(p.date) + '</span>' +
          (p.area ? '<span>' + esc(p.area) + '</span>' : '') +
          '</div></div>'
        ).join('');
      } else {
        mobPay.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-light)">No recent payments</div>';
      }
    }
    // Load collector performance (current month only)
    const now = new Date();
    const cmFrom = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-01';
    const cmLastDay = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    const cmTo = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + cmLastDay;
    try {
      const cpData = await api('/api/reports/collector-performance?from_date=' + cmFrom + '&to_date=' + cmTo);
      const cpEl = document.getElementById('collectorChart');
      const collectors = cpData.collectors || [];
      if (collectors.length) {
        const maxColl = Math.max(...collectors.map(c => c.total_collected), 1);
        const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444'];
        let html = '<div style="display:flex;flex-direction:column;gap:10px">';
        collectors.forEach((c, i) => {
          const pct = Math.max(5, (c.total_collected / maxColl) * 100);
          const color = colors[i % colors.length];
          html += '<div style="display:flex;align-items:center;gap:10px">';
          html += '<div style="min-width:100px;font-size:13px;font-weight:600">' + esc(c.name) + '</div>';
          html += '<div style="flex:1;background:var(--bg-card);border-radius:6px;overflow:hidden;height:26px;position:relative">';
          html += '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,' + color + ',' + color + 'cc);border-radius:6px;display:flex;align-items:center;justify-content:flex-end;padding-right:8px">';
          if (pct > 30) html += '<span style="color:#fff;font-size:12px;font-weight:600">' + fmtRs(c.total_collected) + '</span>';
          html += '</div>';
          if (pct <= 30) html += '<span style="position:absolute;left:' + (pct+2) + '%;top:50%;transform:translateY(-50%);font-size:12px;font-weight:600">' + fmtRs(c.total_collected) + '</span>';
          html += '</div>';
          html += '<div style="min-width:70px;text-align:right;font-size:12px;color:var(--text-light)">' + c.payment_count + ' payments</div>';
          html += '</div>';
        });
        html += '<div style="text-align:right;font-size:12px;color:var(--text-light);padding-top:4px;border-top:1px solid var(--border)">Total: ' + fmtRs(cpData.total_amount) + ' · ' + cpData.total_payments + ' payments</div>';
        html += '</div>';
        cpEl.innerHTML = html;
      } else { cpEl.innerHTML = '<div class="empty-state"><p>No collection data</p></div>'; }
    } catch(e) { document.getElementById('collectorChart').innerHTML = '<div class="empty-state"><p>Failed to load</p></div>'; }

    // Load MSO summary (current month collection)
    try {
      const msoData = await api('/api/reports/mso-summary?from_date=' + cmFrom + '&to_date=' + cmTo);
      const msoEl = document.getElementById('msoChart');
      const msos = msoData.msos || [];
      if (msos.length) {
        const msoColors = {'GTPL':'#6366f1','TACTV':'#10b981','SCV':'#f59e0b','JAISD':'#ec4899'};
        let html = '<div style="display:flex;flex-direction:column;gap:12px">';
        msos.forEach(m => {
          const color = msoColors[m.name] || '#8b5cf6';
          html += '<div style="border:1px solid var(--border);border-radius:10px;padding:12px;border-left:4px solid ' + color + '">';
          html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
          html += '<strong style="font-size:14px">' + esc(m.name) + '</strong>';
          html += '<span style="font-size:13px;font-weight:600;color:' + color + '">' + m.active_customers + ' active</span>';
          html += '</div>';
          html += '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-light);flex-wrap:wrap;gap:4px">';
          html += '<span>' + m.total_customers + ' conn.</span>';
          html += '<span>' + fmtRs(m.total_collected) + '</span>';
          html += '</div>';
          // Progress bar for active ratio
          const activePct = m.total_customers > 0 ? Math.round((m.active_customers / m.total_customers) * 100) : 0;
          html += '<div style="margin-top:6px;background:var(--bg-card);border-radius:4px;height:6px;overflow:hidden">';
          html += '<div style="width:' + activePct + '%;height:100%;background:' + color + ';border-radius:4px"></div>';
          html += '</div>';
          html += '</div>';
        });
        html += '</div>';
        msoEl.innerHTML = html;
      } else { msoEl.innerHTML = '<div class="empty-state"><p>No MSO data</p></div>'; }
    } catch(e) { document.getElementById('msoChart').innerHTML = '<div class="empty-state"><p>Failed to load</p></div>'; }
    // MoM trend
    loadMomTrend();
  } catch (e) { toast('Failed to load dashboard', 'error'); }
    } // end else admin/support
  } // end else (LCO dashboard)
}

// CUSTOMERS
async function loadCustomers(page = 1) {
  currentPage = page;
  const perPage = document.getElementById('custPerPage').value;
  const sortBy = document.getElementById('custSortBy').value;
  const sortOrder = document.getElementById('custSortOrder').value;
  const statusFilter = document.getElementById('custStatusFilter').value;
  let url = '/api/customers?page=' + page + '&per_page=' + perPage + '&sort_by=' + sortBy + '&sort_order=' + sortOrder;
  if (currentFilter === 'paid') { url += '&payment_filter=paid&status='; }
  else if (currentFilter === 'unpaid') { url += '&payment_filter=unpaid&status='; }
  else if (currentFilter === 'all' && statusFilter) url += '&status=' + statusFilter;
  if (currentFilter !== 'all') {
    const from = document.getElementById('paidFrom').value;
    const to = document.getElementById('paidTo').value;
    if (from) url += '&paid_from=' + from;
    if (to) url += '&paid_to=' + to;
  }
  // Paid tab dropdown filters
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
  // Plan filter
  const planFilter = document.getElementById('custPlanFilter').value;
  if (planFilter) url += '&plan_id=' + planFilter;
  try {
    const d = await api(url);
    const items = d.customers || [];
    const total = d.total || items.length;
    const pages = d.pages || Math.ceil(total / perPage);
    const tbody = document.getElementById('customersBody');
    if (items.length) {
      tbody.innerHTML = items.map(c => {
        const stbBadge = c.stb_no ? '<span class="stb-badge" onclick="copyText(\'' + escAttr(c.stb_no) + '\')" title="Click to copy">' + esc(c.stb_no) + '</span>' : '<span style="color:var(--text-light)">--</span>';
        const statusBadge = '<span class="badge ' + (c.status === 'Active' ? 'badge-success' : (c.status === 'Surrendered' ? 'badge-danger' : 'badge-warning')) + '">' + esc(c.status || '--') + '</span>';
        const paidBadge = c.is_paid ? '<span class="badge badge-success">Paid</span>' : '<span class="badge badge-danger">Unpaid</span>';
        let actions = '<button class="btn btn-outline btn-sm" title="View Details" onclick="viewCustomer(\'' + escAttr(c.customer_id || c.id) + '\')">👁</button>';
        if (currentFilter === 'paid') {
          actions += '<button class="btn btn-outline btn-sm" title="Edit Customer" onclick="editCustomer(\'' + escAttr(c.customer_id || c.id) + '\')">✏️</button>';
        } else {
          actions += '<button class="btn btn-outline btn-sm" title="Edit Customer" onclick="editCustomer(\'' + escAttr(c.customer_id || c.id) + '\')">✏️</button>';
          actions += '<button class="btn btn-outline btn-sm" style="color:var(--danger)" title="Delete Customer" onclick="deleteCustomer(\'' + escAttr(c.customer_id || c.id) + '\',\'' + escAttr(c.name || '') + '\')">🗑</button>';
        }
        if (c.status === 'Surrendered') {
          actions += '<button class="btn btn-success btn-sm" title="Reactivate Customer" onclick="reactivateCustomer(\'' + escAttr(c.customer_id || c.id) + '\')">↩️</button>';
        } else if (c.status === 'Temp Disconnected') {
          actions += '<button class="btn btn-primary btn-sm" title="Reconnect" onclick="openReconnectModal(\'' + escAttr(c.customer_id || c.id) + '\',\'' + escAttr(c.name || '') + '\')">⚡</button>';
          actions += '<button class="btn btn-warning btn-sm" title="Surrender" onclick="openSurrenderModal(\'' + escAttr(c.customer_id || c.id) + '\',\'' + escAttr(c.name || '') + '\')">⏸️</button>';
        } else if (c.status === 'Active') {
          actions += '<button class="btn btn-warning btn-sm" title="Surrender Customer" onclick="openSurrenderModal(\'' + escAttr(c.customer_id || c.id) + '\',\'' + escAttr(c.name || '') + '\')">⏸️</button>';
        }
        return '<tr><td><strong>' + esc(c.customer_id || '--') + '</strong></td><td>' + esc(c.name || '--') + '</td><td>' + stbBadge + '</td><td>' + esc(c.phone || '--') + '</td><td>' + esc(c.area || '--') + '</td><td>' + statusBadge + '</td><td>' + paidBadge + '</td><td>' + actions + '</td></tr>';
      }).join('');
    } else { tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>No customers found</p></td></tr>'; }
    const pg = document.getElementById('custPagination');
    if (pages > 1) {
      let html = '<button ' + (page <= 1 ? 'disabled' : '') + ' onclick="loadCustomers(' + (page - 1) + ')">‹</button>';
      for (let i = 1; i <= Math.min(pages, 7); i++) {
        html += '<button class="' + (i === page ? 'active' : '') + '" onclick="loadCustomers(' + i + ')">' + i + '</button>';
      }
      html += '<button ' + (page >= pages ? 'disabled' : '') + ' onclick="loadCustomers(' + (page + 1) + ')">›</button>';
      pg.innerHTML = html;
    } else { pg.innerHTML = ''; }
    if (currentFilter === 'paid') {
      document.getElementById('paidCountBadge').textContent = d.total || 0;
      document.getElementById('paidAmountSum').textContent = fmtRs(d.total_paid_amount || 0);
    }
  } catch (e) { toast('Failed to load customers', 'error'); }
}

function filterCustomers(filter) {
  currentFilter = filter;
  document.querySelectorAll('.tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.filter === filter));
  document.getElementById('dateFilterRow').style.display = filter === 'paid' || filter === 'unpaid' ? 'block' : 'none';
  document.getElementById('paidSummaryBar').style.display = filter === 'paid' ? 'flex' : 'none';
  document.getElementById('paidFilterRow').style.display = filter === 'paid' ? 'flex' : 'none';
  loadCustomers(1);
  if (filter === 'paid') loadPaidFilters();
}

function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = document.getElementById('customerSearch').value.trim();
    if (!q) { loadCustomers(1); return; }
    try {
      const d = await api('/api/customers/search?q=' + encodeURIComponent(q));
      const items = Array.isArray(d) ? d : (d.items || []);
      const tbody = document.getElementById('customersBody');
      if (items.length) {
        tbody.innerHTML = items.map(c => {
          const stbBadge = c.stb_no ? '<span class="stb-badge" onclick="copyText(\'' + escAttr(c.stb_no) + '\')">' + esc(c.stb_no) + '</span>' : '<span style="color:var(--text-light)">--</span>';
          return '<tr><td><strong>' + esc(c.customer_id || '--') + '</strong></td><td>' + esc(c.name || '--') + '</td><td>' + stbBadge + '</td><td>' + esc(c.phone || '--') + '</td><td>' + esc(c.area || '--') + '</td><td><span class="badge ' + (c.status === 'Active' ? 'badge-success' : 'badge-danger') + '">' + escAttr(c.status || '--') + '</span></td><td><span class="badge ' + (c.is_paid ? 'badge-success' : 'badge-danger') + '">' + (c.is_paid ? 'Paid' : 'Unpaid') + '</span></td><td><button class="btn btn-outline btn-sm" title="View Details" onclick="viewCustomer(\'' + escAttr(c.customer_id || c.id) + '\')">👁</button><button class="btn btn-outline btn-sm" title="Edit Customer" onclick="editCustomer(\'' + escAttr(c.customer_id || c.id) + '\')">✏️</button><button class="btn btn-outline btn-sm" style="color:var(--danger)" title="Delete Customer" onclick="deleteCustomer(\'' + escAttr(c.customer_id || c.id) + '\',\'' + escAttr(c.name || '') + '\')">🗑</button></td></tr>';
        }).join('');
      } else { tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>No results found</p></td></tr>'; }
    } catch (e) { toast('Search failed', 'error'); }
  }, 400);
}

// DATE FILTERS & PAID FILTERS
function onPaidFilterChange() {
  loadCustomers(1);
  loadPaidFilters();
}

function setQuickDate(period) {
  const now = new Date();
  let from, to;
  if (period === 'this_month') {
    from = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
    to = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
  } else if (period === 'last_month') {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    from = lastMonth.getFullYear() + '-' + String(lastMonth.getMonth() + 1).padStart(2, '0') + '-01';
    to = lastMonth.getFullYear() + '-' + String(lastMonth.getMonth() + 1).padStart(2, '0') + '-' + String(new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0).getDate());
  } else if (period === 'this_year') {
    from = now.getFullYear() + '-01-01';
    to = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate());
  }
  document.getElementById('paidFrom').value = from;
  document.getElementById('paidTo').value = to;
  loadCustomers(1);
  loadPaidFilters();
}

function clearDates() {
  document.getElementById('paidFrom').value = '';
  document.getElementById('paidTo').value = '';
  loadCustomers(1);
  loadPaidFilters();
}

function clearPaidFilters() {
  document.getElementById('filterArea').value = '';
  document.getElementById('filterMode').value = '';
  document.getElementById('filterCollector').value = '';
  document.getElementById('filterAmount').value = '';
  loadCustomers(1);
}

async function loadPaidFilters() {
  const from = document.getElementById('paidFrom').value;
  const to = document.getElementById('paidTo').value;
  // Preserve current dropdown selections
  const prevArea = document.getElementById('filterArea').value;
  const prevMode = document.getElementById('filterMode').value;
  const prevColl = document.getElementById('filterCollector').value;
  const prevAmt = document.getElementById('filterAmount').value;
  try {
    const d = await api('/api/customers/paid-filters?paid_from=' + (from || '') + '&paid_to=' + (to || ''));
    const areas = d.areas || [];
    const modes = d.modes || [];
    const collectors = d.collectors || [];
    const amounts = d.amounts || [];
    const areaSel = document.getElementById('filterArea');
    const modeSel = document.getElementById('filterMode');
    const collSel = document.getElementById('filterCollector');
    const amtSel = document.getElementById('filterAmount');
    areaSel.innerHTML = '<option value="">All Areas</option>' + areas.map(a => '<option value="' + esc(a) + '">' + esc(a) + '</option>').join('');
    modeSel.innerHTML = '<option value="">All Modes</option>' + modes.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('');
    collSel.innerHTML = '<option value="">All Collectors</option>' + collectors.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
    amtSel.innerHTML = '<option value="">All Amounts</option>' + amounts.map(a => '<option value="' + esc(a) + '">' + esc(a) + '</option>').join('');
    // Restore previous selections if still available
    if (prevArea && areaSel.querySelector('option[value="' + prevArea + '"]')) areaSel.value = prevArea;
    if (prevMode && modeSel.querySelector('option[value="' + prevMode + '"]')) modeSel.value = prevMode;
    if (prevColl && collSel.querySelector('option[value="' + prevColl + '"]')) collSel.value = prevColl;
    if (prevAmt && amtSel.querySelector('option[value="' + prevAmt + '"]')) amtSel.value = prevAmt;
  } catch (e) { console.error('Failed to load paid filters', e); }
}

async function loadCustPlanFilter() {
  try {
    const d = await api('/api/plans?status=Active');
    const plans = d.plans || [];
    const sel = document.getElementById('custPlanFilter');
    const prev = sel.value;
    sel.innerHTML = '<option value="">All Plans</option>' + plans.map(p => '<option value="' + p.id + '">' + esc(p.name) + ' (' + msoBadge(p.network) + ' ₹' + (p.amount || p.price) + ')</option>').join('');
    if (prev && sel.querySelector('option[value="' + prev + '"]')) sel.value = prev;
  } catch (e) { console.error('Failed to load plan filter', e); }
}

// VIEW CUSTOMER (7-tab modal)
async function viewCustomer(id) {
  id = decodeURIComponent(id);
  try {
    const c = await api('/api/customers/' + id);
    _custData = c;
    document.getElementById('custDetailTitle').textContent = esc(c.name || 'Customer');
    document.getElementById('custDetailFooter').innerHTML = '';
    if (c.status === 'Surrendered') {
      document.getElementById('custDetailFooter').innerHTML = '<button class="btn btn-success" onclick="reactivateCustomer(\'' + escAttr(id) + '\')">Reactivate</button>';
    } else if (c.status === 'Temp Disconnected') {
      document.getElementById('custDetailFooter').innerHTML = '<button class="btn btn-primary" onclick="openReconnectModal(\'' + escAttr(id) + '\',\'' + escAttr(c.name || '') + '\')">⚡ Reconnect</button> <button class="btn btn-warning" onclick="openSurrenderModal(\'' + escAttr(id) + '\',\'' + escAttr(c.name || '') + '\')">Surrender</button>';
    } else if (c.status === 'Active') {
      document.getElementById('custDetailFooter').innerHTML = '<button class="btn btn-warning" onclick="openSurrenderModal(\'' + escAttr(id) + '\',\'' + escAttr(c.name || '') + '\')">Surrender</button>';
    }
    // Load 3 parallel API calls
    const [plans, payments, sms] = await Promise.all([
      api('/api/customers/' + id + '/plans').catch(() => ({plans: []})),
      api('/api/customers/' + id + '/payment-history?page=1&per_page=50').catch(() => ({payments: []})),
      api('/api/customers/' + id + '/sms-history').catch(() => ({sms_log: []}))
    ]);
    _custPlans = plans.plans || plans.items || [];
    _custPayments = payments.payments || payments.items || [];
    _custSms = sms.sms_log || sms.items || [];
    switchCustTab('profile', document.querySelector('.cust-tab'));
    document.getElementById('custDetailOverlay').classList.add('show');
  } catch (e) { toast('Failed to load customer', 'error'); }
}

function closeCustDetail() { document.getElementById('custDetailOverlay').classList.remove('show'); }

function switchCustTab(tab, btn) {
  document.querySelectorAll('.cust-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('#custTabContent > div').forEach(d => d.style.display = 'none');
  const tabId = 'custTab' + tab.charAt(0).toUpperCase() + tab.slice(1);
  document.getElementById(tabId).style.display = 'block';
  if (tab === 'profile') renderCustProfile();
  if (tab === 'connections') renderCustConnections();
  if (tab === 'basepack') renderCustPlans('Base Pack');
  if (tab === 'bouquets') renderCustPlans('Bouquets');
  if (tab === 'alacarte') renderCustPlans('A la Carte');
  if (tab === 'payhistory') renderCustPayHistory();
  if (tab === 'smshistory') renderCustSmsHistory();
}

function renderCustProfile() {
  const c = _custData;
  const html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:20px">' +
    '<div><strong>Customer ID:</strong><br>' + esc(c.customer_id || '--') + '</div>' +
    '<div><strong>Phone:</strong><br>' + esc(c.phone || '--') + '</div>' +
    '<div><strong>Phone 2:</strong><br>' + esc(c.phone2 || '--') + '</div>' +
    '<div><strong>Area:</strong><br>' + esc(c.area || '--') + '</div>' +
    '<div><strong>Address:</strong><br>' + esc(c.address || '--') + '</div>' +
    '<div><strong>Status:</strong><br><span class="badge ' + (c.status === 'Active' ? 'badge-success' : (c.status === 'Temp Disconnected' ? 'badge-warning' : 'badge-danger')) + '">' + esc(c.status || '--') + '</span></div>' +
    '<div><strong>Paid This Month:</strong><br><span class="badge ' + (c.is_paid ? 'badge-success' : 'badge-danger') + '">' + (c.is_paid ? 'Yes' : 'No') + '</span></div>' +
    (c.surrendered_date ? '<div><strong>Surrendered:</strong><br>' + fmtDate(c.surrendered_date) + '</div>' : '') +
    '</div>';
  document.getElementById('custTabProfile').innerHTML = html;
}

function renderCustConnections() {
  const conns = _custData.connections || [];
  if (!conns.length) { document.getElementById('custTabConnections').innerHTML = '<p class="empty-state">No connections</p>'; return; }
  let html = '<table><thead><tr><th>STB</th><th>MSO</th><th>Plan</th><th>Activated</th><th>Expiry</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
  conns.forEach(cn => {
    const stbBadge = cn.stb_no ? '<span class="stb-badge" onclick="copyText(\'' + escAttr(cn.stb_no) + '\')">' + esc(cn.stb_no) + '</span>' : '--';
    html += '<tr><td>' + stbBadge + '</td><td>' + msoBadge(cn.network) + '</td><td>' + esc(cn.plan_name || '--') + '</td><td>' + fmtDate(cn.activation_date) + '</td><td>' + fmtDate(cn.expiry_date) + '</td><td><span class="badge ' + (cn.status === 'Active' ? 'badge-success' : (cn.status === 'Temp Disconnected' ? 'badge-warning' : 'badge-danger')) + '">' + esc(cn.status || '--') + '</span></td><td>';
    if (cn.status === 'Active') {
      html += '<button class="btn btn-outline btn-sm" onclick="openExchangeModal(\'' + escAttr(_custData.customer_id) + '\',\'' + escAttr(cn.id) + '\',\'' + escAttr(cn.stb_no || '') + '\')">🔄 Exchange</button>';
      if (_userRole === 'admin' || _userRole === 'master') {
        html += ' <button class="btn btn-outline btn-sm" onclick="openEditExpiryModal(\'' + escAttr(_custData.customer_id) + '\',\'' + escAttr(cn.id) + '\',\'' + escAttr(_custData.name || '') + '\',\'' + escAttr(cn.expiry_date || '') + '\')">📅 Expiry</button>';
      }
      html += ' <button class="btn btn-outline btn-sm" style="color:var(--warning)" onclick="tempDisconnectConn(' + cn.id + ',\'' + escAttr(cn.stb_no || '') + '\',\'' + escAttr(_custData.name || '') + '\')">📦 Reclaim STB</button>';
      if (cn.network === 'GTPL' && cn.stb_no && cn.stb_no.startsWith('338') && (_userRole === 'admin' || _userRole === 'master' || _userRole === 'support')) {
        html += ' <span style="display:inline-flex;gap:4px;margin-top:4px">';
        html += '<button class="btn btn-sm" style="background:#dc3545;color:#fff;border:none" title="Suspend on GTPL" onclick="gtplSuspend(\'' + escAttr(cn.stb_no) + '\',\'' + escAttr(_custData.name || '') + '\')">⛔ Suspend</button>';
        html += '<button class="btn btn-sm" style="background:#28a745;color:#fff;border:none" title="Activate on GTPL" onclick="gtplActivate(\'' + escAttr(cn.stb_no) + '\',\'' + escAttr(_custData.name || '') + '\')">✅ Activate</button>';
        html += '<button class="btn btn-sm" style="background:#007bff;color:#fff;border:none" title="Renew on GTPL" onclick="openGtplRenewModal(\'' + escAttr(cn.stb_no) + '\',\'' + escAttr(_custData.name || '') + '\')">🔁 Renew</button>';
        html += '<button class="btn btn-sm" style="background:#6f42c1;color:#fff;border:none" title="Change Pack on GTPL" onclick="openGtplPackModal(\'' + escAttr(cn.stb_no) + '\',\'' + escAttr(_custData.name || '') + '\',\'' + escAttr(cn.plan_name || '') + '\')">📦 Pack</button>';
        html += '</span>';
      }
    } else if (cn.status === 'Temp Disconnected') {
      html += '<span style="color:var(--warning);font-size:0.85em">STB reclaimed — use Reconnect button below</span>';
    }
    html += '</td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById('custTabConnections').innerHTML = html;
}

// ── Temp Disconnect (Reclaim STB) ────────────────────────────────
async function tempDisconnectConn(connId, stbNo, custName) {
  if (!confirm('Reclaim STB ' + stbNo + ' from ' + custName + '?\n\n• STB will be available for other customers\n• No refund will be given\n• Customer can reconnect anytime without extra charges')) return;
  try {
    const r = await api('/api/connections/temp-disconnect', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ connection_id: connId })
    });
    toast(r.message || 'STB reclaimed successfully', 'success');
    // Reload customer detail
    await viewCustomer(_custData.customer_id);
  } catch (e) {
    toast(e.detail || e.message || 'Failed to reclaim STB', 'error');
  }
}

// ── Reconnect Modal ──────────────────────────────────────────────
function openReconnectModal(custId, custName) {
  document.getElementById('reconnectCustId').value = custId;
  document.getElementById('reconnectCustName').textContent = custName;
  document.getElementById('reconnectStbNo').value = '';
  document.getElementById('reconnectAvailStbs').innerHTML = '<p style="color:var(--muted);font-size:0.9em">Loading available STBs...</p>';
  document.getElementById('reconnectOverlay').classList.add('show');
  loadReconnectAvailStbs();
}
function closeReconnectModal() { document.getElementById('reconnectOverlay').classList.remove('show'); }

async function loadReconnectAvailStbs() {
  try {
    const d = await api('/api/stb-inventory?status=available');
    const stbs = (d.items || d.inventory || []);
    const el = document.getElementById('reconnectAvailStbs');
    if (!stbs.length) { el.innerHTML = '<p style="color:var(--muted);font-size:0.9em">No spare STBs in inventory. Enter STB number manually.</p>'; return; }
    let html = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">';
    stbs.forEach(s => {
      html += '<button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById(\'reconnectStbNo\').value=\'' + escAttr(s.stb_no) + '\'">' + esc(s.stb_no) + '</button>';
    });
    html += '</div>';
    el.innerHTML = html;
  } catch (e) { document.getElementById('reconnectAvailStbs').innerHTML = '<p style="color:var(--muted);font-size:0.9em">Could not load inventory.</p>'; }
}

async function doReconnect() {
  const custId = document.getElementById('reconnectCustId').value;
  const stbNo = document.getElementById('reconnectStbNo').value.trim();
  if (!stbNo) { toast('Enter an STB number', 'error'); return; }
  try {
    const r = await api('/api/connections/reconnect', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ customer_id: custId, stb_no: stbNo })
    });
    toast(r.message || 'Customer reconnected!', 'success');
    closeReconnectModal();
    await viewCustomer(custId);
  } catch (e) {
    toast(e.detail || e.message || 'Reconnect failed', 'error');
  }
}

let _allPlansCache = null;

async function loadAllPlans() {
  if (_allPlansCache) return _allPlansCache;
  try {
    const d = await api('/api/plans?status=Active');
    _allPlansCache = d.plans || [];
  } catch (e) { _allPlansCache = []; }
  return _allPlansCache;
}

async function renderCustPlans(category) {
  // Map category to the correct tab div ID
  const tabIdMap = {'Base Pack': 'custTabBasepack', 'Bouquets': 'custTabBouquets', 'A la Carte': 'custTabAlacarte'};
  const containerId = tabIdMap[category] || ('custTab' + category.charAt(0).toUpperCase() + category.slice(1));
  const container = document.getElementById(containerId);

  if (category === 'Base Pack') {
    // Get current connection's MSO
    const conns = _custData.connections || [];
    const activeConn = conns.find(c => c.status === 'Active') || conns[0];
    const connMSO = activeConn ? (activeConn.network || detectMSO(activeConn.stb_no)) : 'GTPL';

    // Load plans filtered by this connection's MSO
    let filteredPlans = [];
    try {
      const d = await api('/api/plans?status=Active&network=' + connMSO);
      filteredPlans = d.plans || [];
    } catch (e) { filteredPlans = []; }
    if (!filteredPlans.length) { container.innerHTML = '<p class="empty-state">No plans available for ' + esc(connMSO) + ' MSO</p>'; return; }

    // Get current plan from connection
    const currentPlanName = activeConn ? (activeConn.plan_name || '') : '';
    const currentPlanAmount = activeConn ? (activeConn.plan_amount || 0) : 0;

    // Find matching plan ID by name+amount
    let currentPlanId = null;
    if (currentPlanName) {
      const match = filteredPlans.find(p => p.name === currentPlanName && p.amount === currentPlanAmount);
      if (match) currentPlanId = match.id;
    }

    let html = '<div style="margin-bottom:12px;padding:10px 14px;background:var(--bg-card);border-radius:8px;border:1px solid var(--border)">';
    html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><strong>MSO:</strong> ' + msoBadge(connMSO) + '&nbsp;&nbsp;<strong>Current Plan:</strong> ';
    if (currentPlanName) {
      html += '<span class="badge badge-success" style="font-size:14px;padding:6px 14px">' + esc(currentPlanName) + ' — ' + fmtRs(currentPlanAmount) + '/month</span>';
    } else {
      html += '<span style="color:var(--text-light)">No plan assigned</span>';
    }
    html += '</div></div>';

    html += '<p style="margin-bottom:8px;color:var(--text-light);font-size:13px">Select a plan to change:</p>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">';

    filteredPlans.forEach(p => {
      const isCurrent = p.id === currentPlanId;
      const cardStyle = isCurrent
        ? 'border:2px solid var(--success);background:rgba(34,197,94,0.08);'
        : 'border:1px solid var(--border);background:var(--bg-card);';
      html += '<div id="planCard_' + p.id + '" style="' + cardStyle + 'border-radius:10px;padding:14px;cursor:pointer;transition:all .15s" '
        + 'onclick="selectPlan(' + p.id + ')" '
        + 'onmouseover="this.style.boxShadow=\'0 2px 8px rgba(0,0,0,.12)\'" '
        + 'onmouseout="this.style.boxShadow=\'none\'">';
      html += '<div style="font-weight:600;font-size:15px;margin-bottom:4px">' + esc(p.name) + '</div>';
      html += '<div style="font-size:20px;font-weight:700;color:var(--primary)">' + fmtRs(p.amount) + '<span style="font-size:12px;color:var(--text-light);font-weight:400">/month</span></div>';
      // No static validity text - expiry is end of paying month
      if (isCurrent) html += '<div style="margin-top:8px"><span class="badge badge-success">✓ Current Plan</span></div>';
      else html += '<div style="margin-top:8px"><span class="badge badge-primary" style="opacity:0.6">Click to select</span></div>';
      html += '</div>';
    });

    html += '</div>';

    // Change plan button area
    html += '<div id="planChangeBar" style="margin-top:16px;display:none;padding:12px 16px;background:var(--bg-card);border:2px solid var(--warning);border-radius:8px">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">';
    html += '<div>Change to: <strong id="planChangeName"></strong> — <strong id="planChangeAmount"></strong></div>';
    html += '<div><button class="btn btn-success" onclick="confirmChangePlan()">✅ Confirm Change</button> ';
    html += '<button class="btn btn-outline" onclick="cancelChangePlan()">Cancel</button></div>';
    html += '</div></div>';

    container.innerHTML = html;
    return;
  }

  // Original logic for Bouquets / A la Carte
  const plans = _custPlans;
  if (!plans.length) { container.innerHTML = '<p class="empty-state">No plans</p>'; return; }
  let html = '<table><thead><tr><th>Plan Name</th><th>Amount</th><th>Start</th><th>Expiry</th><th>Status</th></tr></thead><tbody>';
  plans.forEach(p => {
    html += '<tr><td>' + esc(p.name || '--') + '</td><td>' + fmtRs(p.amount || 0) + '</td><td>' + fmtDate(p.start_date) + '</td><td>' + fmtDate(p.expiry_date) + '</td><td><span class="badge ' + (p.status === 'Active' ? 'badge-success' : 'badge-danger') + '">' + esc(p.status || '--') + '</span></td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

let _selectedPlanId = null;

function selectPlan(planId) {
  // Find plan from current base pack cards (they already have the right network-filtered plans)
  const planCard = document.getElementById('planCard_' + planId);
  if (!planCard) return;

  // Check if it's the current plan
  const conns = _custData.connections || [];
  const activeConn = conns.find(c => c.status === 'Active') || conns[0];
  const currentPlanName = activeConn ? (activeConn.plan_name || '') : '';
  // Read plan name/amount from the card
  const planName = planCard.querySelector('div[style*="font-weight:600"]')?.textContent || '';
  if (planName === currentPlanName) {
    toast('This is already your current plan', 'info');
    return;
  }

  _selectedPlanId = planId;
  // Extract name and amount from card DOM
  const amountEl = planCard.querySelector('div[style*="font-size:20px"]');
  const amountText = amountEl ? amountEl.textContent.replace(/[^\d.]/g, '') : '0';
  document.getElementById('planChangeName').textContent = planName;
  document.getElementById('planChangeAmount').textContent = '₹' + parseFloat(amountText).toLocaleString('en-IN');
  document.getElementById('planChangeBar').style.display = 'block';

  // Highlight selected card
  document.querySelectorAll('[id^="planCard_"]').forEach(el => {
    el.style.borderColor = 'var(--border)';
    el.style.background = 'var(--bg-card)';
  });
  const selected = document.getElementById('planCard_' + planId);
  if (selected) {
    selected.style.borderColor = 'var(--warning)';
    selected.style.background = 'rgba(245,158,11,0.08)';
  }
}

function cancelChangePlan() {
  _selectedPlanId = null;
  document.getElementById('planChangeBar').style.display = 'none';
  // Restore current plan highlight
  const conns = _custData.connections || [];
  const activeConn = conns.find(c => c.status === 'Active') || conns[0];
  const currentPlanName = activeConn ? (activeConn.plan_name || '') : '';
  const currentPlanAmount = activeConn ? (activeConn.plan_amount || 0) : 0;
  const allPlans = _allPlansCache || [];
  const match = allPlans.find(p => p.name === currentPlanName && p.amount === currentPlanAmount);
  document.querySelectorAll('[id^="planCard_"]').forEach(el => {
    el.style.borderColor = 'var(--border)';
    el.style.background = 'var(--bg-card)';
  });
  if (match) {
    const cur = document.getElementById('planCard_' + match.id);
    if (cur) {
      cur.style.borderColor = 'var(--success)';
      cur.style.background = 'rgba(34,197,94,0.08)';
    }
  }
}

async function confirmChangePlan() {
  if (!_selectedPlanId || !_custData) return;
  try {
    const r = await api('/api/customers/' + _custData.customer_id + '/change-plan', {
      method: 'PUT',
      body: JSON.stringify({ plan_id: _selectedPlanId })
    });
    toast(r.message || 'Plan changed successfully', 'success');
    _selectedPlanId = null;
    _allPlansCache = null; // clear cache in case
    // Reload customer data
    await viewCustomer(_custData.customer_id);
    // Switch back to Base Pack tab
    const tabs = document.querySelectorAll('.cust-tab');
    const baseTab = Array.from(tabs).find(t => t.textContent.includes('Base Pack'));
    if (baseTab) switchCustTab('basepack', baseTab);
  } catch (e) {
    toast('Failed to change plan: ' + (e.message || 'Unknown error'), 'error');
  }
}

function renderCustPayHistory() {
  const payments = _custPayments;
  if (!payments.length) { document.getElementById('custTabPayhistory').innerHTML = '<p class="empty-state">No payment history</p>'; return; }
  let html = '<table><thead><tr><th>#</th><th>Date</th><th>Amount</th><th>Mode</th><th>Collector</th><th>Month</th><th>Action</th></tr></thead><tbody>';
  payments.forEach((p, i) => {
    const isLocal = String(p.id).startsWith('LOCAL-');
    const localId = isLocal ? parseInt(String(p.id).replace('LOCAL-', '')) : null;
    html += '<tr>'
      + '<td>' + (i + 1) + '</td>'
      + '<td>' + fmtDateTime(p.date || p.collected_at) + '</td>'
      + '<td>' + fmtRs(p.amount || p.collection_amount) + '</td>'
      + '<td><span class="badge badge-primary">' + esc(p.mode || p.payment_type || '--') + '</span></td>'
      + '<td>' + esc(p.collector || p.collected_by || '--') + '</td>'
      + '<td>' + esc(p.month_year || '--') + '</td>'
      + '<td>' + (isLocal && _userRole === 'master' ? '<button class="btn btn-sm btn-danger" onclick="deletePayment(' + localId + ')" title="Delete this payment">🗑</button>' : (isLocal ? '<span class="badge badge-success">Local</span>' : '<span class="badge" style="background:#6c757d;color:#fff">Paypakka</span>')) + '</td>'
      + '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('custTabPayhistory').innerHTML = html;
}

async function deletePayment(paymentId) {
  // Confirmation popup
  const confirmed = confirm('⚠️ Are you sure you want to delete this payment?\n\nIf this was a double entry, the expiry date will be automatically corrected after deletion.');
  if (!confirmed) return;

  try {
    const res = await api('/api/payments/' + paymentId, { method: 'DELETE' });

    // Show expiry change popup if expiry was corrected
    if (res.old_expiry && res.new_expiry && res.old_expiry !== res.new_expiry) {
      const oldDate = new Date(res.old_expiry).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
      const newDate = new Date(res.new_expiry).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
      alert('✅ Payment deleted successfully!\n\n📅 Expiry Date Updated:\n   Old: ' + oldDate + '\n   New: ' + newDate + '\n\n(Remaining payments: ' + res.remaining_payments + ')');
    } else {
      toast('Payment deleted successfully', 'success');
    }

    // Reload customer detail to reflect changes
    if (typeof viewCustomer === 'function' && _custData) {
      viewCustomer(_custData.customer_id);
    }
  } catch (e) {
    toast('Failed to delete payment: ' + (e.message || 'Unknown error'), 'error');
  }
}

function renderCustSmsHistory() {
  const sms = _custSms;
  if (!sms.length) { document.getElementById('custTabSmshistory').innerHTML = '<p class="empty-state">No SMS history</p>'; return; }
  let html = '<table><thead><tr><th>Date</th><th>Message</th><th>Status</th></tr></thead><tbody>';
  sms.forEach(s => {
    html += '<tr><td>' + fmtDateTime(s.sent_at) + '</td><td>' + esc(s.message) + '</td><td><span class="badge ' + (s.status === 'Sent' ? 'badge-success' : 'badge-danger') + '">' + esc(s.status || '--') + '</span></td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById('custTabSmshistory').innerHTML = html;
}

// EDIT/ADD/DELETE CUSTOMER
async function editCustomer(id) {
  id = decodeURIComponent(id);
  try {
    const c = await api('/api/customers/' + id);
    document.getElementById('modalTitle').textContent = 'Edit Customer';
    let html = '<form onsubmit="updateCustomer(event,\'' + esc(id) + '\')">' +
      '<div class="form-group"><label>Name</label><input class="form-control" id="editName" value="' + esc(c.name || '') + '"></div>' +
      '<div class="form-group"><label>Phone</label><input class="form-control" id="editPhone" value="' + esc(c.phone || '') + '"></div>' +
      '<div class="form-group"><label>Phone 2</label><input class="form-control" id="editPhone2" value="' + esc(c.phone2 || '') + '"></div>' +
      '<div class="form-group"><label>Area</label><input class="form-control" id="editArea" value="' + esc(c.area || '') + '"></div>' +
      '<div class="form-group"><label>Address</label><input class="form-control" id="editAddress" value="' + esc(c.address || '') + '"></div>' +
      '<div class="form-group"><label>Status</label><select class="form-control" id="editStatus"><option value="Active" ' + (c.status === 'Active' ? 'selected' : '') + '>Active</option><option value="Surrendered" ' + (c.status === 'Surrendered' ? 'selected' : '') + '>Surrendered</option><option value="Pending Surrender" ' + (c.status === 'Pending Surrender' ? 'selected' : '') + '>Pending Surrender</option></select></div>' +
      '</form>';
    document.getElementById('modalBody').innerHTML = html;
    document.getElementById('modalFooter').innerHTML = '<button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="document.getElementById(\'modalBody\').querySelector(\'form\').dispatchEvent(new Event(\'submit\',{cancelable:true}))">Save</button>';
    document.getElementById('modalOverlay').classList.add('show');
  } catch (e) { toast('Failed to load customer', 'error'); }
}

async function updateCustomer(e, id) {
  e.preventDefault();
  try {
    await api('/api/customers/' + id, {method: 'PUT', body: JSON.stringify({
      name: document.getElementById('editName').value,
      phone: document.getElementById('editPhone').value,
      phone2: document.getElementById('editPhone2').value,
      area: document.getElementById('editArea').value,
      address: document.getElementById('editAddress').value,
      status: document.getElementById('editStatus').value
    })});
    toast('Customer updated!', 'success'); closeModal(); loadCustomers(currentPage);
  } catch (e) { toast('Update failed: ' + e.message, 'error'); }
}

async function deleteCustomer(id, name) {
  id = decodeURIComponent(id); name = decodeURIComponent(name);
  if (!confirm('Delete customer "' + name + '"? This cannot be undone.')) return;
  try {
    await api('/api/customers/' + id, {method: 'DELETE'});
    toast('Customer deleted', 'success'); loadCustomers(currentPage);
  } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
}

async function addCustomer(e) {
  e.preventDefault();
  const connFee = parseFloat(document.getElementById('custConnFee').value) || 0;
  try {
    await api('/api/customers', {method: 'POST', body: JSON.stringify({
      name: document.getElementById('custName').value,
      phone: document.getElementById('custPhone').value,
      area: document.getElementById('custArea').value,
      address: document.getElementById('custAddress').value,
      stb_number: document.getElementById('custSTB').value,
      plan_id: document.getElementById('custPlan').value || null,
      activation_date: document.getElementById('custActivation').value || null,
      connection_fee: connFee > 0 ? connFee : null
    })});
    toast('Customer added!' + (connFee > 0 ? ' Connection fee ₹' + connFee + ' recorded.' : ''), 'success');
    document.getElementById('addCustForm').reset();
  } catch (e) { toast('Add failed: ' + e.message, 'error'); }
}

async function loadPlanOptions(network) {
  try {
    const net = network || 'GTPL';
    const data = await api('/api/plans?status=Active&network=' + net);
    const plans = data.plans || data.items || data || [];
    const sel = document.getElementById('custPlan');
    sel.innerHTML = '<option value="">Select plan (' + esc(net) + ')</option>' + plans.map(p => '<option value="' + (p.id || '') + '">' + esc(p.name) + ' - ' + fmtRs(p.amount || p.price) + '</option>').join('');
  } catch (e) {}
}

function onCustMsoChange(network) {
  if (!network) {
    document.getElementById('custPlan').innerHTML = '<option value="">-- Select MSO first --</option>';
    document.getElementById('custSTBSelect').innerHTML = '<option value="">-- Select MSO first --</option>';
    document.getElementById('custSTB').value = '';
    return;
  }
  loadPlanOptions(network);
  loadStbDropdown(network);
}

async function loadStbDropdown(network) {
  const sel = document.getElementById('custSTBSelect');
  if (!sel) return;
  try {
    const data = await api('/api/stb-inventory/available?network=' + (network || 'GTPL'));
    const stbs = data.available || [];
    sel.innerHTML = '<option value="">-- Select STB (' + stbs.length + ' available) --</option>' +
      stbs.map(s => '<option value="' + esc(s.stb_no) + '">' + esc(s.stb_no) + (s.notes ? ' (' + esc(s.notes) + ')' : '') + '</option>').join('');
  } catch (e) { sel.innerHTML = '<option value="">Failed to load STBs</option>'; }
}

function onStbSelectChange() {
  document.getElementById('custSTB').value = document.getElementById('custSTBSelect').value;
}

function initAddCustomerForRole() {
  // All roles use STB dropdown — no role-based switching needed
  // Just ensure dropdown is reset
  document.getElementById('custSTB').value = '';
  // Load all area suggestions upfront
  loadAreaSuggestions();
}

// Area autocomplete
let _areaTimeout;
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('custArea');
  if (el) el.addEventListener('input', () => {
    clearTimeout(_areaTimeout);
    _areaTimeout = setTimeout(loadAreaSuggestions, 300);
  });
});

async function loadAreaSuggestions() {
  const q = (document.getElementById('custArea')?.value || '').trim();
  try {
    const data = await api('/api/customers/area-suggestions?q=' + encodeURIComponent(q));
    const dl = document.getElementById('areaSuggestions');
    if (!dl) return;
    dl.innerHTML = (data.areas || []).map(a => `<option value="${a.replace(/"/g,'&quot;')}">`).join('');
  } catch(e) {}
}

// SURRENDER & REACTIVATE
function openSurrenderModal(id, name) {
  id = decodeURIComponent(id); name = decodeURIComponent(name);
  document.getElementById('surrenderCustId').value = id;
  document.getElementById('surrenderCustName').textContent = name;
  document.getElementById('surrenderReason').value = '';
  document.getElementById('surrenderOverlay').classList.add('show');
}

function closeSurrenderModal() { document.getElementById('surrenderOverlay').classList.remove('show'); }

async function submitSurrender() {
  const id = document.getElementById('surrenderCustId').value;
  const reason = document.getElementById('surrenderReason').value;
  try {
    const result = await api('/api/customers/' + id + '/surrender', {method: 'POST', body: JSON.stringify({reason: reason})});
    toast('Surrender submitted!', 'success');
    closeSurrenderModal();
    loadCustomers(1);
    if (_custData) viewCustomer(id);
  } catch (e) { toast('Surrender failed: ' + e.message, 'error'); }
}

async function reactivateCustomer(id) {
  id = decodeURIComponent(id);
  if (!confirm('Reactivate this customer?')) return;
  try {
    await api('/api/customers/' + id + '/reactivate', {method: 'POST'});
    toast('Customer reactivated!', 'success');
    loadCustomers(1);
    if (_custData) viewCustomer(id);
  } catch (e) { toast('Reactivate failed: ' + e.message, 'error'); }
}

// STB EXCHANGE
function openExchangeModal(custId, connId, oldStb) {
  custId = decodeURIComponent(custId); connId = decodeURIComponent(connId); oldStb = decodeURIComponent(oldStb);
  document.getElementById('exCustId').value = custId;
  document.getElementById('exConnId').value = connId;
  document.getElementById('exOldStb').value = oldStb || '--';
  document.getElementById('exNewStb').value = '';
  document.getElementById('exOldStatus').value = 'faulty';
  document.getElementById('exNotes').value = '';
  loadAvailableStbs();
  document.getElementById('stbExchangeOverlay').classList.add('show');
}

function closeExchangeModal() { document.getElementById('stbExchangeOverlay').classList.remove('show'); }

async function loadAvailableStbs() {
  try {
    const d = await api('/api/stb-inventory?status=available');
    const available = d.inventory || d.available || [];
    const div = document.getElementById('exAvailableStbs');
    if (available.length) {
      div.innerHTML = '<div style="margin-bottom:8px;font-weight:600">Quick pick available STBs:</div>' +
        available.map(s => '<button class="btn btn-outline btn-sm" style="margin:2px" onclick="document.getElementById(\'exNewStb\').value=\'' + escAttr(s.stb_no) + '\'">' + esc(s.stb_no) + '</button>').join('');
    } else { div.innerHTML = '<p style="color:var(--text-light)">No available STBs in inventory</p>'; }
  } catch (e) { console.error('Failed to load STBs', e); }
}

async function submitExchange() {
  const custId = document.getElementById('exCustId').value;
  const connId = document.getElementById('exConnId').value;
  const newStb = document.getElementById('exNewStb').value.trim();
  const oldStatus = document.getElementById('exOldStatus').value;
  const notes = document.getElementById('exNotes').value;
  if (!newStb) { toast('Enter new STB number', 'error'); return; }
  try {
    await api('/api/customers/' + custId + '/connections/' + connId + '/exchange-stb', {method: 'POST', body: JSON.stringify({
      new_stb_no: newStb,
      old_stb_status: oldStatus,
      old_stb_notes: notes
    })});
    toast('STB exchanged!', 'success');
    closeExchangeModal();
    loadCustomers(1);
    viewCustomer(custId);
  } catch (e) { toast('Exchange failed: ' + e.message, 'error'); }
}

// EDIT EXPIRY DATE
function openEditExpiryModal(custId, connId, custName, currentExpiry) {
  custId = decodeURIComponent(custId); connId = decodeURIComponent(connId);
  custName = decodeURIComponent(custName); currentExpiry = decodeURIComponent(currentExpiry);
  document.getElementById('expCustId').value = custId;
  document.getElementById('expConnId').value = connId;
  document.getElementById('expCustName').value = custName || '--';
  document.getElementById('expCurrentDate').value = currentExpiry || '--';
  document.getElementById('expNewDate').value = currentExpiry || '';
  document.getElementById('editExpiryOverlay').classList.add('show');
}

function closeEditExpiryModal() { document.getElementById('editExpiryOverlay').classList.remove('show'); }

async function submitEditExpiry() {
  const custId = document.getElementById('expCustId').value;
  const connId = document.getElementById('expConnId').value;
  const newDate = document.getElementById('expNewDate').value;
  if (!newDate) { toast('Select a new expiry date', 'error'); return; }
  try {
    await api('/api/customers/' + custId + '/connections/' + connId + '/expiry', {
      method: 'PUT',
      body: JSON.stringify({ expiry_date: newDate })
    });
    toast('Expiry date updated!', 'success');
    closeEditExpiryModal();
    viewCustomer(custId);
  } catch (e) { toast('Update failed: ' + e.message, 'error'); }
}

function copyText(text) {
  text = decodeURIComponent(text);
  navigator.clipboard.writeText(text).then(() => { toast('Copied: ' + text, 'success'); }).catch(() => { toast('Copy failed', 'error'); });
}

function copyStbMobile(el, stb) {
  navigator.clipboard.writeText(stb).then(() => {
    el.classList.add('copied');
    el.querySelector('.copy-icon').textContent = '✅';
    toast('STB copied: ' + stb, 'success');
    setTimeout(() => { el.classList.remove('copied'); el.querySelector('.copy-icon').textContent = '📋'; }, 1500);
  }).catch(() => { toast('Copy failed', 'error'); });
}

// SURRENDER REQUESTS PAGE


// ===== SERVICE REQUESTS =====

async function loadServiceRequests() {
  const status = document.getElementById('svcStatusFilter').value;
  try {
    const url = '/api/service-requests/' + (status ? '?status=' + status : '');
    const data = await api(url);
    renderSvcReqTable(data);
    loadSvcReqStats();
  } catch(e) {
    toast('Failed to load service requests', 'error');
  }
}

function renderSvcReqTable(items) {
  const tbody = document.getElementById('svcReqBody');
  if (!items || items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-light)">No service requests found</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(r => {
    const prioCls = {urgent:'color:#e53e3e;font-weight:700',high:'color:#dd6b20;font-weight:600',medium:'color:#d69e2e',low:'color:#718096'}[r.priority]||'';
    const statusBadge = svcStatusBadge(r.status);
    const date = r.created_at ? new Date(r.created_at + (r.created_at.indexOf('Z') === -1 && r.created_at.indexOf('+') === -1 ? 'Z' : '')).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit',timeZone:'Asia/Kolkata'}) : '-';
    const q = String.fromCharCode(39);
    return '<tr style="cursor:pointer" onclick="showSvcDetail(' + q + esc(r.ticket_no) + q + ')">' +
      '<td><strong>' + esc(r.ticket_no) + '</strong></td>' +
      '<td>' + esc(r.customer_name || r.customer_id) + '</td>' +
      '<td>' + esc(r.customer_area || '-') + '</td>' +
      '<td>' + esc(r.type) + '</td>' +
      '<td>' + esc(r.category || '-') + '</td>' +
      '<td style="' + prioCls + '">' + esc(r.priority) + '</td>' +
      '<td>' + esc(r.assigned_to_name || 'Unassigned') + '</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td>' + date + '</td>' +
      '<td><button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();showSvcDetail(' + q + esc(r.ticket_no) + q + ')">View</button></td>' +
      '</tr>';
  }).join('');
}

function svcStatusBadge(s) {
  const colors = {open:'#3182ce',acknowledged:'#805ad5',on_the_way:'#dd6b20',in_progress:'#d69e2e',settled:'#38a169',resolved:'#38a169',closed:'#718096',cancelled:'#e53e3e'};
  const labels = {open:'Open',acknowledged:'Acknowledged',on_the_way:'On the way',in_progress:'In Progress',settled:'Settled',resolved:'Resolved',closed:'Closed',cancelled:'Cancelled'};
  const bg = colors[s] || '#718096';
  return '<span style="background:' + bg + '1a;color:' + bg + ';padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600">' + esc(labels[s] || s.replace('_',' ')) + '</span>';
}

async function loadSvcReqStats() {
  try {
    const stats = await api('/api/service-requests/stats/summary');
    document.getElementById('svcStatOpen').textContent = stats.open_count || 0;
    document.getElementById('svcStatAssigned').textContent = stats.assigned_count || 0;
    document.getElementById('svcStatInProgress').textContent = stats.in_progress_count || 0;
    document.getElementById('svcStatResolved').textContent = stats.resolved_count || 0;
    document.getElementById('svcStatTotal').textContent = stats.total || 0;
  } catch(e) {}
}

async function openSvcReqForm() {
  document.getElementById('svcReqModal').style.display = 'flex';
  document.getElementById('svcModalTitle').textContent = 'New Service Request';
  document.getElementById('svcEditTicket').value = '';
  document.getElementById('svcCustSearch').value = '';
  document.getElementById('svcCustId').value = '';
  document.getElementById('svcType').value = '';
  document.getElementById('svcCategory').value = '';
  document.getElementById('svcPriority').value = 'medium';
  document.getElementById('svcDescription').value = '';
  // Load agents for assignment dropdown
  try {
    const emps = await api('/api/employees');
    const sel = document.getElementById('svcAssignTo');
    sel.innerHTML = '<option value="">Auto-assign</option>';
    (emps || []).forEach(e => {
      if (e.role === 'service_agent' || e.role === 'admin') {
        sel.innerHTML += '<option value="' + e.id + '">' + esc(e.name) + '</option>';
      }
    });
  } catch(e) {}
}

function closeSvcReqModal() {
  document.getElementById('svcReqModal').style.display = 'none';
}

let _svcCustSearchTimer;
async function searchSvcCustomers() {
  clearTimeout(_svcCustSearchTimer);
  const searchVal = document.getElementById('svcCustSearch').value.trim();
  if (searchVal.length < 2) { document.getElementById('svcCustResults').style.display = 'none'; return; }
  _svcCustSearchTimer = setTimeout(async () => {
    try {
      const data = await api('/api/customers/search?q=' + encodeURIComponent(searchVal));
      const custs = Array.isArray(data) ? data : (data.items || data.customers || []);
      const div = document.getElementById('svcCustResults');
      if (!custs.length) {
        div.innerHTML = '<div style="padding:12px;color:var(--text-light);text-align:center">No customers found</div>';
        div.style.display = 'block';
        return;
      }
      div.style.display = 'block';
      const sq = String.fromCharCode(39);
      div.innerHTML = custs.map(c =>
        '<div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s" onmouseover="this.style.background=\'var(--hover)\'" onmouseout="this.style.background=\'transparent\'" onclick="pickSvcCust(' + sq + esc(c.customer_id) + sq + ',' + sq + esc(c.name) + sq + ')">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<strong>' + esc(c.name) + '</strong>' +
        '<span style="font-size:11px;color:var(--text-light)">' + esc(c.customer_id) + '</span></div>' +
        '<div style="font-size:12px;color:var(--text-light);margin-top:2px">' +
        '📍 ' + esc(c.area || '-') + ' &nbsp; 📱 ' + esc(c.phone || '-') +
        (c.stb_no ? ' &nbsp; 📺 ' + esc(c.stb_no) : '') +
        '</div></div>'
      ).join('');
    } catch(e) { console.error('Customer search error:', e); }
  }, 300);
}

function pickSvcCust(id, name) {
  document.getElementById('svcCustId').value = id;
  document.getElementById('svcCustSearch').value = name + ' (' + id + ')';
  document.getElementById('svcCustResults').style.display = 'none';
}

async function saveSvcReq() {
  const custId = document.getElementById('svcCustId').value;
  const type = document.getElementById('svcType').value;
  const desc = document.getElementById('svcDescription').value.trim();
  if (!custId) { toast('Please select a customer', 'error'); return; }
  if (!type) { toast('Please select a type', 'error'); return; }
  if (!desc) { toast('Please enter a description', 'error'); return; }
  
  const body = {
    ticket_no: '',  // backend auto-generates
    customer_id: custId,
    type: type,
    category: document.getElementById('svcCategory').value,
    priority: document.getElementById('svcPriority').value,
    description: desc,
    assigned_to: document.getElementById('svcAssignTo').value || null,
    source: 'app'
  };
  
  try {
    const res = await api('/api/service-requests/', {method: 'POST', body: JSON.stringify(body)});
    toast('Service request created: ' + res.ticket_no, 'success');
    closeSvcReqModal();
    loadServiceRequests();
  } catch(e) {
    toast('Failed: ' + (e.message || 'Unknown error'), 'error');
  }
}

async function showSvcDetail(ticketNo) {
  try {
    const r = await api('/api/service-requests/' + ticketNo);
    document.getElementById('svcDetailTitle').textContent = r.ticket_no;
    const fmtDate = (d) => {
      if (!d) return '-';
      const dt = new Date(d + (d.indexOf('Z') === -1 && d.indexOf('+') === -1 ? 'Z' : ''));
      return dt.toLocaleString('en-IN', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true, timeZone:'Asia/Kolkata'});
    };
    const date = fmtDate(r.created_at);
    const resolvedDate = fmtDate(r.resolved_at);
    document.getElementById('svcDetailBody').innerHTML = 
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px">' +
      '<div><strong>Customer:</strong><br>' + esc(r.customer_name || r.customer_id) + '</div>' +
      '<div><strong>Phone:</strong><br>' + esc(r.customer_phone || '-') + '</div>' +
      '<div><strong>Area:</strong><br>' + esc(r.customer_area || '-') + '</div>' +
      '<div><strong>Type:</strong><br>' + esc(r.type) + '</div>' +
      '<div><strong>Category:</strong><br>' + esc(r.category || '-') + '</div>' +
      '<div><strong>Priority:</strong><br>' + svcStatusBadge(r.priority) + '</div>' +
      '<div><strong>Status:</strong><br>' + svcStatusBadge(r.status) + '</div>' +
      '<div><strong>Assigned To:</strong><br>' + esc(r.assigned_to_name || 'Unassigned') + '</div>' +
      '<div><strong>Created:</strong><br>' + date + '</div>' +
      '<div><strong>Resolved:</strong><br>' + resolvedDate + '</div>' +
      '</div>' +
      '<div style="margin-top:16px"><strong>Description:</strong><br>' + esc(r.description) + '</div>' +
      (r.resolution_notes ? '<div style="margin-top:10px"><strong>Resolution Notes:</strong><br>' + esc(r.resolution_notes) + '</div>' : '');
    
    // Action buttons based on status
    const acts = document.getElementById('svcDetailActions');
    acts.innerHTML = '';
    const q = String.fromCharCode(39);
    if (r.status === 'open') {
      acts.innerHTML += '<button class="btn btn-sm btn-primary" onclick="updateSvcStatus(' + q + ticketNo + q + ',' + q + 'assigned' + q + ')">Assign</button>';
      acts.innerHTML += '<button class="btn btn-sm" style="background:#e53e3e1a;color:#e53e3e" onclick="updateSvcStatus(' + q + ticketNo + q + ',' + q + 'cancelled' + q + ')">Cancel</button>';
    }
    if (r.status === 'assigned') {
      acts.innerHTML += '<button class="btn btn-sm" style="background:#805ad51a;color:#805ad5" onclick="updateSvcStatus(' + q + ticketNo + q + ',' + q + 'acknowledged' + q + ')">Acknowledge</button>';
      acts.innerHTML += '<button class="btn btn-sm" style="background:#d69e2e1a;color:#d69e2e" onclick="updateSvcStatus(' + q + ticketNo + q + ',' + q + 'in_progress' + q + ')">Start Progress</button>';
    }
    if (r.status === 'acknowledged') {
      acts.innerHTML += '<button class="btn btn-sm" style="background:#dd6b20a;color:#dd6b20" onclick="updateSvcStatus(' + q + ticketNo + q + ',' + q + 'on_the_way' + q + ')">On the Way</button>';
      acts.innerHTML += '<button class="btn btn-sm" style="background:#d69e2e1a;color:#d69e2e" onclick="updateSvcStatus(' + q + ticketNo + q + ',' + q + 'in_progress' + q + ')">Start Progress</button>';
    }
    if (r.status === 'on_the_way') {
      acts.innerHTML += '<button class="btn btn-sm" style="background:#d69e2e1a;color:#d69e2e" onclick="updateSvcStatus(' + q + ticketNo + q + ',' + q + 'in_progress' + q + ')">Start Progress</button>';
    }
    if (r.status === 'in_progress') {
      acts.innerHTML += '<button class="btn btn-sm btn-primary" style="background:#38a1691a;color:#38a169;border-color:#38a169" onclick="resolveSvcReq(' + q + ticketNo + q + ')">Resolve</button>';
    }
    if (r.status === 'resolved') {
      acts.innerHTML += '<button class="btn btn-sm btn-primary" onclick="updateSvcStatus(' + q + ticketNo + q + ',' + q + 'closed' + q + ')">Close</button>';
    }
    acts.innerHTML += '<button class="btn btn-sm btn-secondary" onclick="closeSvcDetailModal()">Close</button>';
    
    document.getElementById('svcDetailModal').style.display = 'flex';
  } catch(e) {
    toast('Failed to load details', 'error');
  }
}

function closeSvcDetailModal() {
  document.getElementById('svcDetailModal').style.display = 'none';
}

async function updateSvcStatus(ticketNo, status) {
  try {
    await api('/api/service-requests/' + ticketNo + '/status', {method: 'PUT', body: JSON.stringify({status: status})});
    toast('Status updated to ' + status, 'success');
    closeSvcDetailModal();
    loadServiceRequests();
  } catch(e) {
    toast('Failed: ' + (e.message || 'Error'), 'error');
  }
}

async function resolveSvcReq(ticketNo) {
  const notes = prompt('Resolution notes (optional):') || '';
  try {
    await api('/api/service-requests/' + ticketNo + '/status', {method: 'PUT', body: JSON.stringify({status: 'resolved'})});
    toast('Service request resolved!', 'success');
    closeSvcDetailModal();
    loadServiceRequests();
  } catch(e) {
    toast('Failed: ' + (e.message || 'Error'), 'error');
  }
}

async function loadSurrenderRequests() {
  const status = document.getElementById('srStatusFilter').value;
  try {
    const d = await api('/api/surrender-requests?status=' + (status || ''));
    _surrenderRequests = d.requests || [];
    const tbody = document.getElementById('srBody');
    if (_surrenderRequests.length) {
      tbody.innerHTML = _surrenderRequests.map(sr => {
        const statusBadge = '<span class="badge ' + (sr.status === 'pending' ? 'badge-warning' : (sr.status === 'approved' ? 'badge-success' : 'badge-danger')) + '">' + esc(sr.status || '--') + '</span>';
        let actions = '';
        if (sr.status === 'pending') {
          actions = '<button class="btn btn-success btn-sm" onclick="reviewSurrenderRequest(\'' + escAttr(sr.id) + '\',\'approve\')">✓</button>' +
                    '<button class="btn btn-danger btn-sm" onclick="reviewSurrenderRequest(\'' + escAttr(sr.id) + '\',\'reject\')">✗</button>';
        }
        return '<tr><td><strong>' + esc(sr.customer_name || '--') + '</strong><br><small>' + esc(sr.customer_id || '') + '</small></td><td>' + esc(sr.stb_no || '--') + '</td><td>' + esc(sr.reason || '--') + '</td><td>' + esc(sr.requested_by_name || '--') + '</td><td>' + fmtDateTime(sr.requested_at) + '</td><td>' + statusBadge + '</td><td>' + actions + '</td></tr>';
      }).join('');
    } else { tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No surrender requests</td></tr>'; }
  } catch (e) { toast('Failed to load surrender requests', 'error'); }
}

async function reviewSurrenderRequest(id, action) {
  const notes = prompt('Review notes (optional):');
  try {
    await api('/api/surrender-requests/' + id + '/review', {method: 'POST', body: JSON.stringify({action: action, notes: notes || ''})});
    toast('Request ' + action + 'd!', 'success');
    loadSurrenderRequests();
  } catch (e) { toast('Review failed: ' + e.message, 'error'); }
}

// STB INVENTORY
async function loadStbInventory() {
  const status = document.getElementById('invStatusFilter').value;
  let url = '/api/stb-inventory';
  const params = [];
  if (status) params.push('status=' + status);
  const oid = _settingsOpId();
  if (oid) params.push('operator_id=' + oid);
  if (params.length) url += '?' + params.join('&');
  try {
    const d = await api(url);
    _stbInventory = d.inventory || [];
    const tbody = document.getElementById('stbInvBody');
    if (_stbInventory.length) {
      tbody.innerHTML = _stbInventory.map(s => {
        const statusBadge = '<span class="badge ' + (s.status === 'available' || s.status === 'spare' ? 'badge-success' : (s.status === 'faulty' ? 'badge-danger' : 'badge-warning')) + '">' + esc(s.status || '--') + '</span>';
        return '<tr><td><span class="stb-badge" onclick="copyText(\'' + escAttr(s.stb_no) + '\')">' + esc(s.stb_no) + '</span></td><td>' + statusBadge + '</td><td>' + esc(s.notes || '--') + '</td><td>' + fmtDateTime(s.added_at) + '</td><td><button class="btn btn-outline btn-sm" style="color:var(--danger)" onclick="deleteStbFromInventory(\'' + escAttr(s.id) + '\')">🗑</button></td></tr>';
      }).join('');
    } else { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No STBs in inventory</td></tr>'; }
  } catch (e) { toast('Failed to load STB inventory', 'error'); }
}

function showAddStbModal() {
  document.getElementById('addStbNo').value = '';
  document.getElementById('addStbNotes').value = '';
  document.getElementById('addStbOverlay').classList.add('show');
}

function closeAddStbModal() { document.getElementById('addStbOverlay').classList.remove('show'); }

async function submitAddStb() {
  const stbNo = document.getElementById('addStbNo').value.trim();
  const notes = document.getElementById('addStbNotes').value;
  if (!stbNo) { toast('Enter STB number', 'error'); return; }
  try {
    await api('/api/stb-inventory' + _settingsOpParam(), {method: 'POST', body: JSON.stringify({stb_no: stbNo, notes: notes})});
    toast('STB added to inventory!', 'success');
    closeAddStbModal();
    loadStbInventory();
  } catch (e) { toast('Add failed: ' + e.message, 'error'); }
}

async function deleteStbFromInventory(id) {
  if (!confirm('Remove this STB from inventory?')) return;
  try {
    await api('/api/stb-inventory/' + id + _settingsOpParam(), {method: 'DELETE'});
    toast('STB removed', 'success');
    loadStbInventory();
  } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
}

// EMPLOYEES & PERMISSIONS
async function loadEmployees() {
  try {
    const d = await api('/api/employees');
    _empList = d.employees || [];
    const tbody = document.getElementById('employeesBody');
    if (_empList.length) {
      tbody.innerHTML = _empList.map(e => {
        const roleBadge = '<span class="badge badge-primary">' + esc(e.role_label || e.role || '--') + '</span>';
        const statusBadge = '<span class="badge ' + (e.status === 'Active' ? 'badge-success' : 'badge-danger') + '">' + esc(e.status || '--') + '</span>';
        let actions = '<button class="btn btn-outline btn-sm" onclick="editEmployee(' + (e.id || '') + ')">✏️</button>';
        actions += '<button class="btn btn-outline btn-sm" onclick="showPwdModal(' + (e.id || '') + ')">🔑</button>';
        actions += '<button class="btn btn-outline btn-sm" onclick="showPermModal(' + (e.id || '') + ')">🛡️</button>';
        if (e.role !== 'admin') {
          actions += '<button class="btn btn-outline btn-sm" style="color:var(--danger)" onclick="deleteEmployee(' + (e.id || '') + ',\'' + escAttr(e.name || '') + '\')">🗑</button>';
        }
        return '<tr><td><strong>' + esc(e.name || '--') + '</strong></td><td>' + esc(e.username || '--') + '</td><td>' + roleBadge + '</td><td>' + esc(e.phone || '--') + '</td><td>' + (e.payment_count || 0) + '</td><td>' + statusBadge + '</td><td>' + actions + '</td></tr>';
      }).join('');
    } else { tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No employees found</td></tr>'; }
  } catch (e) { toast('Failed to load employees', 'error'); }
}

function showAddEmployeeModal() {
  document.getElementById('empModalTitle').textContent = 'Add Employee';
  document.getElementById('empModalBody').innerHTML = '<form onsubmit="saveEmployee(event)">' +
    '<div class="form-group"><label>Name</label><input class="form-control" id="empName" required></div>' +
    '<div class="form-group"><label>Username</label><input class="form-control" id="empUsername" required></div>' +
    '<div class="form-group"><label>Password</label><input class="form-control" type="password" id="empPassword" required></div>' +
    '<div class="form-group"><label>Role</label><select class="form-control" id="empRole"><option value="collection_agent">Collection Agent</option><option value="support">Support</option><option value="service_agent">Service Agent</option></select></div>' +
    '<div class="form-group"><label>Phone</label><input class="form-control" id="empPhone"></div>' +
    '</form>';
  document.getElementById('empModalFooter').innerHTML = '<button class="btn btn-outline" onclick="closeEmpModal()">Cancel</button><button class="btn btn-primary" onclick="document.getElementById(\'empModalOverlay\').querySelector(\'form\').dispatchEvent(new Event(\'submit\',{cancelable:true}))">Save</button>';
  document.getElementById('empModalOverlay').classList.add('show');
}

function closeEmpModal() { document.getElementById('empModalOverlay').classList.remove('show'); }

async function saveEmployee(e) {
  e.preventDefault();
  try {
    await api('/api/employees', {method: 'POST', body: JSON.stringify({
      name: document.getElementById('empName').value,
      username: document.getElementById('empUsername').value,
      password: document.getElementById('empPassword').value,
      role: document.getElementById('empRole').value,
      phone: document.getElementById('empPhone').value || null
    })});
    toast('Employee added!', 'success'); closeEmpModal(); loadEmployees();
  } catch (e) { toast('Failed to add employee: ' + e.message, 'error'); }
}

async function editEmployee(id) {
  const e = _empList.find(x => x.id === id);
  if (!e) { toast('Employee not found', 'error'); return; }
  const newRole = prompt('Change role for ' + e.name + ' (current: ' + e.role + '):', e.role);
  if (newRole && newRole !== e.role) {
    try {
      await api('/api/employees/' + id, {method: 'PUT', body: JSON.stringify({role: newRole})});
      toast('Role updated!', 'success'); loadEmployees();
    } catch (e) { toast('Failed to update employee', 'error'); }
  }
}

async function deleteEmployee(id, name) {
  name = decodeURIComponent(name);
  if (!confirm('Delete employee ' + name + '?')) return;
  try {
    await api('/api/employees/' + id, {method: 'DELETE'});
    toast('Employee deleted', 'success'); loadEmployees();
  } catch (e) { toast('Failed to delete employee: ' + e.message, 'error'); }
}

// Password Modal
function showPwdModal(id) {
  document.getElementById('pwdEmpId').value = id;
  document.getElementById('empPwdNew').value = '';
  document.getElementById('empPwdConfirm').value = '';
  document.getElementById('pwdModalOverlay').classList.add('show');
}

function closePwdModal() { document.getElementById('pwdModalOverlay').classList.remove('show'); }

async function saveEmployeePassword(e) {
  e.preventDefault();
  const newPwd = document.getElementById('empPwdNew').value;
  const confirmPwd = document.getElementById('empPwdConfirm').value;
  if (newPwd !== confirmPwd) { toast('Passwords do not match', 'error'); return; }
  if (newPwd.length < 4) { toast('Password must be at least 4 characters', 'error'); return; }
  try {
    await api('/api/employees/' + document.getElementById('pwdEmpId').value + '/password', {method: 'PUT', body: JSON.stringify({password: newPwd})});
    toast('Password updated!', 'success'); closePwdModal();
  } catch (e) { toast('Failed to set password: ' + e.message, 'error'); }
}

// Permissions Modal
const ALL_PERMISSIONS = [
  {key: 'dashboard', label: 'Dashboard', category: 'General'},
  {key: 'reports', label: 'View Reports', category: 'Reports'},
  {key: 'customers_view', label: 'View Customers', category: 'Customers'},
  {key: 'customers_add', label: 'Add Customers', category: 'Customers'},
  {key: 'customers_edit', label: 'Edit Customers', category: 'Customers'},
  {key: 'customers_delete', label: 'Delete Customers', category: 'Customers'},
  {key: 'payments_collect', label: 'Collect Payments', category: 'Payments'},
  {key: 'payments_view', label: 'View Payments', category: 'Payments'},
  {key: 'payments_delete', label: 'Delete Payments', category: 'Payments'},
  {key: 'plans_view', label: 'View Plans', category: 'Plans'},
  {key: 'plans_manage', label: 'Manage Plans', category: 'Plans'},
  {key: 'employees_view', label: 'View Employees', category: 'Employees'},
  {key: 'employees_manage', label: 'Manage Employees', category: 'Employees'},
  {key: 'settings_manage', label: 'Manage Settings', category: 'Settings'}
];

const ROLE_DEFAULTS = {
  'admin': ['dashboard','reports','customers_view','customers_add','customers_edit','customers_delete','payments_collect','payments_view','payments_delete','plans_view','plans_manage','employees_view','employees_manage','settings_manage'],
  'support': ['dashboard','customers_view','customers_add','customers_edit','payments_collect','payments_view','plans_view','reports','employees_view','employees_manage'],
  'collection_agent': ['dashboard','customers_view','payments_collect','payments_view'],
  'service_agent': ['dashboard','customers_view','customers_add','payments_collect','payments_view']
};

let _permEmpId = null;

function showPermModal(id) {
  _permEmpId = id;
  loadPermissions(id);
}

function closePermModal() { document.getElementById('permModalOverlay').classList.remove('show'); }

async function loadPermissions(id) {
  try {
    const d = await api('/api/employees/' + id + '/permissions');
    const emp = _empList.find(e => e.id === id);
    document.getElementById('permModalBody').innerHTML = '<div style="margin-bottom:16px"><strong>Employee:</strong> ' + esc(emp ? emp.name : 'Unknown') + '</div>' +
      '<div class="form-group"><label>Role</label><select id="permRole" class="form-control" onchange="onRoleChange()">' +
      '<option value="admin">Admin</option><option value="support">Support</option><option value="collection_agent">Collection Agent</option><option value="service_agent">Service Agent</option>' +
      '</select></div><div id="permToggles"></div>';
    document.getElementById('permRole').value = d.role || 'collection_agent';
    onRoleChange();
    document.getElementById('permModalOverlay').classList.add('show');
  } catch (e) { toast('Failed to load permissions', 'error'); }
}

function onRoleChange() {
  const role = document.getElementById('permRole').value;
  const defaults = ROLE_DEFAULTS[role] || [];
  const isAdmin = role === 'admin';
  const div = document.getElementById('permToggles');
  const grouped = {};
  ALL_PERMISSIONS.forEach(p => { if (!grouped[p.category]) grouped[p.category] = []; grouped[p.category].push(p); });
  let html = '';
  for (const cat in grouped) {
    html += '<div class="perm-group"><h4>' + esc(cat) + '</h4>';
    grouped[cat].forEach(p => {
      const checked = defaults.includes(p.key) ? 'checked' : '';
      const disabled = isAdmin ? 'disabled' : '';
      html += '<div class="perm-item"><label class="toggle-switch"><input type="checkbox" data-key="' + esc(p.key) + '" ' + checked + ' ' + disabled + '><span class="slider"></span></label><label>' + esc(p.label) + '</label></div>';
    });
    html += '</div>';
  }
  div.innerHTML = html;
}

async function savePermissions() {
  const role = document.getElementById('permRole').value;
  const perms = [];
  if (role !== 'admin') {
    document.querySelectorAll('#permToggles input[type="checkbox"]').forEach(cb => {
      if (cb.checked) perms.push(cb.dataset.key);
    });
  }
  try {
    await api('/api/employees/' + _permEmpId + '/permissions', {method: 'PUT', body: JSON.stringify({role: role, permissions: perms})});
    toast('Permissions updated!', 'success'); closePermModal(); loadEmployees();
  } catch (e) { toast('Failed to save permissions: ' + e.message, 'error'); }
}

// PAYMENTS PAGE - Modern Step-by-Step Flow
let _payAllCustomers = [];
let _payConnsCache = [];
let _payPlansCache = [];

// Initialize payment form
async function initPaymentForm() {
  try {
    // Load ONLY unpaid customers (expired connections = not paid this month)
    _payAllCustomers = [];
    let page = 1;
    while (true) {
      try {
        const d = await api('/api/customers/unpaid?per_page=200&page=' + page);
        const items = d.customers || d.items || [];
        _payAllCustomers = _payAllCustomers.concat(items);
        if (items.length < 200 || _payAllCustomers.length >= (d.total || 9999)) break;
        page++;
      } catch (e) { break; }
    }
    
    // Plans loaded after connection selected (filtered by MSO)
    const psel = document.getElementById('payPlan');
    psel.innerHTML = '<option value="">Select customer first</option>';
    
    // Setup months dropdown
    const msel = document.getElementById('payMonths');
    if (msel.options.length === 0) {
      msel.innerHTML = '';
      for (let i = 1; i <= 12; i++) msel.innerHTML += '<option value="' + i + '">' + i + (i === 12 ? ' (1 month free!)' : '') + '</option>';
    }
    
    // Set default month
    const now = new Date();
    document.getElementById('payMonth').value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  } catch (e) {}
}

// Search customer (debounced)
let _searchTimer = null;
function searchPayCustomer(query) {
  const resultsEl = document.getElementById('paySearchResults');
  if (!query || query.length < 2) { resultsEl.style.display = 'none'; return; }
  
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    const q = query.toLowerCase();
    const matches = _payAllCustomers.filter(c => 
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.customer_id && c.customer_id.toLowerCase().includes(q)) ||
      (c.phone && c.phone.includes(q)) ||
      (c.stb_no && c.stb_no.toLowerCase().includes(q))
    ).slice(0, 20);
    
    if (matches.length === 0) {
      resultsEl.innerHTML = '<div class="ps-empty">No customers found</div>';
      resultsEl.style.display = 'block';
      return;
    }
    
    resultsEl.innerHTML = '<table><thead><tr><th>Customer</th><th>Phone</th><th>STB</th><th>Area</th><th>Connections</th></tr></thead><tbody>' +
      matches.map(c => 
        '<tr onclick="selectPayCustomer(decodeURIComponent(\'' + escAttr(c.customer_id) + '\'))">' +
        '<td><div class="ps-name">' + esc(c.name) + '</div><div class="ps-sub">' + esc(c.customer_id) + '</div></td>' +
        '<td>' + esc(c.phone || '-') + '</td>' +
        '<td>' + (c.stb_no ? '<span class="ps-stb">' + esc(c.stb_no) + '</span>' : '-') + '</td>' +
        '<td class="ps-area">' + esc(c.area || '-') + '</td>' +
        '<td class="ps-count">' + (c.connection_count || c.connections || '-') + '</td>' +
        '</tr>'
      ).join('') + '</tbody></table>';
    resultsEl.style.display = 'block';
  }, 150);
}

// Select customer from search
function selectPayCustomer(custId) {
  custId = decodeURIComponent(custId);
  const cust = _payAllCustomers.find(c => c.customer_id === custId);
  if (!cust) return;
  
  document.getElementById('payCustomerId').value = custId;
  document.getElementById('paySearchInput').value = cust.name + ' (' + cust.customer_id + ')';
  document.getElementById('paySearchResults').style.display = 'none';
  
  // Show customer card with last payment info
  const card = document.getElementById('payCustCard');
  card.innerHTML = '<div class="cust-info"><div>' + esc(cust.name) + '</div><div class="cust-sub">' + esc(cust.customer_id) + ' | ' + esc(cust.phone || 'No phone') + '</div></div>' +
    '<div class="cust-actions"><button class="btn btn-sm" style="color:var(--white);border:1px solid var(--white);background:transparent" onclick="resetPayForm()">Change</button></div>';
  card.style.display = 'flex';
  
  // Load last payment info + history button
  loadCustLastPayment(custId);
  
  // Load connections
  loadPayConnections(custId);
}

// Load last payment for inline display
async function loadCustLastPayment(custId) {
  const el = document.getElementById('payLastPayment');
  try {
    // Fetch from unified payments endpoint for this customer
    const data = await api('/api/payments/all?per_page=1&date_from=2024-01-01&date_to=2030-12-31&customer_id=' + custId);
    const payments = data.payments || [];
    if (payments.length > 0) {
      const last = payments[0];
      const dateStr = fmtDate(last.date);
      el.innerHTML = '<div><span class="lp-label">Last paid: </span><span class="lp-value">' + dateStr + ' • ' + fmtRs(last.amount) + '</span></div>' +
        '<button type="button" class="lp-history-btn" onclick="showCustPayHistory(\'' + custId + '\')">📋 History</button>';
      el.style.display = 'flex';
    } else {
      el.innerHTML = '<div><span class="lp-label">No payments recorded</span></div>' +
        '<button type="button" class="lp-history-btn" onclick="showCustPayHistory(\'' + custId + '\')">📋 History</button>';
      el.style.display = 'flex';
    }
  } catch (e) {
    el.style.display = 'none';
  }
}

// Show full payment history in modal
async function showCustPayHistory(custId) {
  custId = decodeURIComponent(custId);
  // Remove existing modal if any
  const existing = document.getElementById('custPayHistModal');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'custPayHistModal';
  modal.className = 'pay-history-modal';
  modal.innerHTML = '<div class="pay-history-modal-content"><h3>Payment History <button class="btn btn-sm" onclick="document.getElementById(\'custPayHistModal\').remove()">✕</button></h3><div id="custPayHistBody"><p style="color:var(--text-light)">Loading...</p></div></div>';
  document.body.appendChild(modal);
  
  // Close on backdrop click
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
  
  try {
    const data = await api('/api/payments/all?per_page=50&date_from=2024-01-01&date_to=2030-12-31&customer_id=' + custId);
    const payments = data.payments || [];
    const body = document.getElementById('custPayHistBody');
    
    if (payments.length === 0) {
      body.innerHTML = '<p style="color:var(--text-light);text-align:center;padding:20px">No payment history found</p>';
      return;
    }
    
    body.innerHTML = '<table><thead><tr><th>Date</th><th>Amount</th><th>Mode</th><th>Source</th></tr></thead><tbody>' +
      payments.map(p => {
        const d = fmtDate(p.date);
        const src = p.source === 'Local' ? '<span class="badge badge-primary">Local</span>' : '<span class="badge" style="background:rgba(139,92,246,0.15);color:#8b5cf6">Paypakka</span>';
        return '<tr><td>' + esc(d) + '</td><td><strong>' + fmtRs(p.amount) + '</strong></td><td>' + esc(p.payment_mode || '--') + '</td><td>' + src + '</td></tr>';
      }).join('') +
      '</tbody></table><p style="text-align:center;color:var(--text-light);margin-top:8px;font-size:0.8rem">Showing last ' + payments.length + ' payments</p>';
  } catch (e) {
    document.getElementById('custPayHistBody').innerHTML = '<p style="color:var(--error)">Failed to load history</p>';
  }
}

async function loadPayConnections(custId) {
  const connSel = document.getElementById('payConnection');
  connSel.innerHTML = '<option value="">Select connection</option>';
  
  try {
    const c = await api('/api/customers/' + custId);
    const conns = c.connections || [];
    _payConnsCache = conns;
    
    if (conns.length === 0) {
      toast('No connections found for this customer', 'warning');
      return;
    }
    
    let activeConn;
    if (conns.length === 1) {
      connSel.innerHTML = '<option value="' + conns[0].id + '" selected>' + esc(conns[0].stb_no || 'Connection 1') + ' ' + msoBadge(conns[0].network || detectMSO(conns[0].stb_no)) + '</option>';
      activeConn = conns[0];
    } else {
      connSel.innerHTML = conns.map(cn => '<option value="' + cn.id + '">' + esc(cn.stb_no || 'Connection ' + cn.id) + ' ' + msoBadge(cn.network || detectMSO(cn.stb_no)) + '</option>').join('');
      activeConn = conns.find(c2 => c2.status === 'Active') || conns[0];
    }
    const net = activeConn.network || detectMSO(activeConn.stb_no);
    await loadPayPlans(net, activeConn.plan_name);
    autoDetectGap(activeConn);
    
    // Show step 2
    document.getElementById('payStep2').style.display = 'block';
  } catch (e) {}
}

function onPayConnChange() {
  const connId = document.getElementById('payConnection').value;
  if (connId && _payConnsCache.length) {
    const conn = _payConnsCache.find(c => c.id == connId);
    if (conn) {
      const net = conn.network || detectMSO(conn.stb_no);
      loadPayPlans(net, conn.plan_name);
      autoDetectGap(conn);
    }
  }
}

function autoDetectGap(conn) {
  const today = new Date();
  const expiryStr = conn.expiry_date;
  const status = (conn.status || '').toLowerCase();
  const noteEl = document.getElementById('payProrataNote');
  
  // Reset disconnected flag at the start
  window._payIsDisconnected = false;

  if (!expiryStr) {
    // No expiry - default to current month
    const now = new Date();
    document.getElementById('payMonth').value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById('payMonths').value = '1';
    noteEl.style.display = 'none';
    return;
  }

  const expiry = new Date(expiryStr + 'T23:59:59');
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const expiryDate = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
  const isExpired = expiryDate < todayDate || status === 'disconnected' || status === 'inactive' || status === 'suspended';

  if (isExpired) {
    const curMonth = today.getMonth(); // 0-indexed
    const curYear = today.getFullYear();
    
    // Set month to current month so prorata logic works
    document.getElementById('payMonth').value = curYear + '-' + String(curMonth + 1).padStart(2, '0');
    
    // Disconnected customer reconnecting: only charge 1 month at prorata rate
    // (service wasn't provided during gap, so gap months are not charged)
    document.getElementById('payMonths').value = '1';
    
    // Mark as disconnected so calcPayAmount applies prorata regardless of date
    window._payIsDisconnected = true;
    
    // Calculate gap just for display info
    const expMonth = expiry.getMonth(); // 0-indexed
    const expYear = expiry.getFullYear();
    const gapMonths = (curYear - expYear) * 12 + (curMonth - expMonth) + 1;
    
    noteEl.innerHTML = '⚠️ Last paid till <strong>' + expiry.toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}) + '</strong> (' + gapMonths + ' month gap). Reconnecting — 1 month prorata.';
    noteEl.style.display = 'block';
    calcPayAmount();
  } else {
    // Not expired — check if already paid for current month
    const curMonth = today.getMonth();
    const curYear = today.getFullYear();
    const expMonth = expiryDate.getMonth();
    const expYear = expiryDate.getFullYear();

    if (expYear > curYear || (expYear === curYear && expMonth >= curMonth)) {
      let nextM = curMonth + 2;
      let nextY = curYear;
      if (nextM > 12) { nextM -= 12; nextY++; }
      document.getElementById('payMonth').value = nextY + '-' + String(nextM).padStart(2, '0');
      const nextMonthName = new Date(nextY, nextM - 1, 1).toLocaleDateString('en-IN', {month:'long', year:'numeric'});
      noteEl.innerHTML = '✅ Already paid till <strong>' + expiry.toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}) + '</strong>. Month set to <strong>' + nextMonthName + '</strong>.';
      noteEl.style.display = 'block';
    } else {
      document.getElementById('payMonth').value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
      noteEl.style.display = 'none';
    }
    document.getElementById('payMonths').value = '1';
    calcPayAmount();
  }
}

async function loadPayPlans(network, defaultPlanName) {
  const net = network || 'GTPL';
  try {
    const pdata = await api('/api/plans?status=Active&network=' + net);
    _payPlansCache = pdata.plans || pdata.items || pdata || [];
    const psel = document.getElementById('payPlan');
    psel.innerHTML = '<option value="">Select plan (' + esc(net) + ')</option>' + _payPlansCache.map(p => '<option value="' + (p.id || '') + '">' + esc(p.name) + ' - ' + fmtRs(p.amount || p.price) + '</option>').join('');
    
    // Auto-select customer's current plan
    if (defaultPlanName) {
      const match = _payPlansCache.find(p => p.name && p.name.toLowerCase() === defaultPlanName.toLowerCase());
      if (match) {
        psel.value = match.id;
        document.getElementById('payStep3').style.display = 'block';
        calcPayAmount();
        return;
      }
      // Try partial match
      const partial = _payPlansCache.find(p => p.name && (p.name.toLowerCase().includes(defaultPlanName.toLowerCase()) || defaultPlanName.toLowerCase().includes(p.name.toLowerCase())));
      if (partial) {
        psel.value = partial.id;
        document.getElementById('payStep3').style.display = 'block';
        calcPayAmount();
        return;
      }
    }
    
    // Show step 3 when plan is manually selected
    psel.onchange = function() {
      if (this.value) {
        document.getElementById('payStep3').style.display = 'block';
        calcPayAmount();
      }
    };
  } catch (e) {}
}

function calcPayAmount() {
  const planId = document.getElementById('payPlan').value;
  const monthVal = document.getElementById('payMonth').value;
  const months = parseInt(document.getElementById('payMonths').value) || 1;
  const bd = document.getElementById('payBreakdown');
  if (!planId || !monthVal) { bd.style.display = 'none'; return; }

  const plan = _payPlansCache.find(p => p.id == planId);
  if (!plan) { bd.style.display = 'none'; return; }

  const fullAmt = plan.amount || plan.price || 0;
  const today = new Date();
  const payDay = today.getDate();
  const payMonth = today.getMonth();
  const payYear = today.getFullYear();
  const network = plan.network || 'GTPL';

  let netAmt = fullAmt * months;
  let discount = 0;
  let fullDisplay = fullAmt * months;
  let prorataNote = '';
  const isDisconnected = window._payIsDisconnected === true;

  if (months === 12) {
    discount = fullAmt;
    netAmt = fullAmt * 11;
    prorataNote = '🎁 Yearly Pack: 12 months, pay for 11 — 1 month FREE! (₹' + fullAmt + ' saved)';
  } else if (isDisconnected && payDay <= 12) {
    // Disconnected customer reconnecting between 1st-12th:
    // prorata for remaining days until 12th + 1 full month (13th to next 12th)
    const daysInMonth = new Date(payYear, payMonth + 1, 0).getDate();
    const prorataDays = 13 - payDay; // inclusive: today to 12th
    const prorataAmt = (prorataDays / daysInMonth) * fullAmt;
    const roundedProrata = Math.round(prorataAmt / 10) * 10;
    netAmt = roundedProrata + fullAmt;
    fullDisplay = netAmt;
    prorataNote = '🔄 Reconnect: ' + prorataDays + ' days prorata (₹' + roundedProrata + ') + 1 full month (₹' + fullAmt + ') = ₹' + netAmt;
  } else if (payDay > 20 && months >= 1) {
    // GTPL prorata: after 20th, current month is prorata + next month full
    const selDate = new Date(monthVal + '-01');
    const selMonth = selDate.getMonth();
    const selYear = selDate.getFullYear();
    const isCurrentMonth = (payYear === selYear && payMonth === selMonth);

    if (isCurrentMonth && months === 1) {
      // Single current month after 20th: prorata for remaining days
      const nextMonth = payMonth === 11 ? 0 : payMonth + 1;
      const nextYear = payMonth === 11 ? payYear + 1 : payYear;
      const targetDate = new Date(nextYear, nextMonth, 16);
      const remainingDays = Math.ceil((targetDate - today) / (86400000));
      const daysInMonth = new Date(payYear, payMonth + 1, 0).getDate();
      const prorataAmt = (remainingDays / daysInMonth) * fullAmt;
      const roundedAmt = Math.round(prorataAmt / 10) * 10;
      discount = fullAmt - roundedAmt;
      netAmt = roundedAmt;
      fullDisplay = fullAmt;
      prorataNote = '📊 Prorata: ' + remainingDays + ' days (today → ' + targetDate.toLocaleDateString('en-IN', {day:'2-digit',month:'short'}) + ') × ₹' + fullAmt + ' ÷ ' + daysInMonth + ' = ₹' + Math.round(prorataAmt) + ' → ₹' + roundedAmt;
    } else if (isCurrentMonth && months > 1) {
      // Gap payment: past months full + current month prorata
      const nextMonth = payMonth === 11 ? 0 : payMonth + 1;
      const nextYear = payMonth === 11 ? payYear + 1 : payYear;
      const targetDate = new Date(nextYear, nextMonth, 16);
      const remainingDays = Math.ceil((targetDate - today) / (86400000));
      const daysInMonth = new Date(payYear, payMonth + 1, 0).getDate();
      const prorataAmt = (remainingDays / daysInMonth) * fullAmt;
      const roundedProrata = Math.round(prorataAmt / 10) * 10;
      const fullMonths = months - 1; // past months at full rate
      netAmt = (fullAmt * fullMonths) + roundedProrata;
      fullDisplay = fullAmt * months;
      discount = fullDisplay - netAmt;
      prorataNote = '📊 ' + fullMonths + ' month(s) full (₹' + (fullAmt * fullMonths) + ') + current month prorata ' + remainingDays + ' days (₹' + roundedProrata + ') = ₹' + netAmt;
    }
  } else if (months === 1) {
    const selDate = new Date(monthVal + '-01');
    const selMonth = selDate.getMonth();
    const selYear = selDate.getFullYear();
    const isFutureMonth = (selYear > payYear) || (selYear === payYear && selMonth > payMonth);

    if (isDisconnected && payDay > 12 && payDay <= 20) {
      prorataNote = '🔄 Reconnect: Full month (₹' + fullAmt + '). Billing cycle 13th–12th.';
    } else if (isFutureMonth) {
      const monthName = selDate.toLocaleDateString('en-IN', {month:'long', year:'numeric'});
      prorataNote = '📅 Full month payment for ' + monthName;
    } else {
      prorataNote = '📅 Full month payment';
    }
  }

  document.getElementById('payFullAmt').textContent = fmtRs(fullDisplay);
  document.getElementById('payDiscount').textContent = '- ' + fmtRs(discount);
  document.getElementById('payNetAmt').textContent = fmtRs(netAmt);
  document.getElementById('payAmount').value = netAmt;

  const noteEl = document.getElementById('payProrataNote');
  if (prorataNote) {
    noteEl.textContent = prorataNote;
    noteEl.style.display = 'block';
  } else {
    noteEl.style.display = 'none';
  }
  bd.style.display = 'block';
  
  // Show step 4
  document.getElementById('payStep4').style.display = 'block';
}

async function recordPayment(e) {
  e.preventDefault();
  if (document.getElementById('payCustomerId').value === '') return toast('Select a customer first', 'warning');

  const custId = document.getElementById('payCustomerId').value;
  const monthVal = document.getElementById('payMonth').value;
  const monthYear = monthVal.split('-').reverse().join('-');

  // Check if customer already paid for this month
  if (!window._payDuplicateProceed) {
    try {
      const now = new Date();
      const from = monthVal + '-01';
      const [yy, mm] = monthVal.split('-');
      const lastDay = new Date(parseInt(yy), parseInt(mm), 0).getDate();
      const to = monthVal + '-' + lastDay;
      const data = await api('/api/payments/all?per_page=10&date_from=' + from + '&date_to=' + to + '&customer_id=' + custId);
      const existing = (data.payments || []).filter(p => p.source === 'Local');
      if (existing.length > 0) {
        const last = existing[0];
        const lastDate = fmtDate(last.date);
        const lastAmt = fmtRs(last.amount);
        showDuplicateWarning(custId, monthYear, lastDate, lastAmt, existing.length);
        return;
      }
    } catch(ex) {}
  }
  window._payDuplicateProceed = false;

  const connId = document.getElementById('payConnection').value || -1;
  const planId = document.getElementById('payPlan').value || null;
  const payAmount = parseFloat(document.getElementById('payAmount').value);

  let lat = null, lng = null;
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {timeout: 5000, enableHighAccuracy: true});
    });
    lat = pos.coords.latitude;
    lng = pos.coords.longitude;
  } catch(e) {}

  try {
    await api('/api/payments', {method: 'POST', body: JSON.stringify({
      customer_id: custId,
      connection_id: connId === '-1' ? null : parseInt(connId),
      plan_id: planId,
      amount: payAmount,
      payment_mode: document.getElementById('payMode').value,
      payment_type: document.getElementById('payType').value,
      month_year: monthYear,
      months_paid: parseInt(document.getElementById('payMonths').value) || 1,
      notes: document.getElementById('payNotes').value || null,
      latitude: lat,
      longitude: lng,
      previous_balance: 0,
      bill_amount: payAmount
    })});
    toast('Payment recorded!' + (lat ? ' 📍 Location captured' : ''), 'success');
    // Flash success overlay on customer card
    const payCard = document.getElementById('payCustCard');
    if (payCard && payCard.style.display !== 'none') {
      payCard.style.transition = 'all 0.5s ease';
      payCard.style.background = 'linear-gradient(135deg, #28a745, #20c997)';
      payCard.style.color = '#fff';
      payCard.innerHTML = '<div style="text-align:center;padding:8px;font-size:18px;font-weight:700">✅ Payment Recorded!</div>';
      setTimeout(() => {
        payCard.style.opacity = '0';
        payCard.style.transform = 'scale(0.95)';
        setTimeout(() => { payCard.style.display = 'none'; payCard.style.opacity = '1'; payCard.style.transform = ''; payCard.style.background = ''; payCard.style.color = ''; }, 500);
      }, 1200);
    }
    // Hide billing steps and last payment info immediately
    document.getElementById('payStep2').style.display = 'none';
    document.getElementById('payStep3').style.display = 'none';
    document.getElementById('payStep4').style.display = 'none';
    document.getElementById('payBreakdown').style.display = 'none';
    document.getElementById('payLastPayment').style.display = 'none';
    // Show print receipt option
    const result_data = {
      customer_id: custId,
      customer_name: document.getElementById('payCustomerName')?.textContent || '',
      stb_no: document.getElementById('payStbNo')?.textContent || '',
      amount: payAmount,
      payment_mode: document.getElementById('payMode').value,
      collector: _userName || '',
      date: new Date().toISOString(),
    };
    showPayReceiptPrompt(result_data);
    resetPayForm();
    loadAllPaymentHistory(1);
  } catch (e) { toast('Payment failed: ' + e.message, 'error'); }
}

function showPayReceiptPrompt(data) {
  const existing = document.getElementById('payReceiptBanner');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'payReceiptBanner';
  div.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:5000;background:var(--success);color:#fff;padding:12px 18px;border-radius:12px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,0.2);animation:slideIn 0.3s ease';
  div.innerHTML = '<span>✅ Payment saved!</span><button onclick="printPaymentReceipt(' + JSON.stringify(data).replace(/"/g,'&quot;') + ');this.parentNode.remove()" style="background:rgba(255,255,255,0.25);border:none;color:#fff;padding:5px 12px;border-radius:8px;cursor:pointer;font-size:13px">🖨 Print</button><button onclick="this.parentNode.remove()" style="background:none;border:none;color:#fff;cursor:pointer;font-size:18px;padding:0 4px">×</button>';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 8000);
}

function showDuplicateWarning(custId, monthYear, lastDate, lastAmt, count) {
  const existing = document.getElementById('dupPayModal');
  if (existing) existing.remove();

  // Parse the month being paid for (monthYear = "04-2026")
  const [mm, yy] = monthYear.split('-');
  const payForDate = new Date(parseInt(yy), parseInt(mm) - 1, 1);
  const payForName = payForDate.toLocaleDateString('en-IN', {month: 'long', year: 'numeric'});

  // Next month
  let nextM = parseInt(mm) + 1;
  let nextY = parseInt(yy);
  if (nextM > 12) { nextM -= 12; nextY++; }
  const nextDate = new Date(nextY, nextM - 1, 1);
  const nextName = nextDate.toLocaleDateString('en-IN', {month: 'long', year: 'numeric'});

  const modal = document.createElement('div');
  modal.id = 'dupPayModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = '<div style="background:var(--card);border-radius:12px;padding:24px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);border-left:4px solid #f59e0b">' +
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">' +
      '<span style="font-size:2rem">⚠️</span>' +
      '<h3 style="margin:0;color:#f59e0b">Already Paid!</h3>' +
    '</div>' +
    '<p style="margin:0 0 8px;color:var(--text)">This customer already has <strong>' + count + '</strong> payment(s) for <strong>' + payForName + '</strong>.</p>' +
    '<div style="background:var(--bg);border-radius:8px;padding:12px;margin:12px 0">' +
      '<div style="color:var(--text-light);font-size:0.85rem">Last Payment for ' + payForName + '</div>' +
      '<div style="font-size:1.1rem;margin-top:4px"><strong>' + lastDate + '</strong> • <strong>' + lastAmt + '</strong></div>' +
    '</div>' +
    '<p style="margin:0 0 16px;color:var(--text-light);font-size:0.9rem">Due for <strong style="color:var(--primary)">' + nextName + '</strong>. Do you want to proceed with duplicate payment for <strong>' + payForName + '</strong>?</p>' +
    '<div style="display:flex;gap:10px;justify-content:flex-end">' +
      '<button type="button" id="dupCancelBtn" style="padding:8px 20px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer;font-size:0.9rem">Cancel</button>' +
      '<button type="button" id="dupProceedBtn" style="padding:8px 20px;border-radius:8px;border:none;background:#f59e0b;color:#000;cursor:pointer;font-weight:600;font-size:0.9rem">Proceed Anyway</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(modal);

  document.getElementById('dupCancelBtn').onclick = function() { modal.remove(); };
  document.getElementById('dupProceedBtn').onclick = function() {
    modal.remove();
    window._payDuplicateProceed = true;
    document.getElementById('paymentForm').dispatchEvent(new Event('submit', {cancelable: true}));
  };
  modal.addEventListener('click', function(ev) { if (ev.target === modal) modal.remove(); });
}

function resetPayForm() {
  document.getElementById('paymentForm').reset();
  document.getElementById('payCustomerId').value = '';
  document.getElementById('paySearchInput').value = '';
  document.getElementById('paySearchResults').style.display = 'none';
  document.getElementById('payCustCard').style.display = 'none';
  document.getElementById('payStep2').style.display = 'none';
  document.getElementById('payStep3').style.display = 'none';
  document.getElementById('payStep4').style.display = 'none';
  document.getElementById('payBreakdown').style.display = 'none';
  document.getElementById('payProrataNote').style.display = 'none';
  document.getElementById('payConnection').innerHTML = '';
  document.getElementById('payPlan').innerHTML = '';
}

// Payment History date quick buttons
function phDateQuick(preset) {
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
  document.getElementById('payDateFrom').value = from;
  document.getElementById('payDateTo').value = to;
  ['phToday','phYesterday','phMonth'].forEach(id => {
    const b = document.getElementById(id);
    const key = id.replace('ph','').toLowerCase();
    b.className = 'btn btn-sm ' + (key === preset ? 'btn-primary' : 'btn-outline');
  });
  loadAllPaymentHistory();
}

async function loadAllPaymentHistory(page) {
  page = page || 1;
  const perPage = parseInt(document.getElementById('payPerPage').value) || 10;
  const dateFrom = document.getElementById('payDateFrom').value || '';
  const dateTo = document.getElementById('payDateTo').value || '';

  let url = '/api/payments/all?page=' + page + '&per_page=' + perPage;
  if (dateFrom) url += '&date_from=' + dateFrom;
  if (dateTo) url += '&date_to=' + dateTo;

  try {
    const d = await api(url);
    const items = d.payments || [];
    const tbody = document.getElementById('payHistoryBody');

    if (items.length) {
      tbody.innerHTML = items.map((p, i) => {
        const sn = ((d.page || 1) - 1) * (d.per_page || 10) + i + 1;
        const srcBadge = p.source === 'Local'
          ? '<span class="badge badge-success" style="font-size:10px">Local</span>'
          : '<span class="badge" style="background:#6c757d;color:#fff;font-size:10px">Paypakka</span>';
        const locBtn = (p.latitude && p.longitude)
          ? '<button class="btn btn-outline btn-sm" onclick="showLocationMap(' + p.latitude + ',' + p.longitude + ',\'' + escAttr(p.customer_name || '') + '\')" title="View location">📍</button>'
          : '<span style="color:var(--text-light)">—</span>';
        const delBtn = p.deletable
          ? '<button class="btn btn-sm btn-danger" onclick="deleteMainPayment(' + p.id + ')" title="Delete this payment">🗑</button>'
          : '';
        return '<tr>'
          + '<td>' + sn + '</td>'
          + '<td>' + srcBadge + '</td>'
          + '<td><strong>' + esc(p.customer_name || '--') + '</strong>' + (p.stb_no ? '<br><span style="font-size:11px;color:var(--text-light);cursor:pointer" onclick="navigator.clipboard.writeText(\'' + escAttr(p.stb_no) + '\').then(()=>toast(\'Copied STB: ' + esc(p.stb_no) + '\',\'success\'))" title="Click to copy STB #">📺 ' + esc(p.stb_no) + ' 📋</span>' : '') + '<br><span style="font-size:10px;color:var(--text-light)">' + esc(p.customer_id || '') + '</span></td>'
          + '<td>' + esc(p.area || '--') + '</td>'
          + '<td>' + fmtRs(p.bill_amount || 0) + '</td>'
          + '<td><strong>' + fmtRs(p.amount || 0) + '</strong></td>'
          + '<td><span class="badge badge-primary">' + esc(p.payment_mode || '--') + '</span></td>'
          + '<td>' + payTypeBadge(p.payment_type) + '</td>'
          + '<td>' + esc(p.collector || '--') + '</td>'
          + '<td>' + fmtDateTime(p.date) + '</td>'
          + '<td>' + locBtn + '</td>'
          + '<td>' + delBtn + '</td>'
          + '</tr>';
      }).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="12" class="empty-state"><p>No payments found for this period</p></td></tr>';
    }

    // Mobile card view for payment history
    const mobEl = document.getElementById('mobPayHistory');
    if (mobEl) {
      if (items.length) {
        mobEl.innerHTML = items.map((p, i) => {
          const srcBadge = p.source === 'Local'
            ? '<span class="badge badge-success">Local</span>'
            : '<span class="badge" style="background:#6c757d;color:#fff">Paypakka</span>';
          const delBtn = p.deletable
            ? '<button class="btn btn-sm btn-danger" onclick="deleteMainPayment(' + p.id + ')" title="Delete">🗑</button>'
            : '';
          return '<div class="mp-card">'
            + '<div class="mp-top">'
            + '<span class="mp-name">' + esc(p.customer_name || '--') + '</span>'
            + '<span class="mp-amt">' + fmtRs(p.amount || 0) + '</span>'
            + '</div>'
            + '<div style="font-size:11px;color:var(--text-light)">' + esc(p.customer_id || '') + (p.stb_no ? ' · 📺 ' + esc(p.stb_no) : '') + '</div>'
            + '<div class="mp-meta">'
            + srcBadge
            + '<span class="badge badge-primary">' + esc(p.payment_mode || '--') + '</span>'
            + '<span>' + esc(p.collector || '--') + '</span>'
            + '<span>' + fmtDateTime(p.date) + '</span>'
            + (p.area ? '<span>' + esc(p.area) + '</span>' : '')
            + (p.bill_amount ? '<span>Bill: ' + fmtRs(p.bill_amount) + '</span>' : '')
            + '</div>'
            + (delBtn ? '<div class="mp-actions">' + delBtn + '</div>' : '')
            + '</div>';
        }).join('');
      } else {
        mobEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-light)">No payments found</div>';
      }
    }

    // Set date inputs if server defaulted them
    if (d.date_from && !dateFrom) document.getElementById('payDateFrom').value = d.date_from;
    if (d.date_to && !dateTo) document.getElementById('payDateTo').value = d.date_to;

    // Total info
    document.getElementById('payTotalInfo').textContent = 'Showing ' + items.length + ' of ' + d.total + ' payments (Page ' + d.page + ' / ' + d.total_pages + ')';

    // Pagination
    const pg = document.getElementById('payPagination');
    const tp = d.total_pages || 1;
    if (tp > 1) {
      let html = '';
      // Prev button
      if (d.page > 1) html += '<button onclick="loadAllPaymentHistory(' + (d.page - 1) + ')">‹ Prev</button>';
      // Page buttons (max 7 visible)
      let startP = Math.max(1, d.page - 3);
      let endP = Math.min(tp, startP + 6);
      if (endP - startP < 6) startP = Math.max(1, endP - 6);
      for (let i = startP; i <= endP; i++) {
        html += '<button class="' + (i === d.page ? 'active' : '') + '" onclick="loadAllPaymentHistory(' + i + ')">' + i + '</button>';
      }
      // Next button
      if (d.page < tp) html += '<button onclick="loadAllPaymentHistory(' + (d.page + 1) + ')">Next ›</button>';
      pg.innerHTML = html;
    } else {
      pg.innerHTML = '';
    }
  } catch (e) {
    document.getElementById('payHistoryBody').innerHTML = '<tr><td colspan="12" class="empty-state"><p>Could not load history: ' + esc(e.message || '') + '</p></td></tr>';
  }
}

async function deleteMainPayment(paymentId) {
  // Find the payment row from current data to show details
  const row = document.querySelector('button[onclick="deleteMainPayment(' + paymentId + ')"]')?.closest('tr');
  const custName = row ? row.cells[2]?.textContent?.trim().split('\n')[0] : '';
  const amount = row ? row.cells[5]?.textContent?.trim() : '';

  // Confirmation popup
  const confirmed = confirm('⚠️ Delete this payment?\n\n' + custName + ' — ' + amount + '\n\nExpiry date will be corrected automatically if affected.');
  if (!confirmed) return;

 try {
 const res = await api('/api/payments/' + paymentId, { method: 'DELETE' });

 // Always show result with expiry info if present; fallback to simple success
 let title = '✅ Payment Deleted';
 let body = '<strong style="color:var(--success)">Payment deleted successfully!</strong>';

 if (res.message) body += '<br><br><strong>Server:</strong> ' + esc(res.message);
 if (res.remaining_payments != null) body += '<br><strong>📊 Remaining payments:</strong> ' + res.remaining_payments;

 if (res.old_expiry && res.new_expiry) {
 const oldDate = new Date(res.old_expiry).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
 const newDate = new Date(res.new_expiry).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
 let label = 'Expiry Date Updated';
 if (res.remaining_payments === 0) label = 'No payments remaining — Expiry Cleared';
 else if (res.old_expiry !== res.new_expiry) label = 'Expiry Date Corrected';
 title = '📅 ' + label;
 body = '<strong style="color:var(--success)">Payment deleted successfully!</strong><br><br>'
 + '📅 <strong>' + label + ':</strong><br>'
 + '<span style="color:var(--danger)">~~' + oldDate + '~~</span> → <strong style="color:var(--success)">' + newDate + '</strong>';
 if (res.remaining_payments > 0) body += '<br><br>📊 Remaining payments: <strong>' + res.remaining_payments + '</strong>';
 }

showDeleteResult(title, body);

 // Reload current page
const currentPage = parseInt(document.querySelector('#payPagination button.active')?.textContent || '1');
loadAllPaymentHistory(currentPage);
  } catch (e) {
    toast('Failed to delete payment: ' + (e.message || 'Unknown error'), 'error');
  }
}

function showDeleteResult(title, bodyHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';
  overlay.style.zIndex = '3000';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = '<div class="modal" style="max-width:440px">'
    + '<div class="modal-header"><h2>' + title + '</h2><button class="btn btn-outline btn-sm" onclick="this.closest(\'.modal-overlay\').remove()">✕</button></div>'
    + '<div class="modal-body" style="font-size:14px;line-height:1.6">' + bodyHtml + '</div>'
    + '<div class="modal-footer"><button class="btn btn-primary" onclick="this.closest(\'.modal-overlay\').remove()">OK, Got it</button></div>'
    + '</div>';
  document.body.appendChild(overlay);
}

// Keep old function names as aliases for compatibility
async function loadPaymentHistory() { loadAllPaymentHistory(1); }
function loadPaymentHistoryPage(p) { loadAllPaymentHistory(p); }

function fmtDateTime(dt) {
  if (!dt) return '--';
  const d = new Date(dt + (dt.includes('Z') || dt.includes('+') ? '' : 'Z'));
  if (isNaN(d)) return dt;
  return d.toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}) + ' ' + d.toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit',hour12:true});
}

function showLocationMap(lat, lng, name) {
  name = decodeURIComponent(name);
  document.getElementById('mapModalTitle').textContent = '📍 ' + name + ' - Collection Location';
  document.getElementById('mapContainer').innerHTML = '<iframe width="100%" height="400" frameborder="0" style="border:0;border-radius:8px" src="https://www.openstreetmap.org/export/embed.html?bbox=' + (lng-0.005) + '%2C' + (lat-0.005) + '%2C' + (lng+0.005) + '%2C' + (lat+0.005) + '&layer=mapnik&marker=' + lat + '%2C' + lng + '"></iframe>';
  document.getElementById('mapCoords').textContent = 'Lat: ' + lat.toFixed(6) + ', Lng: ' + lng.toFixed(6);
  document.getElementById('mapModalOverlay').classList.add('show');
}

function closeMapModal() { document.getElementById('mapModalOverlay').classList.remove('show'); }

// REPORTS
async function loadReports() {
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

    // Populate area dropdown from results
    if (document.getElementById('agPaidArea').options.length <= 1) {
      const areas = [...new Set(payments.map(p => p.area).filter(Boolean))].sort();
      const sel = document.getElementById('agPaidArea');
      areas.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; sel.appendChild(o); });
    }

    // Apply client-side area filter only
    const areaFilter = document.getElementById('agPaidArea').value;
    let filtered = payments;
    if (areaFilter) filtered = filtered.filter(p => p.area === areaFilter);

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
          '<td>' + esc(p.month_year || '-') + '</td>' +
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
          if (p.month_year) tags += '<span class="rcard-tag plan">📅 ' + esc(p.month_year) + '</span>';
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

    const headers = ['S.No','Customer ID','Customer Name','Phone','STB','MSO','Area','Plan Month','Amount','Payment Mode','Date & Time','Collected By','Source'];
    const rows = payments.map((p, i) => {
      const dt = p.date ? new Date(p.date + (p.date.endsWith('Z') ? '' : 'Z')).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}) : '';
      return [i+1, p.customer_id||'', p.customer_name||'', p.customer_phone||'', p.stb_no||'', p.mso||'', p.area||'', p.month_year||'', p.amount||0, p.payment_mode||'', dt, p.collector||'', p.source||''];
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

// SETTINGS
// Settings Page - Operator selector for Master
function _settingsOpId() {
  if (_userRole !== 'master') return '';
  const sel = document.getElementById('settingsOpSelect');
  return sel ? sel.value : '';
}

function _settingsOpParam() {
  const oid = _settingsOpId();
  return oid ? '?operator_id=' + oid : '';
}

function _settingsOpBody(extra) {
  const oid = _settingsOpId();
  return oid ? {...extra, operator_id: parseInt(oid)} : extra;
}

async function initSettingsPage() {
  const isMaster = _userRole === 'master';
  const selector = document.getElementById('masterOpSelector');
  if (isMaster) {
    selector.style.display = 'block';
    const sel = document.getElementById('settingsOpSelect');
    // Load operators into dropdown
    try {
      const ops = await api('/api/operators/');
      const list = ops.operators || ops || [];
      sel.innerHTML = '<option value="">— Select Operator —</option>' +
        list.map(o => `<option value="${o.id}">${o.business_name} (${o.customer_prefix || ''})</option>`).join('');
    } catch(e) {}
  } else {
    selector.style.display = 'none';
  }
  loadStbInventory();
  loadNotifySettings();
}

function onSettingsOpChange() {
  loadStbInventory();
  loadNotifySettings();
}

// Notification Settings
async function loadNotifySettings() {
  try {
    const r = await api('/api/settings/notifications' + _settingsOpParam());
    const linked = r.telegram_linked;
    document.getElementById('tgNotLinked').style.display = linked ? 'none' : 'block';
    document.getElementById('tgLinked').style.display = linked ? 'block' : 'none';
    if (linked) {
      document.getElementById('tgBotInfo').textContent = `@${r.telegram_bot_username} • ${r.telegram_chat_count} user(s) linked`;
      if (r.notify_payment_scope) document.getElementById('notifyPaymentScope').value = r.notify_payment_scope;
      if (r.notify_enabled) document.getElementById('notifyEnabled').value = r.notify_enabled;
    }
  } catch(e) {}
}

async function verifyTelegram() {
  const token = document.getElementById('tgBotToken').value.trim();
  if (!token) return toast('Enter bot token', 'error');
  const body = _settingsOpBody({bot_token: token});
  const chatIds = document.getElementById('tgChatIds').value.trim();
  if (chatIds) body.chat_ids = chatIds;
  try {
    const r = await api('/api/settings/telegram/verify', {method: 'POST', body: JSON.stringify(body)});
    toast(r.message, r.ok ? 'success' : 'error');
    if (r.ok) loadNotifySettings();
  } catch(e) {
    const msg = e?.detail || 'Verification failed';
    toast(msg, 'error');
  }
}

async function detectTelegramChats() {
  try {
    const r = await api('/api/settings/telegram/detect-chats' + _settingsOpParam(), 'POST', {});
    toast(r.message, 'success');
    loadNotifySettings();
  } catch(e) { toast('Detect failed', 'error'); }
}

async function unlinkTelegram() {
  if (!confirm('Unlink Telegram bot? You won\'t receive notifications.')) return;
  try {
    await api('/api/settings/telegram' + _settingsOpParam(), 'DELETE');
    toast('Bot unlinked', 'success');
    loadNotifySettings();
  } catch(e) { toast('Unlink failed', 'error'); }
}

async function saveNotifySettings() {
  const data = _settingsOpBody({
    notify_payment_scope: document.getElementById('notifyPaymentScope').value,
    notify_enabled: document.getElementById('notifyEnabled').value,
  });
  try {
    await api('/api/settings/notifications', {method: 'PUT', body: JSON.stringify(data)});
    document.getElementById('notifyStatus').textContent = '✅ Saved';
    setTimeout(() => document.getElementById('notifyStatus').textContent = '', 2000);
  } catch(e) {
    document.getElementById('notifyStatus').textContent = '❌ Failed to save';
  }
}

async function changePassword(e) {
  e.preventDefault();
  const cp = document.getElementById('curPwd').value;
  const np = document.getElementById('newPwd').value;
  const cfp = document.getElementById('confirmPwd').value;
  if (!cp) { toast('Enter your current password', 'error'); return; }
  if (np !== cfp) { toast('New passwords do not match', 'error'); return; }
  if (np.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
  try {
    await api('/api/change-password', {method: 'PUT', body: JSON.stringify({current_password: cp, new_password: np})});
    toast('Password changed successfully', 'success');
    document.getElementById('curPwd').value = '';
    document.getElementById('newPwd').value = '';
    document.getElementById('confirmPwd').value = '';
  } catch (err) { toast('Failed: ' + err.message, 'error'); }
}

// MODAL HELPERS
function closeModal() { document.getElementById('modalOverlay').classList.remove('show'); }

// LOGOUT
// ── Idle Timeout (15 min) ───────────────────────────────────────────────
let _idleTimer = null;
let _idleWarning = null;
// No auto-logout — users stay logged in until they manually click Logout

async function doLogout(msg) {
    const token = localStorage.getItem('token');
    if (token) {
        try { await fetch('/api/logout', {method:'POST',headers:{'Authorization':'Bearer '+token}}); } catch(e){}
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (msg) { sessionStorage.setItem('logoutMsg', msg); }
    window.location.href = 'index.html';
}

function logout() {
  if (confirm('Are you sure you want to logout?')) { doLogout(null); }
}

// ===== PUSH NOTIFICATIONS =====
let _pushSubscription = null;
let _vapidKey = null;

async function initPushNotifications() {
  // Only for master, admin, support roles
  const allowedRoles = ['master', 'admin', 'support', 'service_agent'];
  if (!allowedRoles.includes(_userRole)) return;
  
  const bellBtn = document.getElementById('pushBellBtn');
  if (!bellBtn) return;
  bellBtn.style.display = '';
  
  // Register service worker
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      // Get VAPID key
      const keyData = await api('/api/push/vapid-key');
      _vapidKey = keyData.publicKey;
      
      // Check existing subscription
      _pushSubscription = await reg.pushManager.getSubscription();
      updateBellIcon();
    } catch (e) {
      console.log('Push init error:', e);
    }
  }
}

function updateBellIcon() {
  const btn = document.getElementById('pushBellBtn');
  if (!btn) return;
  if (_pushSubscription) {
    btn.textContent = '🔔';
    btn.title = 'Notifications ON — click to disable';
    btn.style.color = 'var(--primary)';
    btn.style.borderColor = 'var(--primary)';
  } else {
    btn.textContent = '🔕';
    btn.title = 'Notifications OFF — click to enable';
    btn.style.color = '';
    btn.style.borderColor = '';
  }
}

async function togglePushSubscription() {
  if (!('serviceWorker' in navigator)) {
    toast('Push notifications not supported in this browser', 'error');
    return;
  }
  
  try {
    const reg = await navigator.serviceWorker.ready;
    
    if (_pushSubscription) {
      // Unsubscribe
      await _pushSubscription.unsubscribe();
      await api('/api/push/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: _pushSubscription.endpoint,
          keys: {}
        })
      });
      _pushSubscription = null;
      updateBellIcon();
      toast('Notifications disabled', 'info');
    } else {
      // Subscribe
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast('Notification permission denied', 'error');
        return;
      }
      
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _vapidKey
      });
      
      const keys = sub.toJSON().keys;
      await api('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: keys
        })
      });
      
      _pushSubscription = sub;
      updateBellIcon();
      toast('🔔 Notifications enabled!', 'success');
      
      // Send test notification
      setTimeout(() => {
        api('/api/push/test');
      }, 1000);
    }
  } catch (e) {
    toast('Push error: ' + e.message, 'error');
    console.error('Push error:', e);
  }
}

// ===== ROLE-BASED ACCESS CONTROL =====
let _userRole = 'admin';
let _userPerms = [];

function applyRoleAccess(user) {
  _userRole = (user.role || 'agent').toLowerCase();
  try {
    const p = JSON.parse(user.permissions || '{}');
    _userPerms = p.permissions || [];
  } catch(e) { _userPerms = []; }

  // Define which nav items each role can see
  const roleAccess = {
    'master': ['dashboard','operators','reports','audit','settings'],
    'admin': ['dashboard','customers','add-customer','plans','payments','unpaid','not-renewed','employees','surrender-req','service-requests','reports','audit','settings'],
    'collection_agent': ['payments','unpaid','not-renewed','reports'],
    'agent': ['payments','unpaid','not-renewed','reports'],
    'service_agent': ['dashboard','customers','add-customer','payments','service-requests','reports'],
    'support': ['dashboard','customers','add-customer','payments','service-requests','reports']
  };

  const allowed = roleAccess[_userRole] || roleAccess['agent'];
  
  // Show/hide sidebar nav items
  document.querySelectorAll('#sidebar .nav-item').forEach(item => {
    const page = item.dataset.page;
    item.style.display = allowed.includes(page) ? '' : 'none';
  });

  // Update "Reports" nav item text for agents
  const reportsNav = document.querySelector('.nav-item[data-page="reports"]');
  if (reportsNav && (_userRole === 'collection_agent' || _userRole === 'agent')) {
    reportsNav.innerHTML = '📈 My Collections';
  }
  if (reportsNav && (_userRole === 'service_agent' || _userRole === 'support')) {
    reportsNav.innerHTML = '📈 Reports';
  }

  // Show/hide mobile bottom nav items
  // Layout: 0=Home, 1=Collect, 2=Unpaid, 3=Customers, 4=Reports, 5=More
  const mobPages = ['dashboard','payments','unpaid','customers','reports'];
  const mobBtns = document.querySelectorAll('.mob-nav-item');
  mobBtns.forEach((btn, i) => {
    if (i === 5) {
      // More button: show for admin (has hidden items) and agents
      btn.style.display = (_userRole === 'admin' || ['collection_agent','agent'].includes(_userRole)) ? '' : 'none';
    } else if (mobPages[i]) {
      btn.style.display = allowed.includes(mobPages[i]) ? '' : 'none';
    }
  });

  // If agent: hide admin-only sections in pages they CAN see
  if (_userRole !== 'admin' && _userRole !== 'support') {
    // On customers page: hide add customer, filters
    // On payments page: hide payment history table (keep collect form only)
    // We'll handle this with CSS class
    document.body.classList.add('role-agent');
  }
}

// ===== OPERATORS MANAGEMENT (Master Only) =====
async function loadOperators() {
  try {
    const ops = await api('/api/operators/');
    const el = document.getElementById('operatorsList');
    if (!ops.length) { el.innerHTML = '<p style="color:var(--text-muted)">No operators yet. Click "+ New Operator" to add one.</p>'; return; }
    el.innerHTML = ops.map(o => `
      <div class="card" style="border:1px solid var(--border);border-radius:12px;padding:16px;background:var(--white)">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
          <div>
            <h3 style="margin:0;font-size:16px">${o.business_name}</h3>
            <small style="color:var(--text-muted)">${o.area || 'No area'} · ${o.mso || 'GTPL'}</small>
          </div>
          <span style="padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${o.status==='active'?'#dcfce7':'#fee2e2'};color:${o.status==='active'?'#166534':'#991b1b'}">${o.status==='active'?'✓ Active':'⏸ Suspended'}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;margin-bottom:12px">
          <div><b>Owner:</b> ${o.owner_name}</div>
          <div><b>Phone:</b> ${o.phone}</div>
          <div><b>Customers:</b> ${o.customer_count} (${o.active_count} active)</div>
          <div><b>Connections:</b> ${o.connection_count}</div>
          <div><b>Staff:</b> ${o.staff_count}</div>
          <div><b>Month Collection:</b> ₹${Number(o.month_collection).toLocaleString()}</div>
        </div>
        ${o.admin_username ? `<div style="background:var(--bg-card);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px">
          <div style="font-weight:600;margin-bottom:6px;color:var(--primary)">👤 Admin Login</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
            <div><b>Username:</b> <code style="background:var(--bg);padding:2px 6px;border-radius:4px;cursor:pointer" onclick="navigator.clipboard.writeText('${o.admin_username}');toast('Copied!','success')">${o.admin_username}</code></div>
            <div><b>Name:</b> ${o.admin_name || '-'}</div>
            ${o.admin_phone ? `<div><b>Phone:</b> ${o.admin_phone}</div>` : ''}
          </div>
        </div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${o.status==='active'
            ?`<button class="btn btn-outline btn-sm" onclick="suspendOperator(${o.id},'${o.business_name}')">⏸ Suspend</button>`
            :`<button class="btn btn-primary btn-sm" onclick="reactivateOperator(${o.id},'${o.business_name}')">✓ Reactivate</button>`}
          <button class="btn btn-outline btn-sm" onclick="resetOpPwd(${o.id},'${o.business_name}')">🔑 Reset Password</button>
        </div>
      </div>
    `).join('');
  } catch(e) { toast('Failed to load operators: ' + e.message, 'error'); }
}

function showAddOperatorModal() { document.getElementById('addOpOverlay').classList.add('show'); }
function closeAddOpModal() { document.getElementById('addOpOverlay').classList.remove('show'); }

async function createOperator() {
  const data = {
    business_name: document.getElementById('opBizName').value.trim(),
    owner_name: document.getElementById('opOwnerName').value.trim(),
    phone: document.getElementById('opPhone').value.trim(),
    area: document.getElementById('opArea').value.trim(),
    mso: document.getElementById('opMso').value,
    email: document.getElementById('opEmail').value.trim(),
    notes: document.getElementById('opNotes').value.trim(),
    customer_prefix: document.getElementById('opPrefix').value.trim().toUpperCase(),
    admin_username: document.getElementById('opAdminUser').value.trim(),
    admin_password: document.getElementById('opAdminPwd').value,
    admin_name: document.getElementById('opAdminName').value.trim(),
  };
  if (!data.business_name || !data.owner_name || !data.phone || !data.admin_username || !data.admin_password || !data.customer_prefix) {
    return toast('Fill all required fields', 'error');
  }
  try {
    const r = await api('/api/operators/', {method: 'POST', body: JSON.stringify(data)});
    toast(r.message, 'success');
    closeAddOpModal();
    loadOperators();
  } catch(e) { toast('Failed: ' + e.message, 'error'); }
}

// ============================
// IMPORT DATA FUNCTIONS
// ============================
let _importPreviewId = null;

function showImportModal() {
  // Populate operator dropdown
  loadImportOperators();
  document.getElementById('importOverlay').classList.add('show');
  // Reset to step 1
  document.getElementById('importStep1').style.display = '';
  document.getElementById('importStep2').style.display = 'none';
  document.getElementById('importStep3').style.display = 'none';
  document.getElementById('importPreviewBtn').style.display = '';
  document.getElementById('importConfirmBtn').style.display = 'none';
  document.getElementById('importBackBtn').style.display = 'none';
  _importPreviewId = null;
}

function closeImportModal() {
  document.getElementById('importOverlay').classList.remove('show');
}

async function loadImportOperators() {
  try {
    const ops = await api('/api/operators/');
    const sel = document.getElementById('importOpSelect');
    sel.innerHTML = '<option value="">-- Choose Operator --</option>' +
      ops.map(o => `<option value="${o.id}">${o.business_name} (${o.customer_prefix || 'no prefix'}) — ${o.active_count || 0} customers</option>`).join('');
    // Also update CSV template link with auth
    const link = document.getElementById('csvTemplateLink');
    link.href = API + '/api/operators/import/template?token=' + encodeURIComponent(token);
  } catch(e) { console.error(e); }
}

function switchImportSource(src) {
  document.getElementById('importCsvSection').style.display = src === 'csv' ? '' : 'none';
  document.getElementById('importPaypakkaSection').style.display = src === 'paypakka' ? '' : 'none';
  document.getElementById('importManualSection').style.display = src === 'manual' ? '' : 'none';
  // Highlight selected
  ['Csv','Paypakka','Manual'].forEach(s => {
    document.getElementById('srcLabel'+s).style.borderColor = (s.toLowerCase() === src || (s === 'Csv' && src === 'csv')) ? '#6366f1' : '#e5e7eb';
  });
}

async function runImportPreview() {
  const opId = document.getElementById('importOpSelect').value;
  if (!opId) return toast('Select an operator first', 'error');

  const source = document.querySelector('input[name="importSource"]:checked').value;
  const btn = document.getElementById('importPreviewBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Analyzing...';

  try {
    let r;
    if (source === 'csv') {
      const file = document.getElementById('importCsvFile').files[0];
      if (!file) { toast('Select a CSV file', 'error'); btn.disabled = false; btn.textContent = 'Preview Import'; return; }
      const fd = new FormData();
      fd.append('operator_id', opId);
      fd.append('source', 'csv');
      fd.append('csv_file', file);
      const resp = await fetch(API + '/api/operators/import/preview', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: fd,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || 'Preview failed');
      }
      r = await resp.json();
    } else if (source === 'paypakka') {
      const accId = document.getElementById('importPpAccId').value.trim();
      const pwd = document.getElementById('importPpPwd').value;
      if (!accId || !pwd) { toast('Enter Paypakka credentials', 'error'); btn.disabled = false; btn.textContent = 'Preview Import'; return; }
      const fd = new FormData();
      fd.append('operator_id', opId);
      fd.append('source', 'paypakka');
      fd.append('paypakka_account_id', accId);
      fd.append('paypakka_password', pwd);
      const resp = await fetch(API + '/api/operators/import/preview', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: fd,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || 'Preview failed');
      }
      r = await resp.json();
    } else if (source === 'manual') {
      const text = document.getElementById('importManualText').value.trim();
      if (!text) { toast('Enter customer data', 'error'); btn.disabled = false; btn.textContent = 'Preview Import'; return; }
      const fd = new FormData();
      fd.append('operator_id', opId);
      fd.append('source', 'manual');
      fd.append('manual_text', text);
      const resp = await fetch(API + '/api/operators/import/preview', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: fd,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || 'Preview failed');
      }
      r = await resp.json();
    }

    _importPreviewId = r.preview_id;

    // Show Step 2
    document.getElementById('importStep1').style.display = 'none';
    document.getElementById('importStep2').style.display = '';
    document.getElementById('importPreviewBtn').style.display = 'none';
    document.getElementById('importConfirmBtn').style.display = '';
    document.getElementById('importBackBtn').style.display = '';

    // Summary
    document.getElementById('importPreviewSummary').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#16a34a">${r.valid_count}</div>
          <div style="color:#6b7280;font-size:13px">Valid Rows</div>
        </div>
        <div style="background:${r.invalid_count > 0 ? '#fef2f2' : '#f9fafb'};border:1px solid ${r.invalid_count > 0 ? '#fca5a5' : '#e5e7eb'};border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:${r.invalid_count > 0 ? '#dc2626' : '#6b7280'}">${r.invalid_count}</div>
          <div style="color:#6b7280;font-size:13px">Invalid Rows</div>
        </div>
        <div style="background:#f0f9ff;border:1px solid #93c5fd;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#2563eb">${r.total_rows}</div>
          <div style="color:#6b7280;font-size:13px">Total Rows</div>
        </div>
      </div>`;

    // Errors
    const errDiv = document.getElementById('importPreviewErrors');
    if (r.errors && r.errors.length > 0) {
      errDiv.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px">
        <div style="font-weight:600;color:#dc2626;margin-bottom:4px">⚠️ Errors (${r.errors.length})</div>
        <div style="font-size:12px;color:#7f1d1d;max-height:120px;overflow-y:auto">${r.errors.map(e => `<div>• ${e}</div>`).join('')}</div>
      </div>`;
    } else {
      errDiv.innerHTML = '';
    }

    // Sample rows
    if (r.sample_rows && r.sample_rows.length > 0) {
      document.getElementById('importPreviewSample').innerHTML = `
        <div style="font-weight:600;margin-bottom:4px">Sample (first ${r.sample_rows.length})</div>
        <div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse">
          <tr style="background:#f9fafb"><th style="padding:4px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Name</th><th style="padding:4px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Phone</th><th style="padding:4px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Area</th><th style="padding:4px 8px;text-align:left;border-bottom:1px solid #e5e7eb">Plan</th><th style="padding:4px 8px;text-align:left;border-bottom:1px solid #e5e7eb">STB</th></tr>
          ${r.sample_rows.map(s => `<tr><td style="padding:4px 8px">${s.name}</td><td style="padding:4px 8px">${s.phone}</td><td style="padding:4px 8px">${s.area || '-'}</td><td style="padding:4px 8px">${s.plan_name || '-'} ₹${s.plan_amount || '-'}</td><td style="padding:4px 8px">${s.stb_no || '-'}</td></tr>`).join('')}
        </table></div>`;
    }

    // Plans to create
    if (r.plans_to_create && r.plans_to_create.length > 0) {
      document.getElementById('importPreviewPlans').innerHTML = `
        <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px">
          <div style="font-weight:600;margin-bottom:4px">📋 New Plans to Create</div>
          <div style="font-size:13px">${r.plans_to_create.map(p => `<span style="background:#fef3c7;padding:2px 8px;border-radius:4px;margin:2px;display:inline-block">${p.name} ₹${p.amount}</span>`).join('')}</div>
        </div>`;
    }

    // Existing customers
    const existingKeys = Object.keys(r.existing_customers || {});
    if (existingKeys.length > 0) {
      document.getElementById('importPreviewExisting').innerHTML = `
        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px">
          <div style="font-weight:600;margin-bottom:4px">👥 Existing Customers (${existingKeys.length} will be skipped)</div>
          <div style="font-size:12px;max-height:80px;overflow-y:auto">${existingKeys.slice(0,10).map(k => `<div>• ${r.existing_customers[k]}</div>`).join('')}${existingKeys.length > 10 ? `<div>... and ${existingKeys.length - 10} more</div>` : ''}</div>
        </div>`;
    }

  } catch(e) {
    toast('Preview failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Preview Import';
  }
}

function importGoBack() {
  document.getElementById('importStep1').style.display = '';
  document.getElementById('importStep2').style.display = 'none';
  document.getElementById('importPreviewBtn').style.display = '';
  document.getElementById('importConfirmBtn').style.display = 'none';
  document.getElementById('importBackBtn').style.display = 'none';
}

async function runImportConfirm() {
  if (!_importPreviewId) return toast('No preview data. Start over.', 'error');
  const btn = document.getElementById('importConfirmBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Importing...';

  try {
    const r = await api('/api/operators/import/confirm', {method: 'POST', body: JSON.stringify({
      preview_id: _importPreviewId,
      skip_existing: document.getElementById('importSkipExisting').checked,
      create_plans: document.getElementById('importCreatePlans').checked,
    })});

    // Show Step 3
    document.getElementById('importStep2').style.display = 'none';
    document.getElementById('importStep3').style.display = '';
    document.getElementById('importConfirmBtn').style.display = 'none';
    document.getElementById('importBackBtn').style.display = 'none';

    document.getElementById('importResultSummary').innerHTML = `
      <div style="text-align:center;padding:20px">
        <div style="font-size:48px;margin-bottom:8px">✅</div>
        <h3 style="color:#16a34a;margin-bottom:16px">Import Complete!</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:400px;margin:0 auto">
          <div style="background:#f0fdf4;border-radius:8px;padding:12px"><div style="font-size:24px;font-weight:700;color:#16a34a">${r.created}</div><div style="font-size:12px;color:#6b7280">Created</div></div>
          <div style="background:#f9fafb;border-radius:8px;padding:12px"><div style="font-size:24px;font-weight:700;color:#6b7280">${r.skipped}</div><div style="font-size:12px;color:#6b7280">Skipped</div></div>
          <div style="background:${r.errors.length > 0 ? '#fef2f2' : '#f9fafb'};border-radius:8px;padding:12px"><div style="font-size:24px;font-weight:700;color:${r.errors.length > 0 ? '#dc2626' : '#6b7280'}">${r.errors.length}</div><div style="font-size:12px;color:#6b7280">Errors</div></div>
        </div>
        ${r.errors.length > 0 ? `<div style="margin-top:12px;font-size:12px;color:#7f1d1d;text-align:left;background:#fef2f2;padding:8px;border-radius:8px">${r.errors.map(e => `<div>• ${e}</div>`).join('')}</div>` : ''}
      </div>`;

    loadOperators(); // Refresh operator stats
    _importPreviewId = null;
  } catch(e) {
    toast('Import failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✅ Confirm Import';
  }
}

async function suspendOperator(id, name) {
  if (!confirm(`Suspend "${name}"? Their staff will be deactivated.`)) return;
  try {
    const r = await api(`/api/operators/${id}`, {method: 'DELETE'});
    toast(r.message, 'success');
    loadOperators();
  } catch(e) { toast('Failed: ' + e.message, 'error'); }
}

async function reactivateOperator(id, name) {
  try {
    const r = await api(`/api/operators/${id}`, {method: 'PUT', body: JSON.stringify({status: 'active'})});
    toast(`Operator "${name}" reactivated`, 'success');
    loadOperators();
  } catch(e) { toast('Failed: ' + e.message, 'error'); }
}

async function resetOpPwd(id, name) {
  const pwd = prompt(`Enter new password for "${name}"'s admin:`);
  if (!pwd || pwd.length < 6) return toast('Password must be at least 6 chars', 'error');
  try {
    const r = await api(`/api/operators/${id}/reset-admin-password?new_password=${encodeURIComponent(pwd)}`, {method: 'POST'});
    toast(r.message, 'success');
  } catch(e) { toast('Failed: ' + e.message, 'error'); }
}

// INIT
// Apply admin role temporarily so page renders immediately while /api/me loads
applyRoleAccess({role: 'admin', permissions: null});

api('/api/me').then(u => {
  if (u.name) { document.getElementById('userName').textContent = u.name; document.getElementById('userAvatar').textContent = u.name[0].toUpperCase(); }
  if (u.role) document.getElementById('userRole').textContent = u.role;
  applyRoleAccess(u);
  
  // Reload dashboard if role changed from the default 'admin'
  if (_userRole === 'master') loadDashboard();
  // For agents, re-render dashboard with restricted data
  if (_userRole === 'service_agent' || _userRole === 'collection_agent' || _userRole === 'agent') loadDashboard();
  
  // Initialize push notifications
  initPushNotifications();
  
  // Redirect to allowed page if current page is not accessible
  const allowed = {
    'master': ['dashboard','customers','add-customer','plans','payments','unpaid','not-renewed','employees','surrender-req','service-requests','operators','reports','settings'],
    'admin': ['dashboard','customers','add-customer','plans','payments','employees','surrender-req','service-requests','reports','settings'],
    'collection_agent': ['payments','reports'],
    'agent': ['payments','reports'],
    'service_agent': ['dashboard','customers','add-customer','payments','service-requests','reports'],
    'support': ['dashboard','customers','add-customer','payments','service-requests','reports']
  };
  const myAllowed = allowed[(u.role || 'agent').toLowerCase()] || allowed['agent'];
  const activePage = document.querySelector('.page.active');
  if (activePage) {
    const pageId = activePage.id.replace('page-', '');
    if (!myAllowed.includes(pageId)) {
      showPage(myAllowed[0]);
    }
  }
}).catch(() => {
  // Auth failed — redirect to login instead of showing admin UI
  localStorage.removeItem('token');
  sessionStorage.setItem('logoutMsg', 'Session expired. Please login again.');
  window.location.href = '/index.html';
});

loadDashboard();

// ===== AGENT MY COLLECTIONS PAGE =====
let _myCollPage = 1;

let _collRange = 'month';

function setCollRange(range, btn) {
  _collRange = range;
  document.querySelectorAll('.chip-bar .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  const customDiv = document.getElementById('myCollCustomDates');
  if (range === 'custom') {
    customDiv.style.display = '';
    return;
  }
  customDiv.style.display = 'none';
  loadMyCollections(1);
}

function getCollDates() {
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  const fmt = dt => dt.toISOString().split('T')[0];
  switch (_collRange) {
    case 'today':
      return { from: fmt(today), to: fmt(today) };
    case 'week': {
      const day = today.getDay();
      const mon = new Date(y, m, d - (day === 0 ? 6 : day - 1));
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return { from: fmt(mon), to: fmt(sun) };
    }
    case 'month':
      return { from: fmt(new Date(y, m, 1)), to: fmt(new Date(y, m + 1, 0)) };
    case 'lastmonth':
      return { from: fmt(new Date(y, m - 1, 1)), to: fmt(new Date(y, m, 0)) };
    case 'custom':
      return { from: document.getElementById('myCollFrom')?.value || '', to: document.getElementById('myCollTo')?.value || '' };
    default:
      return { from: '', to: '' };
  }
}

function loadMyCollections(page = 1) {
  _myCollPage = page;
  const { from, to } = getCollDates();
  
  api(`/api/reports/my-collections?from_date=${from}&to_date=${to}&page=${page}&per_page=20`)
    .then(data => {
      document.getElementById('myCollTotal').textContent = fmtRs(data.total_collected);
      document.getElementById('myCollCount').textContent = data.payment_count;
      document.getElementById('myCollAgent').textContent = data.agent_name || 'Agent';
      
      const tbody = document.getElementById('myCollBody');
      if (!data.payments || data.payments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>No payments found for this period</p></td></tr>';
      } else {
        tbody.innerHTML = data.payments.map((p, i) => 
          '<tr>' +
          '<td>' + ((page - 1) * 20 + i + 1) + '</td>' +
          '<td>' + esc(p.customer_name) + '</td>' +
          '<td>' + esc(p.area) + '</td>' +
          '<td><strong>' + fmtRs(p.amount) + '</strong></td>' +
          '<td>' + esc(p.mode) + '</td>' +
          '<td>' + fmtDateTime(p.date) + '</td>' +
          '</tr>'
        ).join('');
      }
      
      const total = data.payment_count;
      const perPage = data.per_page;
      const totalPages = Math.ceil(total / perPage);
      const pag = document.getElementById('myCollPagination');
      
      if (totalPages <= 1) { pag.innerHTML = ''; return; }
      
      let html = '';
      if (page > 1) html += '<button onclick="loadMyCollections(' + (page - 1) + ')" class="btn btn-outline btn-sm">← Prev</button> ';
      html += '<span style="margin:0 8px;font-size:13px;color:var(--text-light)">Page ' + page + ' of ' + totalPages + '</span> ';
      if (page < totalPages) html += '<button onclick="loadMyCollections(' + (page + 1) + ')" class="btn btn-outline btn-sm">Next →</button>';
      pag.innerHTML = html;
    })
    .catch(() => {
      document.getElementById('myCollBody').innerHTML = '<tr><td colspan="6" class="empty-state"><p>Failed to load data</p></td></tr>';
    });
}

// ===== UNPAID CUSTOMERS =====
let _unpDebounce = null;
function debounceUnpaid() {
  clearTimeout(_unpDebounce);
  _unpDebounce = setTimeout(() => loadUnpaid(1), 400);
}

// ── Unpaid Period Filter ──────────────────────────────────────────────
let _unpAsOf = ''; // empty = today

function setUnpPeriod(period, btn) {
  document.querySelectorAll('[data-period]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('unpDate').value = '';
  const d = new Date();
  if (period === 'today') { _unpAsOf = ''; }
  else if (period === 'last1') { d.setMonth(d.getMonth() - 1); _unpAsOf = d.toISOString().slice(0,10); }
  else if (period === 'last2') { d.setMonth(d.getMonth() - 2); _unpAsOf = d.toISOString().slice(0,10); }
  else if (period === 'last3') { d.setMonth(d.getMonth() - 3); _unpAsOf = d.toISOString().slice(0,10); }
  loadUnpaid(1);
}

function setUnpPeriodCustom(dateVal) {
  if (!dateVal) return;
  document.querySelectorAll('[data-period]').forEach(b => b.classList.remove('active'));
  _unpAsOf = dateVal;
  loadUnpaid(1);
}

function loadUnpaid(page = 1) {
  const q = document.getElementById('unpSearch').value.trim();
  const area = document.getElementById('unpArea').value;
  const perPage = document.getElementById('unpPerPage').value;
  
  let url = `/api/customers/unpaid?page=${page}&per_page=${perPage}`;
  if (q) url += `&q=${encodeURIComponent(q)}`;
  if (area) url += `&area=${encodeURIComponent(area)}`;
  if (_unpAsOf) url += `&as_of=${encodeURIComponent(_unpAsOf)}`;
  
  api(url).then(data => {
    // Stats
    const totalPending = data.customers.reduce((s, c) => s + c.pending_amount, 0);
    document.getElementById('unpCount').textContent = data.total;
    document.getElementById('unpTotalAmt').textContent = fmtRs(totalPending);
    
    // Populate area dropdown (first load)
    if (data.areas && data.areas.length > 0 && document.getElementById('unpArea').options.length <= 1) {
      const sel = document.getElementById('unpArea');
      data.areas.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a; opt.textContent = a;
        sel.appendChild(opt);
      });
    }
    
    // Table
    const tbody = document.getElementById('unpBody');
    if (!data.customers || data.customers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">✅ No unpaid customers for this period!</td></tr>';
    } else {
      tbody.innerHTML = data.customers.map((c, i) => {
        const phone = c.phone || '';
        const gapBadge = c.gap_months > 3 
          ? `<span style="color:var(--danger);font-weight:700">${c.gap_months}mo</span>` 
          : c.gap_months > 0 
            ? `<span style="color:var(--warning);font-weight:600">${c.gap_months}mo</span>` 
            : '<span style="color:var(--success)">Current</span>';
        const networkBadge = c.network && c.network !== 'GTPL' 
          ? ` <span style="font-size:10px;background:#e0e7ff;color:#4338ca;padding:1px 5px;border-radius:4px">${esc(c.network)}</span>` 
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
    const pag = document.getElementById('unpPagination');
    if (data.total_pages <= 1) { pag.innerHTML = ''; return; }
    let html = '';
    if (page > 1) html += '<button onclick="loadUnpaid(' + (page-1) + ')" class="btn btn-outline btn-sm">← Prev</button> ';
    html += '<span style="margin:0 8px;font-size:13px;color:var(--text-light)">' + ((page-1)*parseInt(perPage)+1) + '-' + Math.min(page*parseInt(perPage), data.total) + ' of ' + data.total + '</span> ';
    if (page < data.total_pages) html += '<button onclick="loadUnpaid(' + (page+1) + ')" class="btn btn-outline btn-sm">Next →</button>';
    pag.innerHTML = html;
  }).catch(() => {
    document.getElementById('unpBody').innerHTML = '<tr><td colspan="8" class="empty-state">Failed to load</td></tr>';
  });
}

// ── Not Renewed ────────────────────────────────────────────────────────
let _nrMonth = ''; // empty = last month (default)
let _nrDebounce = null;

function debounceNotRenewed() {
  clearTimeout(_nrDebounce);
  _nrDebounce = setTimeout(() => loadNotRenewed(1), 400);
}

function setNrMonth(period, btn) {
  document.querySelectorAll('[data-nr]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('nrMonthPicker').value = '';
  const d = new Date();
  if (period === 'this') { _nrMonth = d.toISOString().slice(0,7); }
  else if (period === 'last1') { d.setMonth(d.getMonth() - 1); _nrMonth = d.toISOString().slice(0,7); }
  else if (period === 'last2') { d.setMonth(d.getMonth() - 2); _nrMonth = d.toISOString().slice(0,7); }
  else if (period === 'last3') { d.setMonth(d.getMonth() - 3); _nrMonth = d.toISOString().slice(0,7); }
  loadNotRenewed(1);
}

function setNrMonthCustom(val) {
  if (!val) return;
  document.querySelectorAll('[data-nr]').forEach(b => b.classList.remove('active'));
  _nrMonth = val;
  loadNotRenewed(1);
}

function loadNotRenewed(page = 1) {
  const q = document.getElementById('nrSearch').value.trim();
  const area = document.getElementById('nrArea').value;
  const mso = document.getElementById('nrMso').value;
  const perPage = document.getElementById('nrPerPage').value;

  let url = `/api/customers/not-renewed?page=${page}&per_page=${perPage}`;
  if (q) url += `&q=${encodeURIComponent(q)}`;
  if (area) url += `&area=${encodeURIComponent(area)}`;
  if (mso) url += `&mso=${encodeURIComponent(mso)}`;
  if (_nrMonth) url += `&month=${encodeURIComponent(_nrMonth)}`;

  api(url).then(data => {
    // Month label
    document.getElementById('nrMonthLabel').textContent = '— ' + data.month_label;
    // Stats — use backend aggregate (covers ALL pages)
    const totalRev = data.lost_revenue || 0;
    document.getElementById('nrCount').textContent = data.total;
    document.getElementById('nrTotalAmt').textContent = fmtRs(totalRev);

    // Populate area dropdown
    if (data.areas && data.areas.length > 0 && document.getElementById('nrArea').options.length <= 1) {
      const sel = document.getElementById('nrArea');
      data.areas.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a; opt.textContent = a;
        sel.appendChild(opt);
      });
    }

    // Populate MSO dropdown
    if (data.msos && data.msos.length > 0 && document.getElementById('nrMso').options.length <= 1) {
      const sel = document.getElementById('nrMso');
      data.msos.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m; sel.appendChild(o); });
    }

    // Table
    const tbody = document.getElementById('nrBody');
    if (!data.customers || data.customers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">✅ No dropped customers for ' + esc(data.month_label) + '!</td></tr>';
    } else {
      tbody.innerHTML = data.customers.map((c, i) => {
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
    const pag = document.getElementById('nrPagination');
    if (data.total_pages <= 1) { pag.innerHTML = ''; return; }
    let html = '';
    if (page > 1) html += '<button onclick="loadNotRenewed(' + (page-1) + ')" class="btn btn-outline btn-sm">← Prev</button> ';
    html += '<span style="margin:0 8px;font-size:13px;color:var(--text-light)">' + ((page-1)*parseInt(perPage)+1) + '-' + Math.min(page*parseInt(perPage), data.total) + ' of ' + data.total + '</span> ';
    if (page < data.total_pages) html += '<button onclick="loadNotRenewed(' + (page+1) + ')" class="btn btn-outline btn-sm">Next →</button>';
    pag.innerHTML = html;
  }).catch(() => {
    document.getElementById('nrBody').innerHTML = '<tr><td colspan="7" class="empty-state">Failed to load</td></tr>';
  });
}

// Mobile hamburger menu
const hamburgerBtn = document.getElementById('hamburgerBtn');
if (hamburgerBtn) {
  hamburgerBtn.addEventListener('click', () => { document.getElementById('sidebar').classList.toggle('open'); });
  document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const hamburger = document.getElementById('hamburgerBtn');
    if (sidebar && hamburger && !sidebar.contains(e.target) && !hamburger.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  });
  function updateHamburger() {
    const hamburger = document.getElementById('hamburgerBtn');
    if (hamburger) { hamburger.style.display = window.innerWidth <= 768 ? 'flex' : 'none'; }
  }
  updateHamburger();
  window.addEventListener('resize', updateHamburger);
}

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// PWA Install Prompt
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Show banner only on mobile and if not dismissed
  if (window.innerWidth <= 768 && !localStorage.getItem('pwaDismissed')) {
    setTimeout(() => {
      document.getElementById('pwaBanner').style.display = 'block';
    }, 3000);
  }
});

function installPWA() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
  }
  document.getElementById('pwaBanner').style.display = 'none';
}

function dismissPWA() {
  document.getElementById('pwaBanner').style.display = 'none';
  localStorage.setItem('pwaDismissed', '1');
}

// ===== DARK MODE =====
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('darkMode', isDark ? '1' : '0');
  document.getElementById('darkModeBtn').textContent = isDark ? '☀️' : '🌙';
  document.querySelector('meta[name="theme-color"]').setAttribute('content', isDark ? '#0d0d0f' : '#4f46e5');
}

// Apply saved dark mode on load
(function() {
  if (localStorage.getItem('darkMode') === '1') {
    document.body.classList.add('dark-mode');
    const btn = document.getElementById('darkModeBtn');
    if (btn) btn.textContent = '☀️';
  }
})();

// ===== MONTH-OVER-MONTH TREND CHART =====
async function loadMomTrend() {
  const months = document.getElementById('momMonthsSelect')?.value || 6;
  const container = document.getElementById('momChart');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-light);font-size:13px">Loading...</p>';
  try {
    const data = await api('/api/reports/mom-trend?months=' + months);
    const items = data.data || [];
    if (!items.length) { container.innerHTML = '<p style="color:var(--text-light)">No data</p>'; return; }

    const maxVal = Math.max(...items.map(i => i.total), 1);
    const barH = 120;

    let html = '<div style="display:flex;align-items:flex-end;gap:8px;height:' + (barH+60) + 'px;overflow-x:auto;padding-bottom:8px">';
    items.forEach(item => {
      const localH = Math.max(4, Math.round((item.local / maxVal) * barH));
      const ppH = Math.max(0, Math.round((item.paypakka / maxVal) * barH));
      const totalH = localH + ppH;
      html += '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:48px">';
      html += '<div style="font-size:10px;font-weight:600;color:var(--text)">₹' + (item.total >= 1000 ? (item.total/1000).toFixed(1) + 'k' : item.total) + '</div>';
      html += '<div style="display:flex;flex-direction:column;justify-content:flex-end;height:' + barH + 'px;width:100%;max-width:56px;border-radius:6px 6px 0 0;overflow:hidden">';
      if (ppH > 0) html += '<div style="height:' + ppH + 'px;background:rgba(90,200,250,0.7)" title="Paypakka: ₹' + item.paypakka + '"></div>';
      html += '<div style="height:' + localH + 'px;background:var(--primary)" title="Local: ₹' + item.local + '"></div>';
      html += '</div>';
      html += '<div style="font-size:9px;color:var(--text-light);text-align:center;white-space:nowrap">' + item.month.replace(' ', '<br>') + '</div>';
      html += '</div>';
    });
    html += '</div>';
    html += '<div style="display:flex;gap:16px;margin-top:8px;font-size:11px"><span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:12px;background:var(--primary);border-radius:2px;display:inline-block"></span>Local</span><span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:12px;background:rgba(90,200,250,0.7);border-radius:2px;display:inline-block"></span>Paypakka</span></div>';
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<p style="color:var(--danger);font-size:13px">Failed to load trend data</p>';
  }
}

// ===== AUDIT LOG PAGE =====
let _auditPage = 1;

async function loadAuditLog(page) {
  _auditPage = page || 1;
  const entity = document.getElementById('auditEntityFilter')?.value || '';
  const action = document.getElementById('auditActionFilter')?.value || '';
  const body = document.getElementById('auditLogBody');
  const pgn = document.getElementById('auditLogPagination');
  if (!body) return;
  body.innerHTML = '<p style="color:var(--text-light)">Loading...</p>';

  try {
    let url = '/api/reports/audit-log?page=' + _auditPage + '&per_page=50';
    if (entity) url += '&entity=' + encodeURIComponent(entity);
    if (action) url += '&action=' + encodeURIComponent(action);
    const data = await api(url);
    const entries = data.entries || [];

    if (!entries.length) {
      body.innerHTML = '<p class="empty-state">No audit entries found.</p>';
      if (pgn) pgn.innerHTML = '';
      return;
    }

    const actionLabels = {
      payment_create: '💳 Payment Created',
      payment_delete: '🗑 Payment Deleted',
      customer_create: '👤 Customer Created',
      customer_update: '✏️ Customer Updated',
      customer_delete: '❌ Customer Deleted',
    };

    let html = '<div class="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Entity</th><th>ID</th><th>By</th><th>Details</th></tr></thead><tbody>';
    entries.forEach(e => {
      const dt = e.created_at ? new Date(e.created_at).toLocaleString('en-IN') : '--';
      const actionLabel = actionLabels[e.action] || e.action;
      const badgeColor = e.action.includes('delete') ? 'badge-danger' : e.action.includes('create') ? 'badge-success' : 'badge-primary';
      let detail = '';
      try {
        if (e.action === 'payment_delete' && e.old_value) {
          const old = JSON.parse(e.old_value);
          detail = 'Amt: ₹' + (old.amount || 0) + (e.new_value ? ' | Reason: ' + (JSON.parse(e.new_value).reason || 'N/A') : '');
        } else if (e.new_value) {
          const nv = JSON.parse(e.new_value);
          detail = Object.entries(nv).slice(0,3).map(([k,v]) => k + ': ' + v).join(', ');
        }
      } catch(ex) {}
      html += '<tr><td style="font-size:12px;white-space:nowrap">' + dt + '</td>';
      html += '<td><span class="badge ' + badgeColor + '">' + actionLabel + '</span></td>';
      html += '<td>' + esc(e.entity) + '</td>';
      html += '<td style="font-size:12px;font-family:monospace">' + esc(e.entity_id || '--') + '</td>';
      html += '<td>' + esc(e.performed_by_name || 'System') + '</td>';
      html += '<td style="font-size:12px;color:var(--text-light);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escAttr(detail) + '">' + esc(detail) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    body.innerHTML = html;

    // Pagination
    const totalPages = Math.ceil(data.total / 50);
    if (pgn) {
      let pHtml = '<div class="pagination">';
      for (let i = 1; i <= Math.min(totalPages, 20); i++) {
        pHtml += '<button onclick="loadAuditLog(' + i + ')" class="' + (i === _auditPage ? 'active' : '') + '">' + i + '</button>';
      }
      pHtml += '</div>';
      pgn.innerHTML = totalPages > 1 ? pHtml : '';
    }
  } catch(e) {
    body.innerHTML = '<p style="color:var(--danger)">Error: ' + esc(e.message) + '</p>';
  }
}

// ===== PRINT RECEIPT =====
function printPaymentReceipt(data) {
  var w = window.open('', '_blank', 'width=400,height=600');
  var dt = data.date ? new Date(data.date).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}) : new Date().toLocaleDateString('en-IN');
  var amt = (data.amount||0).toLocaleString('en-IN');
  var html = '<!DOCTYPE html><html><head><title>Payment Receipt</title>'
    + '<style>'
    + 'body{font-family:Arial,sans-serif;padding:20px;font-size:13px;color:#000;max-width:320px;margin:0 auto}'
    + '.logo{text-align:center;font-weight:700;font-size:16px;margin-bottom:4px}'
    + '.sub{text-align:center;font-size:11px;color:#555;margin-bottom:16px}'
    + '.divider{border-top:1px dashed #999;margin:12px 0}'
    + '.row{display:flex;justify-content:space-between;margin:5px 0}'
    + '.label{color:#555}.value{font-weight:600}'
    + '.total-row{font-size:16px;font-weight:700;margin:8px 0}'
    + '.footer{text-align:center;font-size:10px;color:#888;margin-top:16px}'
    + '@media print{.no-print{display:none}}'
    + '</style></' + 'head><' + 'body>'
    + '<div class="logo">Wasool</div>'
    + '<div class="sub">Payment Receipt</div>'
    + '<div class="divider"></div>'
    + '<div class="row"><span class="label">Customer</span><span class="value">' + (data.customer_name||'') + '</span></div>'
    + '<div class="row"><span class="label">Customer ID</span><span class="value">' + (data.customer_id||'') + '</span></div>'
    + '<div class="row"><span class="label">STB No</span><span class="value">' + (data.stb_no||'--') + '</span></div>'
    + '<div class="row"><span class="label">Date</span><span class="value">' + dt + '</span></div>'
    + '<div class="row"><span class="label">Mode</span><span class="value">' + (data.payment_mode||'Cash') + '</span></div>'
    + '<div class="row"><span class="label">Collector</span><span class="value">' + (data.collector||'') + '</span></div>'
    + '<div class="divider"></div>'
    + '<div class="row total-row"><span>Amount Paid</span><span>\u20B9' + amt + '</span></div>'
    + '<div class="divider"></div>'
    + '<div class="footer">Thank you for your payment!</div>'
    + '<br><button class="no-print" onclick="window.print()" style="width:100%;padding:8px;background:#0071e3;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px">🖨 Print</button>'
    + '</' + 'body></' + 'html>';
  w.document.write(html);
  w.document.close();
}

// ── GTPL Integration ─────────────────────────────────────────────
const _gtplLocks = new Set();

async function gtplSuspend(stbNo, custName) {
  if (_gtplLocks.has(stbNo)) { toast('⏳ STB ' + stbNo + ' is already being processed', 'error'); return; }
  if (!confirm('⛔ Suspend STB ' + stbNo + ' on GTPL?\n\nCustomer: ' + custName + '\nThis will cut their cable TV signal immediately.')) return;
  _gtplLocks.add(stbNo);
  const btn = event?.target?.closest?.('button') || event?.target;
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    toast('Suspending ' + stbNo + ' on GTPL...', 'info');
    const r = await api('/api/gtpl/suspend', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ stb_no: stbNo })
    });
    if (r.success) toast('✅ ' + r.message, 'success');
    else { toast('❌ ' + (r.message || 'Suspend failed'), 'error'); if (btn) { btn.disabled = false; btn.textContent = '⛔ Suspend'; } }
  } catch (e) {
    toast('❌ GTPL suspend error: ' + (e.detail || e.message), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '⛔ Suspend'; }
  } finally { _gtplLocks.delete(stbNo); }
}

async function gtplActivate(stbNo, custName) {
  if (_gtplLocks.has(stbNo)) { toast('⏳ STB ' + stbNo + ' is already being processed', 'error'); return; }
  _gtplLocks.add(stbNo);
  const btn = event?.target?.closest?.('button') || event?.target;
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    // Check current status first
    toast('Checking GTPL status...', 'info');
    const st = await api('/api/gtpl/status/' + stbNo);
    if (st.success && st.status === 'ACTIVE') {
      toast('✅ Customer already activated on GTPL', 'error');
      if (btn) { btn.disabled = true; btn.textContent = '✅ Active'; btn.style.background = '#6c757d'; }
      return;
    }
  } catch(e) { /* status check failed, proceed anyway */ }

  if (!confirm('✅ Activate STB ' + stbNo + ' on GTPL?\n\nCustomer: ' + custName + '\nThis will restore their cable TV signal.')) {
    if (btn) { btn.disabled = false; btn.textContent = '✅ Activate'; }
    return;
  }
  try {
    toast('Activating ' + stbNo + ' on GTPL...', 'info');
    const r = await api('/api/gtpl/activate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ stb_no: stbNo })
    });
    if (r.success) {
      toast('✅ ' + r.message, 'success');
      if (btn) { btn.textContent = '✅ Activated'; btn.style.background = '#6c757d'; }
    } else {
      toast('❌ ' + (r.message || 'Activate failed'), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '✅ Activate'; }
    }
  } catch (e) {
    toast('❌ GTPL activate error: ' + (e.detail || e.message), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✅ Activate'; }
  } finally { _gtplLocks.delete(stbNo); }
}

function openGtplRenewModal(stbNo, custName) {
  document.getElementById('gtplRenewStb').textContent = stbNo;
  document.getElementById('gtplRenewCust').textContent = custName;
  document.getElementById('gtplRenewMonths').value = '1';
  document.getElementById('gtplRenewBtn').disabled = false;
  document.getElementById('gtplRenewBtn').textContent = '🔁 Renew';
  document.getElementById('gtplRenewOverlay').classList.add('show');
}
function closeGtplRenewModal() { document.getElementById('gtplRenewOverlay').classList.remove('show'); }

async function doGtplRenew() {
  const stbNo = document.getElementById('gtplRenewStb').textContent;
  const months = parseInt(document.getElementById('gtplRenewMonths').value);
  const btn = document.getElementById('gtplRenewBtn');
  if (!confirm('🔁 Renew STB ' + stbNo + ' for ' + months + ' month(s) on GTPL?\n\nAmount will be deducted from your GTPL wallet.')) return;
  btn.disabled = true; btn.textContent = '⏳ Processing...';
  try {
    const r = await api('/api/gtpl/renew', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ stb_no: stbNo, months: months, customer_id: _custData.customer_id })
    });
    toast('✅ ' + (r.message || 'Renewal successful'), 'success');
    closeGtplRenewModal();
    await viewCustomer(_custData.customer_id);
  } catch (e) {
    toast('❌ ' + (e.detail || e.message || 'GTPL renewal failed'), 'error');
    btn.disabled = false; btn.textContent = '🔁 Renew';
  }
}

async function openGtplPackModal(stbNo, custName, currentPlan) {
  document.getElementById('gtplPackStb').textContent = stbNo;
  document.getElementById('gtplPackCust').textContent = custName;
  document.getElementById('gtplPackCurrent').textContent = currentPlan || 'Unknown';
  document.getElementById('gtplPackBtn').disabled = false;
  document.getElementById('gtplPackBtn').textContent = '📦 Change Pack';
  const sel = document.getElementById('gtplPackSelect');
  const loading = document.getElementById('gtplPackLoading');
  sel.innerHTML = '<option value="">Loading packs from GTPL...</option>';
  loading.textContent = '';
  document.getElementById('gtplPackOverlay').classList.add('show');
  try {
    const r = await api('/api/gtpl/plans');
    const plans = r.plans || [];
    sel.innerHTML = '<option value="">-- Select new pack --</option>';
    plans.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.code;
      opt.textContent = p.name;
      if (p.name === currentPlan) opt.textContent += ' (current)';
      sel.appendChild(opt);
    });
    if (!plans.length) loading.textContent = 'No GTPL plans available';
  } catch (e) {
    sel.innerHTML = '<option value="">Failed to load plans</option>';
    loading.textContent = 'Error: ' + (e.detail || e.message || 'unknown');
  }
}
function closeGtplPackModal() { document.getElementById('gtplPackOverlay').classList.remove('show'); }

async function doGtplPackChange() {
  const stbNo = document.getElementById('gtplPackStb').textContent;
  const planCode = document.getElementById('gtplPackSelect').value;
  const planName = document.getElementById('gtplPackSelect').options[document.getElementById('gtplPackSelect').selectedIndex].text;
  if (!planCode) { toast('Please select a new pack', 'error'); return; }
  const btn = document.getElementById('gtplPackBtn');
  if (!confirm('📦 Change pack for STB ' + stbNo + ' to:\n' + planName + '?\n\nThis will change the package on GTPL portal.')) return;
  btn.disabled = true; btn.textContent = '⏳ Processing...';
  try {
    const r = await api('/api/gtpl/change-plan', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ stb_no: stbNo, plan_code: planCode, customer_id: _custData.customer_id })
    });
    toast('✅ ' + (r.message || 'Pack changed successfully'), 'success');
    closeGtplPackModal();
    await viewCustomer(_custData.customer_id);
  } catch (e) {
    toast('❌ ' + (e.detail || e.message || 'Pack change failed'), 'error');
    btn.disabled = false; btn.textContent = '📦 Change Pack';
  }
}

