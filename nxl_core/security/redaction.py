"""Redaction helpers for secrets before state reaches logs, events, or UI."""
from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

SECRET_KEYS = {
    "api_key",
    "apikey",
    "secret",
    "token",
    "password",
    "credential",
    "credentials",
}

SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9][A-Za-z0-9_-]{8,}"),
    re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]{8,}", re.IGNORECASE),
]


def redact_text(value: str) -> str:
    """Replace recognizable secret material in text."""
    result = value
    for pattern in SECRET_PATTERNS:
        result = pattern.sub("[REDACTED]", result)
    return result


def _looks_secret_key(key: Any) -> bool:
    normalized = str(key).lower().replace("-", "_")
    return any(part in normalized for part in SECRET_KEYS)


def redact(value: Any) -> Any:
    """Recursively redact secrets from JSON-like data."""
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, Mapping):
        redacted: dict[Any, Any] = {}
        for key, item in value.items():
            redacted[key] = "[REDACTED]" if _looks_secret_key(key) else redact(item)
        return redacted
    if isinstance(value, tuple):
        return tuple(redact(item) for item in value)
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        return [redact(item) for item in value]
    return value
