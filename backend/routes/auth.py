"""Staff authentication — login, token validation, role-based access."""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from deps import get_current_user, require_role, create_token, get_db
from utils import hash_password, verify_password, needs_rehash
from config import PASSWORD_MIN_LENGTH
from limiter import limiter

router = APIRouter(prefix="/api", tags=["Auth"])


class LoginRequest(BaseModel):
    username: str
    password: str
    force: bool = False  # Set True to kick existing session


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(request: Request, body: LoginRequest):
    with get_db() as conn:
        user = conn.execute(
            "SELECT id, username, name, role, phone, password FROM users WHERE username = ?",
            (body.username,),
        ).fetchone()

        if not user:
            raise HTTPException(status_code=401, detail="Invalid username or password")

        # Verify password (supports bcrypt + legacy SHA256 migration)
        if not verify_password(body.password, user["password"]):
            raise HTTPException(status_code=401, detail="Invalid username or password")

        # Auto-upgrade legacy SHA256 to bcrypt
        if needs_rehash(user["password"]):
            conn.execute(
                "UPDATE users SET password = ? WHERE id = ?",
                (hash_password(body.password), user["id"]),
            )
            conn.commit()

        # Check for existing active session
        existing = conn.execute(
            "SELECT session_id FROM active_sessions WHERE user_id = ?",
            (user["id"],)
        ).fetchone()

        if existing and not body.force:
            # Session conflict — ask user to confirm
            raise HTTPException(
                status_code=409,
                detail="This account is already logged in on another device. Do you want to continue?",
                headers={"X-Session-Conflict": "true"}
            )

        # If force=True or no existing session: create new session
        session_id = str(uuid.uuid4())

        # Remove any existing sessions for this user
        conn.execute("DELETE FROM active_sessions WHERE user_id = ?", (user["id"],))

        # Register new session
        conn.execute(
            "INSERT INTO active_sessions (user_id, session_id) VALUES (?, ?)",
            (user["id"], session_id)
        )
        conn.commit()

    access_token = create_token(
        subject=str(user["id"]),
        token_type="staff",
        extra_claims={"role": user["role"]},
        session_id=session_id,
    )

    return TokenResponse(
        access_token=access_token,
        user={
            "id": user["id"],
            "username": user["username"],
            "name": user["name"],
            "role": user["role"],
            "phone": user["phone"],
        },
    )


@router.post("/logout")
def logout(current_user=Depends(get_current_user)):
    """Logout: remove active session."""
    # The session_id is in the token; we clear all sessions for this user
    with get_db() as conn:
        conn.execute("DELETE FROM active_sessions WHERE user_id = ?", (current_user["id"],))
        conn.commit()
    return {"message": "Logged out successfully"}


@router.get("/me")
def me(current_user=Depends(get_current_user)):
    return current_user
