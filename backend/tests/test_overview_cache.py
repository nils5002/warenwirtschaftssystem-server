"""Unit-Tests fuer den kurzlebigen Overview-Cache (services/overview_cache.py).

Testet die Cache-Bausteine direkt mit einem zaehlenden Builder — unabhaengig
von der App und vom in der Test-Suite deaktivierten TTL (conftest.py setzt
OVERVIEW_CACHE_TTL_SECONDS=0).
"""
from __future__ import annotations

import threading
import time

from sqlalchemy import text

from app.database.session import SessionLocal
from app.services import overview_cache


def setup_function() -> None:
    # Jeder Test startet mit leerem Cache.
    overview_cache.invalidate()


def _counting_builder():
    """Liefert (calls, builder): builder zaehlt seine Aufrufe in calls[0]."""
    calls = [0]

    def builder() -> int:
        calls[0] += 1
        return calls[0]

    return calls, builder


def test_cache_hit_within_ttl_builds_once() -> None:
    calls, builder = _counting_builder()

    first = overview_cache.get_or_build(builder, ttl_seconds=60)
    second = overview_cache.get_or_build(builder, ttl_seconds=60)

    assert first == 1
    assert second == 1  # zweiter Aufruf kam aus dem Cache
    assert calls[0] == 1


def test_invalidate_forces_rebuild() -> None:
    calls, builder = _counting_builder()

    assert overview_cache.get_or_build(builder, ttl_seconds=60) == 1
    overview_cache.invalidate()
    assert overview_cache.get_or_build(builder, ttl_seconds=60) == 2
    assert calls[0] == 2


def test_ttl_zero_disables_cache() -> None:
    calls, builder = _counting_builder()

    overview_cache.get_or_build(builder, ttl_seconds=0)
    overview_cache.get_or_build(builder, ttl_seconds=0)

    assert calls[0] == 2  # kein Caching bei TTL <= 0


def test_expired_ttl_rebuilds() -> None:
    calls, builder = _counting_builder()

    assert overview_cache.get_or_build(builder, ttl_seconds=0.05) == 1
    time.sleep(0.09)
    assert overview_cache.get_or_build(builder, ttl_seconds=0.05) == 2
    assert calls[0] == 2


def test_single_flight_builds_once_under_concurrency() -> None:
    """Bei kaltem Cache rechnet trotz paralleler Zugriffe nur EIN Builder."""
    calls = [0]
    calls_lock = threading.Lock()
    barrier = threading.Barrier(8)

    def builder() -> int:
        with calls_lock:
            calls[0] += 1
        time.sleep(0.1)  # Rechenzeit simulieren, damit sich die Threads stauen
        return calls[0]

    results: list[int] = []
    results_lock = threading.Lock()

    def worker() -> None:
        barrier.wait()
        value = overview_cache.get_or_build(builder, ttl_seconds=60)
        with results_lock:
            results.append(value)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert calls[0] == 1  # Single-Flight: nur eine Berechnung
    assert results == [1] * 8  # alle Threads erhielten dasselbe Ergebnis


def test_after_commit_event_invalidates_cache() -> None:
    """Ein DB-Commit feuert das after_commit-Event und verwirft den Cache.

    Sichert die SQLAlchemy-Event-Verdrahtung ab: nach JEDER committeten
    Transaktion muss der naechste get_or_build-Aufruf neu rechnen.
    """
    calls, builder = _counting_builder()

    assert overview_cache.get_or_build(builder, ttl_seconds=60) == 1
    assert overview_cache.get_or_build(builder, ttl_seconds=60) == 1  # Cache-Hit

    with SessionLocal() as db:
        db.execute(text("SELECT 1"))
        db.commit()  # feuert after_commit -> overview_cache.invalidate()

    assert overview_cache.get_or_build(builder, ttl_seconds=60) == 2  # neu gebaut
    assert calls[0] == 2
