"""Tests for ServerProcess lifecycle management."""
import pytest
import tempfile
import os
from agentcore.client_py.process import ServerProcess


def test_server_process_can_be_instantiated():
    p = ServerProcess('/nonexistent/path')
    assert p._proc is None


def test_health_check_fails_when_not_started():
    p = ServerProcess('/bin/true')
    assert p.health_check() is False


def test_shutdown_is_noop_when_not_started():
    p = ServerProcess('/bin/true')
    p.shutdown()  # should not raise