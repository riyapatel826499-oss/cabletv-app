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
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="unpaid" element={<Unpaid />} />
        <Route path="payments" element={<Payments />} />
        <Route path="payments/new" element={<RecordPayment />} />
        <Route path="plans" element={<Plans />} />
        <Route path="reports" element={<Reports />} />
        <Route path="connections" element={<Connections />} />
        <Route path="service-requests" element={<ServiceRequests />} />
        <Route path="settings" element={<Settings />} />
        <Route path="operators" element={<Operators />} />
        <Route path="employees" element={<Employees />} />
        <Route path="add-customer" element={<AddCustomer />} />
        <Route path="not-renewed" element={<NotRenewed />} />
        <Route path="reminders" element={<Reminders />} />
        <Route path="audit" element={<AuditLog />} />
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
