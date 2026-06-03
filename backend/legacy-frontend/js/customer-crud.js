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
  // JS-side validation with clear messages (replaces silent HTML5 validation)
  const name = document.getElementById('custName').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const mso = document.getElementById('custMSO').value;
  const plan = document.getElementById('custPlan').value;
  const area = document.getElementById('custArea').value.trim();
  const stb = document.getElementById('custSTB').value;
  const activation = document.getElementById('custActivation').value;
  if (!name) { toast('Please enter customer name', 'error'); return; }
  if (!phone) { toast('Please enter phone number', 'error'); return; }
  if (!mso) { toast('Please select MSO', 'error'); return; }
  if (!plan) { toast('Please select a plan', 'error'); return; }
  if (!area) { toast('Please enter area', 'error'); return; }
  if (!stb) { toast('Please select an STB number', 'error'); return; }
  if (!activation) { toast('Please select activation date', 'error'); return; }
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
    if (result.status === 'pending_approval') {
      toast('Surrender request submitted. Awaiting admin approval.', 'info');
    } else {
      toast('Customer surrendered successfully!', 'success');
    }
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

