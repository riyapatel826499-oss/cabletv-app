import 'package:flutter/material.dart';
import '../services/api_service.dart';

class EmployeesTab extends StatefulWidget {
  const EmployeesTab({super.key});

  @override
  State<EmployeesTab> createState() => _EmployeesTabState();
}

class _EmployeesTabState extends State<EmployeesTab> with AutomaticKeepAliveClientMixin {
  List<dynamic> _employees = [];
  bool _loading = true;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final result = await ApiService.getEmployees();
      if (!mounted) return;
      setState(() { _employees = result; _loading = false; });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Staff'),
        actions: [
          IconButton(
            icon: const Icon(Icons.person_add_rounded),
            onPressed: () => _showAddDialog(),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.builder(
                padding: const EdgeInsets.all(12),
                itemCount: _employees.length,
                itemBuilder: (context, index) {
                  final e = _employees[index];
                  final role = e['role'] ?? '';
                  final status = e['status'] ?? 'Active';
                  final isActive = status == 'Active';

                  Color roleColor;
                  switch (role) {
                    case 'admin':
                      roleColor = const Color(0xFFEF4444);
                      break;
                    case 'support':
                      roleColor = const Color(0xFFF59E0B);
                      break;
                    case 'collection_agent':
                      roleColor = const Color(0xFF6366F1);
                      break;
                    case 'service_agent':
                      roleColor = const Color(0xFF10B981);
                      break;
                    default:
                      roleColor = const Color(0xFF6B7280);
                  }

                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Material(
                      color: isActive ? Colors.white : const Color(0xFFF8FAFC),
                      borderRadius: BorderRadius.circular(14),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(14),
                        onTap: () => _showEditDialog(e),
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Row(
                            children: [
                              CircleAvatar(
                                radius: 22,
                                backgroundColor: roleColor.withOpacity(0.1),
                                child: Text(
                                  (e['name'] ?? '?')[0].toUpperCase(),
                                  style: TextStyle(color: roleColor, fontWeight: FontWeight.w700),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      e['name'] ?? '--',
                                      style: TextStyle(
                                        fontWeight: FontWeight.w600,
                                        color: isActive ? null : Colors.grey,
                                      ),
                                    ),
                                    Text(
                                      '${e['username'] ?? '--'} | ${e['phone'] ?? '--'}',
                                      style: TextStyle(color: Colors.grey[500], fontSize: 12),
                                    ),
                                  ],
                                ),
                              ),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: roleColor.withOpacity(0.1),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: Text(
                                      _roleLabel(role),
                                      style: TextStyle(color: roleColor, fontSize: 10, fontWeight: FontWeight.w700),
                                    ),
                                  ),
                                  if (!isActive) ...[
                                    const SizedBox(height: 3),
                                    const Text('Inactive', style: TextStyle(color: Color(0xFFEF4444), fontSize: 10, fontWeight: FontWeight.w600)),
                                  ],
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
    );
  }

  String _roleLabel(String role) {
    switch (role) {
      case 'admin': return 'ADMIN';
      case 'support': return 'SUPPORT';
      case 'collection_agent': return 'COLLECTOR';
      case 'service_agent': return 'SERVICE';
      default: return role.toUpperCase();
    }
  }

  void _showAddDialog() {
    final nameCtrl = TextEditingController();
    final userCtrl = TextEditingController();
    final passCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    String selectedRole = 'collection_agent';
    bool saving = false;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Add Staff'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Name *')),
                const SizedBox(height: 12),
                TextField(controller: userCtrl, decoration: const InputDecoration(labelText: 'Username *')),
                const SizedBox(height: 12),
                TextField(controller: passCtrl, obscureText: true, decoration: const InputDecoration(labelText: 'Password *')),
                const SizedBox(height: 12),
                TextField(controller: phoneCtrl, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone')),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: selectedRole,
                  decoration: const InputDecoration(labelText: 'Role'),
                  items: const [
                    DropdownMenuItem(value: 'admin', child: Text('Admin')),
                    DropdownMenuItem(value: 'support', child: Text('Support')),
                    DropdownMenuItem(value: 'collection_agent', child: Text('Collection Agent')),
                    DropdownMenuItem(value: 'service_agent', child: Text('Service Agent')),
                  ],
                  onChanged: (v) => setDialogState(() => selectedRole = v!),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: saving ? null : () async {
                if (nameCtrl.text.isEmpty || userCtrl.text.isEmpty || passCtrl.text.isEmpty) return;
                setDialogState(() => saving = true);
                try {
                  await ApiService.createEmployee({
                    'name': nameCtrl.text.trim(),
                    'username': userCtrl.text.trim(),
                    'password': passCtrl.text,
                    'role': selectedRole,
                    if (phoneCtrl.text.isNotEmpty) 'phone': phoneCtrl.text.trim(),
                  });
                  if (ctx.mounted) Navigator.pop(ctx);
                  _load();
                } catch (e) {
                  if (ctx.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(e.toString().replaceAll('Exception: ', '')), backgroundColor: Colors.red),
                    );
                  }
                  setDialogState(() => saving = false);
                }
              },
              child: const Text('Create'),
            ),
          ],
        ),
      ),
    );
  }

  void _showEditDialog(dynamic emp) {
    final e = emp as Map<String, dynamic>;
    final nameCtrl = TextEditingController(text: e['name'] ?? '');
    final phoneCtrl = TextEditingController(text: e['phone'] ?? '');
    String selectedRole = e['role'] ?? 'collection_agent';
    bool saving = false;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: Text('Edit ${e['name'] ?? ''}'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Name')),
                const SizedBox(height: 12),
                TextField(controller: phoneCtrl, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone')),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: selectedRole,
                  decoration: const InputDecoration(labelText: 'Role'),
                  items: const [
                    DropdownMenuItem(value: 'admin', child: Text('Admin')),
                    DropdownMenuItem(value: 'support', child: Text('Support')),
                    DropdownMenuItem(value: 'collection_agent', child: Text('Collection Agent')),
                    DropdownMenuItem(value: 'service_agent', child: Text('Service Agent')),
                  ],
                  onChanged: (v) => setDialogState(() => selectedRole = v!),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: saving ? null : () async {
                setDialogState(() => saving = true);
                try {
                  await ApiService.updateEmployee(e['id'], {
                    'name': nameCtrl.text.trim(),
                    'role': selectedRole,
                    if (phoneCtrl.text.isNotEmpty) 'phone': phoneCtrl.text.trim(),
                  });
                  if (ctx.mounted) Navigator.pop(ctx);
                  _load();
                } catch (err) {
                  if (ctx.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(err.toString().replaceAll('Exception: ', '')), backgroundColor: Colors.red),
                    );
                  }
                  setDialogState(() => saving = false);
                }
              },
              child: const Text('Update'),
            ),
          ],
        ),
      ),
    );
  }
}
