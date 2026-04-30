import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';

class CustomerProvider extends ChangeNotifier {
  final ApiService _api = ApiService();

  String? token;
  Map<String, dynamic>? customer;
  Map<String, dynamic>? profile;
  Map<String, dynamic>? dashboard;
  bool isLoading = false;
  String? error;

  Future<bool> login(String customerId, String password) async {
    isLoading = true;
    error = null;
    notifyListeners();

    try {
      final response = await _api.login(customerId, password);
      token = response['access_token'];
      customer = response['customer'];
      _api.setToken(token!);

      // Save token to SharedPreferences
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('auth_token', token!);

      isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      error = e.toString().replaceFirst('Exception: ', '');
      isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<bool> register(String customerId, String phone, String password) async {
    isLoading = true;
    error = null;
    notifyListeners();

    try {
      final response = await _api.register(customerId, phone, password);
      token = response['access_token'];
      customer = response['customer'];
      _api.setToken(token!);

      // Save token to SharedPreferences
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('auth_token', token!);

      isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      error = e.toString().replaceFirst('Exception: ', '');
      isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> loadDashboard() async {
    try {
      dashboard = await _api.getDashboard();
      notifyListeners();
    } catch (e) {
      error = e.toString().replaceFirst('Exception: ', '');
      notifyListeners();
    }
  }

  Future<void> loadProfile() async {
    try {
      profile = await _api.getProfile();
      notifyListeners();
    } catch (e) {
      error = e.toString().replaceFirst('Exception: ', '');
      notifyListeners();
    }
  }

  Future<bool> tryAutoLogin() async {
    final prefs = await SharedPreferences.getInstance();
    final savedToken = prefs.getString('auth_token');

    if (savedToken != null) {
      token = savedToken;
      _api.setToken(savedToken);

      try {
        await loadDashboard();
        await loadProfile();
        return true;
      } catch (e) {
        // Token might be expired
        await logout();
        return false;
      }
    }
    return false;
  }

  Future<void> logout() async {
    token = null;
    customer = null;
    profile = null;
    dashboard = null;
    error = null;
    _api.clearToken();

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('auth_token');

    notifyListeners();
  }

  ApiService get api => _api;
}
