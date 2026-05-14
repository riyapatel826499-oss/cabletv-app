import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/api_service.dart';
import 'collection_detail_screen.dart';

class CollectionListScreen extends StatefulWidget {
  const CollectionListScreen({super.key});

  @override
  State<CollectionListScreen> createState() => _CollectionListScreenState();
}

class _CollectionListScreenState extends State<CollectionListScreen> {
  final _searchCtrl = TextEditingController();
  Timer? _debounce;
  List<dynamic> _customers = [];
  bool _loading = true;
  String _activeFilter = 'all';
  String? _selectedArea;
  int _currentPage = 1;
  int _totalPages = 1;
  int _total = 0;
  Map<String, int> _counts = {
    'due_today': 0,
    'due_tomorrow': 0,
    'unpaid': 0,
    'paid': 0,
  };
  List<String> _areas = [];

  @override
  void initState() {
    super.initState();
    _loadData();
    _searchCtrl.addListener(_onSearchChanged);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.removeListener(_onSearchChanged);
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onSearchChanged() {
    setState(() {});
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 500), () {
      _currentPage = 1;
      _loadData();
    });
  }

  Future<void> _loadData() async {
    if (!mounted) return;
    setState(() => _loading = true);
    try {
      final result = await ApiService.getCollectionList(
        filter: _activeFilter,
        q: _searchCtrl.text.trim().isNotEmpty ? _searchCtrl.text.trim() : null,
        area: _selectedArea,
        page: _currentPage,
        perPage: 50,
      );
      if (!mounted) return;
      setState(() {
        _customers = result['customers'] ?? [];
        _total = result['total'] ?? 0;
        _totalPages = result['total_pages'] ?? 1;
        _areas = List<String>.from(result['areas'] ?? []);
        final counts = result['counts'] ?? {};
        _counts = {
          'due_today': counts['due_today'] ?? 0,
          'due_tomorrow': counts['due_tomorrow'] ?? 0,
          'unpaid': counts['unpaid'] ?? 0,
          'paid': counts['paid'] ?? 0,
        };
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString().replaceAll('Exception: ', '')), backgroundColor: Colors.red),
      );
    }
  }

  void _setFilter(String filter) {
    if (_activeFilter == filter) return;
    setState(() {
      _activeFilter = filter;
      _currentPage = 1;
    });
    _loadData();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: Column(
        children: [
          // Red gradient header
          Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFFDC2626), Color(0xFFEF4444)],
              ),
              borderRadius: BorderRadius.only(
                bottomLeft: Radius.circular(24),
                bottomRight: Radius.circular(24),
              ),
            ),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
                child: Column(
                  children: [
                    // Title row
                    Row(
                      children: [
                        IconButton(
                          icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
                          onPressed: () => Navigator.pop(context),
                        ),
                        const Expanded(
                          child: Text(
                            'Collection',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 22,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.search_rounded, color: Colors.white),
                          onPressed: () {
                            // Focus the search bar below
                          },
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    // Search bar
                    Container(
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: TextField(
                        controller: _searchCtrl,
                        decoration: InputDecoration(
                          hintText: 'Search name, phone, STB, area...',
                          hintStyle: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 14),
                          prefixIcon: Icon(Icons.search_rounded, color: Colors.white.withOpacity(0.8), size: 20),
                          suffixIcon: _searchCtrl.text.isNotEmpty
                              ? IconButton(
                                  icon: const Icon(Icons.clear_rounded, color: Colors.white, size: 18),
                                  onPressed: () {
                                    _searchCtrl.clear();
                                    _currentPage = 1;
                                    _loadData();
                                  },
                                )
                              : null,
                          border: InputBorder.none,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                          isDense: true,
                        ),
                        style: const TextStyle(color: Colors.white, fontSize: 14),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),

          // Filter tabs
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _filterChip('Due Today', 'due_today', _counts['due_today'] ?? 0),
                  const SizedBox(width: 8),
                  _filterChip('Due Tomorrow', 'due_tomorrow', _counts['due_tomorrow'] ?? 0),
                  const SizedBox(width: 8),
                  _filterChip('Unpaid', 'unpaid', _counts['unpaid'] ?? 0),
                  const SizedBox(width: 8),
                  _filterChip('Paid', 'paid', _counts['paid'] ?? 0),
                  const SizedBox(width: 8),
                  _filterChip('All', 'all', _total),
                  if (_selectedArea != null) ...[
                    const SizedBox(width: 8),
                    Chip(
                      label: Text(_selectedArea!, style: const TextStyle(fontSize: 12)),
                      deleteIcon: const Icon(Icons.close, size: 16),
                      onDeleted: () {
                        setState(() => _selectedArea = null);
                        _currentPage = 1;
                        _loadData();
                      },
                      backgroundColor: const Color(0xFFFEF3C7),
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      padding: EdgeInsets.zero,
                      labelPadding: const EdgeInsets.only(left: 8),
                    ),
                  ],
                ],
              ),
            ),
          ),

          // Area filter row
          if (_areas.isNotEmpty && _selectedArea == null)
            Container(
              color: Colors.white,
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
              height: 34,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                itemCount: _areas.length,
                itemBuilder: (context, index) {
                  return Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ActionChip(
                      label: Text(_areas[index], style: const TextStyle(fontSize: 11)),
                      backgroundColor: const Color(0xFFF1F5F9),
                      side: const BorderSide(color: Color(0xFFE2E8F0)),
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      padding: EdgeInsets.zero,
                      labelPadding: const EdgeInsets.symmetric(horizontal: 8),
                      onPressed: () {
                        setState(() => _selectedArea = _areas[index]);
                        _currentPage = 1;
                        _loadData();
                      },
                    ),
                  );
                },
              ),
            ),

          // Count header
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Row(
              children: [
                Text(
                  '$_total customer${_total == 1 ? '' : 's'}',
                  style: const TextStyle(color: Color(0xFF64748B), fontSize: 12, fontWeight: FontWeight.w500),
                ),
                const Spacer(),
                if (_totalPages > 1)
                  Text(
                    'Page $_currentPage / $_totalPages',
                    style: TextStyle(color: Colors.grey[400], fontSize: 11),
                  ),
              ],
            ),
          ),

          const Divider(height: 1, color: Color(0xFFF1F5F9)),

          // Customer list
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFFDC2626)))
                : _customers.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.people_outline_rounded, size: 56, color: Color(0xFFCBD5E1)),
                            const SizedBox(height: 12),
                            const Text('No customers found', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 15)),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        color: const Color(0xFFDC2626),
                        onRefresh: _loadData,
                        child: ListView.builder(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          itemCount: _customers.length,
                          itemBuilder: (context, index) => _buildCustomerCard(_customers[index]),
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _filterChip(String label, String filter, int count) {
    final isActive = _activeFilter == filter;
    final isRed = isActive;
    return GestureDetector(
      onTap: () => _setFilter(filter),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: isRed ? const Color(0xFFDC2626) : Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isRed ? const Color(0xFFDC2626) : const Color(0xFFE2E8F0),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              style: TextStyle(
                color: isRed ? Colors.white : const Color(0xFF64748B),
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            if (count > 0) ...[
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: isRed ? Colors.white.withOpacity(0.25) : const Color(0xFFFEE2E2),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '$count',
                  style: TextStyle(
                    color: isRed ? Colors.white : const Color(0xFFDC2626),
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildCustomerCard(dynamic c) {
    final name = c['name'] ?? '--';
    final phone = c['phone'] ?? '';
    final area = c['area'] ?? '';
    final address = c['address'] ?? '';
    final stbNo = c['stb_no'] ?? '';
    final canId = c['can_id'] ?? '';
    final mso = c['mso'] ?? '';
    final planAmount = (c['plan_amount'] ?? 0).toDouble();
    final pendingAmount = (c['pending_amount'] ?? 0).toDouble();
    final expiryDate = c['expiry_date'] ?? '';
    final isPaid = c['is_paid'] == true || c['is_paid'] == 1;
    final customerId = c['customer_id'] ?? '';
    final network = c['network'] ?? '';
    final gapMonths = c['gap_months'] ?? 0;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        elevation: 1,
        shadowColor: Colors.black.withOpacity(0.06),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => CollectionDetailScreen(customerData: Map<String, dynamic>.from(c)),
              ),
            ).then((_) => _loadData()); // Refresh on return
          },
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Row 1: Name + Amount button
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        name,
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: Color(0xFF1E293B)),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 8),
                    // Amount button
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                      decoration: BoxDecoration(
                        color: isPaid ? const Color(0xFFDCFCE7) : const Color(0xFFDC2626),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        isPaid ? 'PAID' : '₹${_formatAmount(pendingAmount > 0 ? pendingAmount : planAmount)}',
                        style: TextStyle(
                          color: isPaid ? const Color(0xFF16A34A) : Colors.white,
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),

                // Row 2: Expiry date badge
                if (expiryDate.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEF3C7),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.calendar_today_rounded, size: 12, color: Color(0xFFD97706)),
                        const SizedBox(width: 4),
                        Text(
                          'Exp: ${_formatDate(expiryDate)}',
                          style: const TextStyle(color: Color(0xFFD97706), fontSize: 11, fontWeight: FontWeight.w600),
                        ),
                        if (!isPaid && gapMonths > 0) ...[
                          const SizedBox(width: 6),
                          Text(
                            '($gapMonths mo due)',
                            style: const TextStyle(color: Color(0xFFDC2626), fontSize: 10, fontWeight: FontWeight.w600),
                          ),
                        ],
                      ],
                    ),
                  ),
                const SizedBox(height: 8),

                // Row 3: ID info row
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: [
                    _infoChip('ID', customerId),
                    if (stbNo.isNotEmpty) _infoChip('STB', stbNo),
                    if (canId.isNotEmpty) _infoChip('CAN', canId),
                    if (mso.isNotEmpty) _infoChip('MSO', mso),
                  ],
                ),
                const SizedBox(height: 6),

                // Row 4: Area/Address
                if (area.isNotEmpty || address.isNotEmpty)
                  Row(
                    children: [
                      Icon(Icons.location_on_rounded, size: 13, color: Colors.grey[400]),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          [area, address].where((s) => s.isNotEmpty).join(', '),
                          style: TextStyle(color: Colors.grey[500], fontSize: 12),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),

                // Row 5: Phone + action buttons
                Row(
                  children: [
                    if (phone.isNotEmpty)
                      GestureDetector(
                        onTap: () => _launchPhone(phone),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.phone_rounded, size: 13, color: Colors.blue[400]),
                            const SizedBox(width: 4),
                            Text(
                              phone,
                              style: TextStyle(color: Colors.blue[600], fontSize: 12, fontWeight: FontWeight.w500),
                            ),
                          ],
                        ),
                      ),
                    const Spacer(),
                    // Location pin button
                    if (address.isNotEmpty)
                      _circleButton(
                        Icons.location_on_rounded,
                        const Color(0xFF3B82F6),
                        () => _openMap(address, area),
                      ),
                    const SizedBox(width: 8),
                    // Service request button
                    _circleButton(
                      Icons.build_rounded,
                      const Color(0xFF8B5CF6),
                      () {
                        // Navigate to service request creation
                      },
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _infoChip(String label, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(4),
      ),
      child: RichText(
        text: TextSpan(
          style: const TextStyle(fontSize: 10),
          children: [
            TextSpan(text: '$label: ', style: TextStyle(color: Colors.grey[500], fontWeight: FontWeight.w500)),
            TextSpan(text: value, style: const TextStyle(color: Color(0xFF334155), fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }

  Widget _circleButton(IconData icon, Color color, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 32,
        height: 32,
        decoration: BoxDecoration(
          color: color.withOpacity(0.1),
          shape: BoxShape.circle,
        ),
        child: Icon(icon, color: color, size: 16),
      ),
    );
  }

  String _formatAmount(double amount) {
    if (amount == 0) return '0';
    if (amount == amount.roundToDouble()) {
      return amount.round().toString().replaceAllMapped(
            RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
            (m) => '${m[1]},',
          );
    }
    return amount.toStringAsFixed(2).replaceAllMapped(
          RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
          (m) => '${m[1]},',
        );
  }

  String _formatDate(String dateStr) {
    try {
      final dt = DateTime.parse(dateStr);
      final months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return '${dt.day.toString().padLeft(2, '0')} ${months[dt.month - 1]} ${dt.year}';
    } catch (_) {
      return dateStr;
    }
  }

  void _launchPhone(String phone) async {
    final cleaned = phone.replaceAll(RegExp(r'[^\d+]'), '');
    try {
      await MethodChannel('plugins.flutter.io/url_launcher').invokeMethod('launch', 'tel:$cleaned');
    } catch (_) {
      // Fallback: just copy to clipboard
      Clipboard.setData(ClipboardData(text: cleaned));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Phone number copied'), duration: Duration(seconds: 1)),
        );
      }
    }
  }

  void _openMap(String address, String? area) async {
    final query = Uri.encodeComponent([address, area].where((s) => s != null && s.isNotEmpty).join(', '));
    try {
      await MethodChannel('plugins.flutter.io/url_launcher').invokeMethod('launch', 'https://www.google.com/maps/search/?api=1&query=$query');
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open maps'), duration: Duration(seconds: 1)),
        );
      }
    }
  }
}
