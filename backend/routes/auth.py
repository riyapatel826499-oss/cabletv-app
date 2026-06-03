"""Staff authentication — login, token validation, role-based access."""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, update, delete
from sqlalchemy.orm import Session

from deps_orm import get_current_user, require_role, create_token
from models.base import get_db
from models.tables import User, ActiveSession, Operator
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
def login(request: Request, body: LoginRequest, db: Session = Depends(get_db)):
    # Look up user by username
    user_obj = db.execute(
        select(User).where(User.username == body.username)
    ).scalar_one_or_none()

    if not user_obj:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    user = {
        "id": user_obj.id,
        "username": user_obj.username,
        "name": user_obj.name,
        "role": user_obj.role,
        "phone": user_obj.phone,
        "password": user_obj.password,
        "operator_id": user_obj.operator_id,
    }

    # Verify password (supports bcrypt + legacy SHA256 migration)
    if not verify_password(body.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    # Auto-upgrade legacy SHA256 to bcrypt
    if needs_rehash(user["password"]):
        db.execute(
            update(User)
            .where(User.id == user["id"])
            .values(password=hash_password(body.password))
        )
        db.commit()

    # Single-session enforcement: silently replace any existing session.
    # Old token stops working immediately — no multiple simultaneous logins.
    # No popup needed since stale sessions (browser close, network drop) are common.
    session_id = str(uuid.uuid4())

    # Remove any existing sessions for this user
    db.execute(delete(ActiveSession).where(ActiveSession.user_id == user["id"]))

    # Register new session
    db.add(ActiveSession(user_id=user["id"], session_id=session_id))
    db.commit()

    # Get operator business name if assigned
    operator_name = None
    if user.get("operator_id"):
        op = db.execute(
            select(Operator).where(Operator.id == user["operator_id"])
        ).scalar_one_or_none()
        if op:
            operator_name = op.business_name

    access_token = create_token(
        subject=str(user["id"]),
        token_type="staff",
        extra_claims={"role": user["role"], "oid": user.get("operator_id")},
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
            "operator_id": user.get("operator_id"),
            "operator_name": operator_name,
        },
    )


@router.post("/logout")
def logout(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Logout: remove active session."""
    # The session_id is in the token; we clear all sessions for this user
    db.execute(delete(ActiveSession).where(ActiveSession.user_id == current_user["id"]))
    db.commit()
    return {"message": "Logged out successfully"}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.put("/change-password")
def change_password(body: ChangePasswordRequest, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Change own password — must supply current password."""
    if len(body.new_password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(400, detail=f"Password must be at least {PASSWORD_MIN_LENGTH} characters")

    user_obj = db.execute(
        select(User).where(User.id == current_user["id"])
    ).scalar_one_or_none()

    if not user_obj or not verify_password(body.current_password, user_obj.password):
        raise HTTPException(401, detail="Current password is incorrect")

    db.execute(
        update(User)
        .where(User.id == current_user["id"])
        .values(password=hash_password(body.new_password))
    )
    db.commit()

    return {"message": "Password changed successfully"}


@router.get("/me")
def me(current_user=Depends(get_current_user)):
    return current_user
