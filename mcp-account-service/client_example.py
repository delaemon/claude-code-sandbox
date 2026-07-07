"""End-to-end demo client for the OIDC-protected MCP account service.

Walks the same flow a real MCP client (Claude Code, an IDE, another agent)
performs:

  1. Hit the MCP endpoint without a token  -> 401 + WWW-Authenticate
  2. Fetch /.well-known/oauth-protected-resource (RFC 9728) to learn
     which authorization server protects this resource
  3. Obtain an access token from that authorization server
     (here: the dev IdP's client_credentials-style /token endpoint;
     a real client would run the Authorization Code + PKCE flow)
  4. Open an MCP session with `Authorization: Bearer <token>` and call tools
  5. Show that scope enforcement rejects tools the token isn't allowed to use

Prerequisites: dev_idp.py running on :9400 and server.py on :9300.
"""

from __future__ import annotations

import asyncio

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

MCP_URL = "http://127.0.0.1:9300/mcp"


async def call(session: ClientSession, name: str, args: dict | None = None) -> None:
    result = await session.call_tool(name, args or {})
    text = result.content[0].text if result.content else "(no content)"
    print(f"  {name}: {'ERROR ' if result.isError else ''}{text}")


async def run_session(token: str, label: str, tools: list[tuple[str, dict]]) -> None:
    print(f"\n--- MCP session: {label} ---")
    headers = {"Authorization": f"Bearer {token}"}
    async with streamablehttp_client(MCP_URL, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            listed = await session.list_tools()
            print(f"  tools available: {[t.name for t in listed.tools]}")
            for name, args in tools:
                await call(session, name, args)


async def main() -> None:
    async with httpx.AsyncClient() as http:
        # 1. Unauthenticated request is rejected with a pointer to metadata.
        resp = await http.post(
            MCP_URL,
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
            headers={"Accept": "application/json, text/event-stream"},
        )
        print(f"no token -> HTTP {resp.status_code}")
        print(f"  WWW-Authenticate: {resp.headers.get('www-authenticate')}")

        # 2. Protected-resource metadata names the authorization server.
        resp = await http.get(
            "http://127.0.0.1:9300/.well-known/oauth-protected-resource/mcp"
        )
        metadata = resp.json()
        print(f"protected resource metadata: {metadata}")
        auth_server = metadata["authorization_servers"][0].rstrip("/")

        # 3. Get tokens from the advertised authorization server (dev IdP).
        async def get_token(**fields: str) -> str:
            r = await http.post(f"{auth_server}/token", data=fields)
            r.raise_for_status()
            return r.json()["access_token"]

        user_token = await get_token(
            sub="alice",
            name="Alice Example",
            email="alice@example.com",
            scope="account:read account:write",
        )
        admin_token = await get_token(
            sub="root", scope="account:read account:admin"
        )

    # 4-5. Authenticated MCP sessions with per-tool scope enforcement.
    await run_session(
        user_token,
        "alice (account:read account:write)",
        [
            ("whoami", {}),
            ("get_my_account", {}),
            ("update_my_profile", {"display_name": "Alice E."}),
            ("list_accounts", {}),  # should fail: needs account:admin
        ],
    )
    await run_session(
        admin_token,
        "root (account:read account:admin)",
        [
            ("list_accounts", {}),
            ("set_account_active", {"account_id": "alice", "active": False}),
            ("update_my_profile", {"display_name": "x"}),  # fail: needs account:write
        ],
    )


if __name__ == "__main__":
    asyncio.run(main())
