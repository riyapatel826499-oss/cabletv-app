import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

Widget gradientButton(
  String text, {
  required VoidCallback? onPressed,
  bool isLoading = false,
  List<Color>? gradientColors,
  double borderRadius = 12,
  double height = 50,
}) {
  return Container(
    height: height,
    width: double.infinity,
    decoration: BoxDecoration(
      gradient: LinearGradient(
        colors: gradientColors ??
            [const Color(0xFF1E3A8A), const Color(0xFF3B82F6)],
        begin: Alignment.centerLeft,
        end: Alignment.centerRight,
      ),
      borderRadius: BorderRadius.circular(borderRadius),
      boxShadow: [
        BoxShadow(
          color: (gradientColors?.first ?? const Color(0xFF1E3A8A))
              .withValues(alpha: 0.3),
          blurRadius: 8,
          offset: const Offset(0, 4),
        ),
      ],
    ),
    child: Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: isLoading ? null : onPressed,
        borderRadius: BorderRadius.circular(borderRadius),
        child: Center(
          child: isLoading
              ? const SizedBox(
                  height: 24,
                  width: 24,
                  child: CircularProgressIndicator(
                    color: Colors.white,
                    strokeWidth: 2.5,
                  ),
                )
              : Text(
                  text,
                  style: GoogleFonts.poppins(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
        ),
      ),
    ),
  );
}

Widget infoCard(
  String title,
  Widget child, {
  Color? accentColor,
  IconData? icon,
}) {
  return Container(
    width: double.infinity,
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.05),
          blurRadius: 10,
          offset: const Offset(0, 2),
        ),
      ],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            if (icon != null)
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: (accentColor ?? const Color(0xFF1E3A8A))
                      .withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon,
                    size: 18,
                    color: accentColor ?? const Color(0xFF1E3A8A)),
              ),
            if (icon != null) const SizedBox(width: 10),
            Text(
              title,
              style: GoogleFonts.poppins(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: Colors.grey[700],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        child,
      ],
    ),
  );
}

Widget statusBadge(String text, Color color) {
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.15),
      borderRadius: BorderRadius.circular(20),
    ),
    child: Text(
      text,
      style: GoogleFonts.poppins(
        fontSize: 12,
        fontWeight: FontWeight.w600,
        color: color,
      ),
    ),
  );
}

Widget loadingOverlay(Widget child, {bool isLoading = false}) {
  return Stack(
    children: [
      child,
      if (isLoading)
        Container(
          color: Colors.black.withValues(alpha: 0.3),
          child: const Center(
            child: CircularProgressIndicator(
              color: Color(0xFF1E3A8A),
            ),
          ),
        ),
    ],
  );
}

Widget amountDisplay(
  double amount, {
  double fontSize = 24,
  Color? color,
}) {
  return Row(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Text(
          '\u20B9',
          style: GoogleFonts.poppins(
            fontSize: fontSize * 0.65,
            fontWeight: FontWeight.w700,
            color: color ?? Colors.black87,
          ),
        ),
      ),
      Text(
        amount.toStringAsFixed(amount == amount.roundToDouble() ? 0 : 2),
        style: GoogleFonts.poppins(
          fontSize: fontSize,
          fontWeight: FontWeight.w700,
          color: color ?? Colors.black87,
        ),
      ),
    ],
  );
}

Widget emptyState(String message, {IconData icon = Icons.inbox}) {
  return Center(
    child: Padding(
      padding: const EdgeInsets.all(40),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 64, color: Colors.grey[300]),
          const SizedBox(height: 16),
          Text(
            message,
            textAlign: TextAlign.center,
            style: GoogleFonts.poppins(
              fontSize: 15,
              color: Colors.grey[500],
            ),
          ),
        ],
      ),
    ),
  );
}
