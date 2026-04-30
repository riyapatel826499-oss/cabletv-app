import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../services/api_service.dart';
import 'customer_mobile_auth_screen.dart';

class CustomerDashboardScreen extends StatefulWidget {
  const CustomerDashboardScreen({super.key});

  @override
  State<CustomerDashboardScreen> createState() => _CustomerDashboardScreenState();
}

class _CustomerDashboardScreenState extends State<CustomerDashboardScreen> {
  Map<String, dynamic>? _customerData;
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadCustomerData();
  }

  Future<void> _loadCustomerData() async {
    try {
      final data = await ApiService.getCustomerProfile(); // Uses Bearer token
      setState(() {
        _customerData = data;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  Future<void> _logout() async {
    await ApiService.logout();
    if (!mounted) return;
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(builder: (_) => const CustomerMobileAuthScreen()),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: CustomScrollView(
        slivers: [
          // App Bar
          SliverAppBar(
            expandedHeight: 160,
            floating: false,
            pinned: true,
            backgroundColor: const Color(0xFF1e1b4b),
            flexibleSpace: FlexibleSpaceBar(
              background: Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFF1e1b4b), Color(0xFF3730a3), Color(0xFF6366F1)],
                  ),
                ),
                child: SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(20, 60, 20, 20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.tv_rounded, color: Colors.white, size: 32),
                        const SizedBox(height: 12),
                        const Text(
                          'Customer Portal',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 24,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          _customerData?['name'] ?? 'Your Account',
                          style: const TextStyle(color: Colors.white70, fontSize: 14),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            actions: [
              IconButton(
                icon: const Icon(Icons.logout_rounded, color: Colors.white),
                onPressed: _logout,
              ),
            ],
          ),

          // Content
          if (_isLoading)
            const SliverFillRemaining(
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_error != null)
            SliverFillRemaining(
              child: Center(child: Text(_error!)),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.all(16),
              sliver: SliverList(
                delegate: SliverChildListDelegate([
                  // Status Card
                  _buildStatusCard(),
                  const SizedBox(height: 16),

                  // Quick Actions
                  _buildQuickActions(),
                  const SizedBox(height: 16),

                  // Recent Payments
                  _buildRecentPayments(),
                  const SizedBox(height: 16),

                  // Plan Details
                  _buildPlanDetails(),
                  const SizedBox(height: 16),

                  // Support
                  _buildSupportCard(),
                ]),
              ),
            ),
        ],
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          boxShadow: [
            BoxShadow(color: const Color(0xFFE2E8F0), blurRadius: 10, offset: const Offset(0, -4)),
          ],
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: ElevatedButton.icon(
              onPressed: () => _showPayBillDialog(),
              icon: const Icon(Icons.payment_rounded),
              label: const Text('Pay Bill Now', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF6366F1),
                foregroundColor: Colors.white,
                minimumSize: const Size(double.infinity, 52),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStatusCard() {
    final status = _customerData?['status'] ?? 'active';
    final isActive = status == 'active';
    final lastPayment = _customerData?['last_payment_date'];
    final nextDue = _customerData?['next_due_date'];

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(color: const Color(0xFFE2E8F0), blurRadius: 8, offset: const Offset(0, 2)),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: isActive ? const Color(0xFFE6F5EC) : const Color(0xFFFEE2E2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    isActive ? Icons.check_circle_rounded : Icons.warning_rounded,
                    color: isActive ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                    size: 24,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        isActive ? 'Account Active' : 'Connection Inactive',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: isActive ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        nextDue != null
                          ? 'Next due: ${_formatDate(nextDue)}'
                          : lastPayment != null
                            ? 'Last paid: ${_formatDate(lastPayment)}'
                            : 'No payment history',
                        style: const TextStyle(color: Color(0xFF64748B), fontSize: 13),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickActions() {
    return Row(
      children: [
        Expanded(child: _actionCard(Icons.receipt_long_rounded, 'View Bills', const Color(0xFF6366F1))),
        const SizedBox(width: 12),
        Expanded(child: _actionCard(Icons.history_rounded, 'Payment History', const Color(0xFF8B5CF6))),
      ],
    );
  }

  Widget _actionCard(IconData icon, String label, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(color: const Color(0xFFE2E8F0), blurRadius: 8, offset: const Offset(0, 2)),
        ],
      ),
      child: Column(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: color, size: 24),
          ),
          const SizedBox(height: 12),
          Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }

  Widget _buildRecentPayments() {
    final payments = _customerData?['payments'] ?? [];

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(color: const Color(0xFFE2E8F0), blurRadius: 8, offset: const Offset(0, 2)),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Recent Payments', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                TextButton(
                  onPressed: () {},
                  child: const Text('View All'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (payments.isEmpty)
              Center(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Text(
                    'No payments yet',
                    style: TextStyle(color: Colors.grey[500]),
                  ),
                ),
              )
            else
              ...payments.take(3).map<Widget>((p) => _paymentTile(p)).toList(),
          ],
        ),
      ),
    );
  }

  Widget _paymentTile(dynamic payment) {
    final amount = payment['amount'] ?? 0;
    final date = payment['payment_date'] ?? 'Unknown';
    final month = payment['month_year'] ?? '';

    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: const Color(0xFFE6F5EC),
          borderRadius: BorderRadius.circular(10),
        ),
        child: const Icon(Icons.check, color: Color(0xFF10B981), size: 20),
      ),
      title: Text('₹$amount', style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(month.isNotEmpty ? 'For $month' : _formatDate(date)),
      trailing: Text(
        _formatDate(date),
        style: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
      ),
    );
  }

  Widget _buildPlanDetails() {
    final plan = _customerData?['plan'] ?? {};
    final planName = plan['name'] ?? 'Standard Plan';
    final planPrice = plan['price'] ?? 0;
    final stbCount = _customerData?['connections']?.length ?? 1;

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(color: Color(0xFFE2E8F0), blurRadius: 8, offset: Offset(0, 2)),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Current Plan', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 16),
            Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: const Color(0xFFE0E7FF),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.tv_rounded, color: Color(0xFF6366F1), size: 24),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(planName, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 4),
                      Text('₹$planPrice/month • $stbCount STB${stbCount > 1 ? 's' : ''}',
                        style: const TextStyle(color: Color(0xFF64748B), fontSize: 13)),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSupportCard() {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF1e1b4b),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            const Icon(Icons.support_agent_rounded, color: Colors.white, size: 32),
            const SizedBox(width: 16),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Need Help?', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 16)),
                  SizedBox(height: 4),
                  Text('Contact our support team', style: TextStyle(color: Colors.white70, fontSize: 13)),
                ],
              ),
            ),
            IconButton(
              icon: const Icon(Icons.arrow_forward_ios, color: Colors.white, size: 16),
              onPressed: () {},
            ),
          ],
        ),
      ),
    );
  }

  String _formatDate(dynamic date) {
    if (date == null) return '';
    try {
      final d = DateTime.parse(date.toString());
      return DateFormat('dd MMM yyyy').format(d);
    } catch (e) {
      return date.toString();
    }
  }

  void _showPayBillDialog() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(context).viewInsets.bottom,
          ),
          child: Container(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.grey[300],
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                const Text('Pay Bill', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                const SizedBox(height: 20),
                const Text('Amount Due', style: TextStyle(color: Color(0xFF64748B), fontSize: 13)),
                const SizedBox(height: 4),
                Text('₹${_customerData?['amount_due'] ?? 0}', style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w700)),
                const SizedBox(height: 24),
                const Text('Payment Method', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
                const SizedBox(height: 12),
                _paymentMethodTile('UPI / Google Pay', Icons.account_balance_wallet_rounded),
                _paymentMethodTile('Credit/Debit Card', Icons.credit_card_rounded),
                _paymentMethodTile('Net Banking', Icons.account_balance_rounded),
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton(
                    onPressed: () {
                      Navigator.pop(context);
                      _showPaymentProcessing();
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF6366F1),
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: const Text('Continue to Pay', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _paymentMethodTile(String label, IconData icon) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Row(
        children: [
          Icon(icon, color: const Color(0xFF6366F1), size: 24),
          const SizedBox(width: 16),
          Expanded(child: Text(label, style: const TextStyle(fontWeight: FontWeight.w500))),
          const Icon(Icons.arrow_forward_ios, size: 16, color: Color(0xFF94A3B8)),
        ],
      ),
    );
  }

  void _showPaymentProcessing() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 20),
            const Text('Processing payment...'),
          ],
        ),
      ),
    );

    // Simulate payment
    Future.delayed(const Duration(seconds: 2), () {
      Navigator.pop(context);
      _showPaymentSuccess();
    });
  }

  void _showPaymentSuccess() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 80,
              height: 80,
              decoration: const BoxDecoration(
                color: Color(0xFFE6F5EC),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.check, color: Color(0xFF10B981), size: 40),
            ),
            const SizedBox(height: 20),
            const Text('Payment Successful!', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            const Text('Thank you for your payment', style: TextStyle(color: Color(0xFF64748B))),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              _loadCustomerData();
            },
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }
}
