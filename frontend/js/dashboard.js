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

