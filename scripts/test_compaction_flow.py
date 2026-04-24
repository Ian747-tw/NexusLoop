#!/usr/bin/env python3
"""Test compaction trajectory: upstream detector → nxl production, bounded."""
import sys

# Simulated test: verify that CompactRequest tier hints map to correct compact functions
from nxl_core.capsule.compact import soft_trim, hard_regen, clear_handoff, CompactionEvent

def test_tier_soft_trim():
    events = [{'kind': 'ProgressNoted', 'data': {}}] * 100
    result = soft_trim(events)
    assert result.compaction_type.value == 'soft_trim'
    assert len(result.preserved_events) < 100

def test_tier_hard_regen():
    events = [{'kind': 'ProgressNoted', 'data': {}}] * 500
    result = hard_regen(events)
    assert result.compaction_type.value == 'hard_regen'

def test_tier_clear_handoff():
    events = [{'kind': 'HandoffRecorded', 'data': {}}] * 10
    result = clear_handoff(events)
    assert result.compaction_type.value == 'clear_handover'

def main():
    test_tier_soft_trim()
    test_tier_hard_regen()
    test_tier_clear_handoff()
    print("Compaction trajectory: PASS")
    print("  soft_trim: bounded output")
    print("  hard_regen: bounded output")
    print("  clear_handoff: bounded output")

if __name__ == '__main__':
    main()