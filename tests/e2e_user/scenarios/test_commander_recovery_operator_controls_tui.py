from __future__ import annotations

import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


@pytest.mark.phase_m4
def test_operator_controls_commander_recovery_through_real_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr

    sandbox.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.runner.env["NXL_TUI_HEADLESS"] = "1"
    sandbox.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.runner.env["NXL_RUNTIME_CLIENT"] = "real"
    sandbox.env["NXL_OPENCODE_ADAPTER"] = "fake"
    sandbox.runner.env["NXL_OPENCODE_ADAPTER"] = "fake"

    project = sandbox.make_empty_project_dir("commander_recovery_operator_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(
        json.dumps(
            {
                "spec_id": "spec_commander_recovery_operator_e2e",
                "version": 1,
                "status": "approved",
                "objective": "Exercise human-approved Commander recovery controls",
                "project_mode": "build",
                "domain": "test",
                "success_metrics": ["recovery controls remain truthful"],
                "evaluation_protocol": "real headless OpenTUI commands",
                "approved_by": "e2e",
                "approved_at": "2026-08-04T00:00:00Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    fixture = Path(__file__).resolve().parents[1] / "recorded" / "commander_recovery_operator_events.jsonl"
    (project / ".nxl" / "events.jsonl").write_text(fixture.read_text(encoding="utf-8"), encoding="utf-8")

    requests: list[dict[str, object]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            body = self.rfile.read(int(self.headers.get("content-length", "0")))
            requests.append(json.loads(body))
            if self.server.delay_response:  # type: ignore[attr-defined]
                time.sleep(1)
            response = json.dumps(
                {
                    "id": "chatcmpl_e2e_recovery",
                    "object": "chat.completion",
                    "created": 1784160000,
                    "model": "fixture-model",
                    "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "durable recovered final"}}],
                }
            ).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(response)))
            self.end_headers()
            try:
                self.wfile.write(response)
            except BrokenPipeError:
                pass

        def log_message(self, _format: str, *_args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.delay_response = False  # type: ignore[attr-defined]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://localhost:{server.server_address[1]}/v1"
    connector = {
        "connector_id": "openai-test",
        "title": "E2E recovery connector",
        "base_url": base_url,
        "allowed_hosts": ["localhost"],
        "allowed_methods": ["POST"],
        "credential_refs": [{"name": "model-key", "source": "env", "env_name": "NXL_TEST_MODEL_KEY", "inject_as": "header", "target_name": "Authorization", "prefix": "Bearer "}],
        "timeout_ms": 5000,
        "max_response_bytes": 65536,
        "created_at": "1970-01-01T00:00:00.000Z",
        "updated_at": "1970-01-01T00:00:00.000Z",
        "allow_local_http": True,
    }
    provider_env = {
        "NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED": "1",
        "NXL_COMMANDER_INVESTIGATION_TRANSPORT_KIND": "openai_compatible_connector",
        "NXL_COMMANDER_INVESTIGATION_PROVIDER_ID": "fixture_provider",
        "NXL_COMMANDER_INVESTIGATION_PROVIDER_KIND": "openai_compatible",
        "NXL_COMMANDER_INVESTIGATION_CONNECTOR_ID": "openai-test",
        "NXL_COMMANDER_INVESTIGATION_MODEL_ID": "fixture-model",
        "NXL_COMMANDER_INVESTIGATION_ENABLED_PHASES": "general_read,proposal_investigation",
        "NXL_COMMANDER_INVESTIGATION_TIMEOUT_MS": "5000",
        "NXL_COMMANDER_INVESTIGATION_MAX_REQUEST_BYTES": "65536",
        "NXL_COMMANDER_INVESTIGATION_MAX_RESPONSE_BYTES": "65536",
        "NXL_COMMANDER_INVESTIGATION_MAX_CONTEXT_BYTES": "65536",
        "NXL_COMMANDER_INVESTIGATION_MAX_CONTEXT_TOKENS": "16384",
        "NXL_COMMANDER_INVESTIGATION_MAX_OUTPUT_TOKENS": "1024",
        "NXL_COMMANDER_INVESTIGATION_SUPPORTS_TOOLS": "1",
        "NXL_COMMANDER_INVESTIGATION_SUPPORTS_JSON_SCHEMA": "unknown",
        "NXL_COMMANDER_INVESTIGATION_SUPPORTS_LONG_CONTEXT": "unknown",
        "NXL_COMMANDER_INVESTIGATION_SUPPORTS_LOCAL_EXECUTION": "0",
        "NXL_EXTERNAL_API_CONNECTORS_JSON": json.dumps([connector]),
        "NXL_TEST_MODEL_KEY": "e2e-recovery-key",
    }
    sandbox.env.update(provider_env)
    sandbox.runner.env.update(provider_env)

    def run_commands(commands: list[str]):
        keys = [{"type": "submit"}]
        for command in commands:
            keys.extend([{"type": "insert", "text": command}, {"type": "submit"}])
        encoded = json.dumps(keys)
        sandbox.env["NXL_TUI_KEYS"] = encoded
        sandbox.runner.env["NXL_TUI_KEYS"] = encoded
        result = sandbox.run_cli([], cwd=project)
        assert result.exit_code == 0, result.stdout + result.stderr
        return result

    def field(output: str, name: str) -> str:
        match = re.search(rf"^  {re.escape(name)}=([^\s]+)$", output, re.MULTILINE)
        assert match, output
        return match.group(1)

    result = run_commands([
        "/commander-recoveries",
        "/commander-recovery-show commander_recovery_checkpoint_e2e",
        "/commander-recovery-preview commander_recovery_checkpoint_e2e",
        "/commander-recovery-preview commander_recovery_uncertain_e2e",
        "/authority-show /commander-recovery-execute",
        "/authority-show /commander-recovery-cancel",
    ])
    assert "Commander recovery" in result.stdout
    assert "fresh recovery continuation" in result.stdout
    assert "exact replay unavailable" in result.stdout
    assert "provider outcome unknown" in result.stdout
    assert "/commander-recovery-approve" in result.stdout
    assert "/commander-recovery-execute" in result.stdout
    assert "/commander-recovery-cancel" in result.stdout
    assert "connector_url" not in result.stdout
    assert "authorization" not in result.stdout.lower()
    assert "chain of thought" not in result.stdout.lower()

    checkpoint_preview = run_commands(["/commander-recovery-preview commander_recovery_checkpoint_e2e"])
    checkpoint_plan = field(checkpoint_preview.stdout, "recovery_plan_hash")
    stale = run_commands([
        "/commander-recovery-approve investigation_id=commander_recovery_checkpoint_e2e recovery_plan_hash=stale_plan_hash decision=approve_resume_from_checkpoint approved_by=e2e_operator fresh_context_required=true exact_replay_unavailable=true provider_request_replay_forbidden=true tool_execution_replay_forbidden=true confirm=APPROVE",
    ])
    assert "approval=blocked" in stale.stdout

    approved = run_commands([
        f"/commander-recovery-approve investigation_id=commander_recovery_checkpoint_e2e recovery_plan_hash={checkpoint_plan} decision=approve_resume_from_checkpoint approved_by=e2e_operator fresh_context_required=true exact_replay_unavailable=true provider_request_replay_forbidden=true tool_execution_replay_forbidden=true confirm=APPROVE",
    ])
    assert "approval=recorded" in approved.stdout
    current = run_commands(["/commander-recovery-preview commander_recovery_checkpoint_e2e"])
    approval_id = field(current.stdout, "approval_id")
    approval_hash = field(current.stdout, "approval_hash")
    current_plan = field(current.stdout, "recovery_plan_hash")
    preparation_hash = field(current.stdout, "execution_preparation_hash")
    executed = run_commands([
        f"/commander-recovery-execute investigation_id=commander_recovery_checkpoint_e2e approval_id={approval_id} approval_hash={approval_hash} recovery_plan_hash={current_plan} execution_preparation_hash={preparation_hash}",
        f"/commander-recovery-execute investigation_id=commander_recovery_checkpoint_e2e approval_id={approval_id} approval_hash={approval_hash} recovery_plan_hash={current_plan} execution_preparation_hash={preparation_hash} confirm=EXECUTE",
        "/commander-recovery-show commander_recovery_checkpoint_e2e",
        "/commander-recovery-show commander_recovery_checkpoint_e2e",
        "/commander-recovery-show commander_recovery_checkpoint_e2e",
    ])
    assert "confirmation=execution required" not in executed.stdout
    events = [json.loads(line) for line in (project / ".nxl" / "events.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    checkpoint_kinds = [event["kind"] for event in events if event.get("investigation_id") == "commander_recovery_checkpoint_e2e"]
    assert checkpoint_kinds.count("runtime_commander_investigation_recovery_started") == 1
    assert checkpoint_kinds.count("runtime_commander_investigation_model_step_started") == 1
    assert checkpoint_kinds.count("runtime_commander_investigation_finished") == 1
    assert len(requests) == 1

    uncertain_preview = run_commands(["/commander-recovery-preview commander_recovery_uncertain_e2e"])
    uncertain_plan = field(uncertain_preview.stdout, "recovery_plan_hash")
    uncertain_approved = run_commands([
        f"/commander-recovery-approve investigation_id=commander_recovery_uncertain_e2e recovery_plan_hash={uncertain_plan} decision=approve_continue_after_uncertain_provider_outcome approved_by=e2e_operator fresh_context_required=true exact_replay_unavailable=true provider_request_replay_forbidden=true tool_execution_replay_forbidden=true uncertain_provider_outcome=true confirm=APPROVE",
    ])
    assert "approval=recorded" in uncertain_approved.stdout
    uncertain_current = run_commands(["/commander-recovery-preview commander_recovery_uncertain_e2e"])
    uncertain_approval_id = field(uncertain_current.stdout, "approval_id")
    uncertain_approval_hash = field(uncertain_current.stdout, "approval_hash")
    uncertain_current_plan = field(uncertain_current.stdout, "recovery_plan_hash")
    uncertain_preparation = field(uncertain_current.stdout, "execution_preparation_hash")
    server.delay_response = True  # type: ignore[attr-defined]
    cancelled = run_commands([
        f"/commander-recovery-execute investigation_id=commander_recovery_uncertain_e2e approval_id={uncertain_approval_id} approval_hash={uncertain_approval_hash} recovery_plan_hash={uncertain_current_plan} execution_preparation_hash={uncertain_preparation} confirm=EXECUTE",
        f"/commander-recovery-cancel investigation_id=commander_recovery_uncertain_e2e approval_id={uncertain_approval_id}",
        "/commander-recovery-show commander_recovery_uncertain_e2e",
    ])
    assert "cancellation requested" in cancelled.stdout
    events = [json.loads(line) for line in (project / ".nxl" / "events.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    uncertain_events = [event for event in events if event.get("investigation_id") == "commander_recovery_uncertain_e2e"]
    uncertain_kinds = [event["kind"] for event in uncertain_events]
    if "runtime_commander_investigation_recovery_started" in uncertain_kinds:
        assert "runtime_commander_investigation_finished" not in uncertain_kinds
    else:
        approvals = [event for event in uncertain_events if event["kind"] == "runtime_commander_investigation_recovery_approved"]
        assert approvals and approvals[-1]["approval"]["approval_id"] == uncertain_approval_id
    assert "historical_pending_request_e2e" not in json.dumps(requests)
    server.shutdown()
    server.server_close()
