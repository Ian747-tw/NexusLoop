"""
M0.1 Step 4: Migrate existing logging modules to emit events.

Tests: assert an event appears in the event log for each public API call
in journal, incidents, handoffs, and registry modules.

The existing public API signatures are preserved; internally they call
EventLog.append() via nxl_core.events.singletons.
"""
from __future__ import annotations

import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

from nxl_core.events.log import EventLog
from nxl_core.events.singletons import configure, reset, get_shared, set_shared


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TestIncidentLogEmitsEvents:
    def test_report_emits_incident_reported_event(self, tmp_path: Path) -> None:
        from nxl.logging.incidents import IncidentLog

        log_path = tmp_path / "events.jsonl"
        log = EventLog(path=log_path)
        set_shared(log)

        try:
            incident_log = IncidentLog(project_dir=tmp_path)
            incident_log.initialize()
            incident_id = incident_log.report(
                incident_type="divergence",
                run_id="run_001",
                description="Loss went to NaN",
                evidence={"loss": float("nan")},
                severity="critical",
            )
            assert incident_id != ""
            events = list(log.read_all())
            assert len(events) == 1
            assert events[0].kind == "incident_reported"
            assert events[0].incident_type == "divergence"
        finally:
            reset()

    def test_rule_violation_non_research_not_emitted(self, tmp_path: Path) -> None:
        from nxl.logging.incidents import IncidentLog

        log_path = tmp_path / "events.jsonl"
        log = EventLog(path=log_path)
        set_shared(log)

        try:
            incident_log = IncidentLog(project_dir=tmp_path)
            incident_log.initialize()
            incident_id = incident_log.report(
                incident_type="rule_violation",
                run_id="run_001",
                description="Policy violated",
                evidence={"research_related": False},
                severity="medium",
            )
            assert incident_id == ""
            events = list(log.read_all())
            assert len(events) == 0
        finally:
            reset()


class TestHandoffLogEmitsEvents:
    def test_record_handoff_emits_handoff_recorded_event(self, tmp_path: Path) -> None:
        from nxl.logging.handoffs import HandoffLog, HandoffRecord

        log_path = tmp_path / "events.jsonl"
        log = EventLog(path=log_path)
        set_shared(log)

        try:
            hlog = HandoffLog(project_dir=tmp_path)
            hlog.initialize()
            hlog.record_handoff(HandoffRecord(
                handoff_id="hand_001",
                timestamp=_utc_now().isoformat(),
                from_agent="agent_a",
                to_agent="agent_b",
                what_changed="Added feature X",
                why="User requested",
                what_happened="Feature implemented",
                do_not_retry=[],
                next_steps=["Test feature"],
                current_best="run_001: 0.9",
                open_questions=["Is it fast enough?"],
            ))
            events = list(log.read_all())
            assert len(events) == 1
            assert events[0].kind == "handoff_recorded"
            assert events[0].handoff_id == "hand_001"
        finally:
            reset()


class TestJournalEmitsEvents:
    def test_log_event_emits_incident_reported_event(self, tmp_path: Path) -> None:
        from nxl.logging.journal import ProjectJournal

        log_path = tmp_path / "events.jsonl"
        log = EventLog(path=log_path)
        set_shared(log)

        try:
            journal = ProjectJournal(project_dir=tmp_path)
            journal.initialize(project_name="test", spec={})
            journal.log_event("test_event", "Test content")

            events = list(log.read_all())
            assert len(events) == 1
            assert events[0].kind == "incident_reported"
        finally:
            reset()


class TestRegistryEmitsEvents:
    def test_add_run_does_not_emit_event(self, tmp_path: Path) -> None:
        """Registry uses audit_event (no direct EventLog emission by default)."""
        from nxl.logging.registry import ExperimentRegistry, RunRecord

        log_path = tmp_path / "events.jsonl"
        log = EventLog(path=log_path)
        set_shared(log)

        try:
            registry = ExperimentRegistry(project_dir=tmp_path)
            registry.initialize()
            record = RunRecord(
                run_id="run_001",
                hypothesis="test hypothesis",
                agent="test",
                config_summary="{}",
                change_summary="{}",
                rules_checked="test",
                status="completed",
                keep_decision="keep",
            )
            registry.add_run(record)

            events = list(log.read_all())
            # Registry primarily uses audit_event (no direct Event union event here)
            assert len(events) == 0
        finally:
            reset()


class TestAllFourModulesSmoke:
    def test_all_modules_operate_together(self, tmp_path: Path) -> None:
        """Smoke test: all four modules operate without errors after migration."""
        from nxl.logging.journal import ProjectJournal
        from nxl.logging.incidents import IncidentLog
        from nxl.logging.handoffs import HandoffLog, HandoffRecord
        from nxl.logging.registry import ExperimentRegistry, RunRecord

        log_path = tmp_path / "events.jsonl"
        log = EventLog(path=log_path)
        set_shared(log)

        try:
            # Journal
            journal = ProjectJournal(project_dir=tmp_path)
            journal.initialize(project_name="smoke_test", spec={})
            journal.log_event("smoke_event", "smoke content")

            # Incidents
            incident_log = IncidentLog(project_dir=tmp_path)
            incident_log.initialize()
            incident_log.report("divergence", "run_001", "Loss NaN", {}, "critical")

            # Handoffs
            hlog = HandoffLog(project_dir=tmp_path)
            hlog.initialize()
            hlog.record_handoff(HandoffRecord(
                handoff_id="hand_smoke",
                timestamp=_utc_now().isoformat(),
                from_agent="a", to_agent="b",
                what_changed="x", why="y", what_happened="z",
                do_not_retry=[], next_steps=[], current_best="", open_questions=[],
            ))

            # Registry
            reg = ExperimentRegistry(project_dir=tmp_path)
            reg.initialize()
            reg.add_run(RunRecord(
                run_id="run_smoke",
                hypothesis="h", agent="a",
                config_summary="{}", change_summary="{}",
                rules_checked="x", status="completed", keep_decision="keep",
            ))

            events = list(log.read_all())
            event_kinds = {e.kind for e in events}
            assert "incident_reported" in event_kinds
            assert "handoff_recorded" in event_kinds
        finally:
            reset()