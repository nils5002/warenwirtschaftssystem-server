"""Kurzlebiger Prozess-Cache fuer die /api/wms/overview-Antwort.

Hintergrund (Performance-Paket Overview)
----------------------------------------
Der Lasttest hat gezeigt, dass /api/wms/overview unter paralleler Last
super-linear langsamer wird (Concurrency 1 ~70 ms, Concurrency 20 ~3200 ms).
Ursache ist nicht SQLite (die DB ist winzig), sondern der einzelne
uvicorn-Worker: die teure Python-Arbeit (Pydantic-Aufbau, Konfliktberechnung,
JSON-Serialisierung) wird vom GIL serialisiert, waehrend ~20 Clients den
Endpoint im Poll-Takt abfragen.

Loesung: ein einziger, kurzlebiger Cache-Eintrag.

Warum EIN globaler Eintrag fachlich korrekt ist
-----------------------------------------------
Die Overview-Antwort ist rollen- und benutzerunabhaengig: die Route
``routes/wms.py:wms_overview`` verwirft den ``AccessContext`` bewusst
(``_ = context``) und liefert allen authentifizierten Nutzern dieselben Daten.
Es gibt also keine rollenabhaengigen Inhalte, die ein gemeinsamer Cache an die
falsche Rolle ausliefern koennte.

WICHTIG: Sollte /api/wms/overview jemals rollen-/benutzerabhaengig werden,
muss der Cache pro Rolle/Kontext gekeyt werden — dann ist dieser globale
Single-Slot-Cache nicht mehr korrekt.

Single-Flight
-------------
Ein ``threading.Lock`` verhindert den Cache-Stampede: bei kaltem Cache rechnet
nur EIN Request neu, parallele Requests warten auf das Ergebnis statt
gleichzeitig zu rechnen.

Invalidierung
-------------
Ueber ein SQLAlchemy-``after_commit``-Event: JEDE committete
Schreibtransaktion verwirft den Cache. Das deckt automatisch alle Mutationen
ab (Asset/Ausgabe/Ruecknahme/Defekt/Wartung/Standort/Kategorie/Benutzer/
Aktivitaet/Planung sowie Import/Backup), ohne dass einzelne Service-Methoden
dekoriert werden muessen. Der ``get_overview``-Lesepfad committet nicht (nur
SELECTs), invalidiert sich also nicht selbst.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable, TypeVar

from sqlalchemy import event

from ..database.session import SessionLocal

logger = logging.getLogger("cloud_web.overview_cache")

T = TypeVar("T")

_lock = threading.Lock()
# (Wert, Ablaufzeitpunkt als time.monotonic()). None = kein gueltiger Eintrag.
_state: tuple[Any, float] | None = None

# Lebenslange Debug-Zaehler fuer die Cache-Wirksamkeit. Bewusst ohne Lock:
# eine seltene Off-by-one-Ungenauigkeit unter starker Nebenlaeufigkeit ist
# fuer reine Debug-Zaehler unkritisch, ein zweites Lock waere unnoetiger
# Overhead auf dem Hot Path.
_hits = 0
_misses = 0


def stats() -> dict[str, float]:
    """Momentaufnahme der Cache-Wirksamkeit (hits, misses, hit_rate in %).

    Bewusst NICHT an einen HTTP-Endpoint gehaengt — nur eine Debug-Hilfe
    (z. B. aus einer Python-Shell oder einem Test), damit dieses
    Stabilitaets-Paket keine neue oeffentliche API-Flaeche schafft.
    """
    total = _hits + _misses
    return {
        "hits": float(_hits),
        "misses": float(_misses),
        "hit_rate": (_hits / total * 100.0) if total else 0.0,
    }


def _record_access(hit: bool) -> None:
    """Zaehlt einen Cache-Zugriff und loggt ihn auf DEBUG-Level.

    DEBUG ist im Normalbetrieb (Root-Logger INFO) unsichtbar — kein
    Log-Fluten. Zum Debuggen gezielt den Logger ``cloud_web.overview_cache``
    auf DEBUG heben; die laufende Hit-Rate steht dann in jeder Zeile.
    """
    global _hits, _misses
    if hit:
        _hits += 1
    else:
        _misses += 1
    if logger.isEnabledFor(logging.DEBUG):
        total = _hits + _misses
        hit_rate = (_hits / total * 100.0) if total else 0.0
        logger.debug(
            "overview cache %s (hits=%d misses=%d hit_rate=%.0f%%)",
            "HIT" if hit else "MISS",
            _hits,
            _misses,
            hit_rate,
        )


def get_or_build(builder: Callable[[], T], ttl_seconds: float) -> T:
    """Liefert den gecachten Wert oder berechnet ihn via ``builder``.

    ``ttl_seconds <= 0`` deaktiviert den Cache vollstaendig (jeder Aufruf
    rechnet neu) — so laesst sich der Cache per Konfiguration abschalten.
    """
    global _state

    if ttl_seconds <= 0:
        return builder()

    # Schneller Pfad ohne Lock: ein gueltiger Eintrag bedient den Request
    # direkt. Das Lesen einer Modulreferenz ist unter dem GIL atomar.
    state = _state
    if state is not None and time.monotonic() < state[1]:
        _record_access(hit=True)
        return state[0]

    with _lock:
        # Double-Checked Locking: waehrend wir auf das Lock gewartet haben,
        # kann ein paralleler Request den Cache bereits gefuellt haben.
        state = _state
        if state is not None and time.monotonic() < state[1]:
            _record_access(hit=True)
            return state[0]
        _record_access(hit=False)
        value = builder()
        _state = (value, time.monotonic() + ttl_seconds)
        return value


def invalidate() -> None:
    """Verwirft den Cache — der naechste Aufruf von ``get_or_build`` rechnet neu."""
    global _state
    _state = None


@event.listens_for(SessionLocal, "after_commit")
def _invalidate_on_commit(_session: Any) -> None:
    """Verwirft den Overview-Cache nach JEDER committeten Schreibtransaktion.

    Damit ist die Invalidierung vollstaendig und wartungsfrei — jede Mutation
    verwirft den Cache automatisch, ein direkt folgender Reload zeigt den
    frischen Stand.

    Bewusste, harmlose Ueber-Invalidierung: auch Commits ohne Overview-Bezug
    (z. B. Login committet ``users.token_version``) verwerfen den Cache. Das
    kostet hoechstens eine Neuberechnung pro TTL-Fenster und liefert nie
    veraltete Daten.
    """
    invalidate()
