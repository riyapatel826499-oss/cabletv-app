import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiService {
  static const String baseUrl = 'http://192.168.1.100:8000/api';

  static Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('token');
  }

  static Future<void> saveToken(String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('token', token);
  }

  static Future<void> saveUser(Map<String, dynamic> user) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('user', jsonEncode(user));
  }

  static Future<Map<String, dynamic>?> getUser() async {
    final prefs = await SharedPreferences.getInstance();
    final str = prefs.getString('user');
    if (str == null) return null;
    return jsonDecode(str);
  }

  static Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('token');
    await prefs.remove('user');
  }

  static Future<Map<String, String>> _headers() async {
    final token = await getToken();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  static Future<Map<String, dynamic>> login(String username, String password) async {
    final r = await http.post(
      Uri.parse('$baseUrl/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'username': username, 'password': password}),
    );
    final d = jsonDecode(r.body);
    if (r.statusCode != 200) {
      throw Exception(d['detail'] ?? d['error'] ?? 'Login failed');
    }
    return d;
  }

  static Future<Map<String, dynamic>> getDashboardStats() async {
    final h = await _headers();
    final r = await http.get(Uri.parse('$baseUrl/dashboard/stats'), headers: h);
    if (r.statusCode == 401) throw Exception('Session expired');
    return jsonDecode(r.body);
  }

  static Future<Map<String, dynamic>> getCustomers({
    int page = 1,
    int perPage = 20,
    String? sortBy,
    String? sortOrder,
    String? status,
    String? paymentFilter,
    String? paidFrom,
    String? paidTo,
  }) async {
    final h = await _headers();
    final params = <String, String>{
      'page': '$page',
      'per_page': '$perPage',
    };
    if (sortBy != null) params['sort_by'] = sortBy;
    if (sortOrder != null) params['sort_order'] = sortOrder;
    if (status != null && status.isNotEmpty) params['status'] = status;
    if (paymentFilter != null) params['payment_filter'] = paymentFilter;
    if (paidFrom != null) params['paid_from'] = paidFrom;
    if (paidTo != null) params['paid_to'] = paidTo;

    final uri = Uri.parse('$baseUrl/customers').replace(queryParameters: params);
    final r = await http.get(uri, headers: h);
    if (r.statusCode == 401) throw Exception('Session expired');
    return jsonDecode(r.body);
  }

  static Future<List<dynamic>> searchCustomers(String query) async {
    final h = await _headers();
    final r = await http.get(
      Uri.parse('$baseUrl/customers/search?q=${Uri.encodeComponent(query)}'),
      headers: h,
    );
    if (r.statusCode == 401) throw Exception('Session expired');
    final d = jsonDecode(r.body);
    if (d is List) return d;
    return d['items'] ?? d['customers'] ?? [];
  }

  static Future<Map<String, dynamic>> getCustomer(String id) async {
    final h = await _headers();
    final r = await http.get(Uri.parse('$baseUrl/customers/$id'), headers: h);
    if (r.statusCode == 401) throw Exception('Session expired');
    return jsonDecode(r.body);
  }

  static Future<Map<String, dynamic>> getCustomerPlans(String id) async {
    final h = await _headers();
    final r = await http.get(Uri.parse('$baseUrl/customers/$id/plans'), headers: h);
    if (r.statusCode == 401) throw Exception('Session expired');
    return jsonDecode(r.body);
  }

  static Future<Map<String, dynamic>> getCustomerPayments(String id, {int page = 1}) async {
    final h = await _headers();
    final r = await http.get(
      Uri.parse('$baseUrl/customers/$id/payment-history?page=$page&per_page=20'),
      headers: h,
    );
    if (r.statusCode == 401) throw Exception('Session expired');
    return jsonDecode(r.body);
  }

  static Future<Map<String, dynamic>> createCustomer(Map<String, dynamic> data) async {
    final h = await _headers();
    final r = await http.post(
      Uri.parse('$baseUrl/customers'),
      headers: h,
      body: jsonEncode(data),
    );
    if (r.statusCode == 401) throw Exception('Session expired');
    final d = jsonDecode(r.body);
    if (r.statusCode != 200 && r.statusCode != 201) {
      throw Exception(d['detail'] ?? 'Failed to create customer');
    }
    return d;
  }

  static Future<Map<String, dynamic>> updateCustomer(String id, Map<String, dynamic> data) async {
    final h = await _headers();
    final r = await http.put(
      Uri.parse('$baseUrl/customers/$id'),
      headers: h,
      body: jsonEncode(data),
    );
    if (r.statusCode == 401) throw Exception('Session expired');
    final d = jsonDecode(r.body);
    if (r.statusCode != 200) {
      throw Exception(d['detail'] ?? 'Failed to update customer');
    }
    return d;
  }

  static Future<Map<String, dynamic>> recordPayment({
    required String customerId,
    required int connectionId,
    required int planId,
    required double amount,
    required String paymentMode,
    required String monthYear,
    String? notes,
  }) async {
    final h = await _headers();
    final r = await http.post(
      Uri.parse('$baseUrl/payments'),
      headers: h,
      body: jsonEncode({
        'customer_id': customerId,
        'connection_id': connectionId,
        'plan_id': planId,
        'amount': amount,
        'payment_mode': paymentMode,
        'month_year': monthYear,
        if (notes != null) 'notes': notes,
      }),
    );
    if (r.statusCode == 401) throw Exception('Session expired');
    final d = jsonDecode(r.body);
    if (r.statusCode != 201 && r.statusCode != 200) {
      throw Exception(d['detail'] ?? d['error'] ?? 'Payment failed');
    }
    return d;
  }

  static Future<List<dynamic>> getPlans() async {
    final h = await _headers();
    final r = await http.get(Uri.parse('$baseUrl/plans'), headers: h);
    if (r.statusCode == 401) throw Exception('Session expired');
    final d = jsonDecode(r.body);
    if (d is List) return d;
    return d['plans'] ?? d['items'] ?? [];
  }

  static Future<List<dynamic>> getEmployees() async {
    final h = await _headers();
    final r = await http.get(Uri.parse('$baseUrl/employees'), headers: h);
    if (r.statusCode == 401) throw Exception('Session expired');
    final d = jsonDecode(r.body);
    return d['employees'] ?? d['items'] ?? (d is List ? d : []);
  }

  static Future<Map<String, dynamic>> createEmployee(Map<String, dynamic> data) async {
    final h = await _headers();
    final r = await http.post(
      Uri.parse('$baseUrl/employees'),
      headers: h,
      body: jsonEncode(data),
    );
    if (r.statusCode == 401) throw Exception('Session expired');
    final d = jsonDecode(r.body);
    if (r.statusCode != 200 && r.statusCode != 201) {
      throw Exception(d['detail'] ?? 'Failed to create employee');
    }
    return d;
  }

  static Future<Map<String, dynamic>> updateEmployee(int id, Map<String, dynamic> data) async {
    final h = await _headers();
    final r = await http.put(
      Uri.parse('$baseUrl/employees/$id'),
      headers: h,
      body: jsonEncode(data),
    );
    if (r.statusCode == 401) throw Exception('Session expired');
    final d = jsonDecode(r.body);
    if (r.statusCode != 200) {
      throw Exception(d['detail'] ?? 'Failed to update employee');
    }
    return d;
  }

  static Future<List<dynamic>> getStbInventory({String? status}) async {
    final h = await _headers();
    var url = '$baseUrl/stb-inventory';
    if (status != null) url += '?status=$status';
    final r = await http.get(Uri.parse(url), headers: h);
    if (r.statusCode == 401) throw Exception('Session expired');
    final d = jsonDecode(r.body);
    return d['inventory'] ?? d['items'] ?? (d is List ? d : []);
  }

  static Future<Map<String, dynamic>> surrenderCustomer(String id, {String? reason}) async {
    final h = await _headers();
    final r = await http.post(
      Uri.parse('$baseUrl/customers/$id/surrender'),
      headers: h,
      body: jsonEncode({if (reason != null) 'reason': reason}),
    );
    if (r.statusCode == 401) throw Exception('Session expired');
    final d = jsonDecode(r.body);
    if (r.statusCode != 200) {
      throw Exception(d['detail'] ?? 'Surrender failed');
    }
    return d;
  }

  static Future<Map<String, dynamic>> reactivateCustomer(String id) async {
    final h = await _headers();
    final r = await http.post(
      Uri.parse('$baseUrl/customers/$id/reactivate'),
      headers: h,
    );
    if (r.statusCode == 401) throw Exception('Session expired');
    final d = jsonDecode(r.body);
    if (r.statusCode != 200) {
      throw Exception(d['detail'] ?? 'Reactivate failed');
    }
    return d;
  }

  // ==================== CUSTOMER SELF-SERVICE APIs ====================

  /// Verify mobile number exists in our customer database
  static Future<Map<String, dynamic>> verifyMobile(String mobile) async {
    final r = await http.post(
      Uri.parse('$baseUrl/portal/customer/mobile-verify'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'mobile': mobile}),
    );
    final d = jsonDecode(r.body);
    if (r.statusCode != 200) {
      throw Exception(d['detail'] ?? d['message'] ?? d['error'] ?? 'Mobile number not found');
    }
    return d;
  }

  /// Set customer PIN (first time registration)
  static Future<Map<String, dynamic>> setCustomerPin(String customerId, String mobile, String pin) async {
    final r = await http.post(
      Uri.parse('$baseUrl/portal/customer/set-pin'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'customer_id': customerId, 'mobile': mobile, 'pin': pin}),
    );
    final d = jsonDecode(r.body);
    if (r.statusCode != 200 && r.statusCode != 201) {
      throw Exception(d['detail'] ?? d['message'] ?? d['error'] ?? 'Failed to set PIN');
    }
    return d;
  }

  /// Login customer with mobile + PIN
  static Future<Map<String, dynamic>> customerLoginPin(String mobile, String pin) async {
    final r = await http.post(
      Uri.parse('$baseUrl/portal/customer/login-pin'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'mobile': mobile, 'pin': pin}),
    );
    final d = jsonDecode(r.body);
    if (r.statusCode != 200) {
      throw Exception(d['detail'] ?? d['message'] ?? d['error'] ?? 'Invalid PIN');
    }
    return d;
  }

  /// Get customer profile for self-service (via portal/me)
  static Future<Map<String, dynamic>> getCustomerProfile() async {
    final h = await _headers();
    final r = await http.get(
      Uri.parse('$baseUrl/portal/me'),
      headers: h,
    );
    if (r.statusCode == 401) throw Exception('Session expired');
    final d = jsonDecode(r.body);
    if (r.statusCode != 200) {
      throw Exception(d['message'] ?? d['error'] ?? 'Failed to load profile');
    }
    return d;
  }

  /// Get customer payment history (self-service)
  static Future<Map<String, dynamic>> getCustomerPaymentHistory({int page = 1}) async {
    final h = await _headers();
    final r = await http.get(
      Uri.parse('$baseUrl/portal/payments?page=$page&per_page=20'),
      headers: h,
    );
    if (r.statusCode == 401) throw Exception('Session expired');
    final d = jsonDecode(r.body);
    if (r.statusCode != 200) {
      throw Exception(d['detail'] ?? d['error'] ?? 'Failed to load payments');
    }
    return d;
  }
}
