import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { customersApi } from '../api';
import type { CustomerListItem } from '../types';
import { Search, Loader2 } from 'lucide-react';

const PER_PAGE = 20;

interface ListResponse {
  customers: CustomerListItem[];
  total: number;
  page: number;
  per_page: number;
}

function StatusBadge({ status }: { status?: string }) {
  const active = (status || '').toLowerCase() === 'active';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
      {status || '--'}
    </span>
  );
}

export default function Customers() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  // Debounce the search box. Page resets are done in the change handlers below.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isFetching, isError } = useQuery({
    queryKey: ['customers', { debounced, status, page }],
    queryFn: async () => {
      if (debounced) {
        const rows = (await customersApi.search(debounced)).data as CustomerListItem[];
        return { customers: rows, total: rows.length, page: 1, per_page: rows.length } as ListResponse;
      }
      const params: Record<string, string> = { page: String(page), per_page: String(PER_PAGE) };
      if (status) params.status = status;
      return (await customersApi.list(params)).data as ListResponse;
    },
    placeholderData: keepPreviousData,
  });

  const customers = data?.customers ?? [];
  const total = data?.total ?? 0;
  const totalPages = debounced ? 1 : Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-500 mt-1">{total.toLocaleString('en-IN')} {debounced ? 'matches' : 'total'}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search name, phone, STB…"
              className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none w-56"
            />
          </div>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            disabled={!!debounced}
            className="py-2 px-3 border border-gray-300 rounded-lg text-sm bg-white disabled:opacity-50"
          >
            <option value="">All statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Surrendered">Surrendered</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">STB</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Area</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {customers.map((c) => (
                <tr
                  key={c.customer_id}
                  onClick={() => navigate(`/customers/${encodeURIComponent(c.customer_id)}`)}
                  className="hover:bg-blue-50/40 cursor-pointer"
                >
                  <td className="px-4 py-3 font-medium text-gray-700">{c.customer_id}</td>
                  <td className="px-4 py-3 text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-gray-500">{c.stb_no || '--'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.phone || '--'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.area || '--'}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.is_paid ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.is_paid ? 'Paid' : 'Unpaid'}
                    </span>
                  </td>
                </tr>
              ))}
              {!customers.length && !isFetching && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  {isError ? "Couldn't load customers." : 'No customers found.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
          <span className="flex items-center gap-2">
            {isFetching && <Loader2 className="w-4 h-4 animate-spin" />}
            {debounced ? 'Search results' : `Page ${page} of ${totalPages}`}
          </span>
          {!debounced && (
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
              >Previous</button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
              >Next</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
