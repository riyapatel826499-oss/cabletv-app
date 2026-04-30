import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../providers/customer_provider.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen>
    with SingleTickerProviderStateMixin {
  final _phoneController = TextEditingController();
  final _customerIdController = TextEditingController();
  final _phoneFocusNode = FocusNode();
  bool _isLoading = false;
  String? _error;

  late AnimationController _animController;
  late Animation<double> _fadeAnimation;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );
    _fadeAnimation = CurvedAnimation(
      parent: _animController,
      curve: Curves.easeInOut,
    );
    _animController.forward();

    Future.delayed(const Duration(milliseconds: 500), () {
      if (mounted) _phoneFocusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    _phoneController.dispose();
    _customerIdController.dispose();
    _phoneFocusNode.dispose();
    _animController.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    final phone = _phoneController.text.trim();
    final customerId = _customerIdController.text.trim();

    if (phone.length != 10) {
      setState(() => _error = 'Please enter a valid 10-digit phone number');
      return;
    }
    if (customerId.isEmpty) {
      setState(() => _error = 'Please enter your Customer ID');
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    final provider = Provider.of<CustomerProvider>(context, listen: false);
    final success = await provider.login(phone, customerId);

    if (!mounted) return;

    if (success) {
      Navigator.of(context).pushReplacementNamed('/home');
    } else {
      setState(() {
        _isLoading = false;
        _error = provider.error ?? 'Login failed. Please try again.';
      });
    }
  }

  Future<void> _callSupport() async {
    final uri = Uri(scheme: 'tel', path: '7708551139');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  @override
  Widget build(BuildContext context) {
    final screenHeight = MediaQuery.of(context).size.height;

    return Scaffold(
      body: Container(
        height: screenHeight,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Color(0xFF1E3A8A),
              Color(0xFF312E81),
              Color(0xFF4C1D95),
            ],
          ),
        ),
        child: SafeArea(
          child: SingleChildScrollView(
            physics: const BouncingScrollPhysics(),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: FadeTransition(
                opacity: _fadeAnimation,
                child: Column(
                  children: [
                    SizedBox(height: screenHeight * 0.08),

                    // Logo
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.15),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.tv,
                        size: 56,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 16),

                    Text(
                      'SSA Cables',
                      style: GoogleFonts.poppins(
                        fontSize: 32,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                        letterSpacing: 1,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Your Cable TV Partner',
                      style: GoogleFonts.poppins(
                        fontSize: 15,
                        color: Colors.white70,
                      ),
                    ),
                    const SizedBox(height: 32),

                    // Login Card
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(24),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.15),
                            blurRadius: 25,
                            offset: const Offset(0, 10),
                          ),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Welcome Back!',
                            style: GoogleFonts.poppins(
                              fontSize: 22,
                              fontWeight: FontWeight.w700,
                              color: const Color(0xFF1E3A8A),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Sign in to your account',
                            style: GoogleFonts.poppins(
                              fontSize: 14,
                              color: Colors.grey[500],
                            ),
                          ),
                          const SizedBox(height: 24),

                          // Phone Field
                          Text(
                            'Phone Number',
                            style: GoogleFonts.poppins(
                              fontSize: 13,
                              fontWeight: FontWeight.w500,
                              color: Colors.grey[700],
                            ),
                          ),
                          const SizedBox(height: 8),
                          TextFormField(
                            controller: _phoneController,
                            focusNode: _phoneFocusNode,
                            keyboardType: TextInputType.phone,
                            maxLength: 10,
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly,
                              LengthLimitingTextInputFormatter(10),
                            ],
                            style: GoogleFonts.poppins(fontSize: 15),
                            decoration: InputDecoration(
                              hintText: 'Enter 10-digit number',
                              prefixText: '+91 ',
                              prefixStyle: GoogleFonts.poppins(
                                fontWeight: FontWeight.w600,
                                color: const Color(0xFF1E3A8A),
                              ),
                              counterText: '',
                              prefixIcon: const Icon(
                                Icons.phone_android,
                                color: Color(0xFF1E3A8A),
                              ),
                            ),
                            textInputAction: TextInputAction.next,
                            onFieldSubmitted: (_) {
                              FocusScope.of(context).nextFocus();
                            },
                          ),
                          const SizedBox(height: 16),

                          // Customer ID Field
                          Text(
                            'Customer ID',
                            style: GoogleFonts.poppins(
                              fontSize: 13,
                              fontWeight: FontWeight.w500,
                              color: Colors.grey[700],
                            ),
                          ),
                          const SizedBox(height: 8),
                          TextFormField(
                            controller: _customerIdController,
                            keyboardType: TextInputType.text,
                            textCapitalization: TextCapitalization.characters,
                            inputFormatters: [
                              FilteringTextInputFormatter.allow(
                                  RegExp(r'[A-Za-z0-9\-]')),
                              UpperCaseTextFormatter(),
                            ],
                            style: GoogleFonts.poppins(fontSize: 15),
                            decoration: InputDecoration(
                              hintText: 'SSA-XXXXXX',
                              prefixIcon: const Icon(
                                Icons.badge,
                                color: Color(0xFF1E3A8A),
                              ),
                            ),
                            textInputAction: TextInputAction.done,
                            onFieldSubmitted: (_) => _handleLogin(),
                          ),
                          const SizedBox(height: 8),

                          // Error Message
                          if (_error != null) ...[
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: const Color(0xFFEF4444)
                                    .withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Row(
                                children: [
                                  const Icon(Icons.error_outline,
                                      color: Color(0xFFEF4444), size: 20),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      _error!,
                                      style: GoogleFonts.poppins(
                                        fontSize: 13,
                                        color: const Color(0xFFEF4444),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 16),
                          ],

                          // Login Button
                          Container(
                            height: 52,
                            width: double.infinity,
                            decoration: BoxDecoration(
                              gradient: const LinearGradient(
                                colors: [
                                  Color(0xFF1E3A8A),
                                  Color(0xFF3B82F6),
                                ],
                              ),
                              borderRadius: BorderRadius.circular(14),
                              boxShadow: [
                                BoxShadow(
                                  color: const Color(0xFF1E3A8A)
                                      .withValues(alpha: 0.4),
                                  blurRadius: 12,
                                  offset: const Offset(0, 6),
                                ),
                              ],
                            ),
                            child: Material(
                              color: Colors.transparent,
                              child: InkWell(
                                onTap: _isLoading ? null : _handleLogin,
                                borderRadius: BorderRadius.circular(14),
                                child: Center(
                                  child: _isLoading
                                      ? const SizedBox(
                                          height: 24,
                                          width: 24,
                                          child: CircularProgressIndicator(
                                            color: Colors.white,
                                            strokeWidth: 2.5,
                                          ),
                                        )
                                      : Text(
                                          'Login',
                                          style: GoogleFonts.poppins(
                                            fontSize: 16,
                                            fontWeight: FontWeight.w600,
                                            color: Colors.white,
                                          ),
                                        ),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),

                    // Don't know Customer ID?
                    GestureDetector(
                      onTap: _callSupport,
                      child: RichText(
                        text: TextSpan(
                          style: GoogleFonts.poppins(
                              fontSize: 13, color: Colors.white70),
                          children: [
                            const TextSpan(
                                text: "Don't know your Customer ID? "),
                            TextSpan(
                              text: 'Call Us',
                              style: GoogleFonts.poppins(
                                fontWeight: FontWeight.w600,
                                color: Colors.white,
                                decoration: TextDecoration.underline,
                                decorationColor: Colors.white,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 24),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class UpperCaseTextFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
      TextEditingValue oldValue, TextEditingValue newValue) {
    return TextEditingValue(
      text: newValue.text.toUpperCase(),
      selection: newValue.selection,
    );
  }
}
