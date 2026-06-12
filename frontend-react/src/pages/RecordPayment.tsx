import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { customersApi, paymentsApi } from '../api';
import type { CustomerListItem } from '../types';
import { fmtRs } from '../lib/format';
import { ArrowLeft, Loader2, CheckCircle2, Search } from 'lucide-react';

const MODES = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque'];

function currentMonthYear() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

export default function RecordPayment() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<CustomerListItem | null>(null);

  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('Cash');
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results = [], isFetching: searching } = useQuery({
    queryKey: ['cust-search', debounced],
    queryFn: async () => (await customersApi.search(debounced)).data as CustomerListItem[],
    enabled: !!debounced && !selected,
  });

  const mutation = useMutation({
    mutationFn: () => paymentsApi.create({
      customer_id: selected!.customer_id,
      amount: Number(amount),
      payment_mode: mode,
      month_year: monthYear,
      notes: notes || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['customer', selected?.customer_id] });
    },
  });

  function pick(c: CustomerListItem) {
    setSelected(c);
    setQuery(c.name);
    if (c.plan_amount) setAmount(String(c.plan_amount));
  }

  function reset() {
    setSelected(null); setQuery(''); setAmount(''); setMode('Cash');
    setMonthYear(currentMonthYear()); setNotes(''); setError('');
    mutation.reset();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!selected) { setError('Select a customer first'); return; }
    if (!amount || Number(amount) <= 0) { setError('Enter a valid amount'); return; }
    mutation.mutate(undefined, {
      onError: (err) => {
        const detail = axios.isAxiosError(err) ? err.response?.data?.detail : undefined;
        setError(typeof detail === 'string' ? detail : 'Payment failed');
      },
    });
  }

  if (mutation.isSuccess) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900">Payment Recorded</h2>
        <p className="text-gray-500 mt-1">{fmtRs(amount)} for {selected?.name}</p>
        <div className="flex gap-3 justify-center mt-6">
          <button onClick={reset} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
            Record Another
          </button>
          <button onClick={() => navigate('/payments')} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
            View Payments
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <Link to="/payments" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4" /> Back to payments
      </Link>
      <h1 className="text-2xl font-bold text-gray-900">Record Payment</h1>

      <form onSubmit={submit} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
        {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

        {/* Customer search/select */}
        <div className="relative">
          <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
          {selected ? (
            <div className="flex items-center justify-between border border-gray-300 rounded-lg px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-gray-900">{selected.name}</p>
                <p className="text-xs text-gray-400">{selected.customer_id} · {selected.stb_no || 'no STB'}</p>
              </div>
              <button type="button" onClick={reset} className="text-sm text-blue-600">Change</button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, phone, STB…"
                  className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  autoFocus
                />
                {searching && <Loader2 className="w-4 h-4 animate-spin text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />}
              </div>
              {results.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {results.map((c) => (
                    <button
                      key={c.customer_id}
                      type="button"
                      onClick={() => pick(c)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-0"
                    >
                      <p className="text-sm text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-400">{c.customer_id} · {c.area || '--'} · {c.stb_no || 'no STB'}</p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹)</label>
            <input
              type="number" min="1" step="1" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white">
              {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Month (MM-YYYY)</label>
            <input value={monthYear} onChange={(e) => setMonthYear(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
        </div>

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 rounded-lg flex items-center justify-center gap-2"
        >
          {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {mutation.isPending ? 'Recording…' : `Record ${amount ? fmtRs(amount) : 'Payment'}`}
        </button>
      </form>
    </div>
  );
}
