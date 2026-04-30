import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/role_provider.dart';
import '../services/api_service.dart';
import 'customer_detail_screen.dart';
import 'customers_manage_screen.dart';
import 'customers_tab.dart';
import 'search_screen.dart';

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

    return Scaffold(
      body: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          // Header
          SliverToBoxAdapter(
            child: Container(
              decoration: const BoxDecoration(
                color: Color(0xFF6366F1),
                borderRadius: BorderRadius.only(
                  bottomLeft: Radius.circular(28),
                  bottomRight: Radius.circular(28),
                ),
              ),
              child: SafeArea(
                bottom: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
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
                                  'Hello, ${role.name.split(' ').first}!',
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 22,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Row(
                                  children: [
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

          // Stats cards
          SliverToBoxAdapter(
            child: Transform.translate(
              offset: const Offset(0, -16),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: _loading
                    ? const Center(child: Padding(
                        padding: EdgeInsets.all(32),
                        child: CircularProgressIndicator(),
                      ))
                    : Row(
                        children: [
                          Expanded(child: _statCard('Total', '${_stats?['total_customers'] ?? '--'}', Icons.people_rounded, const Color(0xFF6366F1))),
                          const SizedBox(width: 10),
                          Expanded(child: _statCard('Paid', '${_stats?['paid_this_month'] ?? '--'}', Icons.check_circle_rounded, const Color(0xFF10B981))),
                          const SizedBox(width: 10),
                          Expanded(child: _statCard('Unpaid', '${_stats?['unpaid_this_month'] ?? '--'}', Icons.warning_rounded, const Color(0xFFEF4444))),
                        ],
                      ),
              ),
            ),
          ),

          // Collection card
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: _loading ? const SizedBox() : _collectionCard(),
            ),
          ),

          const SliverToBoxAdapter(child: SizedBox(height: 20)),

          // Quick actions
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Text(
                'Quick Actions',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: Colors.grey[800],
                ),
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Wrap(
                spacing: 10,
                runSpacing: 10,
                children: _buildQuickActions(role),
              ),
            ),
          ),

          const SliverToBoxAdapter(child: SizedBox(height: 100)),
        ],
      ),
    );
  }

  List<Widget> _buildQuickActions(RoleProvider role) {
    final actions = <Widget>[];

    actions.add(_quickActionChip(
      icon: Icons.search_rounded,
      label: 'Search',
      color: const Color(0xFF6366F1),
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CustomerSearchScreen())),
    ));

    actions.add(_quickActionChip(
      icon: Icons.payment_rounded,
      label: 'Collect',
      color: const Color(0xFF10B981),
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CustomerSearchScreen(forPayment: true))),
    ));

    if (role.canViewUnpaid) {
      actions.add(_quickActionChip(
        icon: Icons.money_off_rounded,
        label: 'Unpaid',
        color: const Color(0xFFEF4444),
        onTap: () => _navigateToCustomers(filter: 'unpaid'),
      ));
    }

    if (role.canAddCustomer) {
      actions.add(_quickActionChip(
        icon: Icons.person_add_rounded,
        label: 'Add Customer',
        color: const Color(0xFF8B5CF6),
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CustomersManageScreen())),
      ));
    }

    if (role.canSurrenderCustomer) {
      actions.add(_quickActionChip(
        icon: Icons.block_rounded,
        label: 'Surrenders',
        color: const Color(0xFFF59E0B),
        onTap: () => _navigateToCustomers(filter: 'surrendered'),
      ));
    }

    return actions;
  }

  void _navigateToCustomers({String? filter}) {
    // Switch to customers tab via MainShell
    // For now, push directly
    Navigator.push(context, MaterialPageRoute(
      builder: (_) => CustomersTab(initialFilter: filter),
    ));
  }

  Widget _quickActionChip({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          width: (MediaQuery.of(context).size.width - 52) / 3,
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            color: color.withOpacity(0.06),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: color.withOpacity(0.15)),
          ),
          child: Column(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: color, size: 22),
              ),
              const SizedBox(height: 8),
              Text(
                label,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: color,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _statCard(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: color, size: 18),
          ),
          const SizedBox(height: 12),
          Text(
            value,
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: Colors.grey[500],
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Widget _collectionCard() {
    final collected = _stats?['total_collected'] ?? 0;
    final efficiency = _stats?['collection_efficiency'] ?? 0;
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF10B981), Color(0xFF059669)],
        ),
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF10B981).withOpacity(0.25),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'This Month Collection',
                style: TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.w500),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  '${efficiency}% efficiency',
                  style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Rs $collected',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 28,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

// Standalone customer search screen
