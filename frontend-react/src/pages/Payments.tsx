import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { paymentsApi } from '../api';
import type { Payment } from '../types';
import { fmtRs, fmtDate } from '../lib/format';
import { Search, Loader2, Plus } from 'lucide-react';

const PER_PAGE = 25;

interface PaymentsResponse {
  payments: Payment[];
  total: number;
  page: number;
  per_page: number;
  total_pages?: number;
}

function monthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(now) };
}

export default function Payments() {
  const defaults = useMemo(() => monthRange(), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isFetching, isError } = useQuery({
    queryKey: ['payments', { from, to, debounced, page }],
    queryFn: async () => {
      const params: Record<string, string> = {
        page: String(page), per_page: String(PER_PAGE), date_from: from, date_to: to,
      };
      if (debounced) params.search = debounced;
      return (await paymentsApi.list(params)).data as PaymentsResponse;
    },
    placeholderData: keepPreviousData,
  });

  const payments = data?.payments ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? Math.max(1, Math.ceil(total / PER_PAGE));
  const pageTotal = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
            <p className="text-gray-500 mt-1">{total.toLocaleString('en-IN')} payments in range</p>
          </div>
          <Link to="/payments/new" className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
            <Plus className="w-4 h-4" /> Record
          </Link>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            className="py-2 px-3 border border-gray-300 rounded-lg text-sm" />
          <span className="text-gray-400">→</span>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }}
            className="py-2 px-3 border border-gray-300 rounded-lg text-sm" />
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search…"
              className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-44 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">STB</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
                <th className="px-4 py-3 font-medium">Mode</th>
                <th className="px-4 py-3 font-medium">Collected By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {payments.map((p, i) => (
                <tr key={p.id ?? i} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(p.collected_at)}</td>
                  <td className="px-4 py-3">
                    <div className="text-gray-900">{p.customer_name || p.customer_id}</div>
                    <div className="text-xs text-gray-400">{p.customer_id}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{p.stb_no || '--'}</td>
                  <td className="px-4 py-3 text-gray-500">{p.plan_name || '--'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-green-600">{fmtRs(p.amount)}</td>
                  <td className="px-4 py-3 text-gray-500">{p.payment_mode || p.payment_type || '--'}</td>
                  <td className="px-4 py-3 text-gray-500">{p.collected_by_name || '--'}</td>
                </tr>
              ))}
              {!payments.length && !isFetching && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  {isError ? "Couldn't load payments." : 'No payments in this range.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
          <span className="flex items-center gap-2">
            {isFetching && <Loader2 className="w-4 h-4 animate-spin" />}
            Page total: <span className="font-medium text-gray-700">{fmtRs(pageTotal)}</span>
          </span>
          <div className="flex items-center gap-3">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50">Previous</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50">Next</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
