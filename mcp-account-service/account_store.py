"""Account domain layer.

In-memory store for demo purposes. Accounts are keyed by the OIDC `sub`
claim and provisioned just-in-time on first authenticated access, so the
IdP remains the single source of identity truth. Swap this module for a
real database in production; the tool layer in server.py only talks to
AccountStore's public methods.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class Account:
    id: str  # OIDC `sub` claim
    display_name: str
    email: str | None = None
    active: bool = True
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class AccountStore:
    def __init__(self) -> None:
        self._accounts: dict[str, Account] = {}

    def get_or_provision(self, claims: dict[str, Any]) -> Account:
        """Fetch the caller's account, creating it from token claims if new."""
        sub = str(claims["sub"])
        account = self._accounts.get(sub)
        if account is None:
            account = Account(
                id=sub,
                display_name=str(claims.get("name") or claims.get("preferred_username") or sub),
                email=claims.get("email"),
            )
            self._accounts[sub] = account
        return account

    def get(self, account_id: str) -> Account | None:
        return self._accounts.get(account_id)

    def update_profile(
        self, account_id: str, display_name: str | None, email: str | None
    ) -> Account:
        account = self._accounts[account_id]
        if display_name is not None:
            account.display_name = display_name
        if email is not None:
            account.email = email
        account.updated_at = _now()
        return account

    def list_all(self) -> list[Account]:
        return list(self._accounts.values())

    def set_active(self, account_id: str, active: bool) -> Account:
        account = self._accounts[account_id]
        account.active = active
        account.updated_at = _now()
        return account
