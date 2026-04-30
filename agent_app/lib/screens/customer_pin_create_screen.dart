import 'package:flutter/material.dart';
import '../services/api_service.dart';
import 'customer_dashboard_screen.dart';

class CustomerPinCreateScreen extends StatefulWidget {
  final String customerId;
  final String customerName;
  final String mobile;

  const CustomerPinCreateScreen({
    super.key,
    required this.customerId,
    required this.customerName,
    required this.mobile,
  });

  @override
  State<CustomerPinCreateScreen> createState() => _CustomerPinCreateScreenState();
}

class _CustomerPinCreateScreenState extends State<CustomerPinCreateScreen> {
  String _pin = '';
  String _confirmPin = '';
  bool _isLoading = false;
  String? _error;
  bool _isConfirming = false;

  void _onKeyPressed(String digit) {
    if (_isLoading) return;

    setState(() {
      if (!_isConfirming) {
        if (_pin.length < 4) {
          _pin += digit;
          if (_pin.length == 4) {
            _isConfirming = true;
          }
        }
      } else {
        if (_confirmPin.length < 4) {
          _confirmPin += digit;
          if (_confirmPin.length == 4) {
            _onPinComplete();
          }
        }
      }
    });
  }

  void _onBackspace() {
    setState(() {
      if (_confirmPin.isNotEmpty) {
        _confirmPin = _confirmPin.substring(0, _confirmPin.length - 1);
      } else if (_isConfirming && _confirmPin.isEmpty) {
        _isConfirming = false;
        _pin = _pin.substring(0, _pin.length - 1);
      } else if (_pin.isNotEmpty) {
        _pin = _pin.substring(0, _pin.length - 1);
      }
    });
  }

  Future<void> _onPinComplete() async {
    if (_pin != _confirmPin) {
      setState(() {
        _error = 'PINs do not match. Please try again.';
        _pin = '';
        _confirmPin = '';
        _isConfirming = false;
      });
      return;
    }

    setState(() { _isLoading = true; _error = null; });

    try {
      final data = await ApiService.setCustomerPin(widget.customerId, widget.mobile, _pin);

      // Save customer session
      await ApiService.saveToken(data['token'] ?? 'customer_${widget.customerId}');
      await ApiService.saveUser({
        'id': widget.customerId,
        'name': widget.customerName,
        'mobile': widget.mobile,
        'type': 'customer',
      });

      if (!mounted) return;

      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => const CustomerDashboardScreen()),
      );
    } catch (e) {
      setState(() {
        _error = e.toString().replaceAll('Exception: ', '');
        _pin = '';
        _confirmPin = '';
        _isConfirming = false;
      });
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _onClear() {
    setState(() {
      _pin = '';
      _confirmPin = '';
      _isConfirming = false;
      _error = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final pinToShow = _isConfirming ? _confirmPin : _pin;

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
                  Text(
                    _isConfirming ? 'Re-enter PIN' : 'Create 4-digit PIN',
                    style: const TextStyle(
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
                  const SizedBox(height: 4),
                  Text(
                    _isConfirming
                      ? 'Please confirm your PIN'
                      : 'This PIN will be used for quick login',
                    style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
                  ),
                ],
              ),
            ),

            // PIN Display
            Container(
              padding: const EdgeInsets.symmetric(vertical: 40),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(4, (index) {
                  final isFilled = index < pinToShow.length;
                  return Container(
                    margin: const EdgeInsets.symmetric(horizontal: 12),
                    width: 20,
                    height: 20,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isFilled ? Colors.white : const Color.fromRGBO(255, 255, 255, 0.3),
                    ),
                  );
                }),
              ),
            ),

            // Error message
            if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
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

            // Keypad
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
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
            ? Icon(text as IconData, color: const Color(0xFF1E1B4B), size: 28)
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
