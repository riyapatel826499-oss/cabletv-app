import api from './client';
import type { Customer, Connection, Payment, Plan } from '../types';

// ── Customers ────────────────────────────────────────────────────────────
export const customersApi = {
  list: (params?: Record<string, string>) => api.get('/customers', { params }),
  get: (id: string) => api.get(`/customers/${id}`),
  create: (data: Partial<Customer>) => api.post('/customers', data),
  update: (id: string, data: Partial<Customer>) => api.put(`/customers/${id}`, data),
  search: (query: string) => api.get('/customers/search', { params: { q: query } }),
  unpaid: (params: Record<string, string>) => api.get('/customers/unpaid', { params }),
  tempDisconnected: () => api.get('/customers/temp-disconnected'),
  notRenewed: (month: string) => api.get('/customers/not-renewed', { params: { month } }),
  delete: (id: string) => api.delete(`/customers/${id}`),
  changePlan: (customerId: string, data: { plan_id: number }) =>
    api.put(`/customers/${customerId}/change-plan`, data),
};

// ── Connections ───────────────────────────────────────────────────────────
export const connectionsApi = {
  list: (params?: Record<string, string>) => api.get('/connections', { params }),
  create: (data: Partial<Connection>) => api.post('/connections', data),
  update: (id: number, data: Partial<Connection>) => api.put(`/connections/${id}`, data),
  disconnect: (id: number) => api.post(`/connections/${id}/disconnect`),
  reconnect: (data: { customer_id: string; stb_no: string; connection_id?: number }) =>
    api.post('/connections/reconnect', data),
  restore: (data: { connection_id: number; customer_id: string; stb_no: string }) =>
    api.post('/connections/restore', data),
  tempDisconnect: (data: { connection_id: number; reason?: string }) =>
    api.post('/connections/temp-disconnect', data),
  swapStb: (data: { connection_id: number; customer_id: string; new_stb_no: string; old_stb_notes?: string; sync_portal?: boolean }) =>
    api.post('/connections/swap-stb', data),
};

// ── Payments ──────────────────────────────────────────────────────────────
export const paymentsApi = {
  list: (params?: Record<string, string>) => api.get('/payments/all', { params }),
  create: (data: Partial<Payment>) => api.post('/payments', data),
  byMonth: (monthYear: string, page?: number) =>
    api.get('/payments/all', { params: { month_year: monthYear, page: page || 1 } }),
  history: (customerId: string) =>
    api.get('/payments/history', { params: { customer_id: customerId, per_page: '50' } }),
  delete: (id: number, reason?: string) => api.delete(`/payments/${id}`, { params: reason ? { reason } : undefined }),
};

// ── Reminders ─────────────────────────────────────────────────────────────
export const remindersApi = {
  due: () => api.get('/reminders/due'),
  send: (data: { customer_ids: string[]; message?: string }) => api.post('/reminders/send', data),
  history: () => api.get('/reminders/history'),
  status: () => api.get('/reminders/status'),
};

// ── Audit Log ─────────────────────────────────────────────────────────────
export const auditApi = {
  list: (params?: Record<string, string>) => api.get('/reports/audit-log', { params }),
};

// ── Dashboard ─────────────────────────────────────────────────────────────
export const dashboardApi = {
  stats: () => api.get('/dashboard/stats'),
  today: () => api.get('/dashboard/today'),
  paymentModes: () => api.get('/dashboard/payment-modes'),
  master: () => api.get('/dashboard/master'),
  insights: () => api.get('/dashboard/insights'),
  priorityUnpaid: (page = 1) => api.get('/dashboard/priority-unpaid', { params: { page } }),
};

// ── Plans ─────────────────────────────────────────────────────────────────
export const plansApi = {
  list: (params?: Record<string, string>) => api.get('/plans', { params }),
  create: (data: Partial<Plan>) => api.post('/plans', data),
  update: (id: number, data: Partial<Plan>) => api.put(`/plans/${id}`, data),
  delete: (id: number) => api.delete(`/plans/${id}`),
};

// ── Employees ─────────────────────────────────────────────────────────────
export const employeesApi = {
  list: () => api.get('/employees'),
  create: (data: { username: string; password: string; name: string; phone?: string; role: string }) =>
    api.post('/employees', data),
  update: (id: number, data: { name?: string; phone?: string; role?: string; status?: string }) =>
    api.put(`/employees/${id}`, data),
  resetPassword: (id: number, password: string) =>
    api.put(`/employees/${id}/password`, { password }),
  deactivate: (id: number) => api.delete(`/employees/${id}`),
  roles: () => api.get('/employees/roles'),
};

// ── Operators (master admin) ──────────────────────────────────────────────
export const operatorsApi = {
  list: () => api.get('/operators/'),
  get: (id: number) => api.get(`/operators/${id}`),
  create: (data: Record<string, unknown>) => api.post('/operators/', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/operators/${id}`, data),
  suspend: (id: number) => api.delete(`/operators/${id}`),
  resetPassword: (id: number, newPassword: string) =>
    api.post(`/operators/${id}/reset-admin-password`, null, { params: { new_password: newPassword } }),
};

// ── Service Requests ──────────────────────────────────────────────────────
export const serviceRequestsApi = {
  list: (params?: Record<string, string>) => api.get('/service-requests/', { params }),
  get: (ticketNo: string) => api.get(`/service-requests/${ticketNo}`),
  create: (data: { ticket_no: string; customer_id: string; type: string; category: string; priority: string; description: string }) =>
    api.post('/service-requests/', data),
  updateStatus: (ticketNo: string, status: string) =>
    api.put(`/service-requests/${ticketNo}/status`, { status }),
  assign: (ticketNo: string, assignedTo: number) =>
    api.put(`/service-requests/${ticketNo}/assign`, { assigned_to: assignedTo }),
  stats: () => api.get('/service-requests/stats/summary'),
};

// ── Reports ───────────────────────────────────────────────────────────────
export const reportsApi = {
  areaCollection: (params: { from_date: string; to_date: string }) =>
    api.get('/reports/area-collection', { params }),
  collectorPerformance: (params: { from_date: string; to_date: string }) =>
    api.get('/reports/collector-performance', { params }),
  msoSummary: (params: { from_date: string; to_date: string }) =>
    api.get('/reports/mso-summary', { params }),
  monthly: (monthYear: string) => api.get('/reports/monthly', { params: { month_year: monthYear } }),
  msoReconciliation: (monthYear: string) =>
    api.get('/reports/mso-reconciliation', { params: { month_year: monthYear } }),
  myCollections: (params?: Record<string, string>) =>
    api.get('/reports/my-collections', { params }),
  momTrend: (months: number) =>
    api.get('/reports/mom-trend', { params: { months } }),
};

// ── Surrenders ────────────────────────────────────────────────────────────
export const surrenderApi = {
  surrender: (customerId: string, reason?: string) =>
    api.post(`/customers/${customerId}/surrender`, { reason }),
  listRequests: (status?: string) =>
    api.get('/surrender-requests', { params: status ? { status } : undefined }),
  review: (requestId: number, action: string, notes?: string) =>
    api.post(`/surrender-requests/${requestId}/review`, { action, notes }),
  reactivate: (customerId: string) =>
    api.post(`/customers/${customerId}/reactivate`),
};

// ── STB Inventory & Exchange ──────────────────────────────────────────────
export const stbApi = {
  listInventory: (params?: Record<string, string>) => api.get('/stb-inventory', { params }),
  available: (params?: Record<string, string>) => api.get('/stb-inventory/available', { params }),
  add: (data: { stb_no: string; status?: string; notes?: string }) => api.post('/stb-inventory', data),
  update: (id: number, status: string) => api.patch(`/stb-inventory/${id}`, { status }),
  remove: (id: number) => api.delete(`/stb-inventory/${id}`),
  exchange: (customerId: string, connectionId: number, data: { new_stb_no: string; old_stb_status?: string; old_stb_notes?: string }) =>
    api.post(`/customers/${customerId}/connections/${connectionId}/exchange-stb`, data),
};

// ── GTPL ──────────────────────────────────────────────────────────────────
export const gtplApi = {
  suspend: (stbNo: string) => api.post('/gtpl/suspend', { stb_no: stbNo }),
  activate: (stbNo: string) => api.post('/gtpl/activate', { stb_no: stbNo }),
  renew: (stbNo: string, months: number) => api.post('/gtpl/renew', { stb_no: stbNo, months }),
  changePlan: (stbNo: string, planCode: string) => api.post('/gtpl/change-plan', { stb_no: stbNo, plan_code: planCode }),
  retrigger: (stbNo: string) => api.post('/gtpl/retrigger', { stb_no: stbNo }),
  status: (stbNo: string) => api.get(`/gtpl/status/${stbNo}`),
  plans: () => api.get('/gtpl/plans'),
  wallet: () => api.get('/gtpl/wallet'),
};

// ── Settings ──────────────────────────────────────────────────────────────
export const settingsApi = {
  getNotifications: () => api.get('/settings/notifications'),
  updateNotifications: (data: Record<string, unknown>) => api.put('/settings/notifications', data),
  verifyTelegram: (data: { bot_token: string; chat_ids?: string }) =>
    api.post('/settings/telegram/verify', data),
  detectChats: () => api.post('/settings/telegram/detect-chats'),
  unlinkTelegram: () => api.delete('/settings/telegram'),
};

// ── Activity Notifications (MSO Portal Status) ──────────────────────────
export const notificationsApi = {
  list: (params?: { limit?: number; unread_only?: boolean }) =>
    api.get('/notifications', { params }),
  markRead: (id: number) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
  create: (data: Record<string, unknown>) => api.post('/notifications', data),
};
