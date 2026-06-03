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

