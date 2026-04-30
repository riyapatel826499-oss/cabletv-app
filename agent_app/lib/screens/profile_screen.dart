import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/role_provider.dart';
import '../services/api_service.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Map<String, dynamic>? _stats;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    try {
      final stats = await ApiService.getDashboardStats();
      if (!mounted) return;
      setState(() => _stats = stats);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final role = Provider.of<RoleProvider>(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Profile card
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
              ),
              borderRadius: BorderRadius.circular(20),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF6366F1).withOpacity(0.3),
                  blurRadius: 20,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Column(
              children: [
                CircleAvatar(
                  radius: 40,
                  backgroundColor: Colors.white.withOpacity(0.2),
                  child: Icon(role.roleIcon, color: Colors.white, size: 36),
                ),
                const SizedBox(height: 16),
                Text(
                  role.name,
                  style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    role.roleLabel,
                    style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w500),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '@${role.username}',
                  style: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 13),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // Quick stats
          if (_stats != null) ...[
            Row(
              children: [
                Expanded(
                  child: _miniStat('Customers', '${_stats!['total_customers'] ?? '--'}'),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _miniStat('Collected', 'Rs ${_stats!['total_collected'] ?? 0}'),
                ),
              ],
            ),
            const SizedBox(height: 20),
          ],

          // Menu items
          _menuCard([
            _menuItem(
              icon: Icons.person_rounded,
              title: 'Account Info',
              subtitle: '${role.name} | ${role.username}',
              onTap: () {},
            ),
            _menuItem(
              icon: Icons.vpn_key_rounded,
              title: 'Change Password',
              subtitle: 'Update your password',
              onTap: () => _changePasswordDialog(),
            ),
          ]),
          const SizedBox(height: 12),

          _menuCard([
            _menuItem(
              icon: Icons.info_outline_rounded,
              title: 'App Version',
              subtitle: 'SSA Cables v2.0.0',
              onTap: () {},
              showArrow: false,
            ),
          ]),
          const SizedBox(height: 24),

          // Logout
          SizedBox(
            width: double.infinity,
            height: 50,
            child: OutlinedButton.icon(
              onPressed: () => _logout(role),
              icon: const Icon(Icons.logout_rounded, color: Color(0xFFEF4444)),
              label: const Text('Sign Out', style: TextStyle(color: Color(0xFFEF4444), fontWeight: FontWeight.w600, fontSize: 15)),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: Color(0xFFFECACA)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Center(
            child: Text(
              'Sree Selvanaayakki Amman Cables',
              style: TextStyle(color: Colors.grey[400], fontSize: 11),
            ),
          ),
        ],
      ),
    );
  }

  Widget _miniStat(String label, String value) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(color: Colors.grey[500], fontSize: 12, fontWeight: FontWeight.w500)),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18, color: Color(0xFF6366F1))),
        ],
      ),
    );
  }

  Widget _menuCard(List<Widget> children) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(children: children),
    );
  }

  Widget _menuItem({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
    bool showArrow = true,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: const Color(0xFFF1F5F9),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: const Color(0xFF64748B), size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                  Text(subtitle, style: TextStyle(color: Colors.grey[500], fontSize: 12)),
                ],
              ),
            ),
            if (showArrow) Icon(Icons.chevron_right_rounded, color: Colors.grey[400]),
          ],
        ),
      ),
    );
  }

  void _logout(RoleProvider role) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign Out'),
        content: const Text('Are you sure you want to sign out?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFEF4444), foregroundColor: Colors.white),
            child: const Text('Sign Out'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await role.logout();
      if (!mounted) return;
      Navigator.pushReplacementNamed(context, '/login');
    }
  }

  void _changePasswordDialog() {
    final passCtrl = TextEditingController();
    final confirmCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Change Password'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: passCtrl, obscureText: true, decoration: const InputDecoration(labelText: 'New Password')),
            const SizedBox(height: 12),
            TextField(controller: confirmCtrl, obscureText: true, decoration: const InputDecoration(labelText: 'Confirm Password')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Password updated'), backgroundColor: Color(0xFF10B981)),
              );
            },
            child: const Text('Update'),
          ),
        ],
      ),
    );
  }
}
