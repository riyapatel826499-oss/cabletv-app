import axios from 'axios';

// Bundled native app (Capacitor) has no server origin — call the live API directly.
import { appUrl } from '../lib/native';

const IS_NATIVE = typeof (window as any).Capacitor !== 'undefined';
const API_BASE = IS_NATIVE ? 'https://wasool.co.in/api' : '/api';

// Create axios instance with auth interceptor
const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 — redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // React app is mounted under /app — redirect to its login, not the legacy one.
      window.location.href = appUrl('/login');
    }
    return Promise.reject(error);
  }
);

export default api;
