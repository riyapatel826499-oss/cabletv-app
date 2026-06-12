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
    'master': ['dashboard','customers','add-customer','plans','payments','employees','surrender-req','service-requests','operators','reports','settings'],
    'admin': ['dashboard','customers','add-customer','plans','payments','employees','surrender-req','service-requests','reports','settings'],
    'collection_agent': ['payments','reports'],
    'agent': ['payments','reports'],
    'service_agent': ['dashboard','customers','add-customer','payments','service-requests','reports','surrender-req'],
    'support': ['dashboard','customers','add-customer','payments','service-requests','reports','surrender-req']
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
  navigator.serviceWorker.register('/sw.js').then(reg => {
    // Check for push notification support
    if ('PushManager' in window && 'Notification' in window) {
      const bellBtn = document.getElementById('pushBellBtn');
      if (bellBtn) {
        bellBtn.style.display = '';
        // Update bell icon based on permission
        function updateBellIcon() {
          bellBtn.textContent = Notification.permission === 'granted' ? '🔔' : '🔕';
        }
        updateBellIcon();
      }
    }
  }).catch(() => {});
}

// PWA Install Prompt
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Show banner if not dismissed (both mobile and desktop)
  if (!localStorage.getItem('pwaDismissed')) {
    setTimeout(() => {
      const banner = document.getElementById('pwaBanner');
      if (banner) banner.style.display = 'block';
    }, 3000);
  }
});

// Hide banner after install
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  const banner = document.getElementById('pwaBanner');
  if (banner) banner.style.display = 'none';
  toast('App installed successfully!', 'success');
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
  document.querySelector('meta[name="theme-color"]').setAttribute('content', isDark ? '#0d0d0f' : '#0071e3');
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
    + '<div class="row"><span class="label">Customer</span><span class="value">' + esc(data.customer_name||'') + '</span></div>'
    + '<div class="row"><span class="label">Customer ID</span><span class="value">' + esc(data.customer_id||'') + '</span></div>'
    + '<div class="row"><span class="label">STB No</span><span class="value">' + esc(data.stb_no||'--') + '</span></div>'
    + '<div class="row"><span class="label">Date</span><span class="value">' + esc(dt) + '</span></div>'
    + '<div class="row"><span class="label">Mode</span><span class="value">' + esc(data.payment_mode||'Cash') + '</span></div>'
    + '<div class="row"><span class="label">Collector</span><span class="value">' + esc(data.collector||'') + '</span></div>'
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


// Clear search input and re-trigger search
function clearSearch(inputId, callbackName, passValue) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.value = '';
  // hide the X button
  const wrap = input.closest('.search-clear-wrap');
  if (wrap) wrap.classList.remove('has-value');
  // trigger the search callback
  if (passValue) {
    window[callbackName]('');
  } else {
    const fn = window[callbackName];
    if (typeof fn === 'function') fn();
  }
  input.focus();
}

// Show/hide clear button on input
document.addEventListener('input', function(e) {
  const wrap = e.target.closest('.search-clear-wrap');
  if (!wrap) return;
  if (e.target.value.length > 0) wrap.classList.add('has-value');
  else wrap.classList.remove('has-value');
});


