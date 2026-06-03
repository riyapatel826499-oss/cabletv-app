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

