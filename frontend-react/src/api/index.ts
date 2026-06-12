import api from './client';
import type { Customer, Connection, Payment, Plan, Operator } from '../types';

// ── Customers ────────────────────────────────────────────────────────────
export const customersApi = {
  list: (params?: Record<string, string>) => api.get('/customers', { params }),
  get: (id: string) => api.get(`/customers/${id}`),
  create: (data: Partial<Customer>) => api.post('/customers', data),
  update: (id: string, data: Partial<Customer>) => api.put(`/customers/${id}`, data),
  search: (query: string) => api.get('/customers/search', { params: { q: query } }),
  unpaid: (params: Record<string, string>) => api.get('/customers/unpaid', { params }),
  tempDisconnected: () => api.get('/customers/temp-disconnected'),
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
};

// ── Payments ──────────────────────────────────────────────────────────────
export const paymentsApi = {
  list: (params?: Record<string, string>) => api.get('/payments/all', { params }),
  create: (data: Partial<Payment>) => api.post('/payments', data),
  byMonth: (monthYear: string, page?: number) =>
    api.get('/payments/all', { params: { month_year: monthYear, page: page || 1 } }),
  history: (customerId: string) =>
    api.get('/payments/history', { params: { customer_id: customerId, per_page: '50' } }),
};

// ── Dashboard ─────────────────────────────────────────────────────────────
export const dashboardApi = {
  stats: () => api.get('/dashboard/stats'),
  master: () => api.get('/dashboard/master'),
};

// ── Plans ─────────────────────────────────────────────────────────────────
export const plansApi = {
  list: (params?: Record<string, string>) => api.get('/plans', { params }),
  create: (data: Partial<Plan>) => api.post('/plans', data),
  update: (id: number, data: Partial<Plan>) => api.put(`/plans/${id}`, data),
  delete: (id: number) => api.delete(`/plans/${id}`),
};

// ── Operators (master admin) ──────────────────────────────────────────────
export const operatorsApi = {
  list: () => api.get('/operators'),
  get: (id: number) => api.get(`/operators/${id}`),
  create: (data: Partial<Operator>) => api.post('/operators', data),
  update: (id: number, data: Partial<Operator>) => api.put(`/operators/${id}`, data),
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
