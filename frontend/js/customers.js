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
        let actions = '<div class="row-actions">';
        if (currentFilter === 'paid') {
          actions += '<button class="btn btn-outline btn-sm" title="Edit Customer" onclick="editCustomer(\'' + escAttr(c.customer_id || c.id) + '\')">✏️</button>';
        } else {
          actions += '<button class="btn btn-outline btn-sm" title="Edit Customer" onclick="editCustomer(\'' + escAttr(c.customer_id || c.id) + '\')">✏️</button>';
          actions += '<button class="btn btn-outline btn-sm" style="color:var(--danger)" title="Delete Customer" onclick="deleteCustomer(\'' + escAttr(c.customer_id || c.id) + '\',\'' + escAttr(c.name || '') + '\')">🗑</button>';
        }
        if (c.status === 'Surrendered') {
          actions += '<button class="btn btn-success btn-sm" title="Reactivate Customer" onclick="reactivateCustomer(\'' + escAttr(c.customer_id || c.id) + '\')">↩️ Reactivate</button>';
        } else if (c.status === 'Temp Disconnected') {
          actions += '<button class="btn btn-primary btn-sm" title="Reconnect" onclick="openReconnectModal(\'' + escAttr(c.customer_id || c.id) + '\',\'' + escAttr(c.name || '') + '\')">⚡ Reconnect</button>';
          actions += '<button class="btn btn-danger btn-sm" style="font-weight:600" title="Surrender" onclick="openSurrenderModal(\'' + escAttr(c.customer_id || c.id) + '\',\'' + escAttr(c.name || '') + '\')">⏹ Surrender</button>';
        } else if (c.status === 'Active') {
          actions += '<button class="btn btn-danger btn-sm" style="font-weight:600" title="Surrender Customer" onclick="openSurrenderModal(\'' + escAttr(c.customer_id || c.id) + '\',\'' + escAttr(c.name || '') + '\')">⏹ Surrender</button>';
        }
        return '<tr><td><strong>' + esc(c.customer_id || '--') + '</strong></td><td><a href="#" class="cust-name-link" onclick="event.preventDefault();viewCustomer(\'' + escAttr(c.customer_id || c.id) + '\')">' + esc(c.name || '--') + '</a></td><td>' + stbBadge + '</td><td>' + esc(c.phone || '--') + '</td><td>' + esc(c.area || '--') + '</td><td>' + statusBadge + '</td><td>' + paidBadge + '</td><td>' + actions + '</div></td></tr>';
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
          return '<tr><td><strong>' + esc(c.customer_id || '--') + '</strong></td><td><a href="#" class="cust-name-link" onclick="event.preventDefault();viewCustomer(\'' + escAttr(c.customer_id || c.id) + '\')">' + esc(c.name || '--') + '</a></td><td>' + stbBadge + '</td><td>' + esc(c.phone || '--') + '</td><td>' + esc(c.area || '--') + '</td><td><span class="badge ' + (c.status === 'Active' ? 'badge-success' : 'badge-danger') + '">' + escAttr(c.status || '--') + '</span></td><td><span class="badge ' + (c.is_paid ? 'badge-success' : 'badge-danger') + '">' + (c.is_paid ? 'Paid' : 'Unpaid') + '</span></td><td><button class="btn btn-outline btn-sm" title="Edit Customer" onclick="editCustomer(\'' + escAttr(c.customer_id || c.id) + '\')\">✏️</button><button class="btn btn-outline btn-sm" style="color:var(--danger)" title="Delete Customer" onclick="deleteCustomer(\'' + escAttr(c.customer_id || c.id) + '\',\'' + escAttr(c.name || '') + '\')">🗑</button></td></tr>';
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
      document.getElementById('custDetailFooter').innerHTML = '<button class="btn btn-success" onclick="reactivateCustomer(\'' + escAttr(id) + '\')">↩️ Reactivate</button>';
    } else if (c.status === 'Temp Disconnected') {
      document.getElementById('custDetailFooter').innerHTML = '<button class="btn btn-primary" onclick="openReconnectModal(\'' + escAttr(id) + '\',\'' + escAttr(c.name || '') + '\')">⚡ Reconnect</button> <button class="btn btn-danger" style="font-weight:600" onclick="openSurrenderModal(\'' + escAttr(id) + '\',\'' + escAttr(c.name || '') + '\')">⏹ Surrender</button>';
    } else if (c.status === 'Active') {
      document.getElementById('custDetailFooter').innerHTML = '<button class="btn btn-danger" style="font-weight:600" onclick="openSurrenderModal(\'' + escAttr(id) + '\',\'' + escAttr(c.name || '') + '\')">⏹ Surrender</button>';
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
    } else if (cn.status === 'Surrendered') {
      html += '<button class="btn btn-outline btn-sm" style="color:var(--success)" onclick="openRestoreModal(\'' + escAttr(cn.id) + '\',\'' + escAttr(_custData.customer_id) + '\',\'' + escAttr(_custData.name || '') + '\')">📦 Restore STB</button>';
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

// ── Restore STB from Inventory (for Surrendered connections) ────
let _restoreSelectedStb = '';

function openRestoreModal(connId, custId, custName) {
  _restoreSelectedStb = '';
  document.getElementById('restoreConnId').value = connId;
  document.getElementById('restoreCustId').value = custId;
  document.getElementById('restoreCustName').textContent = custName;
  document.getElementById('restoreAvailStbs').innerHTML = '<p style="color:var(--muted);font-size:0.9em">Loading available STBs...</p>';
  document.getElementById('restoreSelectedStb').style.display = 'none';
  document.getElementById('restoreSelectedStbNo').textContent = '--';
  document.getElementById('restoreOverlay').classList.add('show');
  loadRestoreAvailStbs();
}
function closeRestoreModal() { document.getElementById('restoreOverlay').classList.remove('show'); }

async function loadRestoreAvailStbs() {
  try {
    const d = await api('/api/stb-inventory?status=available');
    const stbs = (d.items || d.inventory || []);
    const el = document.getElementById('restoreAvailStbs');
    if (!stbs.length) {
      el.innerHTML = '<p style="color:var(--danger);font-size:0.9em">No STBs available in inventory. Add STBs to inventory first.</p>';
      return;
    }
    let html = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">';
    stbs.forEach(s => {
      html += '<button type="button" class="btn btn-outline btn-sm" data-stb="' + escAttr(s.stb_no) + '" onclick="selectRestoreStb(this,\'' + escAttr(s.stb_no) + '\')">' + esc(s.stb_no) + (s.notes ? ' <span style="color:var(--muted);font-size:0.8em">(' + esc(s.notes.substring(0, 30)) + ')</span>' : '') + '</button>';
    });
    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    document.getElementById('restoreAvailStbs').innerHTML = '<p style="color:var(--danger);font-size:0.9em">Could not load inventory.</p>';
  }
}

function selectRestoreStb(btn, stbNo) {
  _restoreSelectedStb = stbNo;
  // Highlight selected
  document.querySelectorAll('#restoreAvailStbs button').forEach(b => b.classList.remove('btn-primary'));
  btn.classList.add('btn-primary');
  // Show selected info
  document.getElementById('restoreSelectedStb').style.display = 'block';
  document.getElementById('restoreSelectedStbNo').textContent = stbNo;
}

async function doRestore() {
  const connId = parseInt(document.getElementById('restoreConnId').value);
  const custId = document.getElementById('restoreCustId').value;
  if (!_restoreSelectedStb) { toast('Please select an STB from inventory', 'error'); return; }
  try {
    const r = await api('/api/connections/restore', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ connection_id: connId, customer_id: custId, stb_no: _restoreSelectedStb })
    });
    toast(r.message || 'STB restored and connection activated!', 'success');
    closeRestoreModal();
    await viewCustomer(custId);
  } catch (e) {
    toast(e.detail || e.message || 'Restore failed', 'error');
  }
}


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

