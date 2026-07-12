"""Internal cron endpoints — triggered by Railway Cron Jobs, never exposed publicly.

All endpoints are authenticated via the INTERNAL_CRON_SECRET header and rate
limited to prevent abuse.
"""
import logging
from datetime import date, timedelta

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from config import INTERNAL_CRON_SECRET, REMINDER_DAYS_BEFORE_DUE
from db import get_db
from limiter import limiter
from services.whatsapp_service import send_payment_reminder

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])


class ReminderResult(BaseModel):
    sent: int = 0
    failed: int = 0
    skipped: int = 0
    total: int = 0
    errors: list[str] = []


def _verify_secret(x_cron_secret: str) -> None:
    """Raise 403 if the header doesn't match."""
    if x_cron_secret != INTERNAL_CRON_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")


@router.post("/run-reminders")
@limiter.limit("2/hour")
async def run_reminders(
    request: Request,
    x_cron_secret: str = Header(..., description="Cron secret from env"),
) -> ReminderResult:
    """Send WhatsApp payment reminders to customers due in 3 days.

    Called daily by a Railway Cron Job. Protected by INTERNAL_CRON_SECRET header
    and rate-limited to 2 calls/hour.
    """
    _verify_secret(x_cron_secret)

    target_date = (date.today() + timedelta(days=REMINDER_DAYS_BEFORE_DUE)).isoformat()
    result = ReminderResult()

    try:
        with get_db() as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT c.customer_id, c.name, c.phone,
                       cn.plan_amount, cn.expiry_date
                FROM customers c
                JOIN connections cn ON cn.customer_id = c.customer_id
                WHERE cn.status = 'Active'
                  AND cn.expiry_date = ?
                  AND c.status = 'Active'
                """,
                [target_date],
            ).fetchall()
    except Exception as exc:
        logger.error("run-reminders: DB query failed: %s", exc)
        result.errors.append(f"DB error: {exc}")
        return result

    result.total = len(rows)
    if not rows:
        logger.info("run-reminders: no customers due on %s", target_date)
        return result

    for row in rows:
        cid = row["customer_id"] if isinstance(row, dict) else row[0]
        name = row["name"] if isinstance(row, dict) else row[1]
        phone = row["phone"] if isinstance(row, dict) else row[2]
        amount = row["plan_amount"] if isinstance(row, dict) else row[3]
        expiry = row["expiry_date"] if isinstance(row, dict) else row[4]
        try:
            r = send_payment_reminder(
                customer_name=name or "",
                phone=phone or "",
                amount=str(int(amount)) if amount else "0",
                due_date=expiry or target_date,
            )
            if r is not None:
                result.sent += 1
            else:
                result.failed += 1
                result.errors.append(f"{cid}: WhatsApp API returned None (check logs)")
        except Exception as exc:
            result.failed += 1
            result.errors.append(f"{cid}: {exc}")
            logger.warning("Reminder failed for %s (%s): %s", cid, phone, exc)

    logger.info(
        "run-reminders done: %d sent, %d failed, %d total",
        result.sent,
        result.failed,
        result.total,
    )
    return result
