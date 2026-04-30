import 'dart:convert';
import 'package:http/http.dart' as http;

class ApiService {
  static const String baseUrl = 'http://192.168.1.100:8000';
  String? _token;

  void setToken(String token) {
    _token = token;
  }

  void clearToken() {
    _token = null;
  }

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

// Login: POST /api/portal/login
  Future<Map<String, dynamic>> login(String customerId, String password) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/portal/login'),
      headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
      body: jsonEncode({
        'customer_id': customerId,
        'password': password,
      }),
    );

    final data = jsonDecode(response.body);
    if (response.statusCode == 200) {
      _token = data['access_token'];
      return data;
    } else {
      throw Exception(data['message'] ?? data['detail'] ?? 'Login failed');
    }
  }

  // Register: POST /api/portal/register (first-time setup)
  Future<Map<String, dynamic>> register(String customerId, String phone, String password) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/portal/register'),
      headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
      body: jsonEncode({
        'customer_id': customerId,
        'phone': phone,
        'new_password': password,
      }),
    );

    final data = jsonDecode(response.body);
    if (response.statusCode == 200) {
      _token = data['access_token'];
      return data;
    } else {
      throw Exception(data['message'] ?? data['detail'] ?? 'Registration failed');
    }
  }

  Future<Map<String, dynamic>> getProfile() async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/portal/me'),
      headers: _headers,
    );

    final data = jsonDecode(response.body);
    if (response.statusCode == 200) {
      return data;
    } else {
      throw Exception(data['message'] ?? data['detail'] ?? 'Failed to load profile');
    }
  }

  Future<Map<String, dynamic>> getDashboard() async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/portal/dashboard'),
      headers: _headers,
    );

    final data = jsonDecode(response.body);
    if (response.statusCode == 200) {
      return data;
    } else {
      throw Exception(data['message'] ?? data['detail'] ?? 'Failed to load dashboard');
    }
  }

  Future<Map<String, dynamic>> getPayments({int page = 1}) async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/portal/payments?page=$page'),
      headers: _headers,
    );

    final data = jsonDecode(response.body);
    if (response.statusCode == 200) {
      return data;
    } else {
      throw Exception(data['message'] ?? data['detail'] ?? 'Failed to load payments');
    }
  }

  Future<Map<String, dynamic>> initiatePayment(double amount) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/portal/payments/initiate'),
      headers: _headers,
      body: jsonEncode({'amount': amount}),
    );

    final data = jsonDecode(response.body);
    if (response.statusCode == 200) {
      return data;
    } else {
      throw Exception(data['message'] ?? data['detail'] ?? 'Failed to initiate payment');
    }
  }

  Future<Map<String, dynamic>> verifyPayment({
    required String razorpayPaymentId,
    required String razorpayOrderId,
    required String razorpaySignature,
    required double amount,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/portal/payments/verify'),
      headers: _headers,
      body: jsonEncode({
        'razorpay_payment_id': razorpayPaymentId,
        'razorpay_order_id': razorpayOrderId,
        'razorpay_signature': razorpaySignature,
        'amount': amount,
      }),
    );

    final data = jsonDecode(response.body);
    if (response.statusCode == 200) {
      return data;
    } else {
      throw Exception(data['message'] ?? data['detail'] ?? 'Payment verification failed');
    }
  }

  Future<List<dynamic>> getComplaints() async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/portal/complaints'),
      headers: _headers,
    );

    final data = jsonDecode(response.body);
    if (response.statusCode == 200) {
      return data['complaints'] ?? data;
    } else {
      throw Exception(data['message'] ?? data['detail'] ?? 'Failed to load complaints');
    }
  }

  Future<Map<String, dynamic>> createComplaint(
    String subject,
    String description, {
    String priority = 'normal',
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/portal/complaints'),
      headers: _headers,
      body: jsonEncode({
        'subject': subject,
        'description': description,
        'priority': priority,
      }),
    );

    final data = jsonDecode(response.body);
    if (response.statusCode == 200 || response.statusCode == 201) {
      return data;
    } else {
      throw Exception(data['message'] ?? data['detail'] ?? 'Failed to create complaint');
    }
  }

  Future<Map<String, dynamic>> changePassword(
      String currentPwd, String newPwd) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/portal/change-password'),
      headers: _headers,
      body: jsonEncode({
        'current_password': currentPwd,
        'new_password': newPwd,
      }),
    );

    final data = jsonDecode(response.body);
    if (response.statusCode == 200) {
      return data;
    } else {
      throw Exception(data['message'] ?? data['detail'] ?? 'Failed to change password');
    }
  }
}
