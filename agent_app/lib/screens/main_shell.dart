import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/role_provider.dart';
import '../services/api_service.dart';
import 'dashboard_tab.dart';
import 'customers_tab.dart';
import 'payments_tab.dart';
import 'profile_screen.dart';
import 'employees_tab.dart';

class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _currentIndex = 0;
  final List<Widget> _tabs = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _buildTabs();
    });
  }

  void _buildTabs() {
    final role = Provider.of<RoleProvider>(context, listen: false);
    setState(() {
      _tabs.clear();
      _tabs.add(const DashboardTab());
      _tabs.add(const CustomersTab());
      _tabs.add(const PaymentsTab());
      if (role.canViewEmployees) {
        _tabs.add(const EmployeesTab());
      }
      _tabs.add(const ProfileScreen());
    });
  }

  @override
  Widget build(BuildContext context) {
    final role = Provider.of<RoleProvider>(context);
    final items = <BottomNavigationBarItem>[
      const BottomNavigationBarItem(
        icon: Icon(Icons.dashboard_outlined),
        activeIcon: Icon(Icons.dashboard_rounded),
        label: 'Home',
      ),
      const BottomNavigationBarItem(
        icon: Icon(Icons.people_outline_rounded),
        activeIcon: Icon(Icons.people_rounded),
        label: 'Customers',
      ),
      const BottomNavigationBarItem(
        icon: Icon(Icons.payment_outlined),
        activeIcon: Icon(Icons.payment_rounded),
        label: 'Payments',
      ),
      if (role.canViewEmployees)
        const BottomNavigationBarItem(
          icon: Icon(Icons.badge_outlined),
          activeIcon: Icon(Icons.badge_rounded),
          label: 'Staff',
        ),
      const BottomNavigationBarItem(
        icon: Icon(Icons.person_outline_rounded),
        activeIcon: Icon(Icons.person_rounded),
        label: 'Profile',
      ),
    ];

    // Ensure index is valid
    if (_currentIndex >= items.length) {
      _currentIndex = 0;
    }

    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: _tabs.isEmpty ? [const SizedBox()] : _tabs,
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.05),
              blurRadius: 10,
              offset: const Offset(0, -2),
            ),
          ],
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            child: BottomNavigationBar(
              currentIndex: _currentIndex,
              onTap: (i) => setState(() => _currentIndex = i),
              items: items,
            ),
          ),
        ),
      ),
    );
  }
}
