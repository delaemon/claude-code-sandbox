"""Minimal OIDC provider for LOCAL DEVELOPMENT ONLY.

Stands in for a real IdP (Keycloak / Auth0 / Entra ID / Okta) so the MCP
server can be exercised end-to-end without external infrastructure. It
serves OIDC discovery + JWKS and hands out RS256-signed access tokens to
anyone who asks — there is no client authentication, no consent, no user
database. Never deploy this.

Endpoints:
  GET  /.well-known/openid-configuration
  GET  /jwks.json
  POST /token   form fields: scope, sub, name, email, audience (all optional)

Run:  python dev_idp.py   (http://localhost:9400)
"""

from __future__ import annotations

import json
import time
import uuid

import jwt
import uvicorn
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

ISSUER = "http://localhost:9400"
DEFAULT_AUDIENCE = "http://localhost:9300/mcp"
KID = "dev-key-1"
TOKEN_TTL_SECONDS = 3600

_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_public_jwk = json.loads(RSAAlgorithm.to_jwk(_private_key.public_key()))
_public_jwk.update({"kid": KID, "use": "sig", "alg": "RS256"})


async def openid_configuration(_: Request) -> JSONResponse:
    return JSONResponse(
        {
            "issuer": ISSUER,
            "jwks_uri": f"{ISSUER}/jwks.json",
            "token_endpoint": f"{ISSUER}/token",
            "authorization_endpoint": f"{ISSUER}/authorize",  # not implemented
            "response_types_supported": ["code"],
            "grant_types_supported": ["client_credentials"],
            "id_token_signing_alg_values_supported": ["RS256"],
            "code_challenge_methods_supported": ["S256"],
        }
    )


async def jwks(_: Request) -> JSONResponse:
    return JSONResponse({"keys": [_public_jwk]})


async def token(request: Request) -> JSONResponse:
    form = await request.form()
    sub = str(form.get("sub") or "dev-user")
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "sub": sub,
        "aud": str(form.get("audience") or DEFAULT_AUDIENCE),
        "iat": now,
        "exp": now + TOKEN_TTL_SECONDS,
        "jti": str(uuid.uuid4()),
        "client_id": str(form.get("client_id") or "dev-client"),
        "scope": str(form.get("scope") or "account:read account:write"),
    }
    if form.get("name"):
        claims["name"] = str(form["name"])
    if form.get("email"):
        claims["email"] = str(form["email"])

    access_token = jwt.encode(
        claims, _private_key, algorithm="RS256", headers={"kid": KID}
    )
    return JSONResponse(
        {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": TOKEN_TTL_SECONDS,
            "scope": claims["scope"],
        }
    )


app = Starlette(
    routes=[
        Route("/.well-known/openid-configuration", openid_configuration),
        Route("/jwks.json", jwks),
        Route("/token", token, methods=["POST"]),
    ]
)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=9400, log_level="warning")
