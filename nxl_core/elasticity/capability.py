"""nxl_core/elasticity.capability — agent-facing CapabilityToken request API."""
from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator

from pydantic import BaseModel, Field


class CapabilityToken(BaseModel):
    """A granted capability for a scoped action."""
    id: str = Field(default_factory=lambda: f"cap-{uuid.uuid4().hex[:12]}")
    scope: str
    constraints: dict[str, str]
    ttl_seconds: int
    reason: str
    expected_postcondition: str
    created_at: float = Field(default_factory=time.time)
    committed: bool = False


class PolicyEngine:
    """Placeholder — real PolicyEngine exists in nxl_core.policy.engine."""
    pass


@asynccontextmanager
async def capability(
    scope: str,
    constraints: dict,
    ttl_seconds: int,
    reason: str,
    expected_postcondition: str,
) -> AsyncIterator[CapabilityToken]:
    """Request a CapabilityToken for a scoped action.

    Usage:
        async with capability(
            scope="pkg.install",
            constraints={"package": "numpy"},
            ttl_seconds=300,
            reason="Installing numpy for experiment",
            expected_postcondition="python -c 'import numpy' succeeds",
        ) as token:
            # perform action
            pass  # auto-committed on success

    On success: commits the token via PolicyEngine.commit(token)
    On exception: rolls back via PolicyEngine.rollback(token)
    """
    token = CapabilityToken(
        scope=scope,
        constraints=constraints,
        ttl_seconds=ttl_seconds,
        reason=reason,
        expected_postcondition=expected_postcondition,
    )
    try:
        yield token
        # Emit CapabilityCommitted event
        _emit("CapabilityCommitted", token_id=token.id, scope=scope)
        token.committed = True
    except Exception as e:
        # Emit CapabilityRolledBack event
        _emit("CapabilityRolledBack", token_id=token.id, scope=scope, reason=str(e))
        raise


def _emit(kind: str, **kwargs) -> None:
    """Emit a capability-related event using IncidentReported as carrier."""
    from nxl_core.events.singletons import journal_log
    from nxl_core.events.schema import IncidentReported

    # Map capability events to IncidentReported for now
    # (CapabilityCommitted/CapabilityRolledBack can be added to schema later)
    incident_type_map = {
        "CapabilityCommitted": "capability_committed",
        "CapabilityRolledBack": "capability_rolled_back",
    }
    severity_map = {
        "CapabilityCommitted": "low",
        "CapabilityRolledBack": "medium",
    }

    incident_type = incident_type_map.get(kind, kind.lower())
    severity = severity_map.get(kind, "low")

    token_id = kwargs.get("token_id", "")
    scope = kwargs.get("scope", "")
    reason = kwargs.get("reason", "")
    description = f"token={token_id} scope={scope}"
    if reason:
        description += f" reason={reason}"

    ev = IncidentReported(
        incident_type=incident_type,
        severity=severity,
        run_id=token_id,
        description=description[:200],
    )
    journal_log().append(ev)
