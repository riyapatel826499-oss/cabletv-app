import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import '../providers/customer_provider.dart';
import '../widgets/common_widgets.dart';

class SupportTab extends StatefulWidget {
  const SupportTab({super.key});

  @override
  State<SupportTab> createState() => _SupportTabState();
}

class _SupportTabState extends State<SupportTab>
    with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  List<dynamic> _complaints = [];
  bool _isLoading = true;
  int? _expandedIndex;

  @override
  void initState() {
    super.initState();
    _loadComplaints();
  }

  Future<void> _loadComplaints() async {
    setState(() => _isLoading = true);
    final provider = Provider.of<CustomerProvider>(context, listen: false);
    try {
      _complaints = await provider.api.getComplaints();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: const Color(0xFFEF4444),
          ),
        );
      }
    }
    setState(() => _isLoading = false);
  }

  Future<void> _showNewComplaintForm() async {
    final subjectController = TextEditingController();
    final descController = TextEditingController();
    String priority = 'normal';

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Container(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.of(context).size.height * 0.85,
              ),
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Handle bar
                  Container(
                    margin: const EdgeInsets.only(top: 12),
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.grey[300],
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              'New Complaint',
                              style: GoogleFonts.poppins(
                                fontSize: 20,
                                fontWeight: FontWeight.w700,
                                color: const Color(0xFF1E3A8A),
                              ),
                            ),
                            const Spacer(),
                            IconButton(
                              icon: const Icon(Icons.close),
                              onPressed: () => Navigator.pop(context),
                            ),
                          ],
                        ),
                        const SizedBox(height: 20),

                        // Subject
                        Text(
                          'Subject',
                          style: GoogleFonts.poppins(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: Colors.grey[700],
                          ),
                        ),
                        const SizedBox(height: 8),
                        TextFormField(
                          controller: subjectController,
                          style: GoogleFonts.poppins(fontSize: 14),
                          decoration: InputDecoration(
                            hintText: 'Brief subject of your complaint',
                          ),
                        ),
                        const SizedBox(height: 16),

                        // Description
                        Text(
                          'Description',
                          style: GoogleFonts.poppins(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: Colors.grey[700],
                          ),
                        ),
                        const SizedBox(height: 8),
                        TextFormField(
                          controller: descController,
                          maxLines: 4,
                          style: GoogleFonts.poppins(fontSize: 14),
                          decoration: InputDecoration(
                            hintText: 'Describe your issue in detail...',
                          ),
                        ),
                        const SizedBox(height: 16),

                        // Priority
                        Text(
                          'Priority',
                          style: GoogleFonts.poppins(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: Colors.grey[700],
                          ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            _priorityChip('Low', 'low', const Color(0xFF3B82F6),
                                priority, (v) => setModalState(() => priority = v)),
                            const SizedBox(width: 8),
                            _priorityChip('Normal', 'normal',
                                const Color(0xFFF59E0B), priority,
                                (v) => setModalState(() => priority = v)),
                            const SizedBox(width: 8),
                            _priorityChip('High', 'high',
                                const Color(0xFFF97316), priority,
                                (v) => setModalState(() => priority = v)),
                            const SizedBox(width: 8),
                            _priorityChip('Urgent', 'urgent',
                                const Color(0xFFEF4444), priority,
                                (v) => setModalState(() => priority = v)),
                          ],
                        ),
                        const SizedBox(height: 24),

                        // Submit
                        gradientButton(
                          'Submit Complaint',
                          onPressed: () async {
                            if (subjectController.text.trim().isEmpty ||
                                descController.text.trim().isEmpty) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text(
                                      'Please fill in all fields'),
                                  backgroundColor: Color(0xFFEF4444),
                                ),
                              );
                              return;
                            }
                            Navigator.pop(context);
                            await _submitComplaint(
                              subjectController.text.trim(),
                              descController.text.trim(),
                              priority,
                            );
                          },
                        ),
                        SizedBox(
                            height: MediaQuery.of(context).viewInsets.bottom),
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _priorityChip(String label, String value, Color color,
      String current, Function(String) onSelect) {
    final isActive = current == value;
    return GestureDetector(
      onTap: () => onSelect(value),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isActive ? color : color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: color.withValues(alpha: isActive ? 1.0 : 0.3),
          ),
        ),
        child: Text(
          label,
          style: GoogleFonts.poppins(
            fontSize: 12,
            fontWeight: FontWeight.w500,
            color: isActive ? Colors.white : color,
          ),
        ),
      ),
    );
  }

  Future<void> _submitComplaint(
      String subject, String description, String priority) async {
    final provider = Provider.of<CustomerProvider>(context, listen: false);
    try {
      await provider.api.createComplaint(subject, description, priority: priority);
      await _loadComplaints();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Complaint submitted successfully!'),
            backgroundColor: Color(0xFF10B981),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: const Color(0xFFEF4444),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverAppBar(
            floating: true,
            backgroundColor: const Color(0xFF1E3A8A),
            title: Text(
              'Support',
              style: GoogleFonts.poppins(
                fontWeight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.all(16),
            sliver: _isLoading
                ? const SliverFillRemaining(
                    child: Center(
                      child: CircularProgressIndicator(
                        color: Color(0xFF1E3A8A),
                      ),
                    ),
                  )
                : _complaints.isEmpty
                    ? SliverFillRemaining(
                        child: emptyState(
                          'No complaints raised yet.\nNeed help? Raise a complaint!',
                          icon: Icons.headset_mic_outlined,
                        ),
                      )
                    : SliverList(
                        delegate: SliverChildBuilderDelegate(
                          (context, index) {
                            final complaint = _complaints[index]
                                as Map<String, dynamic>;
                            final isExpanded = _expandedIndex == index;
                            return _complaintCard(complaint, index, isExpanded);
                          },
                          childCount: _complaints.length,
                        ),
                      ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showNewComplaintForm,
        backgroundColor: const Color(0xFF1E3A8A),
        icon: const Icon(Icons.add, color: Colors.white),
        label: Text(
          'New Complaint',
          style: GoogleFonts.poppins(
            color: Colors.white,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }

  Widget _complaintCard(
      Map<String, dynamic> complaint, int index, bool isExpanded) {
    final subject = complaint['subject']?.toString() ?? '';
    final description = complaint['description']?.toString() ?? '';
    final priority = complaint['priority']?.toString() ?? 'normal';
    final status = complaint['status']?.toString() ?? 'open';
    final createdAt =
        complaint['created_at']?.toString() ?? complaint['date']?.toString() ?? '';
    final adminResponse =
        complaint['admin_response']?.toString() ?? complaint['response']?.toString();

    final priorityColor = _priorityColor(priority);
    final statusColor = _statusColor(status);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        children: [
          InkWell(
            onTap: () {
              setState(() {
                _expandedIndex = isExpanded ? null : index;
              });
            },
            borderRadius: BorderRadius.circular(14),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          subject,
                          style: GoogleFonts.poppins(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Icon(
                        isExpanded
                            ? Icons.expand_less
                            : Icons.expand_more,
                        color: Colors.grey[400],
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      statusBadge(priority.toUpperCase(), priorityColor),
                      const SizedBox(width: 8),
                      statusBadge(_formatStatus(status), statusColor),
                      const Spacer(),
                      if (createdAt.isNotEmpty)
                        Text(
                          _formatDate(createdAt),
                          style: GoogleFonts.poppins(
                            fontSize: 12,
                            color: Colors.grey[400],
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          if (isExpanded) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Description',
                    style: GoogleFonts.poppins(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: Colors.grey[500],
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    description,
                    style: GoogleFonts.poppins(fontSize: 14),
                  ),
                  if (adminResponse != null && adminResponse.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFF10B981).withValues(alpha: 0.05),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: const Color(0xFF10B981).withValues(alpha: 0.2),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.support_agent,
                                  size: 16, color: Color(0xFF10B981)),
                              const SizedBox(width: 6),
                              Text(
                                'Admin Response',
                                style: GoogleFonts.poppins(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: const Color(0xFF10B981),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            adminResponse,
                            style: GoogleFonts.poppins(fontSize: 13),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Color _priorityColor(String priority) {
    switch (priority.toLowerCase()) {
      case 'low':
        return const Color(0xFF3B82F6);
      case 'high':
        return const Color(0xFFF97316);
      case 'urgent':
        return const Color(0xFFEF4444);
      default:
        return const Color(0xFFF59E0B);
    }
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'open':
        return const Color(0xFFF59E0B);
      case 'in_progress':
      case 'in progress':
        return const Color(0xFF3B82F6);
      case 'resolved':
        return const Color(0xFF10B981);
      case 'closed':
        return Colors.grey[600]!;
      default:
        return const Color(0xFFF59E0B);
    }
  }

  String _formatStatus(String status) {
    return status
        .split('_')
        .map((s) => s[0].toUpperCase() + s.substring(1))
        .join(' ');
  }

  String _formatDate(String dateStr) {
    try {
      final date = DateTime.parse(dateStr);
      return '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}';
    } catch (e) {
      return dateStr;
    }
  }
}
