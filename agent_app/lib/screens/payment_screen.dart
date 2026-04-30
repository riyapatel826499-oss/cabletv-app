import 'package:flutter/material.dart';
import '../services/api_service.dart';

class PaymentScreen extends StatefulWidget {
  final Map<String, dynamic> customer;
  const PaymentScreen({super.key, required this.customer});

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  final _amountCtrl = TextEditingController();
  final _notesCtrl = TextEditingController();
  String _paymentMode = 'Cash';
  List<dynamic> _plans = [];
  int? _selectedPlanId;
  bool _loading = false;
  bool _success = false;

  @override
  void initState() {
    super.initState();
    _loadPlans();
  }

  Future<void> _loadPlans() async {
    try {
      final plans = await ApiService.getPlans();
      if (!mounted) return;
      setState(() => _plans = plans);
    } catch (_) {}
  }

  Future<void> _submit() async {
    final amount = double.tryParse(_amountCtrl.text);
    if (amount == null || amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid amount'), backgroundColor: Color(0xFFEF4444)),
      );
      return;
    }
    setState(() => _loading = true);
    try {
      final now = DateTime.now();
      final monthYear = '${now.month.toString().padLeft(2, '0')}-${now.year}';
      await ApiService.recordPayment(
        customerId: widget.customer['customer_id'] ?? widget.customer['id'] ?? '',
        connectionId: widget.customer['connection_id'] ?? 1,
        planId: _selectedPlanId ?? 1,
        amount: amount,
        paymentMode: _paymentMode,
        monthYear: monthYear,
        notes: _notesCtrl.text.isNotEmpty ? _notesCtrl.text : null,
      );
      if (!mounted) return;
      setState(() => _success = true);
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
    final c = widget.customer;

    return Scaffold(
      appBar: AppBar(title: const Text('Collect Payment')),
      body: _success
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 80,
                      height: 80,
                      decoration: BoxDecoration(
                        color: const Color(0xFFDCFCE7),
                        borderRadius: BorderRadius.circular(24),
                      ),
                      child: const Icon(Icons.check_rounded, size: 40, color: Color(0xFF10B981)),
                    ),
                    const SizedBox(height: 20),
                    const Text('Payment Recorded!', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Color(0xFF10B981))),
                    const SizedBox(height: 8),
                    Text('${c['name'] ?? ''} - Rs ${_amountCtrl.text}', style: const TextStyle(fontSize: 15, color: Color(0xFF64748B))),
                    const SizedBox(height: 32),
                    SizedBox(
                      width: double.infinity,
                      height: 50,
                      child: ElevatedButton(
                        onPressed: () => Navigator.pop(context),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF6366F1),
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        ),
                        child: const Text('Done', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                      ),
                    ),
                  ],
                ),
              ),
            )
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Customer card
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF5F3FF),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFE9E5FF)),
                    ),
                    child: Row(
                      children: [
                        CircleAvatar(
                          radius: 26,
                          backgroundColor: const Color(0xFF6366F1),
                          child: Text(
                            (c['name'] ?? '?')[0].toUpperCase(),
                            style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w700),
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(c['name'] ?? '--', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
                              const SizedBox(height: 2),
                              Text('${c['customer_id'] ?? '--'} | ${c['phone'] ?? '--'}', style: TextStyle(color: Colors.grey[600], fontSize: 12)),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),

                  // Plan
                  if (_plans.isNotEmpty) ...[
                    const Text('Plan', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                    const SizedBox(height: 8),
                    DropdownButtonFormField<int>(
                      value: _selectedPlanId,
                      decoration: const InputDecoration(prefixIcon: Icon(Icons.tv_rounded)),
                      items: _plans.map<DropdownMenuItem<int>>((p) {
                        return DropdownMenuItem<int>(
                          value: p['id'] as int,
                          child: Text('${p['name']} - Rs ${p['amount'] ?? p['price']}'),
                        );
                      }).toList(),
                      onChanged: (val) {
                        setState(() => _selectedPlanId = val);
                        final plan = _plans.firstWhere((p) => p['id'] == val, orElse: () => <String, dynamic>{});
                        if (plan['amount'] != null || plan['price'] != null) {
                          _amountCtrl.text = (plan['amount'] ?? plan['price']).toString();
                        }
                      },
                    ),
                    const SizedBox(height: 16),
                  ],

                  // Amount
                  TextField(
                    controller: _amountCtrl,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Amount (Rs) *',
                      prefixIcon: Icon(Icons.currency_rupee_rounded),
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Payment mode
                  const Text('Payment Mode', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: ['Cash', 'GPay', 'PhonePe', 'UPI', 'Bank Transfer'].map((mode) {
                      final isSelected = _paymentMode == mode;
                      return GestureDetector(
                        onTap: () => setState(() => _paymentMode = mode),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                          decoration: BoxDecoration(
                            color: isSelected ? const Color(0xFF6366F1) : Colors.white,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(
                              color: isSelected ? const Color(0xFF6366F1) : const Color(0xFFE2E8F0),
                            ),
                          ),
                          child: Text(
                            mode,
                            style: TextStyle(
                              color: isSelected ? Colors.white : const Color(0xFF64748B),
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 16),

                  // Notes
                  TextField(
                    controller: _notesCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Notes (optional)',
                      prefixIcon: Icon(Icons.note_rounded),
                    ),
                    maxLines: 2,
                  ),
                  const SizedBox(height: 28),

                  // Submit
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: ElevatedButton.icon(
                      onPressed: _loading ? null : _submit,
                      icon: _loading
                          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                          : const Icon(Icons.payment_rounded),
                      label: Text(_loading ? 'Processing...' : 'Record Payment', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF10B981),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}
