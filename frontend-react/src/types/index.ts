// TypeScript types for Cable TV Management App

export interface User {
  id: number;
  username: string;
  name: string;
  role: 'master' | 'admin' | 'agent';
  phone?: string;
  operator_id?: number | null;
  permissions?: Record<string, any>;
}

export interface Operator {
  id: number;
  business_name: string;
  owner_name: string;
  phone: string;
  email?: string;
  area?: string;
  mso: string;
  status: 'active' | 'inactive';
  customer_prefix?: string;
  connection_count?: number;
}

export interface Customer {
  id: number;
  customer_id: string;
  name: string;
  phone: string;
  phone2?: string;
  address?: string;
  area?: string;
  city: string;
  pincode?: string;
  status: 'Active' | 'Inactive' | 'Surrendered';
  operator_id?: number;
}

export interface Connection {
  id: number;
  customer_id: string;
  stb_no: string;
  can_id?: string;
  mso: string;
  service_type: string;
  package_name?: string;
  status: 'Active' | 'Inactive' | 'Disconnected';
  expiry_date?: string;
  operator_id?: number;
}

export interface Payment {
  id: number;
  customer_id: string;
  customer_name?: string;
  stb_no?: string;
  amount: number;
  payment_method: string;
  payment_date: string;
  month_year: string;
  package_name?: string;
  connection_id?: number;
  operator_id?: number;
}

export interface Plan {
  id: number;
  name: string;
  mso: string;
  type: string;
  price: number;
  mso_cost?: number;
  status: 'Active' | 'Inactive';
}

export interface DashboardStats {
  total_customers: number;
  total_connections: number;
  active_connections: number;
  total_collected: number;
  total_pending: number;
  collection_rate: number;
  monthly_chart: { month: string; collected: number; pending: number }[];
  recent_payments: Payment[];
  package_breakdown: { name: string; count: number; collected: number }[];
}

export interface ServiceRequest {
  id: number;
  customer_id: string;
  customer_name?: string;
  stb_no?: string;
  type: string;
  status: 'open' | 'assigned' | 'in_progress' | 'resolved' | 'closed';
  description?: string;
  created_at: string;
  timeline?: { status: string; timestamp: string; note?: string }[];
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}
