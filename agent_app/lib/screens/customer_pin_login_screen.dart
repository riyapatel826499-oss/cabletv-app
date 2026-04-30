import 'package:flutter/material.dart';
import '../services/api_service.dart';
import 'customer_dashboard_screen.dart';
import 'customer_mobile_auth_screen.dart';

class CustomerPinLoginScreen extends StatefulWidget {
  final String customerId;
  final String customerName;
  final String mobile;

  const CustomerPinLoginScreen({
    super.key,
    required this.customerId,
    required this.customerName,
    required this.mobile,
  });

  @override
  State<CustomerPinLoginScreen> createState() => _CustomerPinLoginScreenState();
}

class _CustomerPinLoginScreenState extends State<CustomerPinLoginScreen> {
  String _pin = '';
  bool _isLoading = false;
  String? _error;
  int _attempts = 0;

  void _onKeyPressed(String digit) {
    if (_isLoading || _pin.length >= 4) return;

    setState(() {
      _pin += digit;
      if (_pin.length == 4) {
        _onPinComplete();
      }
    });
  }

  void _onBackspace() {
    setState(() {
      if (_pin.isNotEmpty) {
        _pin = _pin.substring(0, _pin.length - 1);
      }
    });
  }

  void _onClear() {
    setState(() {
      _pin = '';
      _error = null;
    });
  }

  Future<void> _onPinComplete() async {
    setState(() { _isLoading = true; _error = null; });

    try {
      final data = await ApiService.customerLoginPin(widget.mobile, _pin);

      // Save customer session
      await ApiService.saveToken(data['access_token']);
      await ApiService.saveUser({
        ...Map<String, dynamic>.from(data['customer'] ?? {}),
        'type': 'customer',
      });

      if (!mounted) return;

      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => const CustomerDashboardScreen()),
      );
    } catch (e) {
      _attempts++;
      setState(() {
        _error = 'Invalid PIN. ${_attempts >= 3 ? 'Too many attempts.' : 'Try again.'}';
        _pin = '';
      });

      if (_attempts >= 3) {
        await Future.delayed(const Duration(seconds: 2));
        if (mounted) {
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(
              builder: (_) => const CustomerMobileAuthScreen(),
            ),
          );
        }
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _switchToOtherNumber() {
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        builder: (_) => const CustomerMobileAuthScreen(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1e1b4b),
      body: SafeArea(
        child: Column(
          children: [
            // Header
            Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
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
                    ),
                    child: const Icon(Icons.tv_rounded, color: Colors.white, size: 36),
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'Enter PIN',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Hi ${widget.customerName}!',
                    style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 14),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '+91 ${widget.mobile}',
                    style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
                  ),
                ],
              ),
            ),

            // PIN Dots
            Container(
              padding: const EdgeInsets.symmetric(vertical: 40),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(4, (index) {
                  final isFilled = index < _pin.length;
                  return AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    margin: const EdgeInsets.symmetric(horizontal: 12),
                    width: isFilled ? 20 : 16,
                    height: isFilled ? 20 : 16,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isFilled ? Colors.white : Colors.white.withValues(alpha: 0.3),
                    ),
                  );
                }),
              ),
            ),

            // Error message
            if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF2F2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.error_outline_rounded, color: Color(0xFFEF4444), size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _error!,
                          style: const TextStyle(color: Color(0xFFDC2626), fontSize: 13),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

            const Spacer(),

            // Loading indicator
            if (_isLoading)
              const Padding(
                padding: EdgeInsets.only(bottom: 20),
                child: CircularProgressIndicator(color: Colors.white),
              ),

            // Switch account button
            TextButton(
              onPressed: _switchToOtherNumber,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.swap_horiz_rounded, size: 18, color: Colors.white.withValues(alpha: 0.7)),
                  const SizedBox(width: 6),
                  Text(
                    'Use different number',
                    style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 14),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),

            // Keypad
            Container(
              padding: const EdgeInsets.all(24),
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
              ),
              child: Column(
                children: [
                  GridView.count(
                    shrinkWrap: true,
                    crossAxisCount: 3,
                    childAspectRatio: 1.3,
                    mainAxisSpacing: 16,
                    crossAxisSpacing: 16,
                    physics: const NeverScrollableScrollPhysics(),
                    children: [
                      ...List.generate(9, (i) => _keypadButton('${i + 1}')),
                      _keypadButton('C', isFunction: true, onTap: _onClear),
                      _keypadButton('0'),
                      _keypadButton(Icons.backspace_outlined, isIcon: true, onTap: _onBackspace),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _keypadButton(dynamic text, {bool isIcon = false, bool isFunction = false, VoidCallback? onTap}) {
    onTap ??= () => _onKeyPressed(text as String);

    return Material(
      color: isFunction ? const Color(0xFFF1F5F9) : Colors.grey[100],
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
          ),
          alignment: Alignment.center,
          child: isIcon
            ? Icon(text as IconData?, color: const Color(0xFF1E1B4B), size: 28)
            : Text(
                text as String,
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFF1E1B4B),
                ),
              ),
        ),
      ),
    );
  }
}
