"""tests/unit/core/test_init_skip_onboarding.py — skip-onboarding correctness."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest


class TestSkipOnboardingFlow:
    """Verify --skip-onboarding actually skips OnboardingFlow.run()."""

    def test_skip_onboarding_does_not_invoke_onboarding_flow(
        self, tmp_path: Path
    ) -> None:
        with patch("nxl.core.init.OnboardingFlow") as mock_flow_class:
            mock_instance = MagicMock()
            mock_flow_class.return_value = mock_instance

            from nxl.core import init as init_mod
            import importlib
            importlib.reload(init_mod)

            init_mod.run(project_dir=tmp_path, auto=True, skip_onboarding=True)

            mock_instance.run.assert_not_called()

    def test_skip_onboarding_writes_nxl_config_dir(
        self, tmp_path: Path
    ) -> None:
        """Init creates .nxl/ config directory with state.json."""
        from nxl.core import init as init_mod
        import importlib
        importlib.reload(init_mod)

        result = init_mod.run(project_dir=tmp_path, auto=True, skip_onboarding=True)

        assert result == 0
        assert (tmp_path / ".nxl").is_dir()
        assert (tmp_path / ".nxl" / "state.json").exists()

    def test_skip_onboarding_writes_policy_yaml(
        self, tmp_path: Path
    ) -> None:
        """Init creates policy.yaml in .nxl/."""
        from nxl.core import init as init_mod
        import importlib
        importlib.reload(init_mod)

        result = init_mod.run(project_dir=tmp_path, auto=True, skip_onboarding=True)

        assert result == 0
        assert (tmp_path / ".nxl" / "policy.yaml").exists()

    def test_skip_onboarding_writes_logs_dir(
        self, tmp_path: Path
    ) -> None:
        """Init creates logs/ with experiment_registry.tsv."""
        from nxl.core import init as init_mod
        import importlib
        importlib.reload(init_mod)

        result = init_mod.run(project_dir=tmp_path, auto=True, skip_onboarding=True)

        assert result == 0
        assert (tmp_path / "logs").is_dir()
        assert (tmp_path / "logs" / "experiment_registry.tsv").exists()
