import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import Payments from './pages/Payments';
import RecordPayment from './pages/RecordPayment';
import Reports from './pages/Reports';
import Unpaid from './pages/Unpaid';
import Plans from './pages/Plans';
import Connections from './pages/Connections';
import ServiceRequests from './pages/ServiceRequests';
import Settings from './pages/Settings';
import Operators from './pages/Operators';
import Employees from './pages/Employees';
import AddCustomer from './pages/AddCustomer';
import NotRenewed from './pages/NotRenewed';
import Reminders from './pages/Reminders';
import AuditLog from './pages/AuditLog';
import Surrender from './pages/Surrender';
import MyCollections from './pages/MyCollections';
import Inventory from './pages/Inventory';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// ── Role-based route guard ──────────────────────────────────────────────────
const _ALL = ['master', 'admin', 'agent', 'collection_agent', 'support'];
const _CP = [..._ALL, 'collection_point'];

const ROUTE_ROLES: Record<string, string[]> = {
  '/':                    _CP,
  '/customers/:id':       _CP,
  '/payments/new':        _CP,
  '/my-collections':      _CP,
  '/reports':             _CP,
  '/service-requests':    _CP,
  // Staff only (no collection_point)
  '/customers':           _ALL,
  '/unpaid':              _ALL,
  '/not-renewed':         _ALL,
  // Admin+ only
  '/add-customer':        ['master', 'admin', 'support', 'service_agent'],
  '/payments':            ['master', 'admin'],
  '/plans':               ['master', 'admin'],
  '/reminders':           ['master', 'admin'],
  '/connections':         ['master', 'admin'],
  '/surrender':           ['master', 'admin'],
  '/inventory':           ['master', 'admin', 'support'],
  '/settings':            ['master', 'admin'],
  '/audit':               ['master', 'admin'],
  '/employees':           ['master', 'admin'],
  '/operators':           ['master'],
};

function RoleRoute({ path, element }: { path: string; element: React.ReactNode }) {
  const { user } = useAuth();
  const role = user?.role || 'agent';
  const allowed = ROUTE_ROLES[path] || [];
  // Safety: if role not in any list, treat as agent (not block entirely)
  const isAllowed = allowed.includes(role)
    || (!['master', 'admin'].includes(role) && allowed.includes('agent'));
  if (!isAllowed) {
    return <Navigate to="/" replace />;
  }
  return <>{element}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="customers" element={<RoleRoute path="/customers" element={<Customers />} />} />
        <Route path="customers/:id" element={<RoleRoute path="/customers/:id" element={<CustomerDetail />} />} />
        <Route path="unpaid" element={<RoleRoute path="/unpaid" element={<Unpaid />} />} />
        <Route path="payments" element={<RoleRoute path="/payments" element={<Payments />} />} />
        <Route path="payments/new" element={<RoleRoute path="/payments/new" element={<RecordPayment />} />} />
        <Route path="plans" element={<RoleRoute path="/plans" element={<Plans />} />} />
        <Route path="reports" element={<RoleRoute path="/reports" element={<Reports />} />} />
        <Route path="connections" element={<RoleRoute path="/connections" element={<Connections />} />} />
        <Route path="service-requests" element={<RoleRoute path="/service-requests" element={<ServiceRequests />} />} />
        <Route path="settings" element={<RoleRoute path="/settings" element={<Settings />} />} />
        <Route path="operators" element={<RoleRoute path="/operators" element={<Operators />} />} />
        <Route path="employees" element={<RoleRoute path="/employees" element={<Employees />} />} />
        <Route path="add-customer" element={<RoleRoute path="/add-customer" element={<AddCustomer />} />} />
        <Route path="not-renewed" element={<RoleRoute path="/not-renewed" element={<NotRenewed />} />} />
        <Route path="reminders" element={<RoleRoute path="/reminders" element={<Reminders />} />} />
        <Route path="audit" element={<RoleRoute path="/audit" element={<AuditLog />} />} />
        <Route path="surrender" element={<RoleRoute path="/surrender" element={<Surrender />} />} />
        <Route path="inventory" element={<RoleRoute path="/inventory" element={<Inventory />} />} />
        <Route path="my-collections" element={<RoleRoute path="/my-collections" element={<MyCollections />} />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/app">
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
