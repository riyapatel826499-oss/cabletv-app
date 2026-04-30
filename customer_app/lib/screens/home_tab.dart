import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../providers/customer_provider.dart';
import '../widgets/common_widgets.dart';
import 'main_shell.dart';

class HomeTab extends StatefulWidget {
  const HomeTab({super.key});

  @override
  State<HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<HomeTab> with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadData();
    });
  }

  Future<void> _loadData() async {
    final provider = Provider.of<CustomerProvider>(context, listen: false);
    if (provider.dashboard == null) {
      await provider.loadDashboard();
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Consumer<CustomerProvider>(
      builder: (context, provider, _) {
        final dash = provider.dashboard;
        final name = dash?['name'] ?? provider.customer?['name'] ?? 'Customer';
        final status = dash?['status'] ?? 'Unknown';
        final dueAmount = (dash?['due_amount'] as num?)?.toDouble() ?? 0.0;
        final connection = dash?['connection'] as Map<String, dynamic>? ??
            (provider.profile?['connections'] != null &&
                    (provider.profile!['connections'] as List).isNotEmpty
                ? provider.profile!['connections'][0] as Map<String, dynamic>
                : null);
        final currentPlan = dash?['current_plan'] as Map<String, dynamic>?;
        final lastPayment = dash?['last_payment'] as Map<String, dynamic>?;

        return Scaffold(
          backgroundColor: const Color(0xFFF8FAFC),
          body: RefreshIndicator(
            onRefresh: () async {
              await provider.loadDashboard();
            },
            color: const Color(0xFF1E3A8A),
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                // AppBar
                SliverAppBar(
                  expandedHeight: 60,
                  floating: true,
                  backgroundColor: const Color(0xFF1E3A8A),
                  title: Text(
                    'SSA Cables',
                    style: GoogleFonts.poppins(
                      fontWeight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                  actions: [
                    IconButton(
                      icon: const Icon(Icons.notifications_outlined,
                          color: Colors.white),
                      onPressed: () {},
                    ),
                  ],
                ),

                SliverPadding(
                  padding: const EdgeInsets.all(16),
                  sliver: SliverList(
                    delegate: SliverChildListDelegate([
                      // Welcome Card
                      _welcomeCard(name, provider),
                      const SizedBox(height: 14),

                      // Connection Status Card
                      _connectionStatusCard(connection, status),
                      const SizedBox(height: 14),

                      // Current Plan Card
                      if (currentPlan != null)
                        _currentPlanCard(currentPlan),
                      if (currentPlan != null) const SizedBox(height: 14),

                      // Due Amount Card
                      _dueAmountCard(dueAmount),
                      const SizedBox(height: 14),

                      // Last Payment Card
                      if (lastPayment != null)
                        _lastPaymentCard(lastPayment),
                      if (lastPayment != null) const SizedBox(height: 14),

                      // Quick Actions
                      _quickActionsRow(),
                      const SizedBox(height: 20),
                    ]),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _welcomeCard(String name, CustomerProvider provider) {
    final customerId =
        provider.customer?['customer_id'] ?? provider.dashboard?['customer_id'] ?? '';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF1E3A8A), Color(0xFF3B82F6)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF1E3A8A).withValues(alpha: 0.3),
            blurRadius: 12,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.wb_sunny, color: Colors.amber, size: 20),
              const SizedBox(width: 8),
              Text(
                _greeting(),
                style: GoogleFonts.poppins(
                  fontSize: 13,
                  color: Colors.white70,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Hello, $name!',
            style: GoogleFonts.poppins(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
          if (customerId.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                'ID: $customerId',
                style: GoogleFonts.poppins(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  color: Colors.white,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _connectionStatusCard(Map<String, dynamic>? conn, String status) {
    final isActive = status.toLowerCase() == 'active';
    return infoCard(
      'Connection Status',
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              statusBadge(
                status,
                isActive ? const Color(0xFF10B981) : const Color(0xFFEF4444),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: (isActive ? const Color(0xFF10B981) : const Color(0xFFEF4444))
                      .withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  isActive ? Icons.check_circle : Icons.cancel,
                  color: isActive ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                  size: 20,
                ),
              ),
            ],
          ),
          if (conn != null) ...[
            const SizedBox(height: 12),
            _infoRow('STB No', conn['stb_no']?.toString() ?? '-'),
            const SizedBox(height: 6),
            _infoRow('MSO', conn['mso']?.toString() ?? '-'),
            if (conn['can_id'] != null) ...[
              const SizedBox(height: 6),
              _infoRow('CAN ID', conn['can_id'].toString()),
            ],
          ],
        ],
      ),
      accentColor: isActive ? const Color(0xFF10B981) : const Color(0xFFEF4444),
      icon: isActive ? Icons.verified : Icons.error_outline,
    );
  }

  Widget _currentPlanCard(Map<String, dynamic> plan) {
    final amount = (plan['amount'] as num?)?.toDouble() ?? 0.0;
    final dueDate = plan['due_date'] as String?;
    return infoCard(
      'Current Plan',
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  plan['name']?.toString() ?? 'Standard Plan',
                  style: GoogleFonts.poppins(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              amountDisplay(amount, fontSize: 20, color: const Color(0xFF1E3A8A)),
            ],
          ),
          if (plan['validity'] != null) ...[
            const SizedBox(height: 8),
            _infoRow('Validity', plan['validity'].toString()),
          ],
          if (dueDate != null) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Text(
                  'Due: ',
                  style: GoogleFonts.poppins(
                      fontSize: 13, color: Colors.grey[500]),
                ),
                Text(
                  _formatDate(dueDate),
                  style: GoogleFonts.poppins(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: const Color(0xFFEF4444),
                  ),
                ),
                const SizedBox(width: 8),
                _daysRemaining(dueDate),
              ],
            ),
          ],
        ],
      ),
      accentColor: const Color(0xFF1E3A8A),
      icon: Icons.subscriptions,
    );
  }

  Widget _dueAmountCard(double dueAmount) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: dueAmount > 0 ? const Color(0xFFFEF2F2) : const Color(0xFFF0FDF4),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: dueAmount > 0
              ? const Color(0xFFEF4444).withValues(alpha: 0.3)
              : const Color(0xFF10B981).withValues(alpha: 0.3),
        ),
      ),
      child: Column(
        children: [
          Text(
            dueAmount > 0 ? 'Amount Due' : 'All Clear!',
            style: GoogleFonts.poppins(
              fontSize: 14,
              color: dueAmount > 0 ? const Color(0xFFEF4444) : const Color(0xFF10B981),
            ),
          ),
          const SizedBox(height: 4),
          amountDisplay(
            dueAmount,
            fontSize: 36,
            color: dueAmount > 0 ? const Color(0xFFEF4444) : const Color(0xFF10B981),
          ),
          if (dueAmount > 0) ...[
            const SizedBox(height: 12),
            SizedBox(
              height: 42,
              child: ElevatedButton(
                onPressed: () {
                  final shellState = MainShell.of(context);
                  shellState?.switchToTab(1);
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFEF4444),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Pay Now',
                      style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(width: 4),
                    const Icon(Icons.arrow_forward, size: 18),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _lastPaymentCard(Map<String, dynamic> payment) {
    final amount =
        (payment['amount'] as num?)?.toDouble() ?? 0.0;
    final date = payment['date']?.toString() ?? payment['created_at']?.toString() ?? '';
    final mode = payment['mode']?.toString() ?? payment['payment_mode']?.toString() ?? 'Online';

    return infoCard(
      'Last Payment',
      Row(
        children: [
          amountDisplay(amount, fontSize: 22),
          const Spacer(),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                date.isNotEmpty ? _formatDate(date) : '-',
                style: GoogleFonts.poppins(
                    fontSize: 13, color: Colors.grey[500]),
              ),
              const SizedBox(height: 4),
              statusBadge(
                mode,
                mode.toLowerCase().contains('cash')
                    ? Colors.grey[600]!
                    : mode.toLowerCase().contains('gpay') ||
                            mode.toLowerCase().contains('upi')
                        ? const Color(0xFF7C3AED)
                        : const Color(0xFF3B82F6),
              ),
            ],
          ),
        ],
      ),
      accentColor: const Color(0xFF10B981),
      icon: Icons.payment,
    );
  }

  Widget _quickActionsRow() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Quick Actions',
          style: GoogleFonts.poppins(
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            _quickAction(
              'Pay Bill',
              Icons.account_balance_wallet,
              const Color(0xFF10B981),
              () {
                final shellState = MainShell.of(context);
                shellState?.switchToTab(1);
              },
            ),
            const SizedBox(width: 12),
            _quickAction(
              'Call Us',
              Icons.phone,
              const Color(0xFF3B82F6),
              () async {
                final uri = Uri(scheme: 'tel', path: '7708551139');
                if (await canLaunchUrl(uri)) {
                  await launchUrl(uri);
                }
              },
            ),
            const SizedBox(width: 12),
            _quickAction(
              'WhatsApp',
              Icons.chat,
              const Color(0xFF25D366),
              () async {
                final uri =
                    Uri.parse('https://wa.me/917708551139');
                if (await canLaunchUrl(uri)) {
                  await launchUrl(uri, mode: LaunchMode.externalApplication);
                }
              },
            ),
          ],
        ),
      ],
    );
  }

  Widget _quickAction(String label, IconData icon, Color color, VoidCallback onTap) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.05),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: color, size: 22),
              ),
              const SizedBox(height: 8),
              Text(
                label,
                textAlign: TextAlign.center,
                style: GoogleFonts.poppins(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Row(
      children: [
        Text(
          '$label: ',
          style: GoogleFonts.poppins(fontSize: 13, color: Colors.grey[500]),
        ),
        Text(
          value,
          style: GoogleFonts.poppins(
            fontSize: 13,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }

  String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  }

  String _formatDate(String dateStr) {
    try {
      final date = DateTime.parse(dateStr);
      return '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}';
    } catch (e) {
      return dateStr;
    }
  }

  Widget _daysRemaining(String dueDateStr) {
    try {
      final dueDate = DateTime.parse(dueDateStr);
      final now = DateTime.now();
      final diff = dueDate.difference(now).inDays;
      if (diff < 0) {
        return Text(
          '${-diff} days overdue',
          style: GoogleFonts.poppins(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: const Color(0xFFEF4444),
          ),
        );
      } else if (diff == 0) {
        return Text(
          'Due today!',
          style: GoogleFonts.poppins(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: const Color(0xFFF59E0B),
          ),
        );
      } else {
        return Text(
          '$diff days left',
          style: GoogleFonts.poppins(
            fontSize: 11,
            color: Colors.grey[500],
          ),
        );
      }
    } catch (e) {
      return const SizedBox.shrink();
    }
  }
}


