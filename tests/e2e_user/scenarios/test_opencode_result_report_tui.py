from __future__ import annotations

import json
import re

import pytest


@pytest.mark.phase_m4
def test_user_records_opencode_result_report_metadata_only(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.env["NXL_SECRET_RESULT_REPORT_TOKEN"] = "result-report-secret-abc123"
    sandbox.runner.env["NXL_SECRET_RESULT_REPORT_TOKEN"] = "result-report-secret-abc123"

    project = sandbox.make_empty_project_dir("opencode_result_report_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_opencode_result_report_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise OpenCode result report records through real runtime TUI",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["result report surface renders"],
                "evaluation_protocol": "run headless TUI",
                "approved_by": "e2e",
                "approved_at": "2026-07-01T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    plan_keys = [
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-session-plan objective=result report test token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-sessions"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(plan_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(plan_keys)
    plan_result = sandbox.run_cli([], cwd=project)
    assert plan_result.exit_code == 0, plan_result.stdout + plan_result.stderr
    session_match = re.search(r"latest=(opencode_session_[A-Za-z0-9._-]+)", plan_result.stdout)
    assert session_match, plan_result.stdout
    session_id = session_match.group(1)

    launch_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-session-instruction-pack-write session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-launch-readiness session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-launch session={session_id}"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(launch_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(launch_keys)
    launch_result = sandbox.run_cli([], cwd=project)
    assert launch_result.exit_code == 0, launch_result.stdout + launch_result.stderr
    assert "status=launched" in launch_result.stdout

    progress_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-progress session={session_id} summary=implemented first change files=fileA.ts tests=bun-test"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-progress session={session_id} summary=done with candidate fix token=abc123"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(progress_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(progress_keys)
    progress_result = sandbox.run_cli([], cwd=project)
    assert progress_result.exit_code == 0, progress_result.stdout + progress_result.stderr

    events_path = project / ".nxl" / "events.jsonl"
    events_before_report = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds_before = [event["kind"] for event in events_before_report]

    report_keys = [
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-report-preview session={session_id} summary=implemented candidate fix token=abc123"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-report-dry-run session={session_id} kind=completion_report summary=implemented candidate fix token=abc123 outcome=tests passed"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-report session={session_id} kind=completion_report summary=implemented candidate fix token=abc123 outcome=tests passed changed_files=fileA.ts tests_run=bun-test claims=fix-works followups=commander-review"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-reports session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": f"/opencode-result-report-latest session={session_id}"},
        {"type": "submit"},
        {"type": "insert", "text": "/opencode-result-report-summary"},
        {"type": "submit"},
        {"type": "insert", "text": "/authority-show /opencode-result-report"},
        {"type": "submit"},
    ]
    sandbox.env["NXL_TUI_KEYS"] = json.dumps(report_keys)
    sandbox.runner.env["NXL_TUI_KEYS"] = json.dumps(report_keys)
    report_result = sandbox.run_cli([], cwd=project)
    assert report_result.exit_code == 0, report_result.stdout + report_result.stderr

    assert "OpenCode result reports" in report_result.stdout
    assert "latest_result=" in report_result.stdout
    assert "kind=completion_report" in report_result.stdout
    assert "review_state=needs_commander_review" in report_result.stdout
    assert "mission_mutated=false" in report_result.stdout
    assert "research_db_written=false" in report_result.stdout
    assert "checkpoint_created=false" in report_result.stdout
    assert "commander_review_created=false" in report_result.stdout
    assert "mission not completed" in report_result.stdout
    assert "research.db not written" in report_result.stdout
    assert "selected=/opencode-result-report risk=medium_risk_write" in report_result.stdout
    assert "result-report-secret" not in report_result.stdout
    assert "result-report-secret-abc123" not in report_result.stdout
    assert "token=abc123" not in report_result.stdout

    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    event_kinds = [event["kind"] for event in events]
    assert event_kinds.count("opencode_result_report_recorded") == event_kinds_before.count("opencode_result_report_recorded") + 1
    assert event_kinds.count("opencode_session_launch_started") == 1
    assert event_kinds.count("opencode_session_launch_succeeded") == 1

    new_events = events[len(events_before_report) :]
    new_event_kinds = [event["kind"] for event in new_events]
    metadata_new_event_kinds = [
        kind
        for kind in new_event_kinds
        if kind not in {"runtime_started", "runtime_ready", "runtime_shutdown"}
    ]
    assert metadata_new_event_kinds == ["opencode_result_report_recorded"]
    report_events = [event for event in new_events if event["kind"] == "opencode_result_report_recorded"]
    assert len(report_events) == 1
    serialized_report_events = json.dumps(report_events)
    assert '"mission_mutated": false' in serialized_report_events
    assert '"research_db_written": false' in serialized_report_events
    assert '"checkpoint_created": false' in serialized_report_events
    assert '"commander_review_created": false' in serialized_report_events

    forbidden_new_events = {
        "commander_result_review_created",
        "commander_result_review_accepted",
        "research_result_ingested",
        "research_db_written",
        "runtime_checkpoint_created",
        "opencode_prompt_sent",
        "opencode_commander_guidance_delivered",
        "opencode_session_process_paused",
        "opencode_session_process_resumed",
        "opencode_session_process_killed",
        "opencode_session_process_stopped",
        "opencode_session_launch_started",
        "opencode_session_launch_succeeded",
        "runtime_wake_scheduler_started",
        "runtime_wake_schedule_tick_completed",
        "mission_created",
        "mission_claimed",
        "mission_progress_recorded",
        "mission_result_submitted",
        "mission_completed",
        "mission_failed",
        "review_request_created",
        "commander_proposal_created",
        "commander_proposal_applied",
        "external_api_request_executed",
        "external_api_research_ingestion_created",
    }
    assert forbidden_new_events.isdisjoint(new_event_kinds)
    serialized_new_events = json.dumps(new_events)
    assert "result-report-secret" not in serialized_new_events
    assert "token=abc123" not in serialized_new_events
    assert "stdout" not in serialized_new_events
    assert "stderr" not in serialized_new_events
    assert "diff --git" not in serialized_new_events
    assert "file contents" not in serialized_new_events
