import 'package:flutter/material.dart';
import '../services/api_service.dart';
import 'customer_pin_create_screen.dart';
import 'customer_pin_login_screen.dart';

class CustomerMobileAuthScreen extends StatefulWidget {
  const CustomerMobileAuthScreen({super.key});

  @override
  State<CustomerMobileAuthScreen> createState() => _CustomerMobileAuthScreenState();
}

class _CustomerMobileAuthScreenState extends State<CustomerMobileAuthScreen> {
  final _mobileCtrl = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  bool _isLoading = false;
  String? _error;

  @override
  void dispose() {
    _mobileCtrl.dispose();
    super.dispose();
  }

  Future<void> _verifyMobile() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _isLoading = true; _error = null; });

    try {
      final data = await ApiService.verifyMobile(_mobileCtrl.text.trim());

      if (!mounted) return;

      final customerId = data['customer_id'] as String;
      final customerName = data['name'] as String? ?? '';
      final mobile = data['mobile'] as String? ?? _mobileCtrl.text.trim();
      final hasPin = data['has_pin'] as bool? ?? false;

      if (hasPin) {
        // Existing customer with PIN — go to PIN login
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => CustomerPinLoginScreen(
              customerId: customerId,
              customerName: customerName,
              mobile: mobile,
            ),
          ),
        );
      } else {
        // First time — create PIN
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => CustomerPinCreateScreen(
              customerId: customerId,
              customerName: customerName,
              mobile: mobile,
            ),
          ),
        );
      }
    } catch (e) {
      setState(() => _error = e.toString().replaceAll('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF1e1b4b), Color(0xFF3730a3), Color(0xFF6366F1)],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Container(
                constraints: const BoxConstraints(maxWidth: 400),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(28),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.15),
                      blurRadius: 40,
                      offset: const Offset(0, 20),
                    ),
                  ],
                ),
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        // Logo
                        Container(
                          width: 72,
                          height: 72,
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
                            ),
                            borderRadius: BorderRadius.circular(22),
                            boxShadow: [
                              BoxShadow(
                                color: const Color(0xFF6366F1).withValues(alpha: 0.3),
                                blurRadius: 20,
                                offset: const Offset(0, 8),
                              ),
                            ],
                          ),
                          child: const Icon(Icons.tv_rounded, color: Colors.white, size: 36),
                        ),
                        const SizedBox(height: 20),
                        const Text(
                          'Customer Portal',
                          style: TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF1E1B4B),
                          ),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Enter your registered mobile number',
                          style: TextStyle(color: Color(0xFF64748B), fontSize: 14),
                        ),
                        const SizedBox(height: 28),

                        // Error banner
                        if (_error != null) ...[
                          Container(
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFEF2F2),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: const Color(0xFFFECACA)),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.error_outline_rounded, color: Color(0xFFEF4444), size: 20),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Text(_error!, style: const TextStyle(color: Color(0xFFDC2626), fontSize: 13)),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 20),
                        ],

                        // Mobile Number Field
                        TextFormField(
                          controller: _mobileCtrl,
                          keyboardType: TextInputType.phone,
                          maxLength: 10,
                          validator: (v) {
                            if (v == null || v.length != 10) {
                              return 'Enter valid 10-digit mobile number';
                            }
                            return null;
                          },
                          decoration: InputDecoration(
                            labelText: 'Mobile Number',
                            hintText: 'Enter 10 digits',
                            prefixIcon: const Icon(Icons.phone_outlined),
                            prefixText: '+91 ',
                            counterText: '',
                            filled: true,
                            fillColor: Colors.grey[50],
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: BorderSide.none,
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: BorderSide(color: Colors.grey[200]!),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: const BorderSide(color: Color(0xFF6366F1), width: 2),
                            ),
                          ),
                          textInputAction: TextInputAction.done,
                          onFieldSubmitted: (_) => _verifyMobile(),
                        ),
                        const SizedBox(height: 28),

                        // Continue Button
                        SizedBox(
                          width: double.infinity,
                          height: 52,
                          child: ElevatedButton(
                            onPressed: _isLoading ? null : _verifyMobile,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF6366F1),
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                              elevation: 0,
                            ),
                            child: _isLoading
                              ? const SizedBox(
                                  width: 24,
                                  height: 24,
                                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                                )
                              : const Text('Continue', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                          ),
                        ),

                        const SizedBox(height: 20),
                        const Text(
                          'Sree Selvanaayakki Amman Cables',
                          style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
