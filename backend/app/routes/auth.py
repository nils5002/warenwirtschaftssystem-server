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
from ..services import security_event_service as sec
from ..services.auth_service import (
    AUTH_TOKEN_EXPIRY_SECONDS,
    AccountTemporarilyLockedError,
    authenticate_token,
    authenticate_user,
    decode_access_token,
    invalidate_sessions,
    issue_access_token,
    register_user,
    test_login,
)
from ..services.rate_limiter import (
    account_login_rate_limiter,
    client_ip,
    login_rate_limiter,
    register_rate_limiter,
    too_many_requests,
)
from ..services.role_service import RoleService
from .dependencies import AUTH_COOKIE_NAME, _normalize_role, extract_request_token

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
    # Zwei Limiter: (1) IP+E-Mail — schnell, aber per gefälschtem
    # X-Forwarded-For umgehbar, wenn TRUST_PROXY_HEADERS aktiv ist;
    # (2) rein konto-basiert (nur E-Mail) — greift auch bei IP-Rotation.
    rate_key = f"{client_ip(request)}|{email}"
    account_key = f"acct|{email}"
    blocked = login_rate_limiter.is_blocked(rate_key)
    account_blocked = account_login_rate_limiter.is_blocked(account_key)
    if blocked.limited or account_blocked.limited:
        retry_after = max(blocked.retry_after, account_blocked.retry_after)
        sec.record_event(
            db, sec.LOGIN_RATE_LIMITED, request=request, severity="warning",
            identifier=email, reason="rate_limited",
        )
        raise too_many_requests(retry_after)

    try:
        user, token_version = authenticate_user(db, payload.email, payload.password)
    except AccountTemporarilyLockedError as exc:
        # Persistente Konto-Sperre (überlebt Neustarts). Auf dem auslösenden
        # Versuch zusätzlich ein suspicious-Event für den Admin-Badge.
        sec.record_event(
            db, sec.LOGIN_BLOCKED_LOCKED, request=request, severity="warning",
            identifier=email, reason="locked",
        )
        if exc.just_locked:
            sec.record_event(
                db, sec.SUSPICIOUS_ACTIVITY_DETECTED, request=request, severity="critical",
                identifier=email, reason="failed_login_threshold",
            )
        raise
    except HTTPException as exc:
        # Nur echte Fehlversuche (401) zaehlen. Ein 403 ("Konto nicht
        # freigegeben") bedeutet, dass das Passwort korrekt war — das ist
        # kein Brute-Force-Signal.
        if exc.status_code == 401:
            login_rate_limiter.record_attempt(rate_key)
            account_login_rate_limiter.record_attempt(account_key)
            sec.record_event(
                db, sec.LOGIN_FAILED, request=request, severity="warning",
                identifier=email, reason="invalid_credentials",
            )
        elif exc.status_code == 403:
            sec.record_event(
                db, sec.LOGIN_BLOCKED_INACTIVE, request=request, severity="warning",
                identifier=email, reason="inactive_user",
            )
        raise

    # token_version wird in den Token eingebettet -> serverseitige Invalidierung.
    token = issue_access_token(
        user,
        token_version=token_version,
        expires_in=AUTH_TOKEN_EXPIRY_SECONDS,
    )
    # Erfolgreicher Login: Fehlerzaehler fuer diese IP/E-Mail zuruecksetzen.
    login_rate_limiter.reset(rate_key)
    account_login_rate_limiter.reset(account_key)
    # Login-Metadaten am Benutzer persistieren + Erfolgs-Event.
    sec.note_login_success(db, user.userId, request)
    sec.record_event(
        db, sec.LOGIN_SUCCESS, request=request, success=True,
        user_id=user.userId, identifier=email,
    )
    # Security-Audit Paket B4: Token zusaetzlich als HttpOnly-Cookie setzen.
    # Die Browser-SPA authentifiziert sich darueber; der Token im Body bleibt
    # fuer API-/Test-Clients erhalten, die einen Authorization-Header nutzen.
    _set_auth_cookie(response, request, token)
    # Effektive Rechte mitliefern, damit die Nav direkt nach dem Login passt.
    user = user.model_copy(
        update={"permissions": RoleService.effective_permissions(db, _normalize_role(user.role))}
    )
    return AuthLoginResponse(
        accessToken=token,
        tokenType="bearer",
        expiresIn=AUTH_TOKEN_EXPIRY_SECONDS,
        user=user,
    )


# Generische Erfolgsmeldung der Registrierung. Bewusst identisch für: echte
# Neuanlage, Duplikat, deaktivierte Registrierung und Honeypot-Treffer —
# von außen ist nicht unterscheidbar, ob ein Konto entstanden ist.
_REGISTER_GENERIC_MESSAGE = (
    "Registrierung erfolgreich. Dein Konto muss erst von einem Admin freigegeben werden."
)


@router.post("/register", response_model=AuthRegisterResponse, status_code=201)
def register(
    payload: AuthRegisterRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AuthRegisterResponse:
    email = payload.email.strip().lower()
    sec.record_event(db, sec.REGISTER_ATTEMPT, request=request, identifier=email)

    # Spam-Schutz pro IP: jeder Registrierungsversuch zaehlt.
    rate_key = client_ip(request)
    blocked = register_rate_limiter.is_blocked(rate_key)
    if blocked.limited:
        sec.record_event(
            db, sec.REGISTER_BLOCKED_RATE_LIMIT, request=request, severity="warning",
            identifier=email, reason="rate_limited",
        )
        raise too_many_requests(blocked.retry_after)
    register_rate_limiter.record_attempt(rate_key)

    # Honeypot: Menschen sehen das Feld nicht — ist es befüllt, war es ein Bot.
    # Still verwerfen, generisch antworten.
    if (payload.website or "").strip():
        sec.record_event(
            db, sec.REGISTER_HONEYPOT, request=request, severity="warning",
            identifier=email, reason="honeypot",
        )
        return AuthRegisterResponse(message=_REGISTER_GENERIC_MESSAGE)

    # Admin-Schalter (system_settings, Default AUS): kein Insert, aber die
    # gleiche generische Antwort — der Endpunkt verrät nicht, dass er zu ist.
    if not sec.registration_enabled(db):
        sec.record_event(
            db, sec.REGISTER_BLOCKED_DISABLED, request=request, severity="warning",
            identifier=email, reason="registration_disabled",
        )
        return AuthRegisterResponse(message=_REGISTER_GENERIC_MESSAGE)

    try:
        outcome = register_user(db, payload.name, payload.email, payload.password)
    except HTTPException as exc:
        if exc.status_code == 400:
            sec.record_event(
                db, sec.REGISTER_INVALID_EMAIL, request=request, severity="info",
                identifier=email, reason="invalid_input",
            )
        raise

    if outcome == "duplicate":
        sec.record_event(db, sec.REGISTER_DUPLICATE, request=request, identifier=email)
    else:
        sec.record_event(
            db, sec.REGISTER_SUCCESS_PENDING, request=request, success=True, identifier=email,
        )
        # Fremde Domain nicht blocken, aber sichtbar machen: der Vorfall
        # "supman" wäre damit sofort im Admin-Bereich aufgefallen.
        domain = email.rsplit("@", 1)[-1] if "@" in email else ""
        if domain and domain != sec.INTERNAL_EMAIL_DOMAIN:
            sec.record_event(
                db, sec.REGISTER_EXTERNAL_DOMAIN, request=request, severity="warning",
                identifier=email, reason="external_domain",
            )
    return AuthRegisterResponse(message=_REGISTER_GENERIC_MESSAGE)


@router.get("/me", response_model=AuthUserInfo)
def auth_me(request: Request, db: Session = Depends(get_db)) -> AuthUserInfo:
    # Token aus Authorization-Header ODER HttpOnly-Cookie (Paket B4).
    token = extract_request_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Nicht authentifiziert.")
    # Vollpruefung inkl. token_version — ein invalidierter Token liefert 401.
    info = authenticate_token(db, token)
    # Effektive Rechte der Rolle anhängen (Feature „Rollen & Rechte"). Die Rolle
    # kommt als Label ("Admin") → vor dem Lookup auf den role_key normalisieren.
    perms = RoleService.effective_permissions(db, _normalize_role(info.role))
    return info.model_copy(update={"permissions": perms})


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
            sec.record_event(
                db, sec.LOGOUT, request=request, success=True,
                user_id=info.userId, identifier=info.email,
            )
    # Auth-Cookie in jedem Fall loeschen — auch ohne gueltigen Token bleibt
    # Logout idempotent (Paket B4).
    _clear_auth_cookie(response, request)
    return {"ok": True}
