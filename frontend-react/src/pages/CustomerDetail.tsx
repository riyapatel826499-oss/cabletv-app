import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { customersApi, paymentsApi } from '../api';
import type { CustomerListItem, Connection, Payment } from '../types';
import { fmtRs, fmtDate } from '../lib/format';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';

interface CustomerDetail extends CustomerListItem {
  phone2?: string;
  address?: string;
  city?: string;
  connections?: Connection[];
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm text-gray-900 mt-0.5">{value || '--'}</p>
    </div>
  );
}

export default function CustomerDetail() {
  const { id = '' } = useParams();

  const { data: customer, isLoading, isError } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => (await customersApi.get(id)).data as CustomerDetail,
    enabled: !!id,
  });

  const { data: payHistory } = useQuery({
    queryKey: ['customer-payments', id],
    queryFn: async () => {
      const d = (await paymentsApi.history(id)).data as { payments?: Payment[] } | Payment[];
      return Array.isArray(d) ? d : (d.payments ?? []);
    },
    enabled: !!id,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }
  if (isError || !customer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <AlertCircle className="w-8 h-8 mb-2" />
        <p>Customer not found.</p>
        <Link to="/customers" className="text-blue-600 mt-3 text-sm">← Back to customers</Link>
      </div>
    );
  }

  const connections = customer.connections ?? [];
  const payments = payHistory ?? [];

  return (
    <div className="space-y-5">
      <Link to="/customers" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4" /> Back to customers
      </Link>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{customer.name}</h1>
            <p className="text-gray-500 mt-1">{customer.customer_id}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${(customer.status || '').toLowerCase() === 'active' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {customer.status || '--'}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <Field label="Phone" value={customer.phone} />
          <Field label="Alt. Phone" value={customer.phone2} />
          <Field label="Area" value={customer.area} />
          <Field label="City" value={customer.city} />
          <Field label="Address" value={customer.address} />
          <Field label="Plan" value={customer.plan_name} />
          <Field label="Plan Amount" value={customer.plan_amount ? fmtRs(customer.plan_amount) : undefined} />
        </div>
      </div>

      {/* Connections */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-5 border-b border-gray-100"><h2 className="font-semibold text-gray-900">Connections ({connections.length})</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 font-medium">STB No</th>
                <th className="px-4 py-3 font-medium">CAN ID</th>
                <th className="px-4 py-3 font-medium">MSO</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {connections.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 text-gray-900">{c.stb_no || '--'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.can_id || '--'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.mso || '--'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.service_type || '--'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.status || '--'}</td>
                </tr>
              ))}
              {!connections.length && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No connections.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment history */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-5 border-b border-gray-100"><h2 className="font-semibold text-gray-900">Payment History</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Month</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
                <th className="px-4 py-3 font-medium">Mode</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {payments.map((p, i) => (
                <tr key={p.id ?? i}>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(p.collected_at)}</td>
                  <td className="px-4 py-3 text-gray-500">{p.month_year || '--'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-green-600">{fmtRs(p.amount)}</td>
                  <td className="px-4 py-3 text-gray-500">{p.payment_mode || p.payment_type || '--'}</td>
                </tr>
              ))}
              {!payments.length && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No payments recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
