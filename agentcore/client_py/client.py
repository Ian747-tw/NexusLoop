"""agentcore.client_py.client — 4 seam APIs for the Python harness."""
from __future__ import annotations

import json
from typing import AsyncIterator

from agentcore.client_py.process import ServerProcess
from agentcore.client_py.protocol import (
    CapsuleRequest,
    CapsuleResponse,
    CycleControl,
    CycleResult,
    EventEmission,
    Intervention,
    ToolCallRequest,
    ToolCallResult,
)


class OpenCodeClient:
    """Python-side client for the agentcore TS server."""

    def __init__(self, server_path: str = 'agentcore/server-fork/src/server.ts'):
        self._process = ServerProcess(server_path)

    def start(self) -> None:
        self._process.start()

    def run_cycle(
        self,
        brief: str,
        provider: str | None = None,
        policy_endpoint: str = "",
        events_endpoint: str = "",
    ) -> CycleResult:
        """Drive one full cycle through the TS server.

        Parameters
        ----------
        brief:
            Cycle brief description.
        provider:
            AI provider: "anthropic", "openai", or "ollama".
            Passed to the TS server via CycleControl so it can select the
            appropriate native adapter before the first tool call.
        """
        self._process.start()
        # Send CycleControl start with provider so TS selects correct adapter
        self._send_control(CycleControl(
            action='start',
            provider=provider,
        ))
        # Stream events until cycle completes
        events = []
        tool_calls = 0
        blocked = 0
        # Event loop
        for emission in self.stream_events(f'cycle-{brief[:8]}'):
            events.append(emission)
            if emission.event.get('kind') == 'ToolCallRequested':
                tool_calls += 1
            if emission.event.get('kind') == 'ToolCallDenied':
                blocked += 1
            if emission.event.get('kind') == 'CycleCompleted':
                break
        return CycleResult(
            cycle_id=f'cycle-{brief[:8]}',
            events=events,
            final_state=b'',
            tool_calls=tool_calls,
            blocked=blocked,
        )

    def stream_events(self, cycle_id: str) -> AsyncIterator[EventEmission]:
        """Stream events from the TS server for a given cycle."""
        # Uses subprocess stdout streaming
        proc = self._process._proc
        if proc is None or proc.stdout is None:
            return
        for line in proc.stdout:
            msg = json.loads(line.decode())
            if msg.get('type') == 'event':
                yield EventEmission(event=msg.get('event', {}))

    def inject_intervention(self, verb: str, payload: object) -> None:
        """Inject an intervention verb from Python side into TS server."""
        intervention = Intervention(verb=verb, payload=payload)
        self._send(json.dumps({'type': 'intervention', **intervention.model_dump()}) + '\n')

    def snapshot_session(self) -> dict:
        """Request current session state snapshot from TS server."""
        self._send(json.dumps({'type': 'snapshot'}) + '\n')
        # Receive response
        proc = self._process._proc
        if proc is None or proc.stdout is None:
            return {}
        line = proc.stdout.readline()
        return json.loads(line.decode())

    def _send(self, data: str) -> None:
        proc = self._process._proc
        if proc is None or proc.stdin is None:
            raise RuntimeError('Server not started')
        proc.stdin.write(data.encode())
        proc.stdin.flush()

    def _send_control(self, control: CycleControl) -> None:
        self._send(json.dumps({'type': 'control', **control.model_dump()}) + '\n')