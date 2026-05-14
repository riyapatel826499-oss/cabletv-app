import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/role_provider.dart';
import '../services/api_service.dart';
import 'collection_list_screen.dart';
import 'customer_detail_screen.dart';
import 'customers_manage_screen.dart';
import 'customers_tab.dart';
import 'search_screen.dart';
import 'payments_tab.dart';
import 'service_requests_screen.dart';

class DashboardTab extends StatefulWidget {
  const DashboardTab({super.key});

  @override
  State<DashboardTab> createState() => _DashboardTabState();
}

class _DashboardTabState extends State<DashboardTab> with AutomaticKeepAliveClientMixin {
  Map<String, dynamic>? _stats;
  bool _loading = true;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    try {
      final stats = await ApiService.getDashboardStats();
      if (!mounted) return;
      setState(() { _stats = stats; _loading = false; });
    } catch (e) {
      if (!mounted) return;
      if (e.toString().contains('Session expired')) {
        Navigator.pushReplacementNamed(context, '/login');
        return;
      }
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final role = Provider.of<RoleProvider>(context);
    final screenWidth = MediaQuery.of(context).size.width;
    final cardSize = (screenWidth - 48) / 2; // 2 columns with padding

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: RefreshIndicator(
        onRefresh: _loadStats,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            // Header
            SliverToBoxAdapter(
              child: Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
                  ),
                  borderRadius: BorderRadius.only(
                    bottomLeft: Radius.circular(28),
                    bottomRight: Radius.circular(28),
                  ),
                ),
                child: SafeArea(
                  bottom: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Hello, ${role.name.split(' ').first}! 👋',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 22,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                    decoration: BoxDecoration(
                                      color: Colors.white.withOpacity(0.15),
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Icon(role.roleIcon, color: Colors.white, size: 14),
                                        const SizedBox(width: 6),
                                        Text(
                                          role.roleLabel,
                                          style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w500),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Container(
                              width: 48,
                              height: 48,
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.15),
                                borderRadius: BorderRadius.circular(16),
                              ),
                              child: const Icon(Icons.tv_rounded, color: Colors.white, size: 24),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),

            // Stats summary
            SliverToBoxAdapter(
              child: Transform.translate(
                offset: const Offset(0, -14),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: _loading
                      ? const Center(child: Padding(
                          padding: EdgeInsets.all(24),
                          child: CircularProgressIndicator(),
                        ))
                      : Row(
                          children: [
                            Expanded(child: _miniStat('Total', '${_stats?['total_customers'] ?? '--'}', Icons.people_rounded, const Color(0xFF6366F1))),
                            const SizedBox(width: 8),
                            Expanded(child: _miniStat('Paid', '${_stats?['paid_this_month'] ?? '--'}', Icons.check_circle_rounded, const Color(0xFF10B981))),
                            const SizedBox(width: 8),
                            Expanded(child: _miniStat('Unpaid', '${_stats?['unpaid_this_month'] ?? '--'}', Icons.warning_rounded, const Color(0xFFEF4444))),
                          ],
                        ),
                ),
              ),
            ),

            // Action Cards heading
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
                child: Text(
                  'Quick Actions',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                    color: Colors.grey[800],
                  ),
                ),
              ),
            ),

            // 6 Action Cards in 2-column grid
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Column(
                  children: [
                    // Row 1: Collect Payment + Add Customer
                    Row(
                      children: [
                        _actionCard(
                          title: 'Collect\nPayment',
                          subtitle: 'Search & pay',
                          icon: Icons.account_balance_wallet_rounded,
                          color: const Color(0xFF10B981),
                          size: cardSize,
                          onTap: () => Navigator.push(context, MaterialPageRoute(
                            builder: (_) => const CollectionListScreen(),
                          )),
                        ),
                        const SizedBox(width: 16),
                        _actionCard(
                          title: 'Add\nCustomer',
                          subtitle: 'New connection',
                          icon: Icons.person_add_rounded,
                          color: const Color(0xFF8B5CF6),
                          size: cardSize,
                          onTap: () => Navigator.push(context, MaterialPageRoute(
                            builder: (_) => const CustomersManageScreen(),
                          )),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),

                    // Row 2: Paid List + Unpaid List
                    Row(
                      children: [
                        _actionCard(
                          title: 'Paid\nList',
                          subtitle: 'Collection history',
                          icon: Icons.receipt_long_rounded,
                          color: const Color(0xFFE11D48),
                          size: cardSize,
                          onTap: () => Navigator.push(context, MaterialPageRoute(
                            builder: (_) => const PaidListScreen(),
                          )),
                        ),
                        const SizedBox(width: 16),
                        _actionCard(
                          title: 'Unpaid\nList',
                          subtitle: 'Pending dues',
                          icon: Icons.money_off_rounded,
                          color: const Color(0xFFF59E0B),
                          size: cardSize,
                          onTap: () => Navigator.push(context, MaterialPageRoute(
                            builder: (_) => CustomersTab(initialFilter: 'unpaid'),
                          )),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),

                    // Row 3: Service Requests + Reports
                    Row(
                      children: [
                        _actionCard(
                          title: 'Service\nRequests',
                          subtitle: _loading ? 'Loading...' : '${_stats?['open_sr_count'] ?? _stats?['my_open_sr_count'] ?? 0} pending',
                          icon: Icons.build_rounded,
                          color: const Color(0xFF0EA5E9),
                          size: cardSize,
                          badge: _loading ? null : (_stats?['open_sr_count'] ?? _stats?['my_open_sr_count'] ?? 0),
                          onTap: () => Navigator.push(context, MaterialPageRoute(
                            builder: (_) => const ServiceRequestsScreen(initialStatus: 'open'),
                          )),
                        ),
                        const SizedBox(width: 16),
                        _actionCard(
                          title: 'Reports',
                          subtitle: 'Analytics & stats',
                          icon: Icons.bar_chart_rounded,
                          color: const Color(0xFF3B82F6),
                          size: cardSize,
                          onTap: () => Navigator.push(context, MaterialPageRoute(
                            builder: (_) => const ReportsScreen(),
                          )),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),

            // Recent Activity
            if (!_loading && _stats?['recent_payments'] != null) ...[
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
                  child: Text(
                    'Recent Collections',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                      color: Colors.grey[800],
                    ),
                  ),
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: _buildRecentPayments(),
                ),
              ),
            ],

            const SliverToBoxAdapter(child: SizedBox(height: 100)),
          ],
        ),
      ),
    );
  }

  Widget _miniStat(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.04), blurRadius: 8, offset: const Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, color: color, size: 16),
              ),
              const Spacer(),
            ],
          ),
          const SizedBox(height: 10),
          Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: color)),
          const SizedBox(height: 2),
          Text(label, style: TextStyle(fontSize: 11, color: Colors.grey[500], fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }

  Widget _actionCard({
    required String title,
    required String subtitle,
    required IconData icon,
    required Color color,
    required double size,
    int? badge,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      elevation: 2,
      shadowColor: color.withOpacity(0.15),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          width: size,
          height: size * 0.85,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                color.withOpacity(0.05),
                color.withOpacity(0.02),
              ],
            ),
          ),
          child: Stack(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: color.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Icon(icon, color: color, size: 24),
                  ),
                  const Spacer(),
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: color,
                      height: 1.2,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 11,
                      color: Colors.grey[500],
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
              // Badge for pending count
              if (badge != null && badge > 0)
                Positioned(
                  top: 0,
                  right: 0,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEF4444),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      '$badge',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRecentPayments() {
    final payments = _stats?['recent_payments'] as List? ?? [];
    if (payments.isEmpty) return const SizedBox();

    return Column(
      children: payments.take(5).map((p) {
        return Container(
          margin: const EdgeInsets.symmetric(vertical: 3),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFF1F5F9)),
          ),
          child: Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundColor: const Color(0xFFDCFCE7),
                child: Text(
                  (p['customer_name'] ?? '?')[0].toUpperCase(),
                  style: const TextStyle(color: Color(0xFF16A34A), fontWeight: FontWeight.w700, fontSize: 13),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(p['customer_name'] ?? '--', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                    Text('${p['area'] ?? '--'} · ${p['mode'] ?? '--'}', style: TextStyle(color: Colors.grey[500], fontSize: 11)),
                  ],
                ),
              ),
              Text(
                '₹${(p['amount'] ?? 0).toDouble().toStringAsFixed(0)}',
                style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF10B981), fontSize: 14),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}

// ========== Reports Screen ==========
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  Map<String, dynamic>? _stats;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final stats = await ApiService.getDashboardStats();
      if (!mounted) return;
      setState(() { _stats = stats; _loading = false; });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final byArea = _stats?['by_area'] as List? ?? [];

    return Scaffold(
      backgroundColor: const Color(0xFFF5F5F5),
      appBar: AppBar(
        title: const Text('Reports'),
        backgroundColor: const Color(0xFF3B82F6),
        foregroundColor: Colors.white,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // Summary cards
                  Row(
                    children: [
                      Expanded(
                        child: _reportCard(
                          'Total Customers',
                          '${_stats?['total_customers'] ?? 0}',
                          Icons.people_rounded,
                          const Color(0xFF6366F1),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _reportCard(
                          'Collected',
                          '₹${_stats?['total_collected'] ?? 0}',
                          Icons.account_balance_wallet_rounded,
                          const Color(0xFF10B981),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: _reportCard(
                          'Paid',
                          '${_stats?['paid_this_month'] ?? 0}',
                          Icons.check_circle_rounded,
                          const Color(0xFF10B981),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _reportCard(
                          'Unpaid',
                          '${_stats?['unpaid_this_month'] ?? 0}',
                          Icons.warning_rounded,
                          const Color(0xFFEF4444),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  _reportCard(
                    'Collection Efficiency',
                    '${_stats?['collection_efficiency'] ?? 0}%',
                    Icons.trending_up_rounded,
                    const Color(0xFFF59E0B),
                  ),

                  const SizedBox(height: 24),

                  // Area-wise breakdown
                  const Text('Area-wise Breakdown', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 12),
                  if (byArea.isEmpty)
                    Center(child: Text('No data', style: TextStyle(color: Colors.grey[400])))
                  else
                    ...byArea.map((area) {
                      final total = (area['total'] ?? 0) as int;
                      final paid = (area['paid'] ?? 0) as int;
                      final pct = total > 0 ? ((paid / total) * 100).round() : 0;
                      return Container(
                        margin: const EdgeInsets.symmetric(vertical: 3),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFF1F5F9)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    area['area'] ?? '--',
                                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                Text(
                                  '$paid/$total ($pct%)',
                                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 12, color: pct >= 80 ? const Color(0xFF10B981) : pct >= 50 ? const Color(0xFFF59E0B) : const Color(0xFFEF4444)),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            ClipRRect(
                              borderRadius: BorderRadius.circular(4),
                              child: LinearProgressIndicator(
                                value: total > 0 ? paid / total : 0,
                                backgroundColor: const Color(0xFFF1F5F9),
                                color: pct >= 80 ? const Color(0xFF10B981) : pct >= 50 ? const Color(0xFFF59E0B) : const Color(0xFFEF4444),
                                minHeight: 6,
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                ],
              ),
            ),
    );
  }

  Widget _reportCard(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFF1F5F9)),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(value, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: color)),
                Text(label, style: TextStyle(color: Colors.grey[500], fontSize: 11, fontWeight: FontWeight.w500)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
