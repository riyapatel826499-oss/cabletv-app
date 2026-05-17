import { useAuth } from '../hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../api';
import {
  Wifi,
  WifiOff,
  IndianRupee,
  TrendingUp,
  Clock,
} from 'lucide-react';
import type { DashboardStats } from '../types';

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
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

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await dashboardApi.stats();
      return res.data as DashboardStats;
    },
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const stats = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">
          Welcome back, {user?.name || 'Admin'}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Connections"
          value={stats?.active_connections || 0}
          subtitle={`of ${stats?.total_connections || 0} total`}
          icon={Wifi}
          color="green"
        />
        <StatCard
          title="Inactive"
          value={(stats?.total_connections || 0) - (stats?.active_connections || 0)}
          icon={WifiOff}
          color="red"
        />
        <StatCard
          title="This Month Collected"
          value={`₹${(stats?.total_collected || 0).toLocaleString('en-IN')}`}
          icon={IndianRupee}
          color="blue"
        />
        <StatCard
          title="Collection Rate"
          value={`${(stats?.collection_rate || 0).toFixed(1)}%`}
          subtitle={`₹${(stats?.total_pending || 0).toLocaleString('en-IN')} pending`}
          icon={TrendingUp}
          color="purple"
        />
      </div>

      {/* Recent Payments */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Clock className="w-4 h-4" /> Recent Payments
          </h2>
        </div>
        <div className="divide-y divide-gray-50">
          {stats?.recent_payments?.slice(0, 10).map((p, i) => (
            <div key={i} className="px-5 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{p.customer_name}</p>
                <p className="text-xs text-gray-400">
                  {p.stb_no} · {p.payment_method}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-green-600">
                  ₹{p.amount.toLocaleString('en-IN')}
                </p>
                <p className="text-xs text-gray-400">
                  {new Date(p.payment_date).toLocaleDateString('en-IN')}
                </p>
              </div>
            </div>
          )) || (
            <div className="p-5 text-center text-gray-400 text-sm">
              No payments yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
