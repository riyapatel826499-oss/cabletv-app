"""Unit tests for payment month_year normalization (not-renewed clear fix)."""
from typing import Optional


def _norm_month_year(my: Optional[str]) -> Optional[str]:
    if not my or "-" not in my:
        return my
    parts = my.split("-")
    if len(parts) != 2:
        return my
    a, b = parts[0], parts[1]
    if len(a) == 4 and len(b) <= 2:
        return f"{int(b):02d}-{a}"
    if len(b) == 4 and len(a) <= 2:
        return f"{int(a):02d}-{b}"
    return my


def _month_idx(my: str) -> int:
    m, y = my.split("-")
    return int(y) * 12 + int(m)


def _next_month_year_from_expiry(exp: Optional[str]) -> Optional[str]:
    if not exp:
        return None
    try:
        d = str(exp).strip()[:10]
        y, m, _day = d.split("-")
        return f"{int(m):02d}-{y}"
    except Exception:
        return None


def resolve(month_year, expiry, months_paid=1, payment_type="regular"):
    """Mirrors create_payment month_year clamp in routes/payments.py."""
    my = _norm_month_year(month_year)
    expected = _next_month_year_from_expiry(expiry)
    if payment_type == "regular" and months_paid == 1 and expected:
        if not my:
            return expected
        try:
            if _month_idx(my) > _month_idx(expected):
                return expected
        except Exception:
            return expected
        return my
    return my


def test_next_from_expiry_july():
    assert _next_month_year_from_expiry("2026-07-12") == "07-2026"


def test_next_from_expiry_august():
    assert _next_month_year_from_expiry("2026-08-12") == "08-2026"


def test_norm_yyyy_mm():
    assert _norm_month_year("2026-08") == "08-2026"
    assert _norm_month_year("08-2026") == "08-2026"


def test_clamp_skipped_august_to_july():
    """curMonth+2 bug: client sends 08-2026 while expiry still Jul 12."""
    assert resolve("08-2026", "2026-07-12") == "07-2026"
    assert resolve("2026-08", "2026-07-12") == "07-2026"


def test_keep_correct_july():
    assert resolve("07-2026", "2026-07-12") == "07-2026"


def test_genuine_august_advance():
    assert resolve("08-2026", "2026-08-12") == "08-2026"


def test_missing_month_uses_expected():
    assert resolve(None, "2026-07-12") == "07-2026"


def test_multi_month_not_clamped():
    assert resolve("08-2026", "2026-07-12", months_paid=2) == "08-2026"
