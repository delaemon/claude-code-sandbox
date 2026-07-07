"""Environment-based configuration for the MCP account service."""

import os

# --- OIDC / OAuth2 (resource server side) -----------------------------------
# Issuer URL of the OpenID Provider / Authorization Server that signs tokens.
# In production: e.g. https://login.example.com/realms/myrealm (Keycloak),
# https://your-tenant.auth0.com, https://accounts.google.com, etc.
# Default points at the bundled dev IdP (dev_idp.py).
OIDC_ISSUER = os.environ.get("OIDC_ISSUER", "http://localhost:9400")

# The audience this MCP server expects in access tokens (RFC 8707 "resource").
# Tokens whose `aud` claim does not include this value are rejected.
OIDC_AUDIENCE = os.environ.get("OIDC_AUDIENCE", "http://localhost:9300/mcp")

# Signature algorithms accepted for access tokens.
OIDC_ALGORITHMS = os.environ.get("OIDC_ALGORITHMS", "RS256,ES256").split(",")

# --- MCP server --------------------------------------------------------------
MCP_HOST = os.environ.get("MCP_HOST", "127.0.0.1")
MCP_PORT = int(os.environ.get("MCP_PORT", "9300"))

# Public URL of this MCP endpoint, advertised in the
# /.well-known/oauth-protected-resource metadata (RFC 9728).
MCP_SERVER_URL = os.environ.get("MCP_SERVER_URL", f"http://{MCP_HOST}:{MCP_PORT}/mcp")

# Scope every caller must have just to talk to the server at all.
# Finer-grained scopes (account:write / account:admin) are enforced per tool.
MCP_REQUIRED_SCOPES = os.environ.get("MCP_REQUIRED_SCOPES", "account:read").split(",")
