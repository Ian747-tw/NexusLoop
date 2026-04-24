"""
nxl_core.policy.tokens
----------------------
CapabilityToken mint/consume/expire machinery.

mint(scope, ttl_seconds, postcondition) → CapabilityToken
consume(token, ctx) → bool (True if postcondition passes and token not yet used)
expire(token) → bool (True if TTL exceeded and token not yet used)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from pydantic import BaseModel, Field


class CapabilityToken(BaseModel):
    """A capability token with TTL and optional postcondition."""
    token_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:16])
    scope: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    ttl_seconds: float
    used: bool = False
    expired: bool = False
    postcondition: Callable[[dict[str, Any]], bool] | None = None

    def is_expired(self) -> bool:
        if self.expired:
            return True
        elapsed = (datetime.now(timezone.utc) - self.created_at).total_seconds()
        return elapsed > self.ttl_seconds


def mint(
    scope: str,
    ttl_seconds: float,
    postcondition: Callable[[dict[str, Any]], bool] | None = None,
) -> CapabilityToken:
    """Create a new capability token."""
    return CapabilityToken(
        scope=scope,
        ttl_seconds=ttl_seconds,
        postcondition=postcondition,
    )


def consume(token: CapabilityToken, ctx: dict[str, Any]) -> bool:
    """Validate postcondition and mark token as used. Returns True if successful."""
    if token.used:
        return False
    if token.is_expired():
        return False
    if token.postcondition is not None and not token.postcondition(ctx):
        return False
    token.used = True
    return True


def expire(token: CapabilityToken) -> bool:
    """Mark token as expired if TTL exceeded. Returns True if now expired."""
    if token.used:
        return False
    if token.is_expired():
        token.expired = True
        return True
    return False
