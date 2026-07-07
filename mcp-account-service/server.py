"""OIDC/OAuth2-protected MCP server exposing an account service.

Role split per the MCP authorization spec (2025-06-18):
  - This process is the *resource server*: it serves MCP tools over
    streamable HTTP and validates Bearer JWTs on every request.
  - Token issuance is delegated to an external OIDC provider (`OIDC_ISSUER`);
    clients discover it via /.well-known/oauth-protected-resource (RFC 9728),
    which the SDK serves automatically, and via the WWW-Authenticate header
    on 401 responses.

Authorization model:
  - `account:read`  — required for every request (enforced by SDK middleware)
  - `account:write` — update own profile
  - `account:admin` — list / deactivate other accounts

Run:  python server.py   (defaults: http://127.0.0.1:9300/mcp, dev IdP on :9400)
"""

from __future__ import annotations

from typing import Any

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken
from mcp.server.auth.settings import AuthSettings
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError

import config
from account_store import AccountStore
from oidc_verifier import OIDCTokenVerifier

store = AccountStore()

mcp = FastMCP(
    "account-service",
    instructions=(
        "Account service. Authenticate with an OAuth2 access token issued by "
        f"{config.OIDC_ISSUER}. Scopes: account:read (base), account:write "
        "(profile updates), account:admin (administration)."
    ),
    host=config.MCP_HOST,
    port=config.MCP_PORT,
    token_verifier=OIDCTokenVerifier(
        issuer=config.OIDC_ISSUER,
        audience=config.OIDC_AUDIENCE,
        algorithms=config.OIDC_ALGORITHMS,
    ),
    auth=AuthSettings(
        issuer_url=config.OIDC_ISSUER,
        resource_server_url=config.MCP_SERVER_URL,
        required_scopes=config.MCP_REQUIRED_SCOPES,
    ),
)


def _require(scope: str) -> AccessToken:
    """Return the caller's token, failing the tool call if `scope` is missing."""
    token = get_access_token()
    if token is None:  # unreachable behind RequireAuthMiddleware; kept as a guard
        raise ToolError("not authenticated")
    if scope not in token.scopes:
        raise ToolError(f"insufficient_scope: this tool requires '{scope}'")
    return token


@mcp.tool()
def whoami() -> dict[str, Any]:
    """Show the authenticated caller's identity and granted scopes."""
    token = _require("account:read")
    claims = token.claims or {}
    return {
        "subject": token.subject,
        "client_id": token.client_id,
        "scopes": token.scopes,
        "issuer": claims.get("iss"),
        "expires_at": token.expires_at,
    }


@mcp.tool()
def get_my_account() -> dict[str, Any]:
    """Get the caller's account, provisioning it from the ID token claims on first use."""
    token = _require("account:read")
    return store.get_or_provision(token.claims or {"sub": token.subject}).to_dict()


@mcp.tool()
def update_my_profile(
    display_name: str | None = None, email: str | None = None
) -> dict[str, Any]:
    """Update the caller's own display name and/or email. Requires account:write."""
    token = _require("account:write")
    account = store.get_or_provision(token.claims or {"sub": token.subject})
    return store.update_profile(account.id, display_name, email).to_dict()


@mcp.tool()
def list_accounts() -> list[dict[str, Any]]:
    """List all accounts. Requires account:admin."""
    _require("account:admin")
    return [a.to_dict() for a in store.list_all()]


@mcp.tool()
def set_account_active(account_id: str, active: bool) -> dict[str, Any]:
    """Activate or deactivate an account by id. Requires account:admin."""
    _require("account:admin")
    if store.get(account_id) is None:
        raise ToolError(f"unknown account: {account_id}")
    return store.set_active(account_id, active).to_dict()


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
