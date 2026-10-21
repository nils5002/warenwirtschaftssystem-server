"""Software-Authenticator fuer Tests (WebAuthn Level 2, P-256, Attestation "none").

Erzeugt echte, kryptografisch gueltige Registrierungs- und Anmeldeantworten,
damit die Server-Pruefung durch py_webauthn ohne Mocks getestet wird. Nur fuer
Tests — kein Produktionscode.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

FLAG_UP = 0x01
FLAG_UV = 0x04
FLAG_AT = 0x40


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class SoftAuthenticator:
    def __init__(self, rp_id: str, origin: str):
        self.rp_id = rp_id
        self.origin = origin
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = os.urandom(32)
        self.sign_count = 0

    def _client_data(self, kind: str, challenge: str, origin: str | None = None) -> bytes:
        return json.dumps(
            {"type": kind, "challenge": challenge, "origin": origin or self.origin, "crossOrigin": False},
            separators=(",", ":"),
        ).encode("utf-8")

    def _cose_key(self) -> bytes:
        numbers = self.key.public_key().public_numbers()
        return cbor2.dumps({
            1: 2,  # kty: EC2
            3: -7,  # alg: ES256
            -1: 1,  # crv: P-256
            -2: numbers.x.to_bytes(32, "big"),
            -3: numbers.y.to_bytes(32, "big"),
        })

    def register(self, options: dict, *, user_verified: bool = True, origin: str | None = None) -> dict:
        client_data = self._client_data("webauthn.create", options["challenge"], origin)
        flags = FLAG_UP | FLAG_AT | (FLAG_UV if user_verified else 0)
        auth_data = (
            hashlib.sha256(self.rp_id.encode()).digest()
            + bytes([flags])
            + self.sign_count.to_bytes(4, "big")
            + bytes(16)
            + len(self.credential_id).to_bytes(2, "big")
            + self.credential_id
            + self._cose_key()
        )
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        cid = b64url(self.credential_id)
        return {
            "id": cid,
            "rawId": cid,
            "type": "public-key",
            "response": {
                "clientDataJSON": b64url(client_data),
                "attestationObject": b64url(attestation),
                "transports": ["internal"],
            },
            "clientExtensionResults": {},
        }

    def assert_(
        self,
        options: dict,
        *,
        user_verified: bool = True,
        origin: str | None = None,
        tamper: bool = False,
        reuse_counter: bool = False,
    ) -> dict:
        if not reuse_counter:
            self.sign_count += 1
        client_data = self._client_data("webauthn.get", options["challenge"], origin)
        flags = FLAG_UP | (FLAG_UV if user_verified else 0)
        auth_data = (
            hashlib.sha256(self.rp_id.encode()).digest()
            + bytes([flags])
            + self.sign_count.to_bytes(4, "big")
        )
        signature = self.key.sign(auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256()))
        if tamper:
            signature = signature[:-1] + bytes([signature[-1] ^ 0x01])
        cid = b64url(self.credential_id)
        return {
            "id": cid,
            "rawId": cid,
            "type": "public-key",
            "response": {
                "clientDataJSON": b64url(client_data),
                "authenticatorData": b64url(auth_data),
                "signature": b64url(signature),
            },
            "clientExtensionResults": {},
        }
