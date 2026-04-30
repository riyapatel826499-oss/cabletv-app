import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import '../providers/customer_provider.dart';
import '../widgets/common_widgets.dart';

class PayTab extends StatefulWidget {
  const PayTab({super.key});

  @override
  State<PayTab> createState() => _PayTabState();
}

class _PayTabState extends State<PayTab> with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  final _amountController = TextEditingController();
  late Razorpay _razorpay;
  bool _isProcessing = false;
  bool _paymentSuccess = false;
  Map<String, dynamic>? _paymentResult;

  @override
  void initState() {
    super.initState();
    _razorpay = Razorpay();
    _razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _handlePaymentSuccess);
    _razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _handlePaymentError);
    _razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, _handleExternalWallet);
  }

  @override
  void dispose() {
    _razorpay.clear();
    _amountController.dispose();
    super.dispose();
  }

  void _handlePaymentSuccess(PaymentSuccessResponse response) async {
    final provider = Provider.of<CustomerProvider>(context, listen: false);
    final amount = double.tryParse(_amountController.text) ?? 0;

    try {
      final result = await provider.api.verifyPayment(
        razorpayPaymentId: response.paymentId ?? '',
        razorpayOrderId: response.orderId ?? '',
        razorpaySignature: response.signature ?? '',
        amount: amount,
      );

      setState(() {
        _isProcessing = false;
        _paymentSuccess = true;
        _paymentResult = {
          'amount': amount,
          'payment_id': response.paymentId,
          'date': DateTime.now().toIso8601String(),
          ...result,
        };
      });

      await provider.loadDashboard();
    } catch (e) {
      setState(() => _isProcessing = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
                'Payment done but verification failed. Contact support.'),
            backgroundColor: const Color(0xFFEF4444),
          ),
        );
      }
    }
  }

  void _handlePaymentError(PaymentFailureResponse response) {
    setState(() => _isProcessing = false);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(response.message ?? 'Payment failed. Please try again.'),
          backgroundColor: const Color(0xFFEF4444),
        ),
      );
    }
  }

  void _handleExternalWallet(ExternalWalletResponse response) {
    setState(() => _isProcessing = false);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('External wallet: ${response.walletName}'),
          backgroundColor: const Color(0xFF3B82F6),
        ),
      );
    }
  }

  Future<void> _initiatePayment() async {
    final amount = double.tryParse(_amountController.text) ?? 0;
    if (amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter a valid amount'),
          backgroundColor: Color(0xFFEF4444),
        ),
      );
      return;
    }

    setState(() => _isProcessing = true);

    final provider = Provider.of<CustomerProvider>(context, listen: false);

    try {
      final response = await provider.api.initiatePayment(amount);

      var options = {
        'key': response['razorpay_key'],
        'amount': (amount * 100).toInt(),
        'name': 'SSA Cables',
        'description': 'Cable TV Bill Payment',
        'prefill': {
          'contact': provider.customer?['phone'] ?? '',
        },
        'order_id': response['order_id'],
        'theme': {
          'color': '#1E3A8A',
        },
      };

      _razorpay.open(options);
    } catch (e) {
      setState(() => _isProcessing = false);
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

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Consumer<CustomerProvider>(
      builder: (context, provider, _) {
        final dueAmount =
            (provider.dashboard?['due_amount'] as num?)?.toDouble() ?? 0.0;
        final currentPlan =
            provider.dashboard?['current_plan'] as Map<String, dynamic>?;

        if (_amountController.text.isEmpty && dueAmount > 0) {
          _amountController.text = dueAmount.toStringAsFixed(0);
        }

        if (_paymentSuccess) {
          return _buildSuccessScreen();
        }

        return Scaffold(
          backgroundColor: const Color(0xFFF8FAFC),
          body: loadingOverlay(
            SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Header
                  Text(
                    'Make Payment',
                    style: GoogleFonts.poppins(
                      fontSize: 24,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF1E3A8A),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Pay your cable TV bill securely',
                    style: GoogleFonts.poppins(
                      fontSize: 14,
                      color: Colors.grey[500],
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Outstanding Amount Card
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      gradient: dueAmount > 0
                          ? const LinearGradient(
                              colors: [Color(0xFFFEF2F2), Color(0xFFFEE2E2)],
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            )
                          : const LinearGradient(
                              colors: [Color(0xFFF0FDF4), Color(0xFFDCFCE7)],
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: dueAmount > 0
                            ? const Color(0xFFEF4444).withValues(alpha: 0.2)
                            : const Color(0xFF10B981).withValues(alpha: 0.2),
                      ),
                    ),
                    child: Column(
                      children: [
                        Icon(
                          dueAmount > 0
                              ? Icons.warning_amber_rounded
                              : Icons.check_circle_outline,
                          color: dueAmount > 0
                              ? const Color(0xFFEF4444)
                              : const Color(0xFF10B981),
                          size: 32,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          dueAmount > 0 ? 'Outstanding Amount' : 'No Dues!',
                          style: GoogleFonts.poppins(
                            fontSize: 14,
                            color: dueAmount > 0
                                ? const Color(0xFFEF4444)
                                : const Color(0xFF10B981),
                          ),
                        ),
                        const SizedBox(height: 4),
                        amountDisplay(
                          dueAmount,
                          fontSize: 40,
                          color: dueAmount > 0
                              ? const Color(0xFFEF4444)
                              : const Color(0xFF10B981),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Amount Input
                  Text(
                    'Enter Amount',
                    style: GoogleFonts.poppins(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      color: Colors.grey[700],
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    controller: _amountController,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    style: GoogleFonts.poppins(
                      fontSize: 20,
                      fontWeight: FontWeight.w600,
                    ),
                    decoration: InputDecoration(
                      prefixText: '\u20B9 ',
                      prefixStyle: GoogleFonts.poppins(
                        fontSize: 20,
                        fontWeight: FontWeight.w600,
                        color: const Color(0xFF1E3A8A),
                      ),
                      hintText: '0',
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Plan info
                  if (currentPlan != null) ...[
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1E3A8A).withValues(alpha: 0.05),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.info_outline,
                              color: Color(0xFF1E3A8A), size: 20),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Current Plan: ${currentPlan['name'] ?? '-'} - \u20B9${(currentPlan['amount'] as num?)?.toDouble().toStringAsFixed(0) ?? '0'}',
                              style: GoogleFonts.poppins(
                                fontSize: 13,
                                color: const Color(0xFF1E3A8A),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),
                  ],

                  // Pay Button
                  gradientButton(
                    'Pay \u20B9${_amountController.text.isEmpty ? '0' : _amountController.text}',
                    onPressed: _initiatePayment,
                    isLoading: _isProcessing,
                    gradientColors: const [
                      Color(0xFF10B981),
                      Color(0xFF059669),
                    ],
                    height: 56,
                    borderRadius: 16,
                  ),
                  const SizedBox(height: 16),

                  // Security note
                  Center(
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.lock_outline,
                            size: 14, color: Colors.grey[400]),
                        const SizedBox(width: 4),
                        Text(
                          'Secured by Razorpay',
                          style: GoogleFonts.poppins(
                            fontSize: 12,
                            color: Colors.grey[400],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            isLoading: _isProcessing,
          ),
        );
      },
    );
  }

  Widget _buildSuccessScreen() {
    final amount = (_paymentResult?['amount'] as num?)?.toDouble() ?? 0.0;
    final paymentId =
        _paymentResult?['payment_id']?.toString() ?? _paymentResult?['transaction_id']?.toString() ?? '-';
    final date = _paymentResult?['date']?.toString() ?? DateTime.now().toIso8601String();

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Success icon with animation
                TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0, end: 1),
                  duration: const Duration(milliseconds: 600),
                  curve: Curves.elasticOut,
                  builder: (context, value, child) {
                    return Transform.scale(
                      scale: value,
                      child: child,
                    );
                  },
                  child: Container(
                    width: 100,
                    height: 100,
                    decoration: BoxDecoration(
                      color: const Color(0xFF10B981).withValues(alpha: 0.1),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.check_circle,
                      color: Color(0xFF10B981),
                      size: 64,
                    ),
                  ),
                ),
                const SizedBox(height: 24),

                Text(
                  'Payment Successful!',
                  style: GoogleFonts.poppins(
                    fontSize: 24,
                    fontWeight: FontWeight.w700,
                    color: const Color(0xFF10B981),
                  ),
                ),
                const SizedBox(height: 8),

                amountDisplay(amount, fontSize: 36),
                const SizedBox(height: 24),

                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.grey[50],
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    children: [
                      _detailRow('Date', _formatDate(date)),
                      const SizedBox(height: 8),
                      _detailRow('Transaction ID', paymentId),
                    ],
                  ),
                ),
                const SizedBox(height: 32),

                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: () {
                      setState(() {
                        _paymentSuccess = false;
                        _paymentResult = null;
                        _amountController.clear();
                      });
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF1E3A8A),
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: Text(
                      'Done',
                      style: GoogleFonts.poppins(
                          fontWeight: FontWeight.w600, fontSize: 16),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _detailRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: GoogleFonts.poppins(fontSize: 13, color: Colors.grey[500]),
        ),
        Flexible(
          child: Text(
            value,
            style: GoogleFonts.poppins(
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  String _formatDate(String dateStr) {
    try {
      final date = DateTime.parse(dateStr);
      return '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year} ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
    } catch (e) {
      return dateStr;
    }
  }
}
