import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'home_tab.dart';
import 'pay_tab.dart';
import 'history_tab.dart';
import 'support_tab.dart';
import 'profile_tab.dart';

class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => MainShellState();

  static MainShellState? of(BuildContext context) {
    return context.findAncestorStateOfType<MainShellState>();
  }
}

class MainShellState extends State<MainShell> {
  int _currentIndex = 0;

  final List<Widget> _tabs = const [
    HomeTab(),
    PayTab(),
    HistoryTab(),
    SupportTab(),
    ProfileTab(),
  ];

  void switchToTab(int index) {
    setState(() => _currentIndex = index);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: _tabs,
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.08),
              blurRadius: 10,
              offset: const Offset(0, -2),
            ),
          ],
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: List.generate(_navItems.length, (index) {
                final item = _navItems[index];
                final isActive = _currentIndex == index;
                return _buildNavItem(item, index, isActive);
              }),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildNavItem(_NavItem item, int index, bool isActive) {
    return GestureDetector(
      onTap: () => setState(() => _currentIndex = index),
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: EdgeInsets.symmetric(
          horizontal: isActive ? 16 : 12,
          vertical: 8,
        ),
        decoration: BoxDecoration(
          color: isActive
              ? const Color(0xFF1E3A8A).withValues(alpha: 0.1)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              item.icon,
              color:
                  isActive ? const Color(0xFF1E3A8A) : Colors.grey[400],
              size: 24,
            ),
            if (isActive) ...[
              const SizedBox(width: 6),
              Text(
                item.label,
                style: GoogleFonts.poppins(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: const Color(0xFF1E3A8A),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _NavItem {
  final IconData icon;
  final String label;
  const _NavItem({required this.icon, required this.label});
}

const List<_NavItem> _navItems = [
  _NavItem(icon: Icons.home_rounded, label: 'Home'),
  _NavItem(icon: Icons.payment_rounded, label: 'Pay'),
  _NavItem(icon: Icons.receipt_long_rounded, label: 'History'),
  _NavItem(icon: Icons.headset_mic_rounded, label: 'Support'),
  _NavItem(icon: Icons.person_rounded, label: 'Profile'),
];
