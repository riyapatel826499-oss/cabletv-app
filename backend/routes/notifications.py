"""Activity Notifications API — tracks MSO portal operations (activation, swap, etc.).

Notifications are created by:
  - swap-stb endpoint (connections.py)
  - GTPL operations (gtpl route)
  - TACTV daemon (via cron → internal API)
  - GTPL auto-reconnect daemon
"""
from __future__ import annotations
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session
from deps_orm import get_db, get_current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _now_ist() -> str:
    return datetime.now(timezone.utc).isoformat()


def _create_notification(
    db: Session,
    *,
    type: str,
    title: str,
    message: str,
    status: str = "success",
    mso: str | None = None,
    stb_no: str | None = None,
    customer_id: str | None = None,
    operator_id: int | None = None,
):
    """Insert a notification row. Safe to call from any route."""
    try:
        db.execute(
            text("""
                INSERT INTO activity_notifications
                    (type, title, message, status, mso, stb_no, customer_id, operator_id, is_read, created_at)
                VALUES
                    (:type, :title, :message, :status, :mso, :stb_no, :customer_id, :operator_id, 0, :created_at)
            """),
            {
                "type": type,
                "title": title,
                "message": message,
                "status": status,
                "mso": mso,
                "stb_no": stb_no,
                "customer_id": customer_id,
                "operator_id": operator_id,
                "created_at": _now_ist(),
            },
        )
        db.commit()
    except Exception as e:
        print(f"[notifications] Failed to create notification: {e}")
        db.rollback()


@router.get("")
def list_notifications(
    limit: int = Query(50, ge=1, le=200),
    unread_only: bool = Query(False),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Fetch recent notifications for this operator."""
    op_filter = "AND operator_id = :op_id" if user.get("role") != "master" else ""
    params: dict = {"limit": limit}
    if user.get("role") != "master":
        params["op_id"] = user.get("operator_id", 1)
    if unread_only:
        op_filter += " AND is_read = 0"

    rows = db.execute(
        text(f"""
            SELECT id, type, title, message, status, mso, stb_no, customer_id,
                   is_read, created_at
            FROM activity_notifications
            WHERE 1=1 {op_filter}
            ORDER BY created_at DESC
            LIMIT :limit
        """),
        params,
    ).fetchall()

    items = []
    for r in rows:
        items.append({
            "id": r[0],
            "type": r[1],
            "title": r[2],
            "message": r[3],
            "status": r[4],
            "mso": r[5],
            "stb_no": r[6],
            "customer_id": r[7],
            "is_read": bool(r[8]),
            "created_at": r[9],
        })

    unread_count = db.execute(
        text(f"""
            SELECT COUNT(*) FROM activity_notifications
            WHERE is_read = 0 {op_filter}
        """),
        params,
    ).scalar() or 0

    return {"notifications": items, "unread_count": unread_count}


@router.put("/{notif_id}/read")
def mark_read(
    notif_id: int,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark a single notification as read."""
    db.execute(
        text("UPDATE activity_notifications SET is_read = 1 WHERE id = :id"),
        {"id": notif_id},
    )
    db.commit()
    return {"ok": True}


@router.put("/read-all")
def mark_all_read(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark all unread notifications as read."""
    op_filter = "AND operator_id = :op_id" if user.get("role") != "master" else ""
    params: dict = {}
    if user.get("role") != "master":
        params["op_id"] = user.get("operator_id", 1)
    db.execute(
        text(f"UPDATE activity_notifications SET is_read = 1 WHERE is_read = 0 {op_filter}"),
        params,
    )
    db.commit()
    return {"ok": True}


@router.post("")
def create_notification(
    data: dict,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Manually create a notification (used by daemons/cron via internal API)."""
    _create_notification(
        db,
        type=data.get("type", "info"),
        title=data.get("title", ""),
        message=data.get("message", ""),
        status=data.get("status", "success"),
        mso=data.get("mso"),
        stb_no=data.get("stb_no"),
        customer_id=data.get("customer_id"),
        operator_id=data.get("operator_id", user.get("operator_id", 1)),
    )
    return {"ok": True}
