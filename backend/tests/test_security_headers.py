"""Tests fuer die gehaertete Content-Security-Policy (Security-Audit Paket B3).

Abgedeckt:
* CSP-Header ist auf API-Antworten gesetzt.
* 'unsafe-eval' ist entfernt.
* connect-src erlaubt keine Klartext-/WebSocket-Schemata mehr.
* object-src 'none' blockiert Plugins.
* Die uebrigen Security-Header bleiben erhalten.
* /docs wird weiterhin ausgeliefert (CSP bricht die API-Doku nicht).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

from .auth_helpers import auth_headers


def _csp(response) -> str:
    return response.headers.get("content-security-policy", "")


def _directive_tokens(csp: str, name: str) -> list[str]:
    """Liefert die Tokens einer CSP-Direktive, z. B. connect-src -> ['self', ...]."""
    for part in csp.split(";"):
        tokens = part.split()
        if tokens and tokens[0] == name:
            return tokens
    return []


def test_csp_header_present_on_api_response() -> None:
    client = TestClient(app)
    res = client.get("/health")
    assert res.status_code == 200
    csp = _csp(res)
    assert "default-src 'self'" in csp


def test_csp_no_longer_allows_unsafe_eval() -> None:
    client = TestClient(app)
    assert "unsafe-eval" not in _csp(client.get("/health"))


def test_csp_connect_src_has_no_cleartext_or_websocket_schemes() -> None:
    client = TestClient(app)
    tokens = _directive_tokens(_csp(client.get("/health")), "connect-src")
    assert tokens, "connect-src fehlt in der CSP"
    # Exakte Token-Pruefung: 'https:' ist erlaubt, 'http:'/'ws:'/'wss:' nicht.
    assert "http:" not in tokens
    assert "ws:" not in tokens
    assert "wss:" not in tokens


def test_csp_blocks_plugins_via_object_src_none() -> None:
    client = TestClient(app)
    assert "object-src 'none'" in _csp(client.get("/health"))


def test_other_security_headers_still_present() -> None:
    client = TestClient(app)
    res = client.get("/health")
    assert res.headers.get("x-frame-options") == "DENY"
    assert res.headers.get("x-content-type-options") == "nosniff"
    assert res.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    header_names = {name.lower() for name in res.headers.keys()}
    assert "permissions-policy" in header_names


def test_csp_present_on_authenticated_api_response() -> None:
    client = TestClient(app)
    res = client.get("/api/wms/overview", headers=auth_headers(client, "Admin"))
    assert res.status_code == 200
    assert "unsafe-eval" not in _csp(res)
    assert "object-src 'none'" in _csp(res)


def test_api_docs_still_served_with_hardened_csp() -> None:
    client = TestClient(app)
    res = client.get("/docs")
    assert res.status_code == 200
    csp = _csp(res)
    # Inline-Bootstrap der Swagger-UI bleibt erlaubt; eval bleibt verboten.
    assert "'unsafe-inline'" in csp
    assert "unsafe-eval" not in csp
