import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../providers/customer_provider.dart';
import '../widgets/common_widgets.dart';

class ProfileTab extends StatefulWidget {
  const ProfileTab({super.key});

  @override
  State<ProfileTab> createState() => _ProfileTabState();
}

class _ProfileTabState extends State<ProfileTab>
    with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final provider = Provider.of<CustomerProvider>(context, listen: false);
      if (provider.profile == null) {
        provider.loadProfile();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Consumer<CustomerProvider>(
      builder: (context, provider, _) {
        final profile = provider.profile;
        final dash = provider.dashboard;
        final name = profile?['name'] ?? dash?['name'] ?? provider.customer?['name'] ?? 'Customer';
        final phone = profile?['phone'] ?? provider.customer?['phone'] ?? '-';
        final customerId = profile?['customer_id'] ?? provider.customer?['customer_id'] ?? dash?['customer_id'] ?? '-';
        final area = profile?['area'] ?? provider.customer?['area'] ?? '-';
        final address = profile?['address'] ?? area;

        // Connection info
        final connections = profile?['connections'] as List<dynamic>?;
        final conn = connections != null && connections.isNotEmpty
            ? connections[0] as Map<String, dynamic>
            : dash?['connection'] as Map<String, dynamic>?;

        final currentPlan = dash?['current_plan'] as Map<String, dynamic>? ??
            profile?['current_plan'] as Map<String, dynamic>?;

        return Scaffold(
          backgroundColor: const Color(0xFFF8FAFC),
          body: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            child: Column(
              children: [
                // Header with avatar
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.only(
                      top: 48, bottom: 32, left: 20, right: 20),
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      colors: [Color(0xFF1E3A8A), Color(0xFF3B82F6)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.only(
                      bottomLeft: Radius.circular(32),
                      bottomRight: Radius.circular(32),
                    ),
                  ),
                  child: Column(
                    children: [
                      // Avatar
                      Container(
                        width: 80,
                        height: 80,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Colors.white, Color(0xFFE0E7FF)],
                          ),
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.15),
                              blurRadius: 12,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: Center(
                          child: Text(
                            name.isNotEmpty ? name[0].toUpperCase() : '?',
                            style: GoogleFonts.poppins(
                              fontSize: 32,
                              fontWeight: FontWeight.w700,
                              color: const Color(0xFF1E3A8A),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        name,
                        style: GoogleFonts.poppins(
                          fontSize: 22,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          customerId,
                          style: GoogleFonts.poppins(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      // Phone
                      _profileInfoCard(
                        'Phone Number',
                        phone,
                        Icons.phone_android,
                        const Color(0xFF3B82F6),
                        trailing: IconButton(
                          icon: const Icon(Icons.call,
                              color: Color(0xFF10B981)),
                          onPressed: () async {
                            final uri = Uri(scheme: 'tel', path: phone);
                            if (await canLaunchUrl(uri)) {
                              await launchUrl(uri);
                            }
                          },
                        ),
                      ),
                      const SizedBox(height: 12),

                      // Address
                      _profileInfoCard(
                        'Address',
                        address?.toString() ?? '-',
                        Icons.location_on,
                        const Color(0xFFEF4444),
                      ),
                      const SizedBox(height: 12),

                      // Connection Info
                      if (conn != null) ...[
                        _sectionTitle('Connection Details'),
                        const SizedBox(height: 8),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(16),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.04),
                                blurRadius: 8,
                                offset: const Offset(0, 2),
                              ),
                            ],
                          ),
                          child: Column(
                            children: [
                              if (conn['stb_no'] != null)
                                _detailRow(
                                    'STB No', conn['stb_no'].toString()),
                              if (conn['stb_no'] != null)
                                const SizedBox(height: 10),
                              if (conn['can_id'] != null)
                                _detailRow(
                                    'CAN ID', conn['can_id'].toString()),
                              if (conn['can_id'] != null)
                                const SizedBox(height: 10),
                              if (conn['mso'] != null)
                                _detailRow('MSO', conn['mso'].toString()),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],

                      // Current Plan
                      if (currentPlan != null) ...[
                        _sectionTitle('Current Plan'),
                        const SizedBox(height: 8),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(16),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.04),
                                blurRadius: 8,
                                offset: const Offset(0, 2),
                              ),
                            ],
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  currentPlan['name']?.toString() ??
                                      'Standard Plan',
                                  style: GoogleFonts.poppins(
                                    fontSize: 15,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ),
                              amountDisplay(
                                (currentPlan['amount'] as num?)
                                        ?.toDouble() ??
                                    0.0,
                                fontSize: 18,
                                color: const Color(0xFF1E3A8A),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],

                      // Action Buttons
                      _sectionTitle('Actions'),
                      const SizedBox(height: 8),

                      // Change Password
                      _actionButton(
                        'Change Password',
                        Icons.lock_outline,
                        const Color(0xFF1E3A8A),
                        () => _showChangePasswordDialog(context),
                      ),
                      const SizedBox(height: 8),

                      // Call Support
                      _actionButton(
                        'Call Support',
                        Icons.phone,
                        const Color(0xFF10B981),
                        () async {
                          final uri =
                              Uri(scheme: 'tel', path: '7708551139');
                          if (await canLaunchUrl(uri)) {
                            await launchUrl(uri);
                          }
                        },
                      ),
                      const SizedBox(height: 8),

                      // WhatsApp Us
                      _actionButton(
                        'WhatsApp Us',
                        Icons.chat,
                        const Color(0xFF25D366),
                        () async {
                          final uri = Uri.parse(
                              'https://wa.me/917708551139');
                          if (await canLaunchUrl(uri)) {
                            await launchUrl(uri,
                                mode: LaunchMode.externalApplication);
                          }
                        },
                      ),
                      const SizedBox(height: 24),

                      // Logout Button
                      Container(
                        width: double.infinity,
                        height: 50,
                        decoration: BoxDecoration(
                          color: const Color(0xFFEF4444).withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color:
                                const Color(0xFFEF4444).withValues(alpha: 0.3),
                          ),
                        ),
                        child: Material(
                          color: Colors.transparent,
                          child: InkWell(
                            onTap: () => _showLogoutDialog(context),
                            borderRadius: BorderRadius.circular(14),
                            child: Center(
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.logout,
                                      color: Color(0xFFEF4444), size: 20),
                                  const SizedBox(width: 8),
                                  Text(
                                    'Logout',
                                    style: GoogleFonts.poppins(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w600,
                                      color: const Color(0xFFEF4444),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 40),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _profileInfoCard(
      String title, String value, IconData icon, Color color,
      {Widget? trailing}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: GoogleFonts.poppins(
                    fontSize: 12,
                    color: Colors.grey[500],
                  ),
                ),
                Text(
                  value,
                  style: GoogleFonts.poppins(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          if (trailing != null) trailing,
        ],
      ),
    );
  }

  Widget _sectionTitle(String title) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Text(
        title,
        style: GoogleFonts.poppins(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          color: const Color(0xFF1E3A8A),
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
          style: GoogleFonts.poppins(fontSize: 14, color: Colors.grey[500]),
        ),
        Text(
          value,
          style: GoogleFonts.poppins(
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }

  Widget _actionButton(
      String label, IconData icon, Color color, VoidCallback onTap) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Icon(icon, color: color, size: 22),
                const SizedBox(width: 14),
                Text(
                  label,
                  style: GoogleFonts.poppins(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const Spacer(),
                Icon(Icons.chevron_right, color: Colors.grey[300], size: 22),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _showLogoutDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(
          'Logout',
          style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
        ),
        content: Text(
          'Are you sure you want to logout?',
          style: GoogleFonts.poppins(),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(
              'Cancel',
              style: GoogleFonts.poppins(color: Colors.grey[600]),
            ),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(context);
              final provider =
                  Provider.of<CustomerProvider>(this.context, listen: false);
              await provider.logout();
              if (mounted) {
                Navigator.of(this.context)
                    .pushNamedAndRemoveUntil('/login', (route) => false);
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFEF4444),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
            ),
            child: Text('Logout', style: GoogleFonts.poppins()),
          ),
        ],
      ),
    );
  }

  void _showChangePasswordDialog(BuildContext context) {
    final currentPwdController = TextEditingController();
    final newPwdController = TextEditingController();
    final confirmPwdController = TextEditingController();
    bool isLoading = false;

    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16)),
              title: Text(
                'Change Password',
                style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: currentPwdController,
                    obscureText: true,
                    style: GoogleFonts.poppins(fontSize: 14),
                    decoration: InputDecoration(
                      hintText: 'Current Password',
                      prefixIcon: const Icon(Icons.lock_outline, size: 20),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: newPwdController,
                    obscureText: true,
                    style: GoogleFonts.poppins(fontSize: 14),
                    decoration: InputDecoration(
                      hintText: 'New Password',
                      prefixIcon:
                          const Icon(Icons.lock_open_outlined, size: 20),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: confirmPwdController,
                    obscureText: true,
                    style: GoogleFonts.poppins(fontSize: 14),
                    decoration: InputDecoration(
                      hintText: 'Confirm New Password',
                      prefixIcon: const Icon(Icons.lock_outlined, size: 20),
                    ),
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: Text(
                    'Cancel',
                    style: GoogleFonts.poppins(color: Colors.grey[600]),
                  ),
                ),
                ElevatedButton(
                  onPressed: isLoading
                      ? null
                      : () async {
                          if (newPwdController.text !=
                              confirmPwdController.text) {
                            ScaffoldMessenger.of(this.context).showSnackBar(
                              const SnackBar(
                                content: Text('Passwords do not match'),
                                backgroundColor: Color(0xFFEF4444),
                              ),
                            );
                            return;
                          }
                          setDialogState(() => isLoading = true);
                          final provider = Provider.of<CustomerProvider>(
                              this.context,
                              listen: false);
                          try {
                            await provider.api.changePassword(
                              currentPwdController.text,
                              newPwdController.text,
                            );
                            Navigator.pop(context);
                            ScaffoldMessenger.of(this.context).showSnackBar(
                              const SnackBar(
                                content:
                                    Text('Password changed successfully!'),
                                backgroundColor: Color(0xFF10B981),
                              ),
                            );
                          } catch (e) {
                            setDialogState(() => isLoading = false);
                            ScaffoldMessenger.of(this.context).showSnackBar(
                              SnackBar(
                                content: Text(e
                                    .toString()
                                    .replaceFirst('Exception: ', '')),
                                backgroundColor: const Color(0xFFEF4444),
                              ),
                            );
                          }
                        },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF1E3A8A),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  child: isLoading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                            color: Colors.white,
                            strokeWidth: 2,
                          ),
                        )
                      : Text('Change', style: GoogleFonts.poppins()),
                ),
              ],
            );
          },
        );
      },
    );
  }
}
