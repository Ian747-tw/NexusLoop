"""Test compact responders via Python IPC server."""
import json
import subprocess
import tempfile
from nxl_core.capsule.compact import soft_trim, hard_regen, clear_handoff


def test_soft_trim_preserves_critical():
    events = [
        {'kind': 'MissionDeclared', 'data': {}},
        {'kind': 'ProgressNoted', 'data': {}},
        {'kind': 'TrialCompleted', 'data': {}},
    ]
    result = soft_trim(events)
    assert result.compaction_type.value == 'soft_trim'
    assert len(result.preserved_events) == 2  # ProgressNoted trimmed
    assert result.count == 2  # count is preserved (non-trimmed) events, not total


def test_hard_regen_keeps_only_critical():
    events = [
        {'kind': 'MissionDeclared', 'data': {}},
        {'kind': 'ProgressNoted', 'data': {}},
        {'kind': 'HypothesisFormed', 'data': {}},
    ]
    result = hard_regen(events)
    assert result.compaction_type.value == 'hard_regen'
    assert len(result.preserved_events) == 2  # only critical events


def test_clear_handoff_removes_handoff():
    events = [
        {'kind': 'HandoffRecorded', 'data': {}},
        {'kind': 'MissionDeclared', 'data': {}},
    ]
    result = clear_handoff(events)
    assert result.compaction_type.value == 'clear_handover'
    assert all(e.get('kind') != 'HandoffRecorded' for e in result.preserved_events)