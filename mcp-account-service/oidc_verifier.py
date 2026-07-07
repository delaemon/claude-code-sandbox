"""OIDC/OAuth2 access-token verification for the MCP server.

Implements the MCP authorization spec's resource-server role: the MCP server
never issues tokens itself. It validates Bearer JWTs issued by an external
OpenID Provider (Keycloak, Auth0, Entra ID, ...), located via OIDC discovery
(`/.well-known/openid-configuration`) with signing keys fetched from the
provider's JWKS endpoint.

Checks performed on every token:
  - signature (against a JWKS key matching the token's `kid`)
  - `iss` equals the configured issuer
  - `aud` contains the configured audience (token was minted for THIS server)
  - `exp` / `nbf` (30s clock leeway)

Scopes are read from `scope` (space-separated, standard) or `scp`
(list form used by Microsoft Entra ID).
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import jwt
from mcp.server.auth.provider import AccessToken, TokenVerifier

_JWKS_MIN_REFRESH_SECONDS = 60.0


class OIDCTokenVerifier(TokenVerifier):
    def __init__(self, issuer: str, audience: str, algorithms: list[str]) -> None:
        self._issuer = issuer.rstrip("/")
        self._audience = audience
        self._algorithms = algorithms
        self._jwks_uri: str | None = None
        self._keys: dict[str, jwt.PyJWK] = {}
        self._last_jwks_fetch = 0.0

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.InvalidTokenError:
            return None

        key = await self._signing_key(header.get("kid"))
        if key is None:
            return None

        try:
            claims: dict[str, Any] = jwt.decode(
                token,
                key=key,
                algorithms=self._algorithms,
                issuer=self._issuer,
                audience=self._audience,
                leeway=30,
                options={"require": ["exp", "iss", "aud", "sub"]},
            )
        except jwt.InvalidTokenError:
            return None

        return AccessToken(
            token=token,
            client_id=str(
                claims.get("azp") or claims.get("client_id") or claims["sub"]
            ),
            scopes=self._extract_scopes(claims),
            expires_at=claims.get("exp"),
            resource=self._audience,
            subject=str(claims["sub"]),
            claims=claims,
        )

    @staticmethod
    def _extract_scopes(claims: dict[str, Any]) -> list[str]:
        scope = claims.get("scope")
        if isinstance(scope, str):
            return scope.split()
        scp = claims.get("scp")
        if isinstance(scp, list):
            return [str(s) for s in scp]
        if isinstance(scp, str):
            return scp.split()
        return []

    async def _signing_key(self, kid: str | None) -> jwt.PyJWK | None:
        if kid is None:
            return None
        if kid not in self._keys:
            await self._refresh_jwks()
        return self._keys.get(kid)

    async def _refresh_jwks(self) -> None:
        # Rate-limit refreshes so unknown-kid tokens can't hammer the IdP.
        now = time.monotonic()
        if self._keys and now - self._last_jwks_fetch < _JWKS_MIN_REFRESH_SECONDS:
            return
        self._last_jwks_fetch = now

        async with httpx.AsyncClient(timeout=10) as client:
            if self._jwks_uri is None:
                self._jwks_uri = await self._discover_jwks_uri(client)
            resp = await client.get(self._jwks_uri)
            resp.raise_for_status()
            jwks = resp.json()

        keys: dict[str, jwt.PyJWK] = {}
        for entry in jwks.get("keys", []):
            try:
                key = jwt.PyJWK(entry)
            except jwt.PyJWKError:
                continue  # e.g. encryption key or unsupported algorithm
            if key.key_id:
                keys[key.key_id] = key
        self._keys = keys

    async def _discover_jwks_uri(self, client: httpx.AsyncClient) -> str:
        # OIDC discovery first, RFC 8414 OAuth metadata as a fallback.
        for path in (
            "/.well-known/openid-configuration",
            "/.well-known/oauth-authorization-server",
        ):
            resp = await client.get(self._issuer + path)
            if resp.status_code != 200:
                continue
            metadata = resp.json()
            if metadata.get("issuer", "").rstrip("/") != self._issuer:
                raise ValueError(
                    f"issuer mismatch: expected {self._issuer!r}, "
                    f"metadata says {metadata.get('issuer')!r}"
                )
            return metadata["jwks_uri"]
        raise RuntimeError(f"OIDC discovery failed for issuer {self._issuer!r}")
