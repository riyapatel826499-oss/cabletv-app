import { useAuth } from '../hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../api';
import { Wifi, Users, IndianRupee, TrendingUp, Clock, AlertCircle } from 'lucide-react';
import type { DashboardStats } from '../types';
import { fmtRs, fmtDate } from '../lib/format';

function StatCard({
  title, value, subtitle, icon: Icon, color,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
  };
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
        </div>
        <div className={`p-3 rounded-xl ${colorMap[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();

  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await dashboardApi.stats()).data as DashboardStats,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <AlertCircle className="w-8 h-8 mb-2" />
        <p>Couldn't load dashboard. Try again.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">
          Welcome back, {user?.name || 'Admin'} · {stats.month}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Connections"
          value={stats.total_connections.toLocaleString('en-IN')}
          subtitle={`${stats.total_customers.toLocaleString('en-IN')} customers`}
          icon={Wifi}
          color="green"
        />
        <StatCard
          title="Paid This Month"
          value={stats.paid_this_month.toLocaleString('en-IN')}
          subtitle={`${stats.unpaid_this_month.toLocaleString('en-IN')} unpaid`}
          icon={Users}
          color="blue"
        />
        <StatCard
          title="Collected This Month"
          value={fmtRs(stats.total_collected)}
          icon={IndianRupee}
          color="purple"
        />
        <StatCard
          title="Collection Rate"
          value={`${(stats.collection_efficiency || 0).toFixed(1)}%`}
          subtitle={stats.open_sr_count ? `${stats.open_sr_count} open requests` : undefined}
          icon={TrendingUp}
          color="yellow"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent payments */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="p-5 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Clock className="w-4 h-4" /> Recent Payments
            </h2>
          </div>
          <div className="divide-y divide-gray-50">
            {stats.recent_payments?.length ? (
              stats.recent_payments.slice(0, 10).map((p, i) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.customer_name || p.customer_id}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {[p.stb_no, p.mode, p.collector_name].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="text-right shrink-0 pl-3">
                    <p className="text-sm font-semibold text-green-600">{fmtRs(p.amount)}</p>
                    <p className="text-xs text-gray-400">{fmtDate(p.date)}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-5 text-center text-gray-400 text-sm">No payments yet</div>
            )}
          </div>
        </div>

        {/* Collection by area */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="p-5 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Collection by Area</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {stats.by_area?.length ? (
              stats.by_area.slice(0, 8).map((a, i) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between">
                  <span className="text-sm text-gray-700 truncate">{a.area}</span>
                  <span className="text-sm font-medium text-gray-900 shrink-0 pl-3">{fmtRs(a.total_amount)}</span>
                </div>
              ))
            ) : (
              <div className="p-5 text-center text-gray-400 text-sm">No data</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
