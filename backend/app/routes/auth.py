from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
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
    authenticate_token,
    authenticate_user,
    decode_access_token,
    invalidate_sessions,
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
from .dependencies import AUTH_COOKIE_NAME, extract_request_token

router = APIRouter(prefix="/api/auth", tags=["Auth"])


def _request_is_https(request: Request) -> bool:
    """Erkennt, ob der urspruengliche Client ueber HTTPS spricht.

    Hinter einem TLS-terminierenden Reverse-Proxy (Cloudflare) sieht das
    Backend selbst u. U. nur ``http`` — der ``X-Forwarded-Proto``-Header
    traegt dann das echte Schema. Beides wird geprueft, damit das
    Secure-Flag des Auth-Cookies zuverlaessig gesetzt wird, ohne dass dafuer
    Deployment-Konfiguration angefasst werden muss.
    """
    if request.url.scheme == "https":
        return True
    forwarded = request.headers.get("x-forwarded-proto", "")
    return forwarded.split(",")[0].strip().lower() == "https"


def _set_auth_cookie(response: Response, request: Request, token: str) -> None:
    """Setzt den Auth-Token als HttpOnly-Cookie (Security-Audit Paket B4).

    * HttpOnly: kein JS-Zugriff -> ein XSS kann den Token nicht mehr
      auslesen/exfiltrieren (anders als beim bisherigen localStorage).
    * Secure (nur ueber HTTPS): kein Versand ueber unverschluesselte
      Verbindungen. In der lokalen HTTP-Entwicklung bewusst deaktiviert,
      sonst wuerde der Login lokal nicht funktionieren.
    * SameSite=Lax: das Cookie wird bei Cross-Site-POST/PUT/DELETE NICHT
      mitgeschickt -> CSRF-Schutz fuer zustandsaendernde Requests. Lesende
      Top-Level-GET-Navigationen bleiben moeglich (SPA-Einstieg).
    * max_age == Token-Lebensdauer: das Cookie verfaellt mit dem Token.
    """
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        max_age=AUTH_TOKEN_EXPIRY_SECONDS,
        path="/",
        httponly=True,
        secure=_request_is_https(request),
        samesite="lax",
    )


def _clear_auth_cookie(response: Response, request: Request) -> None:
    """Loescht das Auth-Cookie (leerer Wert + sofortiger Ablauf)."""
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value="",
        max_age=0,
        path="/",
        httponly=True,
        secure=_request_is_https(request),
        samesite="lax",
    )


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
    response: Response,
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
        user, token_version = authenticate_user(db, payload.email, payload.password)
    except HTTPException as exc:
        # Nur echte Fehlversuche (401) zaehlen. Ein 403 ("Konto nicht
        # freigegeben") bedeutet, dass das Passwort korrekt war — das ist
        # kein Brute-Force-Signal.
        if exc.status_code == 401:
            login_rate_limiter.record_attempt(rate_key)
        raise

    # token_version wird in den Token eingebettet -> serverseitige Invalidierung.
    token = issue_access_token(
        user,
        token_version=token_version,
        expires_in=AUTH_TOKEN_EXPIRY_SECONDS,
    )
    # Erfolgreicher Login: Fehlerzaehler fuer diese IP/E-Mail zuruecksetzen.
    login_rate_limiter.reset(rate_key)
    # Security-Audit Paket B4: Token zusaetzlich als HttpOnly-Cookie setzen.
    # Die Browser-SPA authentifiziert sich darueber; der Token im Body bleibt
    # fuer API-/Test-Clients erhalten, die einen Authorization-Header nutzen.
    _set_auth_cookie(response, request, token)
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
def auth_me(request: Request, db: Session = Depends(get_db)) -> AuthUserInfo:
    # Token aus Authorization-Header ODER HttpOnly-Cookie (Paket B4).
    token = extract_request_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Nicht authentifiziert.")
    # Vollpruefung inkl. token_version — ein invalidierter Token liefert 401.
    return authenticate_token(db, token)


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    # Serverseitige Invalidierung (Security-Audit Paket B2): die token_version
    # des Benutzers wird erhoeht, wodurch der verwendete — und jeder andere —
    # Token dieses Users sofort ungueltig wird. Ein fehlender, abgelaufener
    # oder kaputter Token fuehrt NICHT zu einem Fehler: Logout ist idempotent.
    token = extract_request_token(request)
    if token:
        try:
            info = decode_access_token(token)
        except HTTPException:
            info = None
        if info is not None and info.userId:
            invalidate_sessions(db, info.userId)
    # Auth-Cookie in jedem Fall loeschen — auch ohne gueltigen Token bleibt
    # Logout idempotent (Paket B4).
    _clear_auth_cookie(response, request)
    return {"ok": True}
