from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database.session import get_db
from ..schemas.auth import (
    AuthLoginRequest,
    AuthLoginResponse,
    AuthRegisterRequest,
    AuthRegisterResponse,
    AuthUserInfo,
)
from ..schemas.job import LoginRequest, LoginResponse
from ..services.auth_service import (
    AUTH_TOKEN_EXPIRY_SECONDS,
    authenticate_user,
    decode_access_token,
    issue_access_token,
    register_user,
    test_login,
)

router = APIRouter(prefix="/api/auth", tags=["Auth"])


def _extract_bearer_token(request: Request) -> str:
    header = request.headers.get("authorization", "").strip()
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Nicht authentifiziert.")
    token = header[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Nicht authentifiziert.")
    return token


@router.post("/icloud-login", response_model=LoginResponse)
def login_icloud(payload: LoginRequest) -> LoginResponse:
    return test_login(payload)


@router.post("/login", response_model=AuthLoginResponse)
def login(payload: AuthLoginRequest, db: Session = Depends(get_db)) -> AuthLoginResponse:
    user = authenticate_user(db, payload.email, payload.password)
    token = issue_access_token(user, expires_in=AUTH_TOKEN_EXPIRY_SECONDS)
    return AuthLoginResponse(
        accessToken=token,
        tokenType="bearer",
        expiresIn=AUTH_TOKEN_EXPIRY_SECONDS,
        user=user,
    )


@router.post("/register", response_model=AuthRegisterResponse, status_code=201)
def register(payload: AuthRegisterRequest, db: Session = Depends(get_db)) -> AuthRegisterResponse:
    register_user(db, payload.name, payload.email, payload.password)
    return AuthRegisterResponse(
        message="Registrierung erfolgreich. Dein Konto muss erst von einem Admin freigegeben werden."
    )


@router.get("/me", response_model=AuthUserInfo)
def auth_me(request: Request) -> AuthUserInfo:
    token = _extract_bearer_token(request)
    return decode_access_token(token)


@router.post("/logout")
def logout() -> dict[str, bool]:
    # JWT ist stateless. Frontend verwirft den Token.
    return {"ok": True}
