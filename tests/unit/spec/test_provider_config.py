from __future__ import annotations

import json
import os
import stat
from pathlib import Path

import pytest

from nxl_core.events.log import EventLog
from nxl_core.spec import provider_config
from nxl_core.spec.provider_config import FakeSecretBackend, ProviderConfigStore


os.environ["NXL_EVENTLOG_WRITER"] = "test"


def test_provider_config_persists_without_secret_and_resolves_fake_storage(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config-home"))
    secret_backend = FakeSecretBackend()
    events = EventLog(tmp_path / "events.jsonl")
    store = ProviderConfigStore(event_log=events, secret_backend=secret_backend)

    store.saveProviderConfig(provider="openai", model="gpt-test", credential_source="secure_store")
    store.storeSecret("openai", "sk-test-SECRET123")

    config = store.loadGlobalConfig()
    assert config.provider == "openai"
    assert config.model == "gpt-test"
    assert config.api_key_ref == "nexusloop:provider:openai"
    assert "sk-test-SECRET123" not in store.config_path.read_text()
    assert stat.S_IMODE(store.config_path.stat().st_mode) == 0o600

    assert store.resolveCredentials("openai") == "sk-test-SECRET123"
    assert "sk-test-SECRET123" not in (tmp_path / "events.jsonl").read_text()
    assert json.loads((tmp_path / "events.jsonl").read_text().splitlines()[-1])["kind"] == "global_provider_configured"


def test_provider_config_can_resolve_user_chosen_env_var(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config-home"))
    monkeypatch.setenv("NXL_TEST_API_KEY", "sk-test-env-secret")
    store = ProviderConfigStore(secret_backend=FakeSecretBackend())

    store.saveProviderConfig(
        provider="openai",
        model="gpt-test",
        credential_source="env",
        env_var="NXL_TEST_API_KEY",
    )

    assert store.resolveCredentials("openai") == "sk-test-env-secret"
    assert "sk-test-env-secret" not in store.config_path.read_text()


def test_provider_config_does_not_default_to_fake_secret_backend(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config-home"))

    class MissingKeyring:
        def __init__(self) -> None:
            raise RuntimeError("no keyring")

    monkeypatch.setattr(provider_config, "KeyringSecretBackend", MissingKeyring)
    store = ProviderConfigStore()

    with pytest.raises(RuntimeError, match="OS keyring is not available"):
        store.saveProviderConfig(provider="openai", model="gpt-test", credential_source="secure_store")

    assert not store.config_path.exists()
