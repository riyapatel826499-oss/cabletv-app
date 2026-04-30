import 'package:flutter/material.dart';
import '../services/api_service.dart';

class RoleProvider extends ChangeNotifier {
  Map<String, dynamic>? _user;
  String _role = '';
  String _name = '';
  String _username = '';

  Map<String, dynamic>? get user => _user;
  String get role => _role;
  String get name => _name;
  String get username => _username;

  bool get isAdmin => _role == 'admin';
  bool get isSupport => _role == 'support';
  bool get isCollectionAgent => _role == 'collection_agent';
  bool get isServiceAgent => _role == 'service_agent';
  bool get isAdminOrSupport => isAdmin || isSupport;

  // Feature access
  bool get canViewDashboard => true;
  bool get canViewCustomers => true;
  bool get canSearchCustomers => true;
  bool get canCollectPayment => true;
  bool get canViewPaymentHistory => true;
  bool get canAddCustomer => isAdminOrSupport || isServiceAgent;
  bool get canEditCustomer => isAdminOrSupport;
  bool get canDeleteCustomer => isAdminOrSupport;
  bool get canSurrenderCustomer => isAdminOrSupport;
  bool get canReactivateCustomer => isAdminOrSupport;
  bool get canViewUnpaid => isAdminOrSupport || isCollectionAgent;
  bool get canManageEmployees => isAdmin;
  bool get canViewEmployees => isAdminOrSupport;
  bool get canViewReports => isAdminOrSupport;
  bool get canManageStb => isAdminOrSupport;
  bool get canViewSettings => isAdminOrSupport;

  Future<void> loadUser() async {
    _user = await ApiService.getUser();
    if (_user != null) {
      _role = _user!['role'] ?? '';
      _name = _user!['name'] ?? '';
      _username = _user!['username'] ?? '';
    }
    notifyListeners();
  }

  void setUser(Map<String, dynamic> user) {
    _user = user;
    _role = user['role'] ?? '';
    _name = user['name'] ?? '';
    _username = user['username'] ?? '';
    notifyListeners();
  }

  Future<void> logout() async {
    await ApiService.logout();
    _user = null;
    _role = '';
    _name = '';
    _username = '';
    notifyListeners();
  }

  String get roleLabel {
    switch (_role) {
      case 'admin':
        return 'Administrator';
      case 'support':
        return 'Support Staff';
      case 'collection_agent':
        return 'Collection Agent';
      case 'service_agent':
        return 'Service Agent';
      default:
        return 'User';
    }
  }

  IconData get roleIcon {
    switch (_role) {
      case 'admin':
        return Icons.admin_panel_settings;
      case 'support':
        return Icons.support_agent;
      case 'collection_agent':
        return Icons.payment;
      case 'service_agent':
        return Icons.build;
      default:
        return Icons.person;
    }
  }

  Color get roleColor {
    switch (_role) {
      case 'admin':
        return const Color(0xFFEF4444);
      case 'support':
        return const Color(0xFFF59E0B);
      case 'collection_agent':
        return const Color(0xFF6366F1);
      case 'service_agent':
        return const Color(0xFF10B981);
      default:
        return const Color(0xFF6B7280);
    }
  }
}
