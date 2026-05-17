import api from './client';
import type { LoginRequest, LoginResponse, User } from '../types';

export async function login(data: LoginRequest): Promise<LoginResponse> {
  const res = await api.post('/login', data);
  return res.data;
}

export async function getMe(): Promise<User> {
  const res = await api.get('/me');
  return res.data;
}

export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login';
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem('token');
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
