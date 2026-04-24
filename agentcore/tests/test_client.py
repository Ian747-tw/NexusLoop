"""Tests for OpenCodeClient."""
import pytest
from agentcore.client_py.client import OpenCodeClient


def test_client_instantiation():
    client = OpenCodeClient(server_path='/nonexistent')
    assert client._process is not None


def test_client_has_required_methods():
    client = OpenCodeClient()
    assert hasattr(client, 'run_cycle')
    assert hasattr(client, 'stream_events')
    assert hasattr(client, 'inject_intervention')
    assert hasattr(client, 'snapshot_session')
