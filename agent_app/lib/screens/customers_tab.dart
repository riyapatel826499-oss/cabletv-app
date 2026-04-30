import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/role_provider.dart';
import '../services/api_service.dart';
import 'customer_detail_screen.dart';
import 'customers_manage_screen.dart';
import 'search_screen.dart';

class CustomersTab extends StatefulWidget {
  final String? initialFilter;
  const CustomersTab({super.key, this.initialFilter});

  @override
  State<CustomersTab> createState() => _CustomersTabState();
}

class _CustomersTabState extends State<CustomersTab> with AutomaticKeepAliveClientMixin {
  List<dynamic> _customers = [];
  bool _loading = true;
  int _totalPages = 1;
  int _currentPage = 1;
  int _total = 0;
  String _activeFilter = 'all'; // all, paid, unpaid, surrendered
  String _sortBy = 'name';
  String _sortOrder = 'asc';

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    if (widget.initialFilter != null) {
      _activeFilter = widget.initialFilter!;
    }
    _loadCustomers();
  }

  Future<void> _loadCustomers() async {
    setState(() => _loading = true);
    try {
      String? paymentFilter;
      String? status;
      switch (_activeFilter) {
        case 'paid':
          paymentFilter = 'paid';
          break;
        case 'unpaid':
          paymentFilter = 'unpaid';
          break;
        case 'surrendered':
          status = 'Surrendered';
          break;
      }

      final result = await ApiService.getCustomers(
        page: _currentPage,
        perPage: 20,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        status: status,
        paymentFilter: paymentFilter,
      );
      if (!mounted) return;
      setState(() {
        _customers = result['customers'] ?? [];
        _total = result['total'] ?? 0;
        _totalPages = (_total / 20).ceil();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      if (e.toString().contains('Session expired')) {
        Navigator.pushReplacementNamed(context, '/login');
      }
    }
  }

  void _setFilter(String filter) {
    setState(() {
      _activeFilter = filter;
      _currentPage = 1;
    });
    _loadCustomers();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final role = Provider.of<RoleProvider>(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Customers'),
        actions: [
          if (role.canAddCustomer)
            IconButton(
              icon: const Icon(Icons.person_add_rounded),
              onPressed: () async {
                await Navigator.push(context, MaterialPageRoute(builder: (_) => const CustomersManageScreen()));
                _loadCustomers();
              },
              tooltip: 'Add Customer',
            ),
          IconButton(
            icon: const Icon(Icons.search_rounded),
            onPressed: () {
              Navigator.push(context, MaterialPageRoute(builder: (_) => const CustomerSearchScreen()));
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Filter chips
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _filterChip('All', 'all', Icons.people_rounded, const Color(0xFF6366F1)),
                  const SizedBox(width: 8),
                  _filterChip('Paid', 'paid', Icons.check_circle_rounded, const Color(0xFF10B981)),
                  const SizedBox(width: 8),
                  _filterChip('Unpaid', 'unpaid', Icons.warning_rounded, const Color(0xFFEF4444)),
                  const SizedBox(width: 8),
                  _filterChip('Surrendered', 'surrendered', Icons.block_rounded, const Color(0xFF6B7280)),
                ],
              ),
            ),
          ),
          // Sort bar
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Row(
              children: [
                Text(
                  '$_total customers',
                  style: TextStyle(color: Colors.grey[500], fontSize: 13, fontWeight: FontWeight.w500),
                ),
                const Spacer(),
                GestureDetector(
                  onTap: () {
                    setState(() => _sortOrder = _sortOrder == 'asc' ? 'desc' : 'asc');
                    _loadCustomers();
                  },
                  child: Icon(
                    _sortOrder == 'asc' ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded,
                    size: 18,
                    color: const Color(0xFF6366F1),
                  ),
                ),
                const SizedBox(width: 8),
                DropdownButton<String>(
                  value: _sortBy,
                  underline: const SizedBox(),
                  isDense: true,
                  style: const TextStyle(fontSize: 13, color: Color(0xFF64748B)),
                  items: const [
                    DropdownMenuItem(value: 'name', child: Text('Name')),
                    DropdownMenuItem(value: 'customer_id', child: Text('ID')),
                    DropdownMenuItem(value: 'area', child: Text('Area')),
                  ],
                  onChanged: (v) {
                    if (v != null) {
                      setState(() => _sortBy = v);
                      _loadCustomers();
                    }
                  },
                ),
              ],
            ),
          ),
          const Divider(height: 1),

          // List
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _customers.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.people_outline_rounded, size: 56, color: Colors.grey[300]),
                            const SizedBox(height: 12),
                            Text('No customers found', style: TextStyle(color: Colors.grey[400], fontSize: 15)),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _loadCustomers,
                        child: ListView.builder(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          itemCount: _customers.length,
                          itemBuilder: (context, index) {
                            final c = _customers[index];
                            final isPaid = c['is_paid'] == true || c['paid_amount'] != null;
                            final status = c['status'] ?? 'Active';
                            return Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                              child: Material(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(14),
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(14),
                                  onTap: () async {
                                    await Navigator.push(
                                      context,
                                      MaterialPageRoute(
                                        builder: (_) => CustomerDetailScreen(customerId: c['customer_id'] ?? c['id']),
                                      ),
                                    );
                                    _loadCustomers();
                                  },
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                                    child: Row(
                                      children: [
                                        CircleAvatar(
                                          radius: 22,
                                          backgroundColor: isPaid ? const Color(0xFFDCFCE7) : const Color(0xFFFEE2E2),
                                          child: Text(
                                            (c['name'] ?? '?')[0].toUpperCase(),
                                            style: TextStyle(
                                              color: isPaid ? const Color(0xFF16A34A) : const Color(0xFFDC2626),
                                              fontWeight: FontWeight.w700,
                                            ),
                                          ),
                                        ),
                                        const SizedBox(width: 12),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(c['name'] ?? '--', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                                              const SizedBox(height: 2),
                                              Text(
                                                '${c['customer_id'] ?? '--'} | ${c['phone'] ?? '--'}',
                                                style: TextStyle(color: Colors.grey[500], fontSize: 12),
                                              ),
                                            ],
                                          ),
                                        ),
                                        Column(
                                          crossAxisAlignment: CrossAxisAlignment.end,
                                          children: [
                                            _miniChip(
                                              isPaid ? 'PAID' : 'UNPAID',
                                              isPaid ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                                            ),
                                            if (status != 'Active') ...[
                                              const SizedBox(height: 3),
                                              _miniChip(status, const Color(0xFF6B7280)),
                                            ],
                                          ],
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

          // Pagination
          if (_totalPages > 1)
            Container(
              color: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  IconButton(
                    icon: const Icon(Icons.chevron_left_rounded),
                    onPressed: _currentPage > 1 ? () { setState(() => _currentPage--); _loadCustomers(); } : null,
                  ),
                  Text('Page $_currentPage of $_totalPages', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
                  IconButton(
                    icon: const Icon(Icons.chevron_right_rounded),
                    onPressed: _currentPage < _totalPages ? () { setState(() => _currentPage++); _loadCustomers(); } : null,
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _filterChip(String label, String value, IconData icon, Color color) {
    final isActive = _activeFilter == value;
    return GestureDetector(
      onTap: () => _setFilter(value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: isActive ? color : color.withOpacity(0.06),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: isActive ? color : color.withOpacity(0.2)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: isActive ? Colors.white : color),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                color: isActive ? Colors.white : color,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _miniChip(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(5),
      ),
      child: Text(text, style: TextStyle(color: color, fontSize: 9, fontWeight: FontWeight.w700)),
    );
  }
}
