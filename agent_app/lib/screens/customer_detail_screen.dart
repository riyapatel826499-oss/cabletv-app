import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/role_provider.dart';
import '../services/api_service.dart';
import 'payment_screen.dart';

class CustomerDetailScreen extends StatefulWidget {
  final String customerId;
  final bool forPayment;
  const CustomerDetailScreen({super.key, required this.customerId, this.forPayment = false});

  @override
  State<CustomerDetailScreen> createState() => _CustomerDetailScreenState();
}

class _CustomerDetailScreenState extends State<CustomerDetailScreen> with SingleTickerProviderStateMixin {
  Map<String, dynamic>? _customer;
  Map<String, dynamic>? _plans;
  List<dynamic> _payments = [];
  bool _loading = true;
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    try {
      final results = await Future.wait([
        ApiService.getCustomer(widget.customerId),
        ApiService.getCustomerPlans(widget.customerId),
        ApiService.getCustomerPayments(widget.customerId),
      ]);
      if (!mounted) return;
      setState(() {
        _customer = results[0] as Map<String, dynamic>;
        _plans = results[1] as Map<String, dynamic>;
        final payResult = results[2];
        _payments = payResult is Map ? (payResult['payments'] ?? payResult['data'] ?? []) : (payResult as List);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final role = Provider.of<RoleProvider>(context);

    return Scaffold(
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : NestedScrollView(
              headerSliverBuilder: (context, innerBoxIsScrolled) => [
                SliverAppBar(
                  expandedHeight: 140,
                  pinned: true,
                  actions: [
                    if (role.canEditCustomer)
                      IconButton(icon: const Icon(Icons.edit_rounded), onPressed: () => _editCustomer()),
                    PopupMenuButton(
                      itemBuilder: (_) => [
                        if (role.canCollectPayment)
                          const PopupMenuItem(value: 'pay', child: Row(children: [Icon(Icons.payment_rounded, size: 18), SizedBox(width: 8), Text('Collect Payment')])),
                        if (role.canSurrenderCustomer && (_customer?['status'] ?? '') == 'Active')
                          const PopupMenuItem(value: 'surrender', child: Row(children: [Icon(Icons.block_rounded, size: 18), SizedBox(width: 8), Text('Surrender')])),
                        if (role.canReactivateCustomer && (_customer?['status'] ?? '') == 'Surrendered')
                          const PopupMenuItem(value: 'reactivate', child: Row(children: [Icon(Icons.restart_alt_rounded, size: 18), SizedBox(width: 8), Text('Reactivate')])),
                      ],
                      onSelected: (val) {
                        switch (val) {
                          case 'pay':
                            Navigator.push(context, MaterialPageRoute(
                              builder: (_) => PaymentScreen(customer: _customer!),
                            ));
                            break;
                          case 'surrender':
                            _surrenderCustomer();
                            break;
                          case 'reactivate':
                            _reactivateCustomer();
                            break;
                        }
                      },
                    ),
                  ],
                  flexibleSpace: FlexibleSpaceBar(
                    background: Container(
                      decoration: const BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
                        ),
                      ),
                      child: SafeArea(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(20, 56, 20, 16),
                          child: Row(
                            children: [
                              CircleAvatar(
                                radius: 30,
                                backgroundColor: Colors.white.withOpacity(0.2),
                                child: Text(
                                  (_customer?['name'] ?? '?')[0].toUpperCase(),
                                  style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w700),
                                ),
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Text(
                                      _customer?['name'] ?? '--',
                                      style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    const SizedBox(height: 3),
                                    Text(
                                      _customer?['customer_id'] ?? '--',
                                      style: TextStyle(color: Colors.white.withOpacity(0.8), fontSize: 14),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                  bottom: TabBar(
                    controller: _tabController,
                    indicatorColor: Colors.white,
                    labelColor: Colors.white,
                    unselectedLabelColor: Colors.white70,
                    tabs: const [
                      Tab(text: 'Profile'),
                      Tab(text: 'Plans'),
                      Tab(text: 'Payments'),
                    ],
                  ),
                ),
              ],
              body: TabBarView(
                controller: _tabController,
                children: [
                  _profileTab(),
                  _plansTab(),
                  _paymentsTab(),
                ],
              ),
            ),
    );
  }

  Widget _profileTab() {
    final c = _customer ?? {};
    final status = c['status'] ?? 'Active';
    final connections = c['connections'] as List? ?? [];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Status badge
        Center(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: status == 'Active' ? const Color(0xFFDCFCE7) : (status == 'Surrendered' ? const Color(0xFFFEE2E2) : const Color(0xFFFEF3C7)),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  status == 'Active' ? Icons.check_circle_rounded : (status == 'Surrendered' ? Icons.block_rounded : Icons.schedule_rounded),
                  size: 16,
                  color: status == 'Active' ? const Color(0xFF16A34A) : (status == 'Surrendered' ? const Color(0xFFDC2626) : const Color(0xFFD97706)),
                ),
                const SizedBox(width: 6),
                Text(
                  status,
                  style: TextStyle(
                    color: status == 'Active' ? const Color(0xFF16A34A) : (status == 'Surrendered' ? const Color(0xFFDC2626) : const Color(0xFFD97706)),
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),

        _infoSection('Contact Info', [
          _infoRow(Icons.person_rounded, 'Name', c['name'] ?? '--'),
          _infoRow(Icons.phone_rounded, 'Phone', c['phone'] ?? '--'),
          if (c['phone2'] != null) _infoRow(Icons.phone_rounded, 'Phone 2', c['phone2']),
          _infoRow(Icons.location_on_rounded, 'Area', c['area'] ?? '--'),
          _infoRow(Icons.home_rounded, 'Address', c['address'] ?? '--'),
        ]),

        if (connections.isNotEmpty)
          _infoSection('Connections', connections.map((conn) {
            final cm = conn as Map<String, dynamic>;
            return _infoRow(Icons.tv_rounded, 'STB', '${cm['stb_no'] ?? '--'} (${cm['mso'] ?? '--'})');
          }).toList()),

        if (c['surrendered_date'] != null)
          _infoSection('Surrender Info', [
            _infoRow(Icons.calendar_today_rounded, 'Date', c['surrendered_date'] ?? '--'),
            _infoRow(Icons.note_rounded, 'Reason', c['surrender_reason'] ?? '--'),
          ]),
      ],
    );
  }

  Widget _plansTab() {
    final plansList = (_plans?['plans'] as List?) ?? [];
    if (plansList.isEmpty) return const Center(child: Text('No active plans'));

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: plansList.length,
      itemBuilder: (context, index) {
        final p = plansList[index] as Map<String, dynamic>;
        final isActive = (p['status'] ?? '') == 'Active';
        return Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: isActive ? const Color(0xFFDCFCE7) : const Color(0xFFE2E8F0)),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: isActive ? const Color(0xFFDCFCE7) : const Color(0xFFF1F5F9),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  isActive ? Icons.check_circle_rounded : Icons.history_rounded,
                  color: isActive ? const Color(0xFF16A34A) : Colors.grey[400],
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      p['plan_name'] ?? p['name'] ?? '--',
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${p['start_date'] ?? '--'} → ${p['expiry_date'] ?? '--'}',
                      style: TextStyle(color: Colors.grey[500], fontSize: 11),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    '₹${(p['amount'] ?? p['plan_amount'] ?? 0).toDouble().toStringAsFixed(0)}',
                    style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF6366F1)),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: isActive ? const Color(0xFFDCFCE7) : const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      p['status'] ?? '--',
                      style: TextStyle(
                        color: isActive ? const Color(0xFF16A34A) : Colors.grey[500],
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _paymentsTab() {
    if (_payments.isEmpty) {
      return const Center(child: Text('No payment history'));
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _payments.length,
      itemBuilder: (context, index) {
        final p = _payments[index];
        final mode = (p['mode'] ?? p['payment_mode'] ?? '--').toString();
        final dateStr = p['date'] ?? p['collected_at'] ?? p['payment_date'] ?? '';
        final collector = p['collector'] ?? p['collected_by'] ?? '';
        final payType = p['type'] ?? '';
        final payId = p['id'] ?? '';

        return Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: const Color(0xFFDCFCE7),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.payment_rounded, color: Color(0xFF10B981), size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${mode.isNotEmpty ? mode : "--"}${collector.isNotEmpty ? " · $collector" : ""}',
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${_formatPaymentDate(dateStr)}${payType.isNotEmpty ? " · $payType" : ""}${payId.isNotEmpty ? " · $payId" : ""}',
                      style: TextStyle(color: Colors.grey[500], fontSize: 11),
                    ),
                  ],
                ),
              ),
              Text(
                '₹${(p['amount'] ?? p['collection_amount'] ?? 0).toDouble().toStringAsFixed(0)}',
                style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF10B981)),
              ),
            ],
          ),
        );
      },
    );
  }

  String _formatPaymentDate(String? dateStr) {
    if (dateStr == null || dateStr.isEmpty) return '--';
    try {
      final dt = DateTime.parse(dateStr);
      final months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      final month = months[dt.month - 1];
      int hr = dt.hour;
      final min = dt.minute.toString().padLeft(2, '0');
      final ampm = hr >= 12 ? 'PM' : 'AM';
      if (hr > 12) hr -= 12;
      if (hr == 0) hr = 12;
      return '${dt.day.toString().padLeft(2, '0')} $month ${dt.year} $hr:$min $ampm';
    } catch (_) {
      return dateStr;
    }
  }

  Widget _infoSection(String title, List<Widget> children) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: Color(0xFF6366F1))),
        ),
        Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Column(children: children),
        ),
        const SizedBox(height: 12),
      ],
    );
  }

  Widget _infoRow(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: [
          Icon(icon, size: 18, color: Colors.grey[400]),
          const SizedBox(width: 10),
          Expanded(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(label, style: TextStyle(color: Colors.grey[500], fontSize: 13)),
                Flexible(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13), textAlign: TextAlign.right)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _editCustomer() {
    // TODO: Navigate to edit
  }

  void _surrenderCustomer() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Surrender Customer'),
        content: Text('Are you sure you want to surrender ${_customer?['name'] ?? ''}?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFEF4444), foregroundColor: Colors.white),
            child: const Text('Surrender'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      try {
        await ApiService.surrenderCustomer(widget.customerId);
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Customer surrendered'), backgroundColor: Color(0xFF10B981)),
        );
        _loadData();
      } catch (e) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceAll('Exception: ', '')), backgroundColor: Colors.red),
        );
      }
    }
  }

  void _reactivateCustomer() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reactivate Customer'),
        content: Text('Reactivate ${_customer?['name'] ?? ''}?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF10B981), foregroundColor: Colors.white),
            child: const Text('Reactivate'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      try {
        await ApiService.reactivateCustomer(widget.customerId);
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Customer reactivated'), backgroundColor: Color(0xFF10B981)),
        );
        _loadData();
      } catch (e) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceAll('Exception: ', '')), backgroundColor: Colors.red),
        );
      }
    }
  }
}
