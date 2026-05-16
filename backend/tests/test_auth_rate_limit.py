"""Tests fuer den Auth-Rate-Limiter (Security-Audit Paket B1).

Abgedeckt:
* RateLimiter-Mechanik mit kontrollierbarer Uhr (Sperre, Ablauf, Fenster,
  Reset).
* Login: Sperre nach mehreren Fehlversuchen (429 + Retry-After), erfolgreicher
  Login setzt den Zaehler zurueck, 429-Antwort ist generisch und verraet keine
  Konto-Existenz.
* Registrierung: Sperre pro IP, Isolation zwischen verschiedenen IPs.
* Normaler Login funktioniert weiterhin; Sperre laeuft nach Ablauf des
  Block-Fensters automatisch aus.
"""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.services import rate_limiter as rl_module
from app.services.rate_limiter import RateLimiter

from .auth_helpers import ensure_auth_user

GENERIC_429 = "Zu viele Versuche. Bitte später erneut versuchen."


class _FakeClock:
    """Injizierbare Uhr fuer deterministische Zeit-Tests."""

    def __init__(self, start: float = 0.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


# -----------------------------------------------------------------------------
# 1. RateLimiter-Mechanik (Unit-Tests mit kontrollierter Uhr)
# -----------------------------------------------------------------------------
def test_rate_limiter_blocks_after_max_attempts() -> None:
    clock = _FakeClock(1000.0)
    limiter = RateLimiter(max_attempts=3, window_seconds=60, block_seconds=120, time_fn=clock)

    assert limiter.is_blocked("k").limited is False
    assert limiter.record_attempt("k").limited is False  # 1
    assert limiter.record_attempt("k").limited is False  # 2
    assert limiter.record_attempt("k").limited is True   # 3 -> Sperre
    assert limiter.is_blocked("k").limited is True


def test_rate_limiter_block_expires_after_block_window() -> None:
    clock = _FakeClock(0.0)
    limiter = RateLimiter(max_attempts=2, window_seconds=60, block_seconds=120, time_fn=clock)

    limiter.record_attempt("k")
    limiter.record_attempt("k")  # -> gesperrt
    assert limiter.is_blocked("k").limited is True

    clock.advance(119)
    assert limiter.is_blocked("k").limited is True   # noch gesperrt

    clock.advance(2)  # 121 > 120
    assert limiter.is_blocked("k").limited is False  # automatisch freigegeben


def test_rate_limiter_window_slides() -> None:
    clock = _FakeClock(0.0)
    limiter = RateLimiter(max_attempts=3, window_seconds=60, block_seconds=120, time_fn=clock)

    limiter.record_attempt("k")  # t=0
    clock.advance(61)            # erster Versuch faellt aus dem Fenster
    limiter.record_attempt("k")  # t=61
    limiter.record_attempt("k")  # t=61
    # Nur 2 Versuche im aktuellen Fenster -> keine Sperre.
    assert limiter.is_blocked("k").limited is False


def test_rate_limiter_reset_clears_state() -> None:
    clock = _FakeClock(0.0)
    limiter = RateLimiter(max_attempts=2, window_seconds=60, block_seconds=120, time_fn=clock)

    limiter.record_attempt("k")
    limiter.record_attempt("k")  # -> gesperrt
    assert limiter.is_blocked("k").limited is True

    limiter.reset("k")
    assert limiter.is_blocked("k").limited is False
    assert limiter.record_attempt("k").limited is False  # Zaehler war geleert


# -----------------------------------------------------------------------------
# 2. Login-Rate-Limit (End-to-End ueber den Endpunkt)
# -----------------------------------------------------------------------------
def test_login_blocks_after_five_failed_attempts() -> None:
    client = TestClient(app)
    bad = {"email": f"brute-{uuid4().hex}@tests.local", "password": "definitiv-falsch"}

    for _ in range(5):
        res = client.post("/api/auth/login", json=bad)
        assert res.status_code == 401

    blocked = client.post("/api/auth/login", json=bad)
    assert blocked.status_code == 429
    assert blocked.json()["detail"] == GENERIC_429


def test_login_429_sets_retry_after_header() -> None:
    client = TestClient(app)
    bad = {"email": f"retry-{uuid4().hex}@tests.local", "password": "definitiv-falsch"}

    for _ in range(5):
        client.post("/api/auth/login", json=bad)
    blocked = client.post("/api/auth/login", json=bad)

    assert blocked.status_code == 429
    header_names = {name.lower() for name in blocked.headers.keys()}
    assert "retry-after" in header_names


def test_successful_login_resets_failure_counter() -> None:
    client = TestClient(app)
    email, password = ensure_auth_user("Mitarbeiter", user_id=f"usr-rlreset-{uuid4().hex[:8]}")

    # 4 Fehlversuche (unter dem Limit von 5).
    for _ in range(4):
        res = client.post("/api/auth/login", json={"email": email, "password": "falsch"})
        assert res.status_code == 401

    # Erfolgreicher Login setzt den Fehlerzaehler zurueck.
    ok = client.post("/api/auth/login", json={"email": email, "password": password})
    assert ok.status_code == 200

    # Weitere 4 Fehlversuche duerfen daher NICHT zu 429 fuehren.
    for _ in range(4):
        res = client.post("/api/auth/login", json={"email": email, "password": "falsch"})
        assert res.status_code == 401


def test_login_rate_limit_does_not_reveal_account_existence() -> None:
    client = TestClient(app)

    # Bekannte, existierende E-Mail.
    known_email, _ = ensure_auth_user("Mitarbeiter", user_id=f"usr-rlknown-{uuid4().hex[:8]}")
    for _ in range(5):
        client.post("/api/auth/login", json={"email": known_email, "password": "falsch"})
    blocked_known = client.post("/api/auth/login", json={"email": known_email, "password": "falsch"})

    # Voellig unbekannte E-Mail.
    unknown_email = f"unknown-{uuid4().hex}@tests.local"
    for _ in range(5):
        client.post("/api/auth/login", json={"email": unknown_email, "password": "falsch"})
    blocked_unknown = client.post("/api/auth/login", json={"email": unknown_email, "password": "falsch"})

    # Beide werden identisch gesperrt -> keine Account-Enumeration.
    assert blocked_known.status_code == 429
    assert blocked_unknown.status_code == 429
    assert blocked_known.json()["detail"] == blocked_unknown.json()["detail"] == GENERIC_429


def test_normal_login_still_works() -> None:
    client = TestClient(app)
    email, password = ensure_auth_user("Admin", user_id=f"usr-rlok-{uuid4().hex[:8]}")

    res = client.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200
    assert res.json()["accessToken"]


def test_login_unblocks_after_block_window_elapses() -> None:
    """End-to-End: nach Ablauf der Sperrdauer ist Login wieder moeglich."""
    client = TestClient(app)
    email = f"expire-{uuid4().hex}@tests.local"
    bad = {"email": email, "password": "falsch"}
    rate_key = f"testclient|{email}"

    clock = _FakeClock(10_000.0)
    original_time_fn = rl_module.login_rate_limiter.time_fn
    rl_module.login_rate_limiter.time_fn = clock
    try:
        for _ in range(5):
            assert client.post("/api/auth/login", json=bad).status_code == 401
        assert client.post("/api/auth/login", json=bad).status_code == 429

        # Sperrdauer (+1 s) verstreichen lassen.
        clock.advance(rl_module.login_rate_limiter.block_seconds + 1)

        # Danach wieder erreichbar -> regulaerer 401 statt 429.
        assert client.post("/api/auth/login", json=bad).status_code == 401
    finally:
        rl_module.login_rate_limiter.time_fn = original_time_fn
        rl_module.login_rate_limiter.reset(rate_key)


# -----------------------------------------------------------------------------
# 3. Register-Rate-Limit (pro IP)
# -----------------------------------------------------------------------------
def _register_payload() -> dict[str, str]:
    return {
        "name": "Rate Limit Probe",
        "email": f"reg-rl-{uuid4().hex}@tests.local",
        "password": "Willkommen123!",
    }


def test_register_is_rate_limited_per_ip() -> None:
    client = TestClient(app)
    # Eindeutige X-Forwarded-For-Kennung, damit der Test isoliert vom
    # restlichen Test-Lauf laeuft (der Limiter keyt auf den String).
    headers = {"X-Forwarded-For": f"test-ip-{uuid4().hex}"}

    for _ in range(5):
        res = client.post("/api/auth/register", headers=headers, json=_register_payload())
        assert res.status_code in {200, 201}

    blocked = client.post("/api/auth/register", headers=headers, json=_register_payload())
    assert blocked.status_code == 429
    assert blocked.json()["detail"] == GENERIC_429


def test_register_rate_limit_is_isolated_per_ip() -> None:
    client = TestClient(app)
    ip_a = {"X-Forwarded-For": f"test-ip-{uuid4().hex}"}
    ip_b = {"X-Forwarded-For": f"test-ip-{uuid4().hex}"}

    # IP A bis zur Sperre ausreizen.
    for _ in range(5):
        client.post("/api/auth/register", headers=ip_a, json=_register_payload())
    assert client.post("/api/auth/register", headers=ip_a, json=_register_payload()).status_code == 429

    # IP B ist davon unberuehrt.
    res = client.post("/api/auth/register", headers=ip_b, json=_register_payload())
    assert res.status_code in {200, 201}
