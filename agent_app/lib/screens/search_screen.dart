import 'package:flutter/material.dart';
import '../services/api_service.dart';
import 'customer_detail_screen.dart';

class CustomerSearchScreen extends StatefulWidget {
  final bool forPayment;
  const CustomerSearchScreen({super.key, this.forPayment = false});

  @override
  State<CustomerSearchScreen> createState() => _CustomerSearchScreenState();
}

class _CustomerSearchScreenState extends State<CustomerSearchScreen> {
  final _searchCtrl = TextEditingController();
  List<dynamic> _results = [];
  bool _loading = false;
  bool _searched = false;

  Future<void> _search() async {
    final q = _searchCtrl.text.trim();
    if (q.length < 2) return;
    setState(() { _loading = true; _searched = true; });
    try {
      final results = await ApiService.searchCustomers(q);
      if (!mounted) return;
      setState(() => _results = results);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString().replaceAll('Exception: ', '')), backgroundColor: Colors.red),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.forPayment ? 'Collect Payment' : 'Search Customers'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: TextField(
              controller: _searchCtrl,
              decoration: InputDecoration(
                hintText: 'Search by name, phone, STB, or ID...',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: _searchCtrl.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear_rounded),
                        onPressed: () {
                          _searchCtrl.clear();
                          setState(() { _results = []; _searched = false; });
                        },
                      )
                    : null,
              ),
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _search(),
              onChanged: (_) => setState(() {}),
            ),
          ),
          if (_loading)
            const Expanded(child: Center(child: CircularProgressIndicator()))
          else if (_searched && _results.isEmpty)
            const Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.person_off_rounded, size: 56, color: Color(0xFFCBD5E1)),
                    SizedBox(height: 12),
                    Text('No customers found', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 15)),
                  ],
                ),
              ),
            )
          else
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.all(12),
                itemCount: _results.length,
                itemBuilder: (context, index) {
                  final c = _results[index];
                  final status = c['status'] ?? 'Active';
                  final isPaid = c['is_paid'] == true;
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Material(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(14),
                        onTap: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => CustomerDetailScreen(
                                customerId: c['customer_id'] ?? c['id'],
                                forPayment: widget.forPayment,
                              ),
                            ),
                          );
                        },
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Row(
                            children: [
                              CircleAvatar(
                                radius: 24,
                                backgroundColor: isPaid ? const Color(0xFFDCFCE7) : const Color(0xFFFEE2E2),
                                child: Text(
                                  (c['name'] ?? '?')[0].toUpperCase(),
                                  style: TextStyle(
                                    color: isPaid ? const Color(0xFF16A34A) : const Color(0xFFDC2626),
                                    fontWeight: FontWeight.w700,
                                    fontSize: 18,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      c['name'] ?? '--',
                                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                                    ),
                                    const SizedBox(height: 3),
                                    Text(
                                      '${c['customer_id'] ?? '--'} | ${c['phone'] ?? '--'}',
                                      style: TextStyle(color: Colors.grey[500], fontSize: 12),
                                    ),
                                    if (c['area'] != null)
                                      Text(
                                        c['area'],
                                        style: TextStyle(color: Colors.grey[400], fontSize: 11),
                                      ),
                                  ],
                                ),
                              ),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  _statusChip(isPaid ? 'PAID' : 'UNPAID', isPaid ? const Color(0xFF10B981) : const Color(0xFFEF4444)),
                                  const SizedBox(height: 4),
                                  _statusChip(status, status == 'Active' ? const Color(0xFF3B82F6) : const Color(0xFF6B7280)),
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
        ],
      ),
    );
  }

  Widget _statusChip(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        text,
        style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w700),
      ),
    );
  }
}
