"""Audit log helper — write entries to audit_log table."""
import json
from deps import get_db


def log_action(
    action: str,
    entity: str,
    entity_id: str = None,
    old_value=None,
    new_value=None,
    user: dict = None,
    ip_address: str = None,
):
    """Write one audit log entry. Silently swallows errors so it never breaks callers."""
    try:
        performed_by = user.get("id") if user else None
        performed_by_name = user.get("name") or user.get("username") if user else None
        operator_id = user.get("operator_id") if user else None

        old_str = json.dumps(old_value, default=str) if old_value is not None else None
        new_str = json.dumps(new_value, default=str) if new_value is not None else None

        with get_db() as conn:
            conn.execute(
                """INSERT INTO audit_log
                   (action, entity, entity_id, old_value, new_value,
                    performed_by, performed_by_name, operator_id, ip_address)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (action, entity, entity_id, old_str, new_str,
                 performed_by, performed_by_name, operator_id, ip_address),
            )
            conn.commit()
    except Exception:
        pass  # audit failure must never break business logic
