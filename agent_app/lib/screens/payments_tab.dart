import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/role_provider.dart';
import '../services/api_service.dart';
import 'payment_screen.dart';
import 'customer_detail_screen.dart';
import 'search_screen.dart';

class PaymentsTab extends StatefulWidget {
  const PaymentsTab({super.key});

  @override
  State<PaymentsTab> createState() => _PaymentsTabState();
}

class _PaymentsTabState extends State<PaymentsTab> with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final role = Provider.of<RoleProvider>(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Payments')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Collect payment card
          _actionCard(
            icon: Icons.payment_rounded,
            title: 'Collect Payment',
            subtitle: 'Search customer and record payment',
            color: const Color(0xFF10B981),
            onTap: () {
              Navigator.push(context, MaterialPageRoute(
                builder: (_) => const CustomerSearchScreen(forPayment: true),
              ));
            },
          ),
          const SizedBox(height: 12),

          // Unpaid customers
          if (role.canViewUnpaid) ...[
            _actionCard(
              icon: Icons.money_off_rounded,
              title: 'Unpaid Customers',
              subtitle: 'View customers with pending payments',
              color: const Color(0xFFEF4444),
              onTap: () {
                Navigator.push(context, MaterialPageRoute(
                  builder: (_) => const UnpaidListScreen(),
                ));
              },
            ),
            const SizedBox(height: 12),
          ],

          // Recent payments
          _actionCard(
            icon: Icons.history_rounded,
            title: 'Payment History',
            subtitle: 'View all recent transactions',
            color: const Color(0xFF6366F1),
            onTap: () {
              Navigator.push(context, MaterialPageRoute(
                builder: (_) => const PaymentHistoryScreen(),
              ));
            },
          ),
        ],
      ),
    );
  }

  Widget _actionCard({
    required IconData icon,
    required String title,
    required String subtitle,
    required Color color,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: color.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(icon, color: color, size: 26),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                    const SizedBox(height: 3),
                    Text(subtitle, style: TextStyle(color: Colors.grey[500], fontSize: 12)),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: Colors.grey[400]),
            ],
          ),
        ),
      ),
    );
  }
}

// Unpaid customers list
class UnpaidListScreen extends StatefulWidget {
  const UnpaidListScreen({super.key});

  @override
  State<UnpaidListScreen> createState() => _UnpaidListScreenState();
}

class _UnpaidListScreenState extends State<UnpaidListScreen> {
  List<dynamic> _customers = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final result = await ApiService.getCustomers(
        page: 1,
        perPage: 100,
        paymentFilter: 'unpaid',
      );
      if (!mounted) return;
      setState(() {
        _customers = result['customers'] ?? [];
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Unpaid (${_customers.length})'),
        backgroundColor: const Color(0xFFEF4444),
        foregroundColor: Colors.white,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _customers.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.check_circle_rounded, size: 56, color: Color(0xFF10B981)),
                      const SizedBox(height: 12),
                      const Text('All paid!', style: TextStyle(color: Color(0xFF10B981), fontSize: 16, fontWeight: FontWeight.w600)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: _customers.length,
                    itemBuilder: (context, index) {
                      final c = _customers[index];
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Material(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(14),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(14),
                            onTap: () async {
                              await Navigator.push(context, MaterialPageRoute(
                                builder: (_) => CustomerDetailScreen(
                                  customerId: c['customer_id'] ?? c['id'],
                                  forPayment: true,
                                ),
                              ));
                              _load();
                            },
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: Row(
                                children: [
                                  CircleAvatar(
                                    radius: 22,
                                    backgroundColor: const Color(0xFFFEE2E2),
                                    child: Text(
                                      (c['name'] ?? '?')[0].toUpperCase(),
                                      style: const TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.w700),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(c['name'] ?? '--', style: const TextStyle(fontWeight: FontWeight.w600)),
                                        Text('${c['customer_id'] ?? '--'} | ${c['area'] ?? '--'}', style: TextStyle(color: Colors.grey[500], fontSize: 12)),
                                      ],
                                    ),
                                  ),
                                  const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: Color(0xFFCBD5E1)),
                                ],
                              ),
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}

// Payment history screen
class PaymentHistoryScreen extends StatefulWidget {
  const PaymentHistoryScreen({super.key});

  @override
  State<PaymentHistoryScreen> createState() => _PaymentHistoryScreenState();
}

class _PaymentHistoryScreenState extends State<PaymentHistoryScreen> {
  List<dynamic> _payments = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final result = await ApiService.getCustomers(page: 1, perPage: 50, paymentFilter: 'paid');
      if (!mounted) return;
      setState(() {
        _payments = result['customers'] ?? [];
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Recent Payments')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _payments.isEmpty
              ? const Center(child: Text('No payments yet'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: _payments.length,
                    itemBuilder: (context, index) {
                      final p = _payments[index];
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Material(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(14),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(14),
                            onTap: () {
                              Navigator.push(context, MaterialPageRoute(
                                builder: (_) => CustomerDetailScreen(customerId: p['customer_id'] ?? p['id']),
                              ));
                            },
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: Row(
                                children: [
                                  Container(
                                    width: 44,
                                    height: 44,
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFDCFCE7),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: const Icon(Icons.payment_rounded, color: Color(0xFF10B981)),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(p['name'] ?? '--', style: const TextStyle(fontWeight: FontWeight.w600)),
                                        Text(
                                          '${p['customer_id'] ?? '--'} | ${p['area'] ?? '--'}',
                                          style: TextStyle(color: Colors.grey[500], fontSize: 12),
                                        ),
                                      ],
                                    ),
                                  ),
                                  Text(
                                    'Rs ${p['paid_amount'] ?? 0}',
                                    style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF10B981), fontSize: 15),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
