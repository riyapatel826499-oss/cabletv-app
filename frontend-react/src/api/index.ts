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
};

// ── Connections ───────────────────────────────────────────────────────────
export const connectionsApi = {
  list: (params?: Record<string, string>) => api.get('/connections', { params }),
  create: (data: Partial<Connection>) => api.post('/connections', data),
  update: (id: number, data: Partial<Connection>) => api.put(`/connections/${id}`, data),
  disconnect: (id: number) => api.post(`/connections/${id}/disconnect`),
  reconnect: (id: number) => api.post(`/connections/${id}/reconnect`),
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
  list: (params?: Record<string, string>) => api.get('/service-requests', { params }),
  get: (id: number) => api.get(`/service-requests/${id}`),
  updateStatus: (id: number, status: string, note?: string) =>
    api.put(`/service-requests/${id}/status`, { status, note }),
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
  get: () => api.get('/settings'),
  update: (data: Record<string, unknown>) => api.put('/settings', data),
};
