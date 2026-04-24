"""agentcore/tests/e2e_synthetic_violation.py — verify tripwire halts cleanly."""
import subprocess


def test_synthetic_rule_violation():
    """Inject NON_NEGOTIABLE-violating action mid-cycle; verify halts."""
    result = subprocess.run(
        ['nxl', 'run', '--once', '--provider', 'anthropic', '--inject-violation'],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode != 0  # should halt
    assert 'TripwireFired' in result.stdout or 'TripwireFired' in result.stderr