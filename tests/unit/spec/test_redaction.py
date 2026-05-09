from __future__ import annotations

import json

from nxl_core.security.redaction import redact


def test_redaction_removes_api_keys_from_nested_payloads() -> None:
    payload = {
        "message": "use sk-test-SECRET123 for openai",
        "nested": ["Bearer abc.def.ghi", {"api_key": "sk-live-SECRET456"}],
    }

    redacted = redact(payload)
    encoded = json.dumps(redacted)

    assert "sk-test-SECRET123" not in encoded
    assert "sk-live-SECRET456" not in encoded
    assert "Bearer abc.def.ghi" not in encoded
    assert "[REDACTED]" in encoded
