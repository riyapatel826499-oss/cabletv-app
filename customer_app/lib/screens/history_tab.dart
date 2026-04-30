import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import '../providers/customer_provider.dart';
import '../widgets/common_widgets.dart';

class HistoryTab extends StatefulWidget {
  const HistoryTab({super.key});

  @override
  State<HistoryTab> createState() => _HistoryTabState();
}

class _HistoryTabState extends State<HistoryTab>
    with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  List<dynamic> _payments = [];
  int _currentPage = 1;
  bool _hasMore = true;
  bool _isLoadingMore = false;
  String _filter = 'all'; // 'this_month', 'last_3_months', 'all'

  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _loadPayments();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
            _scrollController.position.maxScrollExtent - 200 &&
        !_isLoadingMore &&
        _hasMore) {
      _loadMore();
    }
  }

  Future<void> _loadPayments() async {
    setState(() {
      _currentPage = 1;
      _hasMore = true;
    });

    final provider = Provider.of<CustomerProvider>(context, listen: false);
    try {
      final response = await provider.api.getPayments(page: 1);
      setState(() {
        _payments = _applyFilter(response['payments'] ?? []);
        _hasMore = _payments.length < (response['total'] ?? 0);
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: const Color(0xFFEF4444),
          ),
        );
      }
    }
  }

  Future<void> _loadMore() async {
    if (_isLoadingMore || !_hasMore) return;
    setState(() => _isLoadingMore = true);

    final provider = Provider.of<CustomerProvider>(context, listen: false);
    try {
      _currentPage++;
      final response = await provider.api.getPayments(page: _currentPage);
      final newPayments = _applyFilter(response['payments'] ?? []);
      setState(() {
        _payments.addAll(newPayments);
        _hasMore = newPayments.length >= 10;
        _isLoadingMore = false;
      });
    } catch (e) {
      setState(() => _isLoadingMore = false);
      _currentPage--;
    }
  }

  List<dynamic> _applyFilter(List<dynamic> payments) {
    if (_filter == 'all') return payments;
    final now = DateTime.now();
    return payments.where((p) {
      try {
        final dateStr = p['date'] ?? p['created_at'] ?? '';
        final date = DateTime.parse(dateStr.toString());
        if (_filter == 'this_month') {
          return date.month == now.month && date.year == now.year;
        } else if (_filter == 'last_3_months') {
          final threeMonthsAgo = DateTime(now.year, now.month - 3, now.day);
          return date.isAfter(threeMonthsAgo);
        }
      } catch (e) {
        // ignore: parse failures default to including payment
      }
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Consumer<CustomerProvider>(
      builder: (context, provider, _) {
        final totalPaid =
            (provider.dashboard?['total_paid_this_month'] as num?)?.toDouble() ??
                0.0;

        return Scaffold(
          backgroundColor: const Color(0xFFF8FAFC),
          body: RefreshIndicator(
            onRefresh: _loadPayments,
            color: const Color(0xFF1E3A8A),
            child: CustomScrollView(
              controller: _scrollController,
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                // Header
                SliverAppBar(
                  floating: true,
                  backgroundColor: const Color(0xFF1E3A8A),
                  title: Text(
                    'Payment History',
                    style: GoogleFonts.poppins(
                      fontWeight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                ),

                SliverPadding(
                  padding: const EdgeInsets.all(16),
                  sliver: SliverList(
                    delegate: SliverChildListDelegate([
                      // Total Paid Card
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Color(0xFF1E3A8A), Color(0xFF3B82F6)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Total Paid This Month',
                              style: GoogleFonts.poppins(
                                fontSize: 14,
                                color: Colors.white70,
                              ),
                            ),
                            const SizedBox(height: 4),
                            amountDisplay(
                              totalPaid,
                              fontSize: 32,
                              color: Colors.white,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Filter Chips
                      Row(
                        children: [
                          _filterChip('This Month', 'this_month'),
                          const SizedBox(width: 8),
                          _filterChip('Last 3 Months', 'last_3_months'),
                          const SizedBox(width: 8),
                          _filterChip('All', 'all'),
                        ],
                      ),
                      const SizedBox(height: 16),
                    ]),
                  ),
                ),

                // Payments List
                _payments.isEmpty
                    ? SliverFillRemaining(
                        child: emptyState(
                          'No payments yet',
                          icon: Icons.receipt_long_outlined,
                        ),
                      )
                    : SliverPadding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        sliver: SliverList(
                          delegate: SliverChildBuilderDelegate(
                            (context, index) {
                              if (index == _payments.length) {
                                return _isLoadingMore
                                    ? const Padding(
                                        padding: EdgeInsets.all(16),
                                        child: Center(
                                          child: CircularProgressIndicator(
                                            color: Color(0xFF1E3A8A),
                                          ),
                                        ),
                                      )
                                    : const SizedBox.shrink();
                              }
                              return _paymentCard(_payments[index]);
                            },
                            childCount:
                                _payments.length + (_hasMore ? 1 : 0),
                          ),
                        ),
                      ),

                SliverToBoxAdapter(
                  child: SizedBox(height: 80),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _filterChip(String label, String value) {
    final isActive = _filter == value;
    return GestureDetector(
      onTap: () {
        setState(() => _filter = value);
        _loadPayments();
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: isActive ? const Color(0xFF1E3A8A) : Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isActive
                ? const Color(0xFF1E3A8A)
                : Colors.grey[300]!,
          ),
        ),
        child: Text(
          label,
          style: GoogleFonts.poppins(
            fontSize: 12,
            fontWeight: FontWeight.w500,
            color: isActive ? Colors.white : Colors.grey[600],
          ),
        ),
      ),
    );
  }

  Widget _paymentCard(Map<String, dynamic> payment) {
    final amount =
        (payment['amount'] as num?)?.toDouble() ?? 0.0;
    final dateStr =
        payment['date']?.toString() ?? payment['created_at']?.toString() ?? '';
    final mode = payment['mode']?.toString() ??
        payment['payment_mode']?.toString() ??
        'Online';

    Color modeColor;
    if (mode.toLowerCase().contains('cash')) {
      modeColor = Colors.grey[600]!;
    } else if (mode.toLowerCase().contains('gpay') ||
        mode.toLowerCase().contains('upi')) {
      modeColor = const Color(0xFF7C3AED);
    } else {
      modeColor = const Color(0xFF3B82F6);
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: modeColor.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
              mode.toLowerCase().contains('cash')
                  ? Icons.money
                  : Icons.credit_card,
              color: modeColor,
              size: 20,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _formatDate(dateStr),
                  style: GoogleFonts.poppins(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 4),
                statusBadge(mode, modeColor),
              ],
            ),
          ),
          amountDisplay(amount, fontSize: 18),
        ],
      ),
    );
  }

  String _formatDate(String dateStr) {
    try {
      final date = DateTime.parse(dateStr);
      return '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}';
    } catch (e) {
      return dateStr;
    }
  }
}
