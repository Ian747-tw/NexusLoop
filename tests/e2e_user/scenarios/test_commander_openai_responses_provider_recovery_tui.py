from __future__ import annotations

import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


@pytest.mark.phase_m4
def test_commander_recovers_through_native_openai_responses_via_real_tui(sandbox) -> None:
    install = sandbox.install_from_current_repo()
    assert install.exit_code == 0, install.stdout + install.stderr
    project = sandbox.make_empty_project_dir("commander_openai_responses_recovery_project")
    spec_dir = project / ".nxl" / "spec"
    spec_dir.mkdir(parents=True)
    (spec_dir / "current.json").write_text(json.dumps({
        "spec_id": "spec_commander_openai_responses_recovery_e2e", "version": 1, "status": "approved",
        "objective": "Exercise native OpenAI Responses through approved Commander recovery",
        "project_mode": "build", "domain": "test", "success_metrics": ["native OpenAI Responses transport remains audited and bounded"],
        "evaluation_protocol": "real headless OpenTUI recovery flow", "approved_by": "e2e", "approved_at": "2026-08-10T00:00:00Z",
    }, indent=2), encoding="utf-8")
    fixture = Path(__file__).resolve().parents[1] / "recorded" / "commander_openai_responses_recovery_events.jsonl"
    (project / ".nxl" / "events.jsonl").write_text(fixture.read_text(encoding="utf-8"), encoding="utf-8")

    requests: list[dict[str, object]] = []
    observed_headers: list[dict[str, str]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            assert self.path == "/v1/responses"
            request = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))))
            requests.append(request)
            observed_headers.append({key.lower(): value for key, value in self.headers.items()})
            assert request["model"] == "gpt-4.1-mini"
            assert request["max_output_tokens"] == 1024
            assert request["store"] is False
            forbidden = {"previous_response_id", "conversation", "background", "include", "service_tier", "prompt", "mcp_servers"}
            assert forbidden.isdisjoint(request)
            contents = json.dumps(request["input"])
            assert "Exercise native OpenAI Responses through approved Commander recovery" in contents
            assert "proposal_investigation" in contents
            assert "previous_response_id" not in contents
            response = json.dumps({
                "id": "resp_e2e", "object": "response", "created_at": 1784160000,
                "status": "completed", "background": False, "error": None,
                "incomplete_details": None, "model": "gpt-4.1-mini",
                "output": [{"type": "message", "id": "msg_e2e", "status": "completed", "role": "assistant", "content": [{"type": "output_text", "text": "native OpenAI Responses recovery completed", "annotations": []}]}],
                "previous_response_id": None, "reasoning": {"effort": None, "summary": None}, "store": False,
                "usage": {"input_tokens": 31, "output_tokens": 7, "total_tokens": 38, "input_tokens_details": {"cached_tokens": 0}, "output_tokens_details": {"reasoning_tokens": 0}},
            }).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://localhost:{server.server_address[1]}"
    connector = {
        "connector_id": "openai-responses-test", "title": "E2E OpenAI Responses connector", "base_url": f"{origin}/v1",
        "allowed_hosts": ["localhost"], "allowed_methods": ["POST"],
        "credential_refs": [{"name": "openai-responses-key", "source": "env", "env_name": "NXL_TEST_OPENAI_RESPONSES_KEY", "inject_as": "header", "target_name": "Authorization", "prefix": "Bearer "}],
        "timeout_ms": 5000, "max_response_bytes": 65536, "created_at": "1970-01-01T00:00:00.000Z", "updated_at": "1970-01-01T00:00:00.000Z", "allow_local_http": True,
    }
    configured = {
        "NXL_TUI_HEADLESS": "1", "NXL_RUNTIME_CLIENT": "real", "NXL_OPENCODE_ADAPTER": "fake",
        "NXL_COMMANDER_INVESTIGATION_PROVIDER_ENABLED": "1", "NXL_COMMANDER_INVESTIGATION_TRANSPORT_KIND": "openai_responses_connector",
        "NXL_COMMANDER_INVESTIGATION_PROVIDER_ID": "openai_responses_fixture_provider", "NXL_COMMANDER_INVESTIGATION_PROVIDER_KIND": "openai",
        "NXL_COMMANDER_INVESTIGATION_CONNECTOR_ID": "openai-responses-test", "NXL_COMMANDER_INVESTIGATION_MODEL_ID": "gpt-4.1-mini",
        "NXL_COMMANDER_INVESTIGATION_ENABLED_PHASES": "proposal_investigation", "NXL_COMMANDER_INVESTIGATION_TIMEOUT_MS": "5000",
        "NXL_COMMANDER_INVESTIGATION_MAX_REQUEST_BYTES": "65536", "NXL_COMMANDER_INVESTIGATION_MAX_RESPONSE_BYTES": "65536",
        "NXL_COMMANDER_INVESTIGATION_MAX_CONTEXT_BYTES": "65536", "NXL_COMMANDER_INVESTIGATION_MAX_CONTEXT_TOKENS": "16384",
        "NXL_COMMANDER_INVESTIGATION_MAX_OUTPUT_TOKENS": "1024", "NXL_COMMANDER_INVESTIGATION_SUPPORTS_TOOLS": "1",
        "NXL_COMMANDER_INVESTIGATION_SUPPORTS_JSON_SCHEMA": "0", "NXL_COMMANDER_INVESTIGATION_SUPPORTS_LONG_CONTEXT": "unknown",
        "NXL_COMMANDER_INVESTIGATION_SUPPORTS_LOCAL_EXECUTION": "0", "NXL_EXTERNAL_API_CONNECTORS_JSON": json.dumps([connector]),
        "NXL_TEST_OPENAI_RESPONSES_KEY": "openai-responses-e2e-secret",
    }
    sandbox.env.update(configured)
    sandbox.runner.env.update(configured)

    def run(commands: list[str]):
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

    investigation_id = "commander_openai_responses_recovery_e2e"
    preview = run(["/commander-recoveries", f"/commander-recovery-show {investigation_id}", f"/commander-recovery-preview {investigation_id}"])
    assert "preview=ready_for_approval" in preview.stdout
    approved = run([f"/commander-recovery-approve investigation_id={investigation_id} recovery_plan_hash={field(preview.stdout, 'recovery_plan_hash')} decision=approve_resume_from_checkpoint approved_by=e2e_operator fresh_context_required=true exact_replay_unavailable=true provider_request_replay_forbidden=true tool_execution_replay_forbidden=true confirm=APPROVE"])
    assert "approval=recorded" in approved.stdout
    current = run([f"/commander-recovery-preview {investigation_id}"])
    executed = run([f"/commander-recovery-execute investigation_id={investigation_id} approval_id={field(current.stdout, 'approval_id')} approval_hash={field(current.stdout, 'approval_hash')} recovery_plan_hash={field(current.stdout, 'recovery_plan_hash')} execution_preparation_hash={field(current.stdout, 'execution_preparation_hash')} confirm=EXECUTE", *[f"/commander-recovery-show {investigation_id}" for _ in range(12)]])
    assert "status=completed" in executed.stdout
    assert len(requests) == 1
    assert observed_headers[0]["authorization"] == "Bearer openai-responses-e2e-secret"
    assert "x-api-key" not in observed_headers[0]

    events_text = (project / ".nxl" / "events.jsonl").read_text(encoding="utf-8")
    events = [json.loads(line) for line in events_text.splitlines() if line.strip()]
    kinds = [event["kind"] for event in events if event.get("investigation_id") == investigation_id]
    assert kinds.count("runtime_commander_investigation_recovery_started") == 1
    model_steps = [event for event in events if event.get("investigation_id") == investigation_id and event["kind"] == "runtime_commander_investigation_model_step_started"]
    assert len(model_steps) == 2
    assert sum("recovery_attempt_id" in event for event in model_steps) == 1
    assert kinds.count("runtime_commander_investigation_finished") == 1
    terminal = next(event for event in events if event.get("investigation_id") == investigation_id and event["kind"] == "runtime_commander_investigation_finished")
    assert terminal["terminal"]["status"] == "final"
    assert sum(event["kind"] == "external_api_request_executed" for event in events) == 1
    assert events[-1]["kind"] == "runtime_shutdown"
    for forbidden in ["openai-responses-e2e-secret", "NXL_TEST_OPENAI_RESPONSES_KEY", "resp_e2e"]:
        assert forbidden not in executed.stdout
        assert forbidden not in events_text
    assert "provider_tool_loop_enabled=true" not in executed.stdout
    server.shutdown()
    server.server_close()
