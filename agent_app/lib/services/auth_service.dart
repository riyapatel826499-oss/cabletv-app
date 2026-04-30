import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'config.dart';

class AuthService {
  static const String _tokenKey = 'auth_token';
  static const String _userKey = 'user_data';

  static Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_tokenKey);
  }

  static Future<Map<String, dynamic>?> getUser() async {
    final prefs = await SharedPreferences.getInstance();
    final data = prefs.getString(_userKey);
    if (data != null) return jsonDecode(data);
    return null;
  }

  static Future<Map<String, dynamic>> login(String username, String password) async {
    final response = await http.post(
      Uri.parse('${Config.baseUrl}/api/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'username': username, 'password': password}),
    );

    final data = jsonDecode(response.body);
    if (response.statusCode == 200) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_tokenKey, data['access_token']);
      await prefs.setString(_userKey, jsonEncode(data['user']));
      return data;
    } else {
      throw Exception(data['detail'] ?? 'Login failed');
    }
  }

  static Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    await prefs.remove(_userKey);
  }
}

class ApiService {
  static Future<Map<String, String>> _headers() async {
    final token = await AuthService.getToken();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  static Future<dynamic> get(String path) async {
    final headers = await _headers();
    final response = await http.get(
      Uri.parse('${Config.baseUrl}$path'),
      headers: headers,
    );
    if (response.statusCode == 401) throw Exception('Session expired');
    return jsonDecode(response.body);
  }

  static Future<dynamic> post(String path, Map<String, dynamic> body) async {
    final headers = await _headers();
    final response = await http.post(
      Uri.parse('${Config.baseUrl}$path'),
      headers: headers,
      body: jsonEncode(body),
    );
    final data = jsonDecode(response.body);
    if (response.statusCode >= 400) {
      throw Exception(data['detail'] ?? data['error'] ?? 'Request failed');
    }
    return data;
  }

  static Future<dynamic> put(String path, Map<String, dynamic> body) async {
    final headers = await _headers();
    final response = await http.put(
      Uri.parse('${Config.baseUrl}$path'),
      headers: headers,
      body: jsonEncode(body),
    );
    return jsonDecode(response.body);
  }
}
