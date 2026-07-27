import axios from 'axios';

const TOKEN_KEY = 'wasool_portal_token';
const CUSTOMER_KEY = 'wasool_portal_customer';

const api = axios.create({
  baseURL: '/api/portal',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(CUSTOMER_KEY);
      window.location.href = '/app/portal';
    }
    return Promise.reject(err);
  },
);

export function getPortalToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setPortalSession(token: string, customer?: Record<string, unknown>) {
  localStorage.setItem(TOKEN_KEY, token);
  if (customer) {
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
  }
}

export function getPortalCustomer(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(CUSTOMER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isValidToken(token: string | null | undefined): boolean {
  if (!token) return false;
  // Simple check — must be at least 20 chars (JWT-like)
  return token.length > 20;
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CUSTOMER_KEY);
}

export default api;
