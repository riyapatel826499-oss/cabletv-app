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
      let nextM = curMonth + 1;
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
  const btn = document.querySelector('.pay-now-btn');
  if (btn && btn.disabled) return; // already submitting
  if (document.getElementById('payCustomerId').value === '') return toast('Select a customer first', 'warning');

  // Disable button immediately to prevent double-click
  if (btn) {
    btn.disabled = true;
    btn.dataset.origHtml = btn.innerHTML;
    btn.innerHTML = '⏳ Processing...';
    btn.style.opacity = '0.7';
    btn.style.pointerEvents = 'none';
  }

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
        // Re-enable button — user will re-submit via duplicate warning dialog
        if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.origHtml || '💳 Pay Now'; btn.style.opacity = ''; btn.style.pointerEvents = ''; }
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
    // Re-enable button (resetPayForm recreates form state)
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.origHtml || '💳 Pay Now'; btn.style.opacity = ''; btn.style.pointerEvents = ''; }
    loadAllPaymentHistory(1);
  } catch (e) {
    toast('Payment failed: ' + e.message, 'error');
    // Re-enable button on failure so they can retry
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.origHtml || '💳 Pay Now'; btn.style.opacity = ''; btn.style.pointerEvents = ''; }
  }
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
  const selectEl = document.getElementById('payPerPage');
  const perPage = parseInt(selectEl ? selectEl.value : '100');
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

