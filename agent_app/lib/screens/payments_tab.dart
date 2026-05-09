import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
          _actionCard(
            icon: Icons.receipt_long_rounded,
            title: 'Paid List',
            subtitle: 'View all paid customers with details',
            color: const Color(0xFFE11D48),
            onTap: () {
              Navigator.push(context, MaterialPageRoute(
                builder: (_) => const PaidListScreen(),
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

// ========== Paypakka-style Paid List Screen ==========
class PaidListScreen extends StatefulWidget {
  const PaidListScreen({super.key});

  @override
  State<PaidListScreen> createState() => _PaidListScreenState();
}

class _PaidListScreenState extends State<PaidListScreen> {
  List<dynamic> _allPayments = [];
  List<dynamic> _filtered = [];
  bool _loading = true;
  String _searchQuery = '';
  String? _selectedArea;
  List<String> _areas = [];
  double _totalCash = 0;
  double _totalOnline = 0;
  DateTime? _filterDateFrom;
  DateTime? _filterDateTo;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final result = await ApiService.getCustomers(
        page: 1,
        perPage: 200,
        paymentFilter: 'paid',
      );
      if (!mounted) return;
      final payments = List<dynamic>.from(result['customers'] ?? []);
      final areas = List<String>.from(result['areas'] ?? []);

      // Sort by payment date descending (latest first)
      payments.sort((a, b) {
        final da = _parseDate(a['payment_date']);
        final db = _parseDate(b['payment_date']);
        return db.compareTo(da);
      });

      double cash = 0, online = 0;
      for (var p in payments) {
        final amt = (p['paid_amount'] ?? 0).toDouble();
        final mode = (p['payment_mode'] ?? '').toString().toLowerCase();
        if (mode.contains('online') || mode.contains('upi') || mode.contains('gpay') || mode.contains('phonepe') || mode.contains('bank')) {
          online += amt;
        } else {
          cash += amt;
        }
      }

      setState(() {
        _allPayments = payments;
        _areas = areas;
        _totalCash = cash;
        _totalOnline = online;
        _loading = false;
      });
      _applyFilters();
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  DateTime _parseDate(dynamic dateStr) {
    if (dateStr == null) return DateTime.fromMillisecondsSinceEpoch(0);
    try {
      return DateTime.parse(dateStr.toString());
    } catch (_) {
      return DateTime.fromMillisecondsSinceEpoch(0);
    }
  }

  void _applyFilters() {
    var filtered = _allPayments;

    // Date range filter
    if (_filterDateFrom != null) {
      final from = DateTime(_filterDateFrom!.year, _filterDateFrom!.month, _filterDateFrom!.day);
      filtered = filtered.where((p) {
        final d = _parseDate(p['payment_date']);
        final dd = DateTime(d.year, d.month, d.day);
        return !dd.isBefore(from);
      }).toList();
    }
    if (_filterDateTo != null) {
      final to = DateTime(_filterDateTo!.year, _filterDateTo!.month, _filterDateTo!.day);
      filtered = filtered.where((p) {
        final d = _parseDate(p['payment_date']);
        final dd = DateTime(d.year, d.month, d.day);
        return !dd.isAfter(to);
      }).toList();
    }

    // Area filter
    if (_selectedArea != null) {
      filtered = filtered.where((p) => p['area'] == _selectedArea).toList();
    }

    // Search filter
    if (_searchQuery.isNotEmpty) {
      final q = _searchQuery.toLowerCase();
      filtered = filtered.where((p) {
        return (p['name'] ?? '').toString().toLowerCase().contains(q) ||
               (p['customer_id'] ?? '').toString().toLowerCase().contains(q) ||
               (p['phone'] ?? '').toString().toLowerCase().contains(q) ||
               (p['area'] ?? '').toString().toLowerCase().contains(q) ||
               (p['stb_no'] ?? '').toString().toLowerCase().contains(q);
      }).toList();
    }

    // Re-sort filtered results by date desc
    filtered.sort((a, b) => _parseDate(b['payment_date']).compareTo(_parseDate(a['payment_date'])));

    setState(() => _filtered = filtered);
  }

  String _formatDate(String? dateStr) {
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
      return '$month ${dt.day.toString().padLeft(2, '0')}, $hr:$min $ampm';
    } catch (_) {
      return dateStr;
    }
  }

  String _dateLabel(DateTime? d) {
    if (d == null) return '';
    final months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return '${d.day.toString().padLeft(2, '0')} ${months[d.month - 1]} ${d.year}';
  }

  Future<void> _pickDateFrom() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _filterDateFrom ?? DateTime.now(),
      firstDate: DateTime(2024),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) {
      _filterDateFrom = picked;
      _applyFilters();
    }
  }

  Future<void> _pickDateTo() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _filterDateTo ?? DateTime.now(),
      firstDate: DateTime(2024),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) {
      _filterDateTo = picked;
      _applyFilters();
    }
  }

  void _copyToClipboard(String text) {
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Copied: $text'),
        duration: const Duration(seconds: 1),
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(8),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F5F5),
      appBar: AppBar(
        title: const Text('Paid List'),
        backgroundColor: const Color(0xFFE11D48),
        foregroundColor: Colors.white,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                // Summary cards row
                Container(
                  color: Colors.white,
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
                  child: Row(
                    children: [
                      _summaryCard(
                        count: '${_allPayments.length}',
                        label: 'Total Paid',
                        iconColor: const Color(0xFFF59E0B),
                        bgColor: const Color(0xFFFFFBEB),
                      ),
                      const SizedBox(width: 8),
                      _summaryCard(
                        count: '₹${_totalCash.toStringAsFixed(0)}',
                        label: 'Cash',
                        iconColor: const Color(0xFF3B82F6),
                        bgColor: const Color(0xFFEFF6FF),
                      ),
                      const SizedBox(width: 8),
                      _summaryCard(
                        count: '₹${_totalOnline.toStringAsFixed(0)}',
                        label: 'Online',
                        iconColor: const Color(0xFFEC4899),
                        bgColor: const Color(0xFFFDF2F8),
                      ),
                    ],
                  ),
                ),

                // Search bar
                Container(
                  color: Colors.white,
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 6),
                  child: TextField(
                    decoration: InputDecoration(
                      hintText: 'Search name, ID, phone, STB...',
                      hintStyle: TextStyle(color: Colors.grey[400], fontSize: 13),
                      prefixIcon: Icon(Icons.search_rounded, color: Colors.grey[400], size: 20),
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(vertical: 10),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide(color: Colors.grey[300]!),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide(color: Colors.grey[300]!),
                      ),
                    ),
                    style: const TextStyle(fontSize: 14),
                    onChanged: (v) {
                      _searchQuery = v;
                      _applyFilters();
                    },
                  ),
                ),

                // Filters row: Area + Date
                Container(
                  color: Colors.white,
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        // Area filter
                        if (_areas.isNotEmpty)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8),
                            decoration: BoxDecoration(
                              border: Border.all(color: Colors.grey[300]!),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: DropdownButton<String>(
                              value: _selectedArea,
                              hint: Text('Area', style: TextStyle(color: Colors.grey[500], fontSize: 12)),
                              underline: const SizedBox(),
                              isDense: true,
                              style: const TextStyle(fontSize: 12, color: Color(0xFF334155)),
                              items: [
                                const DropdownMenuItem<String>(value: null, child: Text('All Areas', style: TextStyle(fontSize: 12))),
                                ..._areas.map((a) => DropdownMenuItem<String>(value: a, child: Text(a, style: const TextStyle(fontSize: 12)))),
                              ],
                              onChanged: (v) {
                                _selectedArea = v;
                                _applyFilters();
                              },
                            ),
                          ),
                        const SizedBox(width: 6),
                        // Date from
                        GestureDetector(
                          onTap: _pickDateFrom,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                            decoration: BoxDecoration(
                              border: Border.all(color: _filterDateFrom != null ? const Color(0xFF6366F1) : Colors.grey[300]!),
                              borderRadius: BorderRadius.circular(10),
                              color: _filterDateFrom != null ? const Color(0xFFEEF2FF) : null,
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.calendar_today_rounded, size: 14, color: _filterDateFrom != null ? const Color(0xFF6366F1) : Colors.grey[500]),
                                const SizedBox(width: 4),
                                Text(
                                  _filterDateFrom != null ? _dateLabel(_filterDateFrom) : 'From',
                                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: _filterDateFrom != null ? const Color(0xFF6366F1) : Colors.grey[500]),
                                ),
                                if (_filterDateFrom != null) ...[
                                  const SizedBox(width: 4),
                                  GestureDetector(
                                    onTap: () { _filterDateFrom = null; _applyFilters(); },
                                    child: Icon(Icons.clear_rounded, size: 14, color: Colors.grey[500]),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        // Date to
                        GestureDetector(
                          onTap: _pickDateTo,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                            decoration: BoxDecoration(
                              border: Border.all(color: _filterDateTo != null ? const Color(0xFF6366F1) : Colors.grey[300]!),
                              borderRadius: BorderRadius.circular(10),
                              color: _filterDateTo != null ? const Color(0xFFEEF2FF) : null,
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.calendar_today_rounded, size: 14, color: _filterDateTo != null ? const Color(0xFF6366F1) : Colors.grey[500]),
                                const SizedBox(width: 4),
                                Text(
                                  _filterDateTo != null ? _dateLabel(_filterDateTo) : 'To',
                                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: _filterDateTo != null ? const Color(0xFF6366F1) : Colors.grey[500]),
                                ),
                                if (_filterDateTo != null) ...[
                                  const SizedBox(width: 4),
                                  GestureDetector(
                                    onTap: () { _filterDateTo = null; _applyFilters(); },
                                    child: Icon(Icons.clear_rounded, size: 14, color: Colors.grey[500]),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                // Count + filtered total
                Container(
                  color: Colors.white,
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
                  child: Row(
                    children: [
                      Text(
                        '${_filtered.length} payments',
                        style: TextStyle(color: Colors.grey[500], fontSize: 12, fontWeight: FontWeight.w500),
                      ),
                      if (_filtered.isNotEmpty) ...[
                        const Spacer(),
                        Text(
                          'Total: ₹${_filtered.fold<double>(0, (sum, p) => sum + (p["paid_amount"] ?? 0).toDouble()).toStringAsFixed(0)}',
                          style: const TextStyle(color: Color(0xFF10B981), fontSize: 12, fontWeight: FontWeight.w700),
                        ),
                      ],
                    ],
                  ),
                ),

                // Payment list
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _load,
                    child: _filtered.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.receipt_long_outlined, size: 56, color: Colors.grey[300]),
                                const SizedBox(height: 12),
                                Text('No payments found', style: TextStyle(color: Colors.grey[400], fontSize: 15)),
                              ],
                            ),
                          )
                        : ListView.builder(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            itemCount: _filtered.length,
                            itemBuilder: (context, index) {
                              final p = _filtered[index];
                              final mode = (p['payment_mode'] ?? 'Cash').toString();
                              final isOnline = mode.toLowerCase().contains('online') ||
                                               mode.toLowerCase().contains('upi') ||
                                               mode.toLowerCase().contains('gpay') ||
                                               mode.toLowerCase().contains('phonepe') ||
                                               mode.toLowerCase().contains('bank');
                              final modeColor = isOnline ? const Color(0xFFEC4899) : const Color(0xFF3B82F6);
                              final stbNo = (p['stb_no'] ?? '--').toString();

                              return Container(
                                margin: const EdgeInsets.symmetric(vertical: 4),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(color: const Color(0xFFF1F5F9)),
                                ),
                                child: Material(
                                  color: Colors.transparent,
                                  borderRadius: BorderRadius.circular(14),
                                  child: InkWell(
                                    borderRadius: BorderRadius.circular(14),
                                    onTap: () {
                                      Navigator.push(context, MaterialPageRoute(
                                        builder: (_) => CustomerDetailScreen(customerId: p['customer_id'] ?? p['id']),
                                      ));
                                    },
                                    child: Padding(
                                      padding: const EdgeInsets.all(12),
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          // Top row: Avatar + Name + Amount
                                          Row(
                                            children: [
                                              CircleAvatar(
                                                radius: 20,
                                                backgroundColor: const Color(0xFFDCFCE7),
                                                child: Text(
                                                  (p['name'] ?? '?')[0].toUpperCase(),
                                                  style: const TextStyle(color: Color(0xFF16A34A), fontWeight: FontWeight.w700),
                                                ),
                                              ),
                                              const SizedBox(width: 10),
                                              Expanded(
                                                child: Column(
                                                  crossAxisAlignment: CrossAxisAlignment.start,
                                                  children: [
                                                    Text(
                                                      p['name'] ?? '--',
                                                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                                                    ),
                                                    const SizedBox(height: 2),
                                                    Text(
                                                      '${p['customer_id'] ?? '--'} | ${p['phone'] ?? '--'}',
                                                      style: TextStyle(color: Colors.grey[500], fontSize: 11),
                                                    ),
                                                  ],
                                                ),
                                              ),
                                              Column(
                                                crossAxisAlignment: CrossAxisAlignment.end,
                                                children: [
                                                  Text(
                                                    '₹${(p['paid_amount'] ?? 0).toDouble().toStringAsFixed(0)}',
                                                    style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF10B981), fontSize: 16),
                                                  ),
                                                  Container(
                                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                    decoration: BoxDecoration(
                                                      color: modeColor.withOpacity(0.1),
                                                      borderRadius: BorderRadius.circular(4),
                                                    ),
                                                    child: Text(
                                                      mode,
                                                      style: TextStyle(color: modeColor, fontSize: 9, fontWeight: FontWeight.w700),
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 8),
                                          // Detail row
                                          Container(
                                            padding: const EdgeInsets.all(8),
                                            decoration: BoxDecoration(
                                              color: const Color(0xFFF8FAFC),
                                              borderRadius: BorderRadius.circular(8),
                                            ),
                                            child: Row(
                                              children: [
                                                // STB No — tap to copy
                                                Expanded(
                                                  child: GestureDetector(
                                                    onTap: () => _copyToClipboard(stbNo),
                                                    child: Column(
                                                      crossAxisAlignment: CrossAxisAlignment.start,
                                                      children: [
                                                        Row(
                                                          mainAxisSize: MainAxisSize.min,
                                                          children: [
                                                            _detailLabel('STB No'),
                                                            const SizedBox(width: 2),
                                                            Icon(Icons.copy_rounded, size: 10, color: Colors.grey[400]),
                                                          ],
                                                        ),
                                                        Text(stbNo, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFF6366F1))),
                                                      ],
                                                    ),
                                                  ),
                                                ),
                                                Expanded(
                                                  child: Column(
                                                    crossAxisAlignment: CrossAxisAlignment.start,
                                                    children: [
                                                      _detailLabel('Area'),
                                                      Text(p['area'] ?? '--', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis),
                                                    ],
                                                  ),
                                                ),
                                                Expanded(
                                                  child: Column(
                                                    crossAxisAlignment: CrossAxisAlignment.start,
                                                    children: [
                                                      _detailLabel('Date'),
                                                      Text(_formatDate(p['payment_date']), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w500)),
                                                    ],
                                                  ),
                                                ),
                                              ],
                                            ),
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
                ),
              ],
            ),
      // Floating collect button
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          Navigator.push(context, MaterialPageRoute(
            builder: (_) => const CustomerSearchScreen(forPayment: true),
          ));
        },
        backgroundColor: const Color(0xFFE11D48),
        foregroundColor: Colors.white,
        icon: const Icon(Icons.payment_rounded),
        label: const Text('Collect', style: TextStyle(fontWeight: FontWeight.w600)),
      ),
    );
  }

  Widget _summaryCard({required String count, required String label, required Color iconColor, required Color bgColor}) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            Text(count, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18, color: iconColor)),
            const SizedBox(height: 2),
            Text(label, style: TextStyle(color: iconColor.withOpacity(0.8), fontSize: 10, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }

  Widget _detailLabel(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Text(text, style: TextStyle(color: Colors.grey[400], fontSize: 9, fontWeight: FontWeight.w500)),
    );
  }
}
