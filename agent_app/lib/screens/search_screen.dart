import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
  final _focusNode = FocusNode();
  List<dynamic> _results = [];
  bool _loading = false;
  bool _searched = false;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _focusNode.requestFocus();
    _searchCtrl.addListener(_onSearchChanged);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.removeListener(_onSearchChanged);
    _searchCtrl.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _onSearchChanged() {
    // Rebuild to update clear button visibility
    setState(() {});
    final q = _searchCtrl.text.trim();

    if (q.length < 2) {
      if (_searched) {
        setState(() {
          _results = [];
          _searched = false;
          _loading = false;
        });
      }
      _debounce?.cancel();
      return;
    }

    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      _search(q);
    });
  }

  Future<void> _search(String q) async {
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
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: Text(widget.forPayment ? 'Collect Payment' : 'Search Customers'),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0.5,
      ),
      body: Column(
        children: [
          // Search bar
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Container(
              decoration: BoxDecoration(
                color: const Color(0xFFF1F5F9),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: TextField(
                controller: _searchCtrl,
                focusNode: _focusNode,
                decoration: InputDecoration(
                  hintText: 'Name, Phone, STB, Area...',
                  hintStyle: const TextStyle(color: Color(0xFF94A3B8), fontSize: 15),
                  prefixIcon: Container(
                    margin: const EdgeInsets.only(left: 4),
                    child: Icon(
                      _loading ? Icons.hourglass_empty_rounded : Icons.search_rounded,
                      color: const Color(0xFF64748B),
                      size: 22,
                    ),
                  ),
                  suffixIcon: _searchCtrl.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear_rounded, color: Color(0xFF64748B), size: 20),
                          onPressed: () {
                            _searchCtrl.clear();
                            setState(() { _results = []; _searched = false; _loading = false; });
                          },
                        )
                      : null,
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 14),
                  isDense: true,
                ),
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
                textInputAction: TextInputAction.search,
                onSubmitted: (q) {
                  _debounce?.cancel();
                  if (q.trim().length >= 2) _search(q.trim());
                },
              ),
            ),
          ),

          // Hint chips
          if (!_searched && _results.isEmpty)
            Container(
              color: Colors.white,
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
              child: Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  _hintChip('👤 Name', 'ra'),
                  _hintChip('📱 Phone', '978'),
                  _hintChip('📺 STB No', 'STB'),
                  _hintChip('📍 Area', 'tirupur'),
                ],
              ),
            ),

          const Divider(height: 1, color: Color(0xFFF1F5F9)),

          // Loading indicator
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: SizedBox(
                width: 24, height: 24,
                child: CircularProgressIndicator(strokeWidth: 2.5),
              )),
            ),

          // No results
          if (!_loading && _searched && _results.isEmpty)
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.person_off_rounded, size: 56, color: Color(0xFFCBD5E1)),
                    const SizedBox(height: 12),
                    const Text('No customers found', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 15)),
                    const SizedBox(height: 4),
                    Text('Try: "${_searchCtrl.text}" with different spelling', style: const TextStyle(color: Color(0xFFCBD5E1), fontSize: 12)),
                  ],
                ),
              ),
            ),

          // Results count
          if (!_loading && _results.isNotEmpty)
            Container(
              color: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  Text(
                    '${_results.length} result${_results.length == 1 ? '' : 's'} found',
                    style: const TextStyle(color: Color(0xFF64748B), fontSize: 12, fontWeight: FontWeight.w500),
                  ),
                  const Spacer(),
                  Text(
                    'Tap STB to copy',
                    style: TextStyle(color: Colors.grey[400], fontSize: 11),
                  ),
                ],
              ),
            ),

          // Results list
          if (!_loading && _results.isNotEmpty)
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                itemCount: _results.length,
                itemBuilder: (context, index) => _buildResultCard(_results[index]),
              ),
            ),
        ],
      ),
    );
  }

  Widget _hintChip(String label, String example) {
    return ActionChip(
      label: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500)),
      backgroundColor: const Color(0xFFF1F5F9),
      side: const BorderSide(color: Color(0xFFE2E8F0)),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      onPressed: () {
        _searchCtrl.text = example;
        _searchCtrl.selection = TextSelection.fromPosition(TextPosition(offset: example.length));
        _search(example);
      },
    );
  }

  Widget _buildResultCard(dynamic c) {
    final status = c['status'] ?? 'Active';
    final isPaid = c['is_paid'] == true || c['is_paid'] == 1;
    final name = c['name'] ?? '--';
    final phone = c['phone'] ?? '';
    final stb = c['stb_no'] ?? '';
    final area = c['area'] ?? '';
    final customerId = c['customer_id'] ?? c['id'] ?? '';
    final matchQuery = _searchCtrl.text.trim().toLowerCase();

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        elevation: 0.5,
        shadowColor: Colors.black.withOpacity(0.04),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => CustomerDetailScreen(
                  customerId: customerId,
                  forPayment: widget.forPayment,
                ),
              ),
            );
          },
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                // Avatar
                CircleAvatar(
                  radius: 22,
                  backgroundColor: isPaid ? const Color(0xFFDCFCE7) : const Color(0xFFFEE2E2),
                  child: Text(
                    name[0].toUpperCase(),
                    style: TextStyle(
                      color: isPaid ? const Color(0xFF16A34A) : const Color(0xFFDC2626),
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                    ),
                  ),
                ),
                const SizedBox(width: 12),

                // Info
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Name with match highlight
                      _highlightedText(name, matchQuery, const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: Color(0xFF1E293B))),
                      const SizedBox(height: 3),

                      // Phone row
                      if (phone.isNotEmpty)
                        Row(
                          children: [
                            Icon(Icons.phone_rounded, size: 12, color: Colors.grey[400]),
                            const SizedBox(width: 4),
                            _highlightedText(phone, matchQuery, TextStyle(color: Colors.grey[500], fontSize: 12)),
                          ],
                        ),

                      // STB row
                      if (stb.isNotEmpty)
                        Row(
                          children: [
                            Icon(Icons.tv_rounded, size: 12, color: Colors.grey[400]),
                            const SizedBox(width: 4),
                            GestureDetector(
                              onTap: () {
                                Clipboard.setData(ClipboardData(text: stb));
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text('STB copied: $stb'),
                                    duration: const Duration(seconds: 1),
                                    behavior: SnackBarBehavior.floating,
                                    margin: const EdgeInsets.all(8),
                                  ),
                                );
                              },
                              child: _highlightedText(stb, matchQuery, TextStyle(
                                color: Colors.blue[600],
                                fontSize: 12,
                                fontWeight: FontWeight.w500,
                                decoration: TextDecoration.underline,
                                decorationColor: Colors.blue[300],
                              )),
                            ),
                          ],
                        ),

                      // Area
                      if (area.isNotEmpty)
                        Row(
                          children: [
                            Icon(Icons.location_on_rounded, size: 12, color: Colors.grey[400]),
                            const SizedBox(width: 4),
                            _highlightedText(area, matchQuery, TextStyle(color: Colors.grey[400], fontSize: 11)),
                          ],
                        ),
                    ],
                  ),
                ),

                // Status + ID
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    _statusChip(isPaid ? 'PAID' : 'UNPAID', isPaid ? const Color(0xFF10B981) : const Color(0xFFEF4444)),
                    const SizedBox(height: 4),
                    _statusChip(status, status == 'Active' ? const Color(0xFF3B82F6) : const Color(0xFF6B7280)),
                    const SizedBox(height: 4),
                    Text(customerId, style: TextStyle(color: Colors.grey[400], fontSize: 9)),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _highlightedText(String text, String query, TextStyle baseStyle) {
    if (query.isEmpty || query.length < 2) {
      return Text(text, style: baseStyle);
    }

    final lowerText = text.toLowerCase();
    final lowerQuery = query.toLowerCase();
    final matchIndex = lowerText.indexOf(lowerQuery);

    if (matchIndex == -1) {
      return Text(text, style: baseStyle);
    }

    return RichText(
      text: TextSpan(
        style: baseStyle,
        children: [
          TextSpan(text: text.substring(0, matchIndex)),
          TextSpan(
            text: text.substring(matchIndex, matchIndex + query.length),
            style: TextStyle(
              color: const Color(0xFF6366F1),
              fontWeight: FontWeight.w700,
              backgroundColor: const Color(0xFFEEF2FF),
            ),
          ),
          TextSpan(text: text.substring(matchIndex + query.length)),
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
        style: TextStyle(color: color, fontSize: 9, fontWeight: FontWeight.w700),
      ),
    );
  }
}
