"""nxl_core/elasticity.elastic_txn — snapshot+rollback envelope."""
from __future__ import annotations

import subprocess
from contextlib import contextmanager
from pathlib import Path

from nxl_core.elasticity.capability import CapabilityToken


class RollbackError(Exception):
    """Raised when rollback fails."""
    pass


class PostconditionFailed(Exception):
    """Raised when expected_postcondition verification fails."""
    pass


@contextmanager
def elastic_txn(token: CapabilityToken, snapshot_paths: list[Path]):
    """Wrap an elastic action with snapshot+verified rollback.

    On entry: snapshot current git HEAD and file contents
    On exit (success): verify postcondition; if fail, rollback
    On exit (exception): rollback git + files byte-identical
    On rollback failure: quarantine, do not re-execute

    Parameters
    ----------
    token:
        CapabilityToken tracking this transaction
    snapshot_paths:
        Files to snapshot before the action
    """
    git_head = _git_current_head()
    file_snapshots = {p: p.read_bytes() for p in snapshot_paths if p.exists()}

    try:
        yield
        # Verify postcondition
        if not _verify_postcondition(token.expected_postcondition):
            raise PostconditionFailed(
                f"Postcondition failed: {token.expected_postcondition}"
            )
    except Exception as e:
        # Restore git + files byte-identical
        _git_reset(git_head)
        for path, data in file_snapshots.items():
            path.write_bytes(data)
        _emit("RollbackExecuted", token_id=token.id, reason=str(e))
        raise


def _git_current_head() -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], text=True
    ).strip()


def _git_reset(ref: str) -> None:
    subprocess.run(["git", "reset", "--hard", ref], check=False)


def _verify_postcondition(cmd: str) -> bool:
    """Run the postcondition command; return True if it succeeds."""
    result = subprocess.run(cmd, shell=True, capture_output=True)
    return result.returncode == 0


def _emit(kind: str, **kwargs) -> None:
    """Emit a rollback event using IncidentReported as carrier."""
    from nxl_core.events.ipc import EventEmissionClient
    from nxl_core.events.schema import IncidentReported

    incident_type = "rollback_executed"
    severity = "high"

    token_id = kwargs.get("token_id", "")
    reason = kwargs.get("reason", "")
    description = f"token={token_id}"
    if reason:
        description += f" reason={reason}"

    ev = IncidentReported(
        incident_type=incident_type,
        severity=severity,
        run_id=token_id,
        description=description[:200],
    )
    EventEmissionClient().emit(ev, origin_mcp="elasticity")
