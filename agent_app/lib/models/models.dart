class Customer {
  final String? customerId;
  final String? name;
  final String? phone;
  final String? area;
  final String? address;
  final String? status;
  final bool? isPaid;
  final List<Connection>? connections;

  Customer({
    this.customerId, this.name, this.phone, this.area,
    this.address, this.status, this.isPaid, this.connections,
  });

  factory Customer.fromJson(Map<String, dynamic> json) {
    return Customer(
      customerId: json['customer_id']?.toString(),
      name: json['name']?.toString(),
      phone: json['phone']?.toString(),
      area: json['area']?.toString(),
      address: json['address']?.toString(),
      status: json['status']?.toString(),
      isPaid: json['is_paid'] as bool?,
      connections: (json['connections'] as List?)
          ?.map((c) => Connection.fromJson(c))
          .toList(),
    );
  }

  String get displayName => name ?? 'Unknown';
  String get displayId => customerId ?? '--';
}

class Connection {
  final int? id;
  final String? stbNumber;
  final String? planName;
  final String? status;
  final String? activationDate;
  final String? expiryDate;

  Connection({
    this.id, this.stbNumber, this.planName, this.status,
    this.activationDate, this.expiryDate,
  });

  factory Connection.fromJson(Map<String, dynamic> json) {
    return Connection(
      id: json['id'] as int?,
      stbNumber: json['stb_number']?.toString(),
      planName: json['plan_name']?.toString(),
      status: json['status']?.toString(),
      activationDate: json['activation_date']?.toString(),
      expiryDate: json['expiry_date']?.toString(),
    );
  }
}

class Plan {
  final int? id;
  final String? name;
  final double? amount;
  final String? description;
  final String? status;

  Plan({this.id, this.name, this.amount, this.description, this.status});

  factory Plan.fromJson(Map<String, dynamic> json) {
    return Plan(
      id: json['id'] as int?,
      name: json['name']?.toString(),
      amount: (json['amount'] ?? json['price'] as num?)?.toDouble(),
      description: json['description']?.toString(),
      status: json['status']?.toString(),
    );
  }
}

class Payment {
  final int? id;
  final String? customerId;
  final String? customerName;
  final String? area;
  final double? amount;
  final String? paymentMode;
  final String? collectorName;
  final String? collectedAt;

  Payment({
    this.id, this.customerId, this.customerName, this.area,
    this.amount, this.paymentMode, this.collectorName, this.collectedAt,
  });

  factory Payment.fromJson(Map<String, dynamic> json) {
    return Payment(
      id: json['id'] as int?,
      customerId: json['customer_id']?.toString(),
      customerName: json['customer_name']?.toString(),
      area: json['area']?.toString(),
      amount: (json['amount'] as num?)?.toDouble(),
      paymentMode: json['payment_mode']?.toString(),
      collectorName: json['collector_name']?.toString(),
      collectedAt: json['collected_at']?.toString(),
    );
  }
}
