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
from ..services.rate_limiter import (
    client_ip,
    login_rate_limiter,
    register_rate_limiter,
    too_many_requests,
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
def login_icloud(payload: LoginRequest, request: Request) -> LoginResponse:
    # Brute-Force-Schutz pro IP: verhindert, dass der Endpunkt als Proxy zum
    # Durchprobieren von Apple-Zugangsdaten missbraucht wird.
    key = f"icloud:{client_ip(request)}"
    blocked = login_rate_limiter.is_blocked(key)
    if blocked.limited:
        raise too_many_requests(blocked.retry_after)
    result = test_login(payload)
    if result.success:
        login_rate_limiter.reset(key)
    elif not result.two_factor_required:
        # Eine 2FA-Aufforderung ist kein Fehlversuch — nur echte Fehlschlaege
        # zaehlen, damit der legitime 2FA-Flow nicht blockiert wird.
        login_rate_limiter.record_attempt(key)
    return result


@router.post("/login", response_model=AuthLoginResponse)
def login(
    payload: AuthLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AuthLoginResponse:
    email = payload.email.strip().lower()
    # Schluessel = IP + normalisierte E-Mail. Generische 429-Antwort, falls
    # die Kombination wegen zu vieler Fehlversuche gesperrt ist.
    rate_key = f"{client_ip(request)}|{email}"
    blocked = login_rate_limiter.is_blocked(rate_key)
    if blocked.limited:
        raise too_many_requests(blocked.retry_after)

    try:
        user = authenticate_user(db, payload.email, payload.password)
    except HTTPException as exc:
        # Nur echte Fehlversuche (401) zaehlen. Ein 403 ("Konto nicht
        # freigegeben") bedeutet, dass das Passwort korrekt war — das ist
        # kein Brute-Force-Signal.
        if exc.status_code == 401:
            login_rate_limiter.record_attempt(rate_key)
        raise

    token = issue_access_token(user, expires_in=AUTH_TOKEN_EXPIRY_SECONDS)
    # Erfolgreicher Login: Fehlerzaehler fuer diese IP/E-Mail zuruecksetzen.
    login_rate_limiter.reset(rate_key)
    return AuthLoginResponse(
        accessToken=token,
        tokenType="bearer",
        expiresIn=AUTH_TOKEN_EXPIRY_SECONDS,
        user=user,
    )


@router.post("/register", response_model=AuthRegisterResponse, status_code=201)
def register(
    payload: AuthRegisterRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AuthRegisterResponse:
    # Spam-Schutz pro IP: jeder Registrierungsversuch zaehlt.
    rate_key = client_ip(request)
    blocked = register_rate_limiter.is_blocked(rate_key)
    if blocked.limited:
        raise too_many_requests(blocked.retry_after)
    register_rate_limiter.record_attempt(rate_key)

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
