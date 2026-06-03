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
    'admin': ['dashboard','customers','add-customer','plans','payments','employees','surrender-req','service-requests','reports','audit','settings'],
    'collection_agent': ['payments','reports'],
    'agent': ['payments','reports'],
    'service_agent': ['dashboard','customers','add-customer','payments','service-requests','reports','surrender-req'],
    'support': ['dashboard','customers','add-customer','payments','service-requests','reports','surrender-req']
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
  // Layout: 0=Home, 1=Collect, 2=Customers, 3=Reports, 4=More
  const mobPages = ['dashboard','payments','customers','reports'];
  const mobBtns = document.querySelectorAll('.mob-nav-item');
  mobBtns.forEach((btn, i) => {
    if (i === 4) {
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
