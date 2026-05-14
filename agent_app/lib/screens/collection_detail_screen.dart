import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/api_service.dart';

class CollectionDetailScreen extends StatefulWidget {
  final Map<String, dynamic> customerData;
  const CollectionDetailScreen({super.key, required this.customerData});

  @override
  State<CollectionDetailScreen> createState() => _CollectionDetailScreenState();
}

class _CollectionDetailScreenState extends State<CollectionDetailScreen> {
  Map<String, dynamic>? _customerDetail;
  bool _loading = true;
  bool _submitting = false;

  late TextEditingController _billAmountCtrl;
  late TextEditingController _discountCtrl;
  late TextEditingController _collectionAmountCtrl;
  late TextEditingController _remarkCtrl;
  late TextEditingController _prevBalanceCtrl;

  String _paymentMode = 'Cash';
  bool _isArrear = false;
  double _billAmount = 0;
  double _discount = 0;
  double _prevBalance = 0;

  @override
  void initState() {
    super.initState();
    _billAmountCtrl = TextEditingController();
    _discountCtrl = TextEditingController(text: '0');
    _collectionAmountCtrl = TextEditingController();
    _remarkCtrl = TextEditingController();
    _prevBalanceCtrl = TextEditingController(text: '0');

    _loadDetail();
  }

  @override
  void dispose() {
    _billAmountCtrl.dispose();
    _discountCtrl.dispose();
    _collectionAmountCtrl.dispose();
    _remarkCtrl.dispose();
    _prevBalanceCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadDetail() async {
    try {
      final customerId = widget.customerData['customer_id'] ?? '';
      final detail = await ApiService.getCustomerCollectionDetail(customerId);
      if (!mounted) return;

      setState(() {
        _customerDetail = detail;
        _loading = false;
      });

      // Set bill amount from plan_amount or pending_amount
      final planAmount = (widget.customerData['plan_amount'] ?? 0).toDouble();
      final pendingAmount = (widget.customerData['pending_amount'] ?? 0).toDouble();
      final billAmt = pendingAmount > 0 ? pendingAmount : planAmount;

      _billAmount = billAmt;
      _billAmountCtrl.text = billAmt.toStringAsFixed(0);
      _recalculate();
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      // Use the passed-in data as fallback
      final planAmount = (widget.customerData['plan_amount'] ?? 0).toDouble();
      final pendingAmount = (widget.customerData['pending_amount'] ?? 0).toDouble();
      _billAmount = pendingAmount > 0 ? pendingAmount : planAmount;
      _billAmountCtrl.text = _billAmount.toStringAsFixed(0);
      _recalculate();
    }
  }

  void _recalculate() {
    _billAmount = double.tryParse(_billAmountCtrl.text) ?? 0;
    _discount = double.tryParse(_discountCtrl.text) ?? 0;
    _prevBalance = double.tryParse(_prevBalanceCtrl.text) ?? 0;
    final collection = _billAmount - _discount;
    _collectionAmountCtrl.text = collection.toStringAsFixed(0);
    setState(() {});
  }

  Future<void> _submitPayment() async {
    if (_submitting) return;
    final collection = double.tryParse(_collectionAmountCtrl.text) ?? 0;
    if (collection <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Collection amount must be greater than 0'), backgroundColor: Colors.red),
      );
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Confirm Payment'),
        content: Text(
          'Collect ₹${collection.toStringAsFixed(0)} from ${widget.customerData['name'] ?? 'customer'} via $_paymentMode?',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFDC2626), foregroundColor: Colors.white),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    setState(() => _submitting = true);
    try {
      await ApiService.recordPayment(
        customerId: widget.customerData['customer_id'] ?? '',
        connectionId: widget.customerData['conn_id'] ?? -1,
        planId: 0,
        amount: collection,
        paymentMode: _paymentMode,
        monthYear: '', // Backend auto-fills
        notes: _remarkCtrl.text.isNotEmpty ? _remarkCtrl.text : null,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Payment collected successfully!'),
          backgroundColor: Color(0xFF10B981),
          duration: Duration(seconds: 2),
        ),
      );
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e.toString().replaceAll('Exception: ', '')),
          backgroundColor: Colors.red,
          duration: const Duration(seconds: 3),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = widget.customerData;
    final detail = _customerDetail;
    final name = data['name'] ?? '--';
    final phone = data['phone'] ?? '';
    final customerId = data['customer_id'] ?? '';
    final stbNo = data['stb_no'] ?? '';
    final canId = data['can_id'] ?? '';
    final mso = data['mso'] ?? '';
    final area = data['area'] ?? '';
    final address = data['address'] ?? '';
    final planName = data['plan_name'] ?? '';
    final planAmount = (data['plan_amount'] ?? 0).toDouble();
    final expiryDate = data['expiry_date'] ?? '';
    final lastPayAmt = data['last_payment_amount'];
    final lastPayDate = data['last_payment_date'];
    final network = data['network'] ?? '';
    final isPaid = data['is_paid'] == true || data['is_paid'] == 1;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: Column(
        children: [
          // AppBar
          Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFFDC2626), Color(0xFFEF4444)],
              ),
            ),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
                child: Row(
                  children: [
                    IconButton(
                      icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
                      onPressed: () => Navigator.pop(context),
                    ),
                    const Expanded(
                      child: Text(
                        'Collection Detail',
                        style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),

          // Profile section (dark blue/navy)
          Container(
            width: double.infinity,
            decoration: const BoxDecoration(
              color: Color(0xFF1E293B),
              borderRadius: BorderRadius.only(
                bottomLeft: Radius.circular(24),
                bottomRight: Radius.circular(24),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
              child: Column(
                children: [
                  // Phone and wrench icons
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      if (phone.isNotEmpty)
                        GestureDetector(
                          onTap: () {
                            final cleaned = phone.replaceAll(RegExp(r'[^\d+]'), '');
                            Clipboard.setData(ClipboardData(text: cleaned));
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Phone copied'),
                                duration: Duration(seconds: 1),
                                behavior: SnackBarBehavior.floating,
                              ),
                            );
                          },
                          child: Container(
                            width: 36,
                            height: 36,
                            decoration: BoxDecoration(
                              color: Colors.white.withOpacity(0.1),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(Icons.phone_rounded, color: Colors.white70, size: 18),
                          ),
                        )
                      else
                        const SizedBox(width: 36),
                      // Avatar
                      Container(
                        width: 64,
                        height: 64,
                        decoration: BoxDecoration(
                          color: isPaid ? const Color(0xFF10B981) : const Color(0xFFDC2626),
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white.withOpacity(0.3), width: 3),
                        ),
                        child: Center(
                          child: Text(
                            name.isNotEmpty ? name[0].toUpperCase() : '?',
                            style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w700),
                          ),
                        ),
                      ),
                      Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.1),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.build_rounded, color: Colors.white70, size: 18),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(
                    name,
                    style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700),
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    customerId,
                    style: TextStyle(color: Colors.white.withOpacity(0.6), fontSize: 13),
                  ),
                ],
              ),
            ),
          ),

          // Detail fields
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFFDC2626)))
                : SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        // Info card
                        Container(
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(16),
                            boxShadow: [
                              BoxShadow(color: Colors.black.withOpacity(0.04), blurRadius: 8, offset: const Offset(0, 2)),
                            ],
                          ),
                          child: Column(
                            children: [
                              _detailRow('PayPakka User ID', customerId),
                              const Divider(height: 1, indent: 16, endIndent: 16),
                              _detailRow('STB No', stbNo),
                              const Divider(height: 1, indent: 16, endIndent: 16),
                              _detailRow('CAN ID', canId),
                              const Divider(height: 1, indent: 16, endIndent: 16),
                              _detailRow('MSO', mso),
                              const Divider(height: 1, indent: 16, endIndent: 16),
                              _detailRow('Network', network),
                              const Divider(height: 1, indent: 16, endIndent: 16),
                              _detailRow(
                                'Area',
                                area,
                                trailing: Icon(Icons.edit_rounded, size: 16, color: Colors.grey[400]),
                              ),
                              const Divider(height: 1, indent: 16, endIndent: 16),
                              _detailRow('Mobile', phone),
                              const Divider(height: 1, indent: 16, endIndent: 16),
                              _detailRow(
                                'Last Transaction',
                                lastPayAmt != null ? '₹${lastPayAmt.toStringAsFixed(0)}' : '--',
                                subtitle: lastPayDate != null ? _formatDateTime(lastPayDate) : null,
                              ),
                              const Divider(height: 1, indent: 16, endIndent: 16),
                              _detailRow('Plan', '$planName - ₹${planAmount.toStringAsFixed(0)}'),
                              const Divider(height: 1, indent: 16, endIndent: 16),
                              _detailRow('Expiry', expiryDate.isNotEmpty ? _formatDate(expiryDate) : '--'),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),

                        // Payment form card
                        Container(
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(16),
                            boxShadow: [
                              BoxShadow(color: Colors.black.withOpacity(0.04), blurRadius: 8, offset: const Offset(0, 2)),
                            ],
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'Payment Details',
                                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Color(0xFF1E293B)),
                                ),
                                const SizedBox(height: 16),

                                // Previous Balance
                                _buildTextField(
                                  label: 'Previous Balance',
                                  controller: _prevBalanceCtrl,
                                  prefix: '₹',
                                  onChanged: (_) => _recalculate(),
                                ),
                                const SizedBox(height: 12),

                                // Bill Amount with CHANGE button
                                Row(
                                  children: [
                                    Expanded(
                                      child: _buildTextField(
                                        label: 'Bill Amount',
                                        controller: _billAmountCtrl,
                                        prefix: '₹',
                                        onChanged: (_) => _recalculate(),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    SizedBox(
                                      height: 56,
                                      child: ElevatedButton(
                                        onPressed: _changingPlan ? null : _showChangePlanSheet,
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor: const Color(0xFFDC2626),
                                          foregroundColor: Colors.white,
                                          disabledBackgroundColor: const Color(0xFFDC2626).withOpacity(0.6),
                                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                          padding: const EdgeInsets.symmetric(horizontal: 12),
                                        ),
                                        child: _changingPlan
                                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                                            : const Text('CHANGE!', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),

                                // Payment Mode
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text('Payment Mode', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: Color(0xFF64748B))),
                                    const SizedBox(height: 6),
                                    Container(
                                      decoration: BoxDecoration(
                                        border: Border.all(color: const Color(0xFFE2E8F0)),
                                        borderRadius: BorderRadius.circular(10),
                                      ),
                                      child: DropdownButtonHideUnderline(
                                        child: DropdownButton<String>(
                                          value: _paymentMode,
                                          isExpanded: true,
                                          padding: const EdgeInsets.symmetric(horizontal: 12),
                                          items: ['Cash', 'Online', 'UPI', 'Cheque']
                                              .map((m) => DropdownMenuItem(value: m, child: Text(m, style: const TextStyle(fontSize: 14))))
                                              .toList(),
                                          onChanged: (v) {
                                            if (v != null) setState(() => _paymentMode = v);
                                          },
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),

                                // Discount
                                _buildTextField(
                                  label: 'Discount',
                                  controller: _discountCtrl,
                                  prefix: '₹',
                                  onChanged: (_) => _recalculate(),
                                ),
                                const SizedBox(height: 12),

                                // Collection Amount (auto-calculated, read-only)
                                _buildTextField(
                                  label: 'Collection Amount',
                                  controller: _collectionAmountCtrl,
                                  prefix: '₹',
                                  readOnly: true,
                                  onChanged: null,
                                  style: const TextStyle(
                                    fontSize: 18,
                                    fontWeight: FontWeight.w800,
                                    color: Color(0xFFDC2626),
                                  ),
                                ),
                                const SizedBox(height: 12),

                                // Is Arrear Collection toggle
                                Container(
                                  decoration: BoxDecoration(
                                    border: Border.all(color: const Color(0xFFE2E8F0)),
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                                  child: Row(
                                    children: [
                                      const Expanded(
                                        child: Text(
                                          'Is Arrear Collection',
                                          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: Color(0xFF334155)),
                                        ),
                                      ),
                                      Switch(
                                        value: _isArrear,
                                        activeColor: const Color(0xFFDC2626),
                                        onChanged: (v) => setState(() => _isArrear = v),
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(height: 12),

                                // Remark
                                TextField(
                                  controller: _remarkCtrl,
                                  decoration: InputDecoration(
                                    labelText: 'Remark',
                                    labelStyle: const TextStyle(color: Color(0xFF64748B), fontSize: 13),
                                    border: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(10),
                                      borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                                    ),
                                    enabledBorder: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(10),
                                      borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                                    ),
                                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                                  ),
                                  maxLines: 2,
                                  style: const TextStyle(fontSize: 14),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 24),

                        // Submit button
                        SizedBox(
                          width: double.infinity,
                          height: 52,
                          child: ElevatedButton(
                            onPressed: _submitting ? null : _submitPayment,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFFDC2626),
                              foregroundColor: Colors.white,
                              disabledBackgroundColor: const Color(0xFFDC2626).withOpacity(0.5),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                              elevation: 2,
                            ),
                            child: _submitting
                                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                                : const Text(
                                    'Submit',
                                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, letterSpacing: 0.5),
                                  ),
                          ),
                        ),
                        const SizedBox(height: 32),
                      ],
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _detailRow(String label, String value, {Widget? trailing, String? subtitle}) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: TextStyle(color: Colors.grey[500], fontSize: 12, fontWeight: FontWeight.w500)),
                if (subtitle != null)
                  Text(subtitle, style: TextStyle(color: Colors.grey[400], fontSize: 10)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              value.isNotEmpty ? value : '--',
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: Color(0xFF1E293B)),
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (trailing != null) ...[
            const SizedBox(width: 4),
            trailing,
          ],
        ],
      ),
    );
  }

  Widget _buildTextField({
    required String label,
    required TextEditingController controller,
    String? prefix,
    bool readOnly = false,
    TextStyle? style,
    ValueChanged<String>? onChanged,
  }) {
    return TextField(
      controller: controller,
      readOnly: readOnly,
      keyboardType: TextInputType.number,
      style: style ?? const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Color(0xFF64748B), fontSize: 13),
        prefixText: prefix,
        prefixStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Color(0xFF64748B)),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
        ),
        filled: readOnly,
        fillColor: readOnly ? const Color(0xFFF8FAFC) : null,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      ),
      onChanged: onChanged,
    );
  }

  bool _changingPlan = false;
  String _currentPlanName = '';
  double _currentPlanAmount = 0;

  Future<void> _showChangePlanSheet() async {
    // Fetch available plans
    try {
      final plans = await ApiService.getPlans();
      if (!mounted) return;

      final currentPlan = widget.customerData['plan_name'] ?? '';
      final network = widget.customerData['network'] ?? '';

      // Filter plans by same network if available
      List<dynamic> filteredPlans = plans;
      if (network.isNotEmpty) {
        final sameNetwork = plans.where((p) => (p['network'] ?? '') == network).toList();
        if (sameNetwork.isNotEmpty) filteredPlans = sameNetwork;
      }

      showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (ctx) => DraggableScrollableSheet(
          initialChildSize: 0.7,
          maxChildSize: 0.9,
          minChildSize: 0.4,
          builder: (_, scrollCtrl) => Container(
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.only(topLeft: Radius.circular(24), topRight: Radius.circular(24)),
            ),
            child: Column(
              children: [
                // Handle bar
                Container(
                  margin: const EdgeInsets.only(top: 12),
                  width: 40, height: 4,
                  decoration: BoxDecoration(color: Colors.grey[300], borderRadius: BorderRadius.circular(2)),
                ),
                Padding(
                  padding: const EdgeInsets.all(20),
                  child: Row(
                    children: [
                      const Icon(Icons.swap_horiz_rounded, color: Color(0xFFDC2626)),
                      const SizedBox(width: 8),
                      const Expanded(
                        child: Text('Change Base Pack', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                      ),
                      Text(
                        'Current: $currentPlan',
                        style: TextStyle(color: Colors.grey[500], fontSize: 12, fontWeight: FontWeight.w500),
                      ),
                    ],
                  ),
                ),
                const Divider(height: 1),
                Expanded(
                  child: ListView.builder(
                    controller: scrollCtrl,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    itemCount: filteredPlans.length,
                    itemBuilder: (_, idx) {
                      final p = filteredPlans[idx];
                      final pName = p['name'] ?? '';
                      final pAmount = (p['amount'] ?? 0).toDouble();
                      final pNetwork = p['network'] ?? '';
                      final pDesc = p['description'] ?? '';
                      final pValidity = p['validity_days'] ?? 30;
                      final pActive = p['status'] == 'Active';
                      final isCurrent = pName == currentPlan;

                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Material(
                          color: isCurrent ? const Color(0xFFDCFCE7) : Colors.white,
                          borderRadius: BorderRadius.circular(14),
                          elevation: isCurrent ? 0 : 0.5,
                          child: InkWell(
                            borderRadius: BorderRadius.circular(14),
                            onTap: isCurrent || !pActive ? null : () => _selectPlan(p),
                            child: Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(14),
                                border: isCurrent
                                    ? Border.all(color: const Color(0xFF10B981), width: 1.5)
                                    : Border.all(color: const Color(0xFFF1F5F9)),
                              ),
                              child: Row(
                                children: [
                                  Container(
                                    width: 48, height: 48,
                                    decoration: BoxDecoration(
                                      color: isCurrent
                                          ? const Color(0xFF10B981).withOpacity(0.15)
                                          : const Color(0xFFDC2626).withOpacity(0.1),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Icon(
                                      isCurrent ? Icons.check_circle_rounded : Icons.tv_rounded,
                                      color: isCurrent ? const Color(0xFF10B981) : const Color(0xFFDC2626),
                                      size: 22,
                                    ),
                                  ),
                                  const SizedBox(width: 14),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          children: [
                                            Text(pName, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                                            if (isCurrent)
                                              Container(
                                                margin: const EdgeInsets.only(left: 8),
                                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                                decoration: BoxDecoration(
                                                  color: const Color(0xFF10B981).withOpacity(0.15),
                                                  borderRadius: BorderRadius.circular(6),
                                                ),
                                                child: const Text('CURRENT',
                                                  style: TextStyle(color: Color(0xFF10B981), fontSize: 9, fontWeight: FontWeight.w700)),
                                              ),
                                          ],
                                        ),
                                        const SizedBox(height: 4),
                                        Row(
                                          children: [
                                            if (pNetwork.isNotEmpty) ...[
                                              Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                decoration: BoxDecoration(
                                                  color: const Color(0xFFF1F5F9),
                                                  borderRadius: BorderRadius.circular(4),
                                                ),
                                                child: Text(pNetwork, style: TextStyle(fontSize: 10, color: Colors.grey[600])),
                                              ),
                                              const SizedBox(width: 6),
                                            ],
                                            Text('$pValidity days',
                                              style: TextStyle(fontSize: 11, color: Colors.grey[500])),
                                          ],
                                        ),
                                        if (pDesc.isNotEmpty)
                                          Padding(
                                            padding: const EdgeInsets.only(top: 2),
                                            child: Text(pDesc, style: TextStyle(fontSize: 11, color: Colors.grey[400]),
                                              maxLines: 1, overflow: TextOverflow.ellipsis),
                                          ),
                                      ],
                                    ),
                                  ),
                                  Text('₹${pAmount.toStringAsFixed(0)}',
                                    style: TextStyle(
                                      fontWeight: FontWeight.w800,
                                      fontSize: 18,
                                      color: isCurrent ? const Color(0xFF10B981) : const Color(0xFFDC2626),
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
              ],
            ),
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to load plans: ${e.toString().replaceAll('Exception: ', '')}'), backgroundColor: Colors.red),
      );
    }
  }

  Future<void> _selectPlan(Map<String, dynamic> plan) async {
    final pName = plan['name'] ?? '';
    final pAmount = (plan['amount'] ?? 0).toDouble();
    final planId = plan['id'];

    // Ask confirmation
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            const Icon(Icons.swap_horiz_rounded, color: Color(0xFFDC2626)),
            const SizedBox(width: 8),
            const Expanded(child: Text('Change Base Pack?', style: TextStyle(fontSize: 16))),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${widget.customerData['name'] ?? 'Customer'}',
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('From:', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text(_currentPlanName.isNotEmpty ? _currentPlanName : (widget.customerData['plan_name'] ?? '--'),
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text('₹${_currentPlanAmount > 0 ? _currentPlanAmount.toStringAsFixed(0) : (widget.customerData['plan_amount'] ?? 0).toStringAsFixed(0)}',
                      style: TextStyle(color: Colors.grey[600], fontSize: 12)),
                  ],
                ),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16),
                  child: Icon(Icons.arrow_forward_rounded, color: Color(0xFFDC2626)),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('To:', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text(pName, style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFFDC2626))),
                    Text('₹${pAmount.toStringAsFixed(0)}', style: const TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.w600, fontSize: 12)),
                  ],
                ),
              ],
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFDC2626), foregroundColor: Colors.white),
            child: const Text('Change Pack'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    Navigator.pop(context); // Close the bottom sheet

    setState(() => _changingPlan = true);
    try {
      final result = await ApiService.changePlan(
        widget.customerData['customer_id'] ?? '',
        planId,
      );
      if (!mounted) return;
      setState(() {
        _changingPlan = false;
        _currentPlanName = pName;
        _currentPlanAmount = pAmount;
        _billAmountCtrl.text = pAmount.toStringAsFixed(0);
      });
      _recalculate();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result['message'] ?? 'Plan changed to $pName (₹${pAmount.toStringAsFixed(0)})'),
          backgroundColor: const Color(0xFF10B981),
          duration: const Duration(seconds: 2),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _changingPlan = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString().replaceAll('Exception: ', '')), backgroundColor: Colors.red),
      );
    }
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

  String _formatDateTime(String dateStr) {
    try {
      final dt = DateTime.parse(dateStr);
      final months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      int hr = dt.hour;
      final min = dt.minute.toString().padLeft(2, '0');
      final ampm = hr >= 12 ? 'PM' : 'AM';
      if (hr > 12) hr -= 12;
      if (hr == 0) hr = 12;
      return '${dt.day.toString().padLeft(2, '0')} ${months[dt.month - 1]} ${dt.year} $hr:$min $ampm';
    } catch (_) {
      return dateStr;
    }
  }
}
