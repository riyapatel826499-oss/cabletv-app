"""
Firebase Cloud Messaging (FCM) sender — HTTP v1 API with service-account JWT.
Zero heavy deps: uses httpx + cryptography (already in venv).

Config: FCM_SERVICE_ACCOUNT_JSON (env) = path to Firebase service-account JSON.
        FCM_SERVICE_ACCOUNT (env)      = OR the raw JSON content inline (container use).
If neither set, all FCM functions are no-ops (web push still works).
"""
import json
import os
import time
import logging

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

logger = logging.getLogger("wasool.fcm")

_SA_PATH = os.getenv("FCM_SERVICE_ACCOUNT_JSON", "")
_SA_INLINE = os.getenv("FCM_SERVICE_ACCOUNT", "")
_cached_sa = None
_token_cache = {"token": None, "exp": 0}


def _load_sa():
    global _cached_sa
    if _cached_sa is not None:
        return _cached_sa
    if _SA_INLINE:
        try:
            _cached_sa = json.loads(_SA_INLINE)
            return _cached_sa
        except Exception as e:
            logger.error(f"[fcm] inline service account parse failed: {e}")
            return None
    if _SA_PATH and os.path.exists(_SA_PATH):
        with open(_SA_PATH) as f:
            _cached_sa = json.load(f)
        return _cached_sa
    return None


def fcm_enabled() -> bool:
    """True when a service account is configured."""
    return _load_sa() is not None


def _sign_jwt(sa: dict) -> str:
    """Create a signed JWT for Google OAuth2 token exchange."""
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    now = int(time.time())
    header = {"alg": "RS256", "typ": "JWT"}
    claims = {
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/firebase.messaging",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    }

    def b64url(b: bytes) -> str:
        import base64
        return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

    signing_input = b64url(json.dumps(header).encode()) + "." + b64url(json.dumps(claims).encode())
    key = load_pem_private_key(sa["private_key"].encode(), password=None)
    sig = key.sign(signing_input.encode(), padding.PKCS1v15(), hashes.SHA256())
    return signing_input + "." + b64url(sig)


async def _get_access_token() -> str | None:
    """OAuth2 access token via service-account JWT (cached ~50 min)."""
    now = time.time()
    if _token_cache["token"] and _token_cache["exp"] > now + 300:
        return _token_cache["token"]
    sa = _load_sa()
    if not sa:
        return None
    jwt = _sign_jwt(sa)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": jwt,
                },
            )
            r.raise_for_status()
            data = r.json()
            _token_cache["token"] = data["access_token"]
            _token_cache["exp"] = now + data.get("expires_in", 3600)
            return data["access_token"]
    except Exception as e:
        logger.error(f"[fcm] token exchange failed: {e}")
        return None


async def send_fcm(token: str, title: str, body: str, data: dict | None = None) -> bool:
    """Send a single FCM message to one device token. Returns success."""
    sa = _load_sa()
    if not sa or not token:
        return False
    access = await _get_access_token()
    if not access:
        return False
    payload = {
        "message": {
            "token": token,
            "notification": {"title": title, "body": body},
            "android": {
                "priority": "HIGH",
                "notification": {"sound": "default", "priority": "HIGH"},
            },
            "data": {k: str(v) for k, v in (data or {}).items()},
        }
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"https://fcm.googleapis.com/v1/projects/{sa['project_id']}/messages:send",
                headers={"Authorization": f"Bearer {access}"},
                json=payload,
            )
            if r.status_code == 200:
                return True
            logger.warning(f"[fcm] send failed {r.status_code}: {r.text[:200]}")
            return False
    except Exception as e:
        logger.error(f"[fcm] send error: {e}")
        return False


async def send_fcm_to_user(user_id: int, title: str, body: str, data: dict | None = None) -> int:
    """Send FCM to ALL tokens registered for a user. Returns count sent."""
    if not fcm_enabled():
        return 0
    from conn import get_conn
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT token FROM fcm_tokens WHERE user_id=?", (user_id,)
        ).fetchall()
    sent = 0
    for row in rows:
        if await send_fcm(row["token"], title, body, data):
            sent += 1
    return sent
