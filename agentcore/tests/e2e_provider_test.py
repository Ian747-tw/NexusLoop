"""agentcore/tests/e2e_provider_test.py — E2E across 3 providers."""
import pytest

@pytest.mark.parametrize('provider', ['anthropic', 'openai', 'ollama'])
def test_run_once_dry_run(provider):
    """Verify nxl run --once --dry-run works for each provider."""
    import subprocess
    result = subprocess.run(
        ['nxl', 'run', '--once', '--provider', provider, '--dry-run'],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, f'{provider} dry-run failed: {result.stderr}'