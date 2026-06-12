"""SQLAlchemy 2.0 model definitions for all 23 database tables."""
from __future__ import annotations
from typing import Optional, List
from sqlalchemy import (
    String, Integer, Float, Text, ForeignKey, UniqueConstraint, Index,
    PrimaryKeyConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from models.base import Base


# ---------------------------------------------------------------------------
# OPERATORS
# ---------------------------------------------------------------------------
class Operator(Base):
    __tablename__ = "operators"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    business_name: Mapped[str] = mapped_column(String(200), nullable=False)
    owner_name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(200))
    area: Mapped[Optional[str]] = mapped_column(String(200))
    mso: Mapped[Optional[str]] = mapped_column(String(100))
    status: Mapped[Optional[str]] = mapped_column(String(50))
    license_type: Mapped[Optional[str]] = mapped_column(String(100))
    created_at: Mapped[Optional[str]] = mapped_column(String(100))
    notes: Mapped[Optional[str]] = mapped_column(String(500))
    customer_prefix: Mapped[Optional[str]] = mapped_column(String(20))

    # relationships
    users: Mapped[List["User"]] = relationship(back_populates="operator")


# ---------------------------------------------------------------------------
# USERS
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    password: Mapped[str] = mapped_column(String(200), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(20))
    created_at: Mapped[Optional[str]] = mapped_column(String(100))
    status: Mapped[Optional[str]] = mapped_column(String(50), default="active")
    permissions: Mapped[Optional[str]] = mapped_column(Text)
    operator_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("operators.id"))

    # relationships
    operator: Mapped[Optional["Operator"]] = relationship(back_populates="users")
    active_sessions: Mapped[List["ActiveSession"]] = relationship(back_populates="user")


# ---------------------------------------------------------------------------
# ACTIVE SESSIONS
# ---------------------------------------------------------------------------
class ActiveSession(Base):
    __tablename__ = "active_sessions"
    __table_args__ = (
        Index("idx_sessions_user_id", "user_id"),
        Index("idx_sessions_session_id", "session_id"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    session_id: Mapped[Optional[str]] = mapped_column(String(200))
    created_at: Mapped[Optional[str]] = mapped_column(String(100))
    last_activity: Mapped[Optional[str]] = mapped_column(String(100))

    user: Mapped[Optional["User"]] = relationship(back_populates="active_sessions")


# ---------------------------------------------------------------------------
# CUSTOMERS
# ---------------------------------------------------------------------------
class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (
        Index("idx_customers_operator_id", "operator_id"),
        Index("idx_customers_phone", "phone"),
        Index("idx_customers_area", "area"),
        Index("idx_customers_status", "status"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    phone2: Mapped[Optional[str]] = mapped_column(String(20))
    address: Mapped[Optional[str]] = mapped_column(String(500))
    area: Mapped[Optional[str]] = mapped_column(String(200))
    city: Mapped[Optional[str]] = mapped_column(String(100))
    pincode: Mapped[Optional[str]] = mapped_column(String(10))
    status: Mapped[Optional[str]] = mapped_column(String(50))
    paypakka_id: Mapped[Optional[str]] = mapped_column(String(100))
    imported_at: Mapped[Optional[str]] = mapped_column(String(100))
    surrendered_date: Mapped[Optional[str]] = mapped_column(String(100))
    surrender_reason: Mapped[Optional[str]] = mapped_column(String(500))
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)

    # relationships
    connections: Mapped[List["Connection"]] = relationship(back_populates="customer")
    payments: Mapped[List["Payment"]] = relationship(back_populates="customer")
    customer_plans: Mapped[List["CustomerPlan"]] = relationship(back_populates="customer")


# ---------------------------------------------------------------------------
# CONNECTIONS
# ---------------------------------------------------------------------------
class Connection(Base):
    __tablename__ = "connections"
    __table_args__ = (
        Index("idx_connections_customer_id", "customer_id"),
        Index("idx_connections_operator_id", "operator_id"),
        Index("idx_connections_status", "status"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[str] = mapped_column(String(20), ForeignKey("customers.customer_id"), nullable=False)
    stb_no: Mapped[str] = mapped_column(String(50), nullable=False)
    can_id: Mapped[Optional[str]] = mapped_column(String(50))
    mso: Mapped[Optional[str]] = mapped_column(String(50))
    service_type: Mapped[Optional[str]] = mapped_column(String(50))
    billing_type: Mapped[Optional[str]] = mapped_column(String(50))
    status: Mapped[Optional[str]] = mapped_column(String(50))
    created_at: Mapped[Optional[str]] = mapped_column(String(100))
    plan_name: Mapped[Optional[str]] = mapped_column(String(200))
    plan_amount: Mapped[Optional[float]] = mapped_column(Float)
    activation_date: Mapped[Optional[str]] = mapped_column(String(100))
    expiry_date: Mapped[Optional[str]] = mapped_column(String(100))
    network: Mapped[Optional[str]] = mapped_column(String(50))
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)
    notes: Mapped[Optional[str]] = mapped_column(String(500))
    updated_at: Mapped[Optional[str]] = mapped_column(String(100))
    disconnect_date: Mapped[Optional[str]] = mapped_column(String(100))

    customer: Mapped["Customer"] = relationship(back_populates="connections")


# ---------------------------------------------------------------------------
# PLANS
# ---------------------------------------------------------------------------
class Plan(Base):
    __tablename__ = "plans"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    validity_days: Mapped[Optional[int]] = mapped_column(Integer)
    description: Mapped[Optional[str]] = mapped_column(String(500))
    status: Mapped[Optional[str]] = mapped_column(String(50))
    network: Mapped[Optional[str]] = mapped_column(String(50))
    mso_cost: Mapped[Optional[float]] = mapped_column(Float)
    mso_cost_late: Mapped[Optional[float]] = mapped_column(Float)
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)


# ---------------------------------------------------------------------------
# CUSTOMER PLANS
# ---------------------------------------------------------------------------
class CustomerPlan(Base):
    __tablename__ = "customer_plans"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[Optional[str]] = mapped_column(String(20), ForeignKey("customers.customer_id"))
    connection_id: Mapped[Optional[int]] = mapped_column(Integer)
    plan_id: Mapped[Optional[int]] = mapped_column(Integer)
    amount: Mapped[Optional[float]] = mapped_column(Float)
    start_date: Mapped[Optional[str]] = mapped_column(String(100))
    expiry_date: Mapped[Optional[str]] = mapped_column(String(100))
    status: Mapped[Optional[str]] = mapped_column(String(50))
    created_at: Mapped[Optional[str]] = mapped_column(String(100))
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)

    customer: Mapped[Optional["Customer"]] = relationship(back_populates="customer_plans")


# ---------------------------------------------------------------------------
# PAYMENTS
# ---------------------------------------------------------------------------
class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        Index("idx_payments_op_collected", "operator_id", "collected_at"),
        Index("idx_payments_cust_month", "customer_id", "month_year"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[str] = mapped_column(String(20), ForeignKey("customers.customer_id"), nullable=False)
    connection_id: Mapped[int] = mapped_column(Integer, ForeignKey("connections.id"), nullable=False)
    plan_id: Mapped[Optional[int]] = mapped_column(Integer)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    payment_mode: Mapped[Optional[str]] = mapped_column(String(50))
    collected_by: Mapped[Optional[int]] = mapped_column(Integer)
    collected_at: Mapped[Optional[str]] = mapped_column(String(100))
    month_year: Mapped[Optional[str]] = mapped_column(String(10))
    notes: Mapped[Optional[str]] = mapped_column(String(500))
    latitude: Mapped[Optional[float]] = mapped_column(Float)
    longitude: Mapped[Optional[float]] = mapped_column(Float)
    previous_balance: Mapped[Optional[float]] = mapped_column(Float)
    bill_amount: Mapped[Optional[float]] = mapped_column(Float)
    months_paid: Mapped[Optional[int]] = mapped_column(Integer)
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)
    payment_type: Mapped[Optional[str]] = mapped_column(String(50))
    deleted: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    deleted_by: Mapped[Optional[int]] = mapped_column(Integer)
    deleted_at: Mapped[Optional[str]] = mapped_column(String(100))
    delete_reason: Mapped[Optional[str]] = mapped_column(String(500))

    customer: Mapped["Customer"] = relationship(back_populates="payments")
    connection: Mapped["Connection"] = relationship()


# ---------------------------------------------------------------------------
# PAYPAKKA PAYMENTS
# ---------------------------------------------------------------------------
class PaypakkaPayment(Base):
    __tablename__ = "paypakka_payments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[Optional[str]] = mapped_column(String(20))
    payment_ref_id: Mapped[Optional[str]] = mapped_column(String(100))
    transaction_id: Mapped[Optional[str]] = mapped_column(String(100))
    service_ref_id: Mapped[Optional[str]] = mapped_column(String(100))
    plan_amount: Mapped[Optional[float]] = mapped_column(Float)
    bill_amount: Mapped[Optional[float]] = mapped_column(Float)
    collection_amount: Mapped[Optional[float]] = mapped_column(Float)
    discount_amount: Mapped[Optional[float]] = mapped_column(Float)
    tax: Mapped[Optional[float]] = mapped_column(Float)
    payment_type: Mapped[Optional[str]] = mapped_column(String(50))
    status: Mapped[Optional[str]] = mapped_column(String(50))
    paypakka_created_at: Mapped[Optional[str]] = mapped_column(String(100))
    imported_at: Mapped[Optional[str]] = mapped_column(String(100))
    emp_ref_id: Mapped[Optional[str]] = mapped_column(String(100))
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)


# ---------------------------------------------------------------------------
# PAYPAKKA PLANS
# ---------------------------------------------------------------------------
class PaypakkaPlan(Base):
    __tablename__ = "paypakka_plans"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    paypakka_plan_id: Mapped[Optional[str]] = mapped_column(String(100))
    plan_name: Mapped[Optional[str]] = mapped_column(String(200))
    plan_amount: Mapped[Optional[float]] = mapped_column(Float)
    package_category: Mapped[Optional[str]] = mapped_column(String(100))
    billing_cycle: Mapped[Optional[str]] = mapped_column(String(50))
    billing_type: Mapped[Optional[str]] = mapped_column(String(50))
    service_type: Mapped[Optional[str]] = mapped_column(String(50))
    mso: Mapped[Optional[str]] = mapped_column(String(50))
    sd_count: Mapped[Optional[int]] = mapped_column(Integer)
    hd_count: Mapped[Optional[int]] = mapped_column(Integer)
    inclusive_of_tax: Mapped[Optional[int]] = mapped_column(Integer)
    plan_validity: Mapped[Optional[str]] = mapped_column(String(50))
    status: Mapped[Optional[str]] = mapped_column(String(50))
    distributor_ref_id: Mapped[Optional[str]] = mapped_column(String(100))
    paypakka_created_at: Mapped[Optional[str]] = mapped_column(String(100))
    imported_at: Mapped[Optional[str]] = mapped_column(String(100))
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)


# ---------------------------------------------------------------------------
# PAYPAKKA CUSTOMER PLANS
# ---------------------------------------------------------------------------
class PaypakkaCustomerPlan(Base):
    __tablename__ = "paypakka_customer_plans"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[Optional[str]] = mapped_column(String(20))
    cust_plan_ref_id: Mapped[Optional[str]] = mapped_column(String(100))
    plan_ref_id: Mapped[Optional[str]] = mapped_column(String(100))
    service_ref_id: Mapped[Optional[str]] = mapped_column(String(100))
    activate_date: Mapped[Optional[str]] = mapped_column(String(100))
    expired_date: Mapped[Optional[str]] = mapped_column(String(100))
    status: Mapped[Optional[str]] = mapped_column(String(50))
    paypakka_created_at: Mapped[Optional[str]] = mapped_column(String(100))
    paypakka_updated_at: Mapped[Optional[str]] = mapped_column(String(100))
    imported_at: Mapped[Optional[str]] = mapped_column(String(100))
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)


# ---------------------------------------------------------------------------
# PAYPAKKA EMPLOYEES (no PK)
# ---------------------------------------------------------------------------
class PaypakkaEmployee(Base):
    __tablename__ = "paypakka_employees"
    __table_args__ = {"extend_existing": True}
    # No primary key — treat as read-only import table
    emp_ref_id: Mapped[Optional[str]] = mapped_column(String(100), primary_key=True)
    emp_name: Mapped[Optional[str]] = mapped_column(String(200))
    emp_role: Mapped[Optional[str]] = mapped_column(String(100))
    emp_status: Mapped[Optional[str]] = mapped_column(String(50))
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)


# ---------------------------------------------------------------------------
# NOTIFICATION SETTINGS (no PK)
# ---------------------------------------------------------------------------
class NotificationSetting(Base):
    __tablename__ = "notification_settings"
    __table_args__ = (
        PrimaryKeyConstraint("key", "operator_id"),
        {"extend_existing": True},
    )
    key: Mapped[Optional[str]] = mapped_column(String(100))
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)
    value: Mapped[Optional[str]] = mapped_column(Text)


# ---------------------------------------------------------------------------
# AUDIT LOG
# ---------------------------------------------------------------------------
class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (
        Index("idx_audit_created", "created_at"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    action: Mapped[Optional[str]] = mapped_column(String(100))
    entity: Mapped[Optional[str]] = mapped_column(String(100))
    entity_id: Mapped[Optional[str]] = mapped_column(String(100))
    old_value: Mapped[Optional[str]] = mapped_column(Text)
    new_value: Mapped[Optional[str]] = mapped_column(Text)
    performed_by: Mapped[Optional[int]] = mapped_column(Integer)
    performed_by_name: Mapped[Optional[str]] = mapped_column(String(200))
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)
    ip_address: Mapped[Optional[str]] = mapped_column(String(50))
    created_at: Mapped[Optional[str]] = mapped_column(String(100))


# ---------------------------------------------------------------------------
# SERVICE REQUESTS
# ---------------------------------------------------------------------------
class ServiceRequest(Base):
    __tablename__ = "service_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticket_no: Mapped[Optional[str]] = mapped_column(String(50))
    customer_id: Mapped[Optional[str]] = mapped_column(String(20))
    type: Mapped[Optional[str]] = mapped_column(String(50))
    category: Mapped[Optional[str]] = mapped_column(String(50))
    priority: Mapped[Optional[str]] = mapped_column(String(20))
    status: Mapped[Optional[str]] = mapped_column(String(50))
    description: Mapped[Optional[str]] = mapped_column(Text)
    assigned_to: Mapped[Optional[int]] = mapped_column(Integer)
    created_by: Mapped[Optional[int]] = mapped_column(Integer)
    source: Mapped[Optional[str]] = mapped_column(String(50))
    resolution: Mapped[Optional[str]] = mapped_column(Text)
    resolution_notes: Mapped[Optional[str]] = mapped_column(Text)
    deadline: Mapped[Optional[str]] = mapped_column(String(100))
    tg_message_id: Mapped[Optional[int]] = mapped_column(Integer)
    resolved_at: Mapped[Optional[str]] = mapped_column(String(100))
    closed_at: Mapped[Optional[str]] = mapped_column(String(100))
    closed_by: Mapped[Optional[int]] = mapped_column(Integer)
    cancelled_at: Mapped[Optional[str]] = mapped_column(String(100))
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[Optional[str]] = mapped_column(String(100))
    updated_at: Mapped[Optional[str]] = mapped_column(String(100))
    acknowledged_at: Mapped[Optional[str]] = mapped_column(String(100))
    on_the_way_at: Mapped[Optional[str]] = mapped_column(String(100))
    ack_lat: Mapped[Optional[float]] = mapped_column(Float)
    ack_lng: Mapped[Optional[float]] = mapped_column(Float)
    otw_lat: Mapped[Optional[float]] = mapped_column(Float)
    otw_lng: Mapped[Optional[float]] = mapped_column(Float)
    settled_lat: Mapped[Optional[float]] = mapped_column(Float)
    settled_lng: Mapped[Optional[float]] = mapped_column(Float)

    timeline: Mapped[List["RequestTimeline"]] = relationship(back_populates="service_request")


# ---------------------------------------------------------------------------
# REQUEST TIMELINE
# ---------------------------------------------------------------------------
class RequestTimeline(Base):
    __tablename__ = "request_timeline"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("service_requests.id"))
    old_status: Mapped[Optional[str]] = mapped_column(String(50))
    new_status: Mapped[Optional[str]] = mapped_column(String(50))
    changed_by: Mapped[Optional[int]] = mapped_column(Integer)
    changed_by_name: Mapped[Optional[str]] = mapped_column(String(200))
    source: Mapped[Optional[str]] = mapped_column(String(50))
    note: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[Optional[str]] = mapped_column(String(100))

    service_request: Mapped[Optional["ServiceRequest"]] = relationship(back_populates="timeline")


# ---------------------------------------------------------------------------
# STB INVENTORY
# ---------------------------------------------------------------------------
class StbInventory(Base):
    __tablename__ = "stb_inventory"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stb_no: Mapped[Optional[str]] = mapped_column(String(50))
    status: Mapped[Optional[str]] = mapped_column(String(50))
    notes: Mapped[Optional[str]] = mapped_column(String(500))
    added_at: Mapped[Optional[str]] = mapped_column(String(100))
    added_by: Mapped[Optional[str]] = mapped_column(String(200))
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)


# ---------------------------------------------------------------------------
# SURRENDER REQUESTS
# ---------------------------------------------------------------------------
class SurrenderRequest(Base):
    __tablename__ = "surrender_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[Optional[str]] = mapped_column(String(20))
    customer_name: Mapped[Optional[str]] = mapped_column(String(200))
    stb_no: Mapped[Optional[str]] = mapped_column(String(50))
    reason: Mapped[Optional[str]] = mapped_column(Text)
    requested_by: Mapped[Optional[int]] = mapped_column(Integer)
    requested_by_name: Mapped[Optional[str]] = mapped_column(String(200))
    requested_at: Mapped[Optional[str]] = mapped_column(String(100))
    status: Mapped[Optional[str]] = mapped_column(String(50))
    reviewed_by: Mapped[Optional[int]] = mapped_column(Integer)
    reviewed_by_name: Mapped[Optional[str]] = mapped_column(String(200))
    reviewed_at: Mapped[Optional[str]] = mapped_column(String(100))
    review_notes: Mapped[Optional[str]] = mapped_column(Text)
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)


# ---------------------------------------------------------------------------
# COMPLAINTS
# ---------------------------------------------------------------------------
class Complaint(Base):
    __tablename__ = "complaints"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[Optional[str]] = mapped_column(String(20))
    subject: Mapped[Optional[str]] = mapped_column(String(500))
    description: Mapped[Optional[str]] = mapped_column(Text)
    priority: Mapped[Optional[str]] = mapped_column(String(20))
    status: Mapped[Optional[str]] = mapped_column(String(50))
    created_at: Mapped[Optional[str]] = mapped_column(String(100))
    updated_at: Mapped[Optional[str]] = mapped_column(String(100))
    resolved_at: Mapped[Optional[str]] = mapped_column(String(100))
    admin_notes: Mapped[Optional[str]] = mapped_column(Text)
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)


# ---------------------------------------------------------------------------
# CUSTOMER AUTH
# ---------------------------------------------------------------------------
class CustomerAuth(Base):
    __tablename__ = "customer_auth"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[Optional[str]] = mapped_column(String(20))
    phone: Mapped[Optional[str]] = mapped_column(String(20))
    password: Mapped[Optional[str]] = mapped_column(String(200))
    created_at: Mapped[Optional[str]] = mapped_column(String(100))
    pin: Mapped[Optional[str]] = mapped_column(String(10))
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)


# ---------------------------------------------------------------------------
# ONLINE PAYMENTS
# ---------------------------------------------------------------------------
class OnlinePayment(Base):
    __tablename__ = "online_payments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[Optional[str]] = mapped_column(String(20))
    razorpay_order_id: Mapped[Optional[str]] = mapped_column(String(100))
    razorpay_payment_id: Mapped[Optional[str]] = mapped_column(String(100))
    razorpay_signature: Mapped[Optional[str]] = mapped_column(String(200))
    amount: Mapped[Optional[float]] = mapped_column(Float)
    status: Mapped[Optional[str]] = mapped_column(String(50))
    created_at: Mapped[Optional[str]] = mapped_column(String(100))
    captured_at: Mapped[Optional[str]] = mapped_column(String(100))
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)


# ---------------------------------------------------------------------------
# PUSH SUBSCRIPTIONS
# ---------------------------------------------------------------------------
class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer)
    endpoint: Mapped[Optional[str]] = mapped_column(Text)
    p256dh: Mapped[Optional[str]] = mapped_column(String(200))
    auth: Mapped[Optional[str]] = mapped_column(String(200))
    created_at: Mapped[Optional[str]] = mapped_column(String(100))


# ---------------------------------------------------------------------------
# SMS LOG
# ---------------------------------------------------------------------------
class SmsLog(Base):
    __tablename__ = "sms_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[Optional[str]] = mapped_column(String(20))
    phone: Mapped[Optional[str]] = mapped_column(String(20))
    message: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[Optional[str]] = mapped_column(String(50))
    provider: Mapped[Optional[str]] = mapped_column(String(50))
    sent_at: Mapped[Optional[str]] = mapped_column(String(100))
    operator_id: Mapped[Optional[int]] = mapped_column(Integer)
