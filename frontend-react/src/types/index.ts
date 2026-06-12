// TypeScript types for Cable TV Management App

export interface User {
  id: number;
  username: string;
  name: string;
  role: 'master' | 'admin' | 'agent';
  phone?: string;
  operator_id?: number | null;
  permissions?: Record<string, unknown>;
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

// Matches the rows returned by GET /api/payments/all and the create payload.
export interface Payment {
  id: number;
  customer_id: string;
  customer_name?: string;
  phone?: string;
  stb_no?: string;
  plan_name?: string;
  amount: number;
  payment_mode?: string;
  payment_type?: string;
  collected_at?: string;
  collected_by_name?: string;
  month_year?: string;
  connection_id?: number;
  area?: string;
  source?: string;
  notes?: string;
  operator_id?: number;
}

// Row shape from GET /api/customers and /api/customers/search.
export interface CustomerListItem {
  customer_id: string;
  name: string;
  phone?: string;
  phone2?: string;
  area?: string;
  address?: string;
  city?: string;
  status?: string;
  stb_no?: string;
  is_paid?: number | boolean;
  plan_name?: string;
  plan_amount?: number;
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

// Matches GET /api/dashboard/stats (non-agent response).
export interface AreaStat {
  area: string;
  paid_count: number;
  total_amount: number;
}

export interface RecentPayment {
  customer_id: string;
  customer_name?: string;
  amount: number;
  mode?: string;
  date?: string;
  area?: string;
  collector_name?: string;
  source?: string;
  stb_no?: string;
}

export interface DashboardStats {
  month: string;
  total_customers: number;
  total_connections: number;
  paid_this_month: number;
  unpaid_this_month: number;
  total_collected: number;
  collection_efficiency: number;
  by_area: AreaStat[];
  recent_payments: RecentPayment[];
  expiring_soon: unknown[];
  open_sr_count: number;
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
