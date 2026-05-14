import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/api_service.dart';
import 'customer_detail_screen.dart';

class ServiceRequestsScreen extends StatefulWidget {
  final String? initialStatus;
  const ServiceRequestsScreen({super.key, this.initialStatus});

  @override
  State<ServiceRequestsScreen> createState() => _ServiceRequestsScreenState();
}

class _ServiceRequestsScreenState extends State<ServiceRequestsScreen> {
  List<dynamic> _allRequests = [];
  List<dynamic> _filtered = [];
  bool _loading = true;
  String _selectedStatus = 'all';

  @override
  void initState() {
    super.initState();
    _selectedStatus = widget.initialStatus ?? 'all';
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      String? status;
      if (_selectedStatus != 'all') status = _selectedStatus;
      final data = await ApiService.getServiceRequests(status: status);
      if (!mounted) return;
      setState(() {
        _allRequests = data;
        _filtered = data;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  String _formatDate(String? dateStr) {
    if (dateStr == null || dateStr.isEmpty) return '--';
    try {
      final dt = DateTime.parse(dateStr);
      final months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      int hr = dt.hour;
      final min = dt.minute.toString().padLeft(2, '0');
      final ampm = hr >= 12 ? 'PM' : 'AM';
      if (hr > 12) hr -= 12;
      if (hr == 0) hr = 12;
      return '${dt.day.toString().padLeft(2, '0')} ${months[dt.month - 1]} ${dt.year} $hr:$min $ampm';
    } catch (_) {
      return dateStr;
    }
  }

  Color _statusColor(String? status) {
    switch (status) {
      case 'open': return const Color(0xFFEF4444);
      case 'assigned': return const Color(0xFF8B5CF6);
      case 'in_progress': return const Color(0xFFF59E0B);
      case 'resolved': return const Color(0xFF10B981);
      case 'closed': return const Color(0xFF6B7280);
      default: return Colors.grey;
    }
  }

  IconData _categoryIcon(String? category) {
    switch (category) {
      case 'no_signal': return Icons.tv_off_rounded;
      case 'picture_quality': return Icons.high_quality_rounded;
      case 'stb_issue': return Icons.settings_input_hdmi_rounded;
      case 'remote_issue': return Icons.settings_remote_rounded;
      case 'cable_issue': return Icons.cable_rounded;
      case 'recharge': return Icons.receipt_long_rounded;
      case 'new_connection': return Icons.add_circle_rounded;
      case 'complaint': return Icons.report_problem_rounded;
      default: return Icons.build_rounded;
    }
  }

  String _categoryLabel(String? category) {
    switch (category) {
      case 'no_signal': return 'No Signal';
      case 'picture_quality': return 'Picture Quality';
      case 'stb_issue': return 'STB Issue';
      case 'remote_issue': return 'Remote Issue';
      case 'cable_issue': return 'Cable Issue';
      case 'recharge': return 'Recharge';
      case 'new_connection': return 'New Connection';
      case 'complaint': return 'Complaint';
      default: return category ?? 'Other';
    }
  }

  void _showDetail(dynamic sr) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => _SRDetailSheet(
        sr: sr,
        onStatusChanged: () {
          Navigator.pop(ctx);
          _load();
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F5F5),
      appBar: AppBar(
        title: Text('Service Requests (${_filtered.length})'),
        backgroundColor: const Color(0xFF0EA5E9),
        foregroundColor: Colors.white,
      ),
      body: Column(
        children: [
          // Status filter chips
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _statusChip('All', 'all'),
                  const SizedBox(width: 6),
                  _statusChip('Open', 'open'),
                  const SizedBox(width: 6),
                  _statusChip('Assigned', 'assigned'),
                  const SizedBox(width: 6),
                  _statusChip('In Progress', 'in_progress'),
                  const SizedBox(width: 6),
                  _statusChip('Resolved', 'resolved'),
                  const SizedBox(width: 6),
                  _statusChip('Closed', 'closed'),
                ],
              ),
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _filtered.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.build_outlined, size: 56, color: Colors.grey[300]),
                            const SizedBox(height: 12),
                            Text('No service requests', style: TextStyle(color: Colors.grey[400], fontSize: 15)),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.builder(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          itemCount: _filtered.length,
                          itemBuilder: (context, index) {
                            final sr = _filtered[index];
                            final status = sr['status'] ?? 'open';
                            final color = _statusColor(status);
                            return Container(
                              margin: const EdgeInsets.symmetric(vertical: 4),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(color: const Color(0xFFF1F5F9)),
                              ),
                              child: Material(
                                color: Colors.transparent,
                                borderRadius: BorderRadius.circular(14),
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(14),
                                  onTap: () => _showDetail(sr),
                                  child: Padding(
                                    padding: const EdgeInsets.all(12),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          children: [
                                            Container(
                                              width: 40,
                                              height: 40,
                                              decoration: BoxDecoration(
                                                color: color.withOpacity(0.08),
                                                borderRadius: BorderRadius.circular(10),
                                              ),
                                              child: Icon(_categoryIcon(sr['category']), color: color, size: 20),
                                            ),
                                            const SizedBox(width: 10),
                                            Expanded(
                                              child: Column(
                                                crossAxisAlignment: CrossAxisAlignment.start,
                                                children: [
                                                  Text(
                                                    '${sr['ticket_no'] ?? '--'}',
                                                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                                                  ),
                                                  const SizedBox(height: 2),
                                                  Text(
                                                    sr['customer_name'] ?? '--',
                                                    style: TextStyle(color: Colors.grey[600], fontSize: 12, fontWeight: FontWeight.w500),
                                                  ),
                                                ],
                                              ),
                                            ),
                                            Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                              decoration: BoxDecoration(
                                                color: color.withOpacity(0.1),
                                                borderRadius: BorderRadius.circular(6),
                                              ),
                                              child: Text(
                                                status.toUpperCase().replaceAll('_', ' '),
                                                style: TextStyle(color: color, fontSize: 9, fontWeight: FontWeight.w700),
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 8),
                                        Container(
                                          padding: const EdgeInsets.all(8),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFFF8FAFC),
                                            borderRadius: BorderRadius.circular(8),
                                          ),
                                          child: Row(
                                            children: [
                                              Expanded(
                                                child: Column(
                                                  crossAxisAlignment: CrossAxisAlignment.start,
                                                  children: [
                                                    Text('Category', style: TextStyle(color: Colors.grey[400], fontSize: 9, fontWeight: FontWeight.w500)),
                                                    Text(_categoryLabel(sr['category']), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
                                                  ],
                                                ),
                                              ),
                                              Expanded(
                                                child: Column(
                                                  crossAxisAlignment: CrossAxisAlignment.start,
                                                  children: [
                                                    Text('Area', style: TextStyle(color: Colors.grey[400], fontSize: 9, fontWeight: FontWeight.w500)),
                                                    Text(sr['customer_area'] ?? '--', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis),
                                                  ],
                                                ),
                                              ),
                                              Expanded(
                                                child: Column(
                                                  crossAxisAlignment: CrossAxisAlignment.start,
                                                  children: [
                                                    Text('Created', style: TextStyle(color: Colors.grey[400], fontSize: 9, fontWeight: FontWeight.w500)),
                                                    Text(_formatDate(sr['created_at']), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w500)),
                                                  ],
                                                ),
                                              ),
                                            ],
                                          ),
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
          ),
        ],
      ),
    );
  }

  Widget _statusChip(String label, String value) {
    final selected = _selectedStatus == value;
    return GestureDetector(
      onTap: () {
        _selectedStatus = value;
        _load();
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFF0EA5E9) : const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? Colors.white : Colors.grey[600],
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _SRDetailSheet extends StatefulWidget {
  final dynamic sr;
  final VoidCallback onStatusChanged;
  const _SRDetailSheet({required this.sr, required this.onStatusChanged});

  @override
  State<_SRDetailSheet> createState() => _SRDetailSheetState();
}

class _SRDetailSheetState extends State<_SRDetailSheet> {
  bool _updating = false;

  Future<void> _updateStatus(String newStatus) async {
    setState(() => _updating = true);
    try {
      await ApiService.updateServiceRequestStatus(
        widget.sr['ticket_no'],
        newStatus,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Status updated to $newStatus'), backgroundColor: const Color(0xFF10B981)),
      );
      widget.onStatusChanged();
    } catch (e) {
      if (!mounted) return;
      setState(() => _updating = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString().replaceAll('Exception: ', '')), backgroundColor: Colors.red),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final sr = widget.sr;
    final status = sr['status'] ?? 'open';
    final color = _statusColor(status);

    return Container(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.grey[300], borderRadius: BorderRadius.circular(2)))),
          const SizedBox(height: 16),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(color: color.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                child: Text(status.toUpperCase(), style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 12)),
              ),
              const Spacer(),
              Text(sr['ticket_no'] ?? '--', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            ],
          ),
          const SizedBox(height: 16),
          Text(sr['customer_name'] ?? '--', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
          const SizedBox(height: 4),
          Text('${sr['customer_id'] ?? '--'} | ${sr['customer_phone'] ?? '--'}', style: TextStyle(color: Colors.grey[500], fontSize: 13)),
          const SizedBox(height: 4),
          Text('Area: ${sr['customer_area'] ?? '--'}', style: TextStyle(color: Colors.grey[500], fontSize: 13)),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(12)),
            child: Column(
              children: [
                _infoRow('Category', sr['category'] ?? '--'),
                _infoRow('Type', sr['type'] ?? '--'),
                _infoRow('Priority', sr['priority'] ?? '--'),
                _infoRow('Source', sr['source'] ?? '--'),
                _infoRow('Assigned', sr['assigned_to_name'] ?? 'Unassigned'),
                _infoRow('Created', sr['created_at'] ?? '--'),
              ],
            ),
          ),
          if (sr['description'] != null && sr['description'].toString().isNotEmpty) ...[
            const SizedBox(height: 12),
            const Text('Description', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
            const SizedBox(height: 4),
            Text(sr['description'], style: TextStyle(color: Colors.grey[600], fontSize: 13)),
          ],
          const SizedBox(height: 20),
          if (_updating)
            const Center(child: CircularProgressIndicator())
          else ...[
            Row(
              children: [
                if (status == 'open')
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () => _updateStatus('in_progress'),
                      icon: const Icon(Icons.play_arrow_rounded, size: 18),
                      label: const Text('Start'),
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFF59E0B), foregroundColor: Colors.white),
                    ),
                  ),
                if (status == 'assigned')
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () => _updateStatus('in_progress'),
                      icon: const Icon(Icons.play_arrow_rounded, size: 18),
                      label: const Text('Start Work'),
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFF59E0B), foregroundColor: Colors.white),
                    ),
                  ),
                if (status == 'in_progress')
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () => _updateStatus('resolved'),
                      icon: const Icon(Icons.check_rounded, size: 18),
                      label: const Text('Resolve'),
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF10B981), foregroundColor: Colors.white),
                    ),
                  ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: sr['customer_phone'] ?? ''));
                      Navigator.push(context, MaterialPageRoute(
                        builder: (_) => CustomerDetailScreen(customerId: sr['customer_id']),
                      ));
                    },
                    icon: const Icon(Icons.person_rounded, size: 18),
                    label: const Text('Customer'),
                  ),
                ),
              ],
            ),
          ],
          SizedBox(height: MediaQuery.of(context).viewInsets.bottom + 20),
        ],
      ),
    );
  }

  Color _statusColor(String? status) {
    switch (status) {
      case 'open': return const Color(0xFFEF4444);
      case 'assigned': return const Color(0xFF8B5CF6);
      case 'in_progress': return const Color(0xFFF59E0B);
      case 'resolved': return const Color(0xFF10B981);
      case 'closed': return const Color(0xFF6B7280);
      default: return Colors.grey;
    }
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(color: Colors.grey[500], fontSize: 12)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12)),
        ],
      ),
    );
  }
}
