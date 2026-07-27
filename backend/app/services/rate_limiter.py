"""In-Memory Rate-Limiter fuer Auth-Endpunkte (Security-Audit Paket B1).

Schlanker Brute-Force-Schutz ohne externe Infrastruktur — kein Redis, keine
zusaetzliche DB-Tabelle. Der Limiter zaehlt Ereignisse pro Schluessel in einem
gleitenden Zeitfenster und sperrt den Schluessel nach Ueberschreiten einer
Schwelle fuer eine feste Dauer; danach wird automatisch wieder freigegeben.

Bewusste Einschraenkung: Der State ist prozesslokal. Bei mehreren
Backend-Instanzen ist er also nicht geteilt. Fuer den aktuellen, eher kleinen
teaminternen Betrieb ist das akzeptiert und gewollt einfach gehalten.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from math import ceil
from typing import Callable

from fastapi import HTTPException, Request

# Nach wie vielen Mutationen ein voller Cleanup-Sweep ueber alle Schluessel
# laeuft. Haelt den Speicher bei vielen unterschiedlichen IPs/E-Mails klein,
# ohne bei jedem Request ueber den gesamten State zu iterieren.
_CLEANUP_EVERY = 256


@dataclass(frozen=True)
class RateLimitStatus:
    """Ergebnis einer Limiter-Abfrage.

    ``retry_after`` ist nur aussagekraeftig, wenn ``limited`` True ist.
    """

    limited: bool
    retry_after: int


class RateLimiter:
    """Gleitendes-Fenster-Limiter mit fester Sperrdauer.

    ``time_fn`` ist injizierbar, damit Tests die Uhr kontrollieren koennen.
    """

    def __init__(
        self,
        *,
        max_attempts: int,
        window_seconds: int,
        block_seconds: int,
        time_fn: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self.block_seconds = block_seconds
        self.time_fn = time_fn
        self._events: dict[str, list[float]] = {}
        self._blocked_until: dict[str, float] = {}
        self._lock = threading.Lock()
        self._ops_since_cleanup = 0

    def is_blocked(self, key: str) -> RateLimitStatus:
        """Prueft, ob der Schluessel aktuell gesperrt ist (ohne ihn zu zaehlen)."""
        with self._lock:
            now = self.time_fn()
            until = self._blocked_until.get(key)
            if until is not None:
                if until > now:
                    return RateLimitStatus(True, ceil(until - now))
                # Sperre abgelaufen -> automatisch freigeben.
                del self._blocked_until[key]
                self._events.pop(key, None)
            return RateLimitStatus(False, 0)

    def record_attempt(self, key: str) -> RateLimitStatus:
        """Zaehlt einen Versuch. Loest bei Ueberschreiten die Sperre aus."""
        with self._lock:
            now = self.time_fn()
            until = self._blocked_until.get(key)
            if until is not None:
                if until > now:
                    # Bereits gesperrt — Versuch nicht weiter hochzaehlen.
                    return RateLimitStatus(True, ceil(until - now))
                del self._blocked_until[key]

            window_start = now - self.window_seconds
            events = [t for t in self._events.get(key, []) if t >= window_start]
            events.append(now)
            self._maybe_cleanup_locked(now)

            if len(events) >= self.max_attempts:
                self._blocked_until[key] = now + self.block_seconds
                self._events.pop(key, None)
                return RateLimitStatus(True, self.block_seconds)

            self._events[key] = events
            return RateLimitStatus(False, 0)

    def reset(self, key: str) -> None:
        """Loescht Zaehler und Sperre fuer einen Schluessel (z. B. nach Erfolg)."""
        with self._lock:
            self._events.pop(key, None)
            self._blocked_until.pop(key, None)

    def reset_all(self) -> None:
        """Nur fuer Tests gedacht: gesamten State leeren."""
        with self._lock:
            self._events.clear()
            self._blocked_until.clear()
            self._ops_since_cleanup = 0

    def _maybe_cleanup_locked(self, now: float) -> None:
        self._ops_since_cleanup += 1
        if self._ops_since_cleanup < _CLEANUP_EVERY:
            return
        self._ops_since_cleanup = 0
        window_start = now - self.window_seconds
        for key in list(self._events.keys()):
            fresh = [t for t in self._events[key] if t >= window_start]
            if fresh:
                self._events[key] = fresh
            else:
                del self._events[key]
        for key in list(self._blocked_until.keys()):
            if self._blocked_until[key] <= now:
                del self._blocked_until[key]


# --- Konfigurierte Limiter-Instanzen (prozesslokale Singletons) --------------
# Login: max. 5 Fehlversuche pro 10-Minuten-Fenster, danach 15 Minuten Sperre.
login_rate_limiter = RateLimiter(
    max_attempts=5,
    window_seconds=10 * 60,
    block_seconds=15 * 60,
)
# Zweiter, rein konto-basierter Login-Limiter (Schluessel = normalisierte
# E-Mail OHNE IP). Greift auch dann, wenn ein Angreifer die IP-Komponente des
# kombinierten Schluessels per rotierendem X-Forwarded-For umgeht. Bewusst
# lockerer als das IP-Limit, damit ein Angreifer einen legitimen Nutzer nicht
# leicht per Dauerfeuer aussperren kann (DoS auf ein Konto).
account_login_rate_limiter = RateLimiter(
    max_attempts=15,
    window_seconds=15 * 60,
    block_seconds=15 * 60,
)
# Registrierung: max. 5 Versuche pro IP in 30 Minuten, danach 30 Minuten Sperre.
register_rate_limiter = RateLimiter(
    max_attempts=5,
    window_seconds=30 * 60,
    block_seconds=30 * 60,
)
# Mobile-Token-Refresh: großzügiges IP-Limit gegen Durchprobieren von
# Refresh-Tokens (die Tokens selbst sind signiert und lang).
refresh_rate_limiter = RateLimiter(
    max_attempts=60,
    window_seconds=10 * 60,
    block_seconds=10 * 60,
)
# Systemupdate ausloesen: harte Bremse gegen wiederholte Redeploy-Anforderungen
# (jeder Aufruf erzeugt Backup + Stack-Neustart). Gilt zusaetzlich zum
# DB-Update-Lock, der parallele Laeufe ohnehin verhindert.
system_update_rate_limiter = RateLimiter(
    max_attempts=5,
    window_seconds=60 * 60,
    block_seconds=15 * 60,
)
# Versionspruefung: schuetzt das GitHub-API-Rate-Limit vor einem zu eifrig
# pollenden Client, bleibt fuer normales Nachschauen aber grosszuegig.
system_update_check_rate_limiter = RateLimiter(
    max_attempts=60,
    window_seconds=10 * 60,
    block_seconds=5 * 60,
)


def client_ip(request: Request) -> str:
    """Ermittelt die Client-IP fuer Rate-Limiting und Security-Logging.

    ``X-Forwarded-For`` wird NUR ausgewertet, wenn ``TRUST_PROXY_HEADERS``
    gesetzt ist (Betrieb hinter Cloudflare/NPM — dort ist der Header vom
    Proxy gesetzt und ``request.client.host`` waere die Proxy-IP). Ohne
    vertrauenswuerdigen Proxy ist der Header client-kontrolliert: ein
    Angreifer koennte pro Request eine neue Fake-IP schicken und bekaeme
    fuer jeden Rate-Limit-Schluessel mit IP-Anteil unbegrenzt neue Buckets.
    Als zweites Netz existiert deshalb zusaetzlich der rein konto-basierte
    ``account_login_rate_limiter`` (ohne IP im Schluessel).
    """
    from ..config.settings import get_settings

    if get_settings().trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            first = forwarded.split(",")[0].strip()
            if first:
                return first
    client = request.client
    if client and client.host:
        return client.host
    return "unknown"


def too_many_requests(retry_after: int) -> HTTPException:
    """Baut eine generische 429-Antwort (ohne Hinweis auf Konto-Existenz)."""
    headers = {"Retry-After": str(retry_after)} if retry_after > 0 else None
    return HTTPException(
        status_code=429,
        detail="Zu viele Versuche. Bitte später erneut versuchen.",
        headers=headers,
    )
