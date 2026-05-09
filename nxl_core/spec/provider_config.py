"""Global provider configuration and credential resolution."""
from __future__ import annotations

import os
import stat
import tempfile
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field

from nxl_core.events.log import EventLog
from nxl_core.events.schema import GlobalProviderConfigured


class SecretBackend(Protocol):
    def store(self, ref: str, secret: str) -> None: ...
    def resolve(self, ref: str) -> str | None: ...


class FakeSecretBackend:
    """In-process secure-storage stand-in for tests and first-run dry flows."""

    def __init__(self) -> None:
        self._secrets: dict[str, str] = {}

    def store(self, ref: str, secret: str) -> None:
        self._secrets[ref] = secret

    def resolve(self, ref: str) -> str | None:
        return self._secrets.get(ref)


class KeyringSecretBackend:
    def __init__(self) -> None:
        import keyring  # type: ignore

        self._keyring = keyring

    def store(self, ref: str, secret: str) -> None:
        self._keyring.set_password("nexusloop", ref, secret)

    def resolve(self, ref: str) -> str | None:
        return self._keyring.get_password("nexusloop", ref)


class ProviderConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = ""
    model: str = ""
    credential_source: str = "secure_store"
    api_key_ref: str | None = None
    env_var: str | None = None
    local_endpoint: str | None = None


class GlobalConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: ProviderConfig = Field(default_factory=ProviderConfig)


def _global_config_path() -> Path:
    root = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return root / "nexusloop" / "config.toml"


def _write_strict(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".config.", text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
        os.replace(tmp, path)
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _toml_quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


class ProviderConfigStore:
    def __init__(
        self,
        *,
        config_path: Path | None = None,
        event_log: EventLog | None = None,
        secret_backend: SecretBackend | None = None,
    ) -> None:
        self.config_path = config_path or _global_config_path()
        self.event_log = event_log
        self.secret_backend = secret_backend or self._best_secret_backend()

    def loadGlobalConfig(self) -> ProviderConfig:
        if not self.config_path.exists():
            return ProviderConfig()
        import tomllib

        data = tomllib.loads(self.config_path.read_text(encoding="utf-8"))
        return ProviderConfig.model_validate(data.get("provider", {}))

    def saveProviderConfig(
        self,
        *,
        provider: str,
        model: str,
        credential_source: str = "secure_store",
        env_var: str | None = None,
        local_endpoint: str | None = None,
    ) -> ProviderConfig:
        api_key_ref = f"nexusloop:provider:{provider}" if credential_source == "secure_store" else None
        config = ProviderConfig(
            provider=provider,
            model=model,
            credential_source=credential_source,
            api_key_ref=api_key_ref,
            env_var=env_var,
            local_endpoint=local_endpoint,
        )
        self._write_config(config)
        if self.event_log is not None:
            self.event_log.append(
                GlobalProviderConfigured(
                    provider=provider,
                    model=model,
                    credential_source=credential_source,
                    has_secret=credential_source in {"secure_store", "env"},
                )
            )
        return config

    def storeSecret(self, provider: str, secret: str) -> str:
        if not secret.strip():
            raise ValueError("secret cannot be empty")
        ref = f"nexusloop:provider:{provider}"
        self.secret_backend.store(ref, secret)
        config = self.loadGlobalConfig()
        if config.provider == provider and config.credential_source == "secure_store":
            self._write_config(config.model_copy(update={"api_key_ref": ref}))
        return ref

    def resolveCredentials(self, provider: str | None = None) -> str | None:
        config = self.loadGlobalConfig()
        if provider is not None and config.provider and provider != config.provider:
            return None
        if config.credential_source == "env":
            return os.environ.get(config.env_var or "")
        if config.credential_source == "secure_store" and config.api_key_ref:
            return self.secret_backend.resolve(config.api_key_ref)
        return None

    def _write_config(self, config: ProviderConfig) -> None:
        lines = ["[provider]"]
        for key, value in config.model_dump().items():
            if value is None:
                continue
            lines.append(f"{key} = {_toml_quote(value) if isinstance(value, str) else str(value).lower()}")
        _write_strict(self.config_path, "\n".join(lines) + "\n")

    def _best_secret_backend(self) -> SecretBackend:
        try:
            return KeyringSecretBackend()
        except Exception:
            return FakeSecretBackend()
