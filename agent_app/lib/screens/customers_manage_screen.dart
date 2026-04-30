import 'package:flutter/material.dart';
import '../services/api_service.dart';

class CustomersManageScreen extends StatefulWidget {
  final Map<String, dynamic>? customer;
  const CustomersManageScreen({super.key, this.customer});

  @override
  State<CustomersManageScreen> createState() => _CustomersManageScreenState();
}

class _CustomersManageScreenState extends State<CustomersManageScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _phone2Ctrl = TextEditingController();
  final _areaCtrl = TextEditingController();
  final _addressCtrl = TextEditingController();
  final _stbCtrl = TextEditingController();
  bool _loading = false;
  bool get _isEdit => widget.customer != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      final c = widget.customer!;
      _nameCtrl.text = c['name'] ?? '';
      _phoneCtrl.text = c['phone'] ?? '';
      _phone2Ctrl.text = c['phone2'] ?? '';
      _areaCtrl.text = c['area'] ?? '';
      _addressCtrl.text = c['address'] ?? '';
      _stbCtrl.text = c['stb_no'] ?? '';
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      final data = {
        'name': _nameCtrl.text.trim(),
        'phone': _phoneCtrl.text.trim(),
        if (_phone2Ctrl.text.isNotEmpty) 'phone2': _phone2Ctrl.text.trim(),
        if (_areaCtrl.text.isNotEmpty) 'area': _areaCtrl.text.trim(),
        if (_addressCtrl.text.isNotEmpty) 'address': _addressCtrl.text.trim(),
        if (_stbCtrl.text.isNotEmpty) 'stb_number': _stbCtrl.text.trim(),
      };

      if (_isEdit) {
        await ApiService.updateCustomer(widget.customer!['customer_id'] ?? widget.customer!['id'], data);
      } else {
        await ApiService.createCustomer(data);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_isEdit ? 'Customer updated' : 'Customer created'),
          backgroundColor: const Color(0xFF10B981),
        ),
      );
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString().replaceAll('Exception: ', '')), backgroundColor: Colors.red),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit Customer' : 'New Customer')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                controller: _nameCtrl,
                validator: (v) => v!.trim().isEmpty ? 'Name required' : null,
                decoration: const InputDecoration(labelText: 'Full Name *', prefixIcon: Icon(Icons.person_rounded)),
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _phoneCtrl,
                validator: (v) => v!.trim().isEmpty ? 'Phone required' : null,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Phone *', prefixIcon: Icon(Icons.phone_rounded)),
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _phone2Ctrl,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Phone 2 (optional)', prefixIcon: Icon(Icons.phone_rounded)),
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _areaCtrl,
                decoration: const InputDecoration(labelText: 'Area', prefixIcon: Icon(Icons.location_on_rounded)),
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _addressCtrl,
                maxLines: 2,
                decoration: const InputDecoration(labelText: 'Address', prefixIcon: Icon(Icons.home_rounded)),
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _stbCtrl,
                decoration: const InputDecoration(labelText: 'STB Number', prefixIcon: Icon(Icons.tv_rounded)),
              ),
              const SizedBox(height: 28),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  onPressed: _loading ? null : _submit,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF6366F1),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: _loading
                      ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                      : Text(_isEdit ? 'Update Customer' : 'Create Customer', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
