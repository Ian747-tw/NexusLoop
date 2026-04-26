"""tests/integration/conftest.py — Integration test configuration."""
from __future__ import annotations

import os

os.environ["NXL_EVENTLOG_WRITER"] = "test"
