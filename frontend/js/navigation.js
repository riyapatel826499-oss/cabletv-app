
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
  const pageMap = {'dashboard':0,'payments':1,'customers':2,'reports':3};
  const idx = pageMap[page];
  document.querySelectorAll('.mob-nav-item').forEach((b,i) => b.classList.toggle('active', i === idx));
};

// Save current page to URL hash for refresh persistence
const _origShowPage3 = showPage;
showPage = function(page) {
  _origShowPage3(page);
  history.replaceState(null, '', '#' + page);
};

// Restore page from URL hash on refresh
(function() {
  const hashPage = location.hash.slice(1);
  const validPages = ['dashboard','customers','add-customer','plans','payments','unpaid','not-renewed','employees','surrender-req','service-requests','reports','reminders','audit','settings','operators','my-collections'];
  if (hashPage && validPages.includes(hashPage)) {
    showPage(hashPage);
  }
  // No hash = first visit. Dashboard is already active (HTML default).
})();

