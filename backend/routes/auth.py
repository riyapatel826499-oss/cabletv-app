"""Staff authentication — login, token validation, role-based access."""
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

    access_token = create_token(
        subject=str(user["id"]),
        token_type="staff",
        extra_claims={"role": user["role"]},
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


@router.get("/me")
def me(current_user=Depends(get_current_user)):
    return current_user
