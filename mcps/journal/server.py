"""mcps.journal — append + tail queries against events.jsonl."""
from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from mcps._shared.base import BaseMCPServer


class AppendRequest(BaseModel):
    event: dict


class AppendResponse(BaseModel):
    event_id: str


class TailRequest(BaseModel):
    n: int


class TailResponse(BaseModel):
    events: list[dict]


class QueryRequest(BaseModel):
    kind: str
    limit: int


class QueryResponse(BaseModel):
    events: list[dict]


class JournalMCPServer(BaseMCPServer):
    """Append + tail queries against events.jsonl via EventLog."""

    def __init__(self, events_path: Path | None = None) -> None:
        super().__init__("journal")
        self._events_path = events_path  # None means use shared log

    def get_tools(self) -> list[dict[str, object]]:
        return [
            {
                "name": "journal.append",
                "description": "Append an event dict to events.jsonl via EventLog",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "event": {
                            "type": "object",
                            "description": "Event dict to append (must include 'kind' field)",
                        },
                    },
                    "required": ["event"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "journal.tail",
                "description": "Return the last n events from events.jsonl",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "n": {
                            "type": "integer",
                            "description": "Number of recent events to return",
                            "minimum": 1,
                        },
                    },
                    "required": ["n"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "journal.query",
                "description": "Return events matching a given kind",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "kind": {
                            "type": "string",
                            "description": "Event kind to filter by",
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of events to return",
                            "minimum": 1,
                        },
                    },
                    "required": ["kind", "limit"],
                    "additionalProperties": False,
                },
            },
        ]

    async def handle_tool(self, tool_name: str, args: dict[str, object]) -> dict[str, object]:
        self.emit_tool_requested(tool_name, args)
        decision = self._policy.check(tool_name, args)
        if not decision.allowed:
            return {"ok": False, "error": f"Policy denied: {decision.reason}"}
        if tool_name == "journal.append":
            return await self._append(args)
        elif tool_name == "journal.tail":
            return await self._tail(args)
        elif tool_name == "journal.query":
            return await self._query(args)
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    async def _append(self, args: dict[str, object]) -> dict[str, object]:
        from pydantic import TypeAdapter
        from nxl_core.events.schema import Event
        from nxl_core.events.singletons import journal_log

        event_dict = args.get("event", {})
        if "kind" not in event_dict:
            return {"ok": False, "error": "event must include 'kind' field"}

        # Build event from dict using TypeAdapter (Event is a union, not a model)
        ta = TypeAdapter(Event)
        event = ta.validate_python(event_dict)
        log = journal_log()
        event_id = log.append(event)
        return {"ok": True, "data": {"event_id": event_id}}

    async def _tail(self, args: dict[str, object]) -> dict[str, object]:
        from nxl_core.events.singletons import journal_log

        n = int(args.get("n", 10))
        log = journal_log()
        events = list(log.read_all())
        recent = events[-n:] if n < len(events) else events
        return {
            "ok": True,
            "data": {
                "events": [e.model_dump(mode="json") for e in recent],
            },
        }

    async def _query(self, args: dict[str, object]) -> dict[str, object]:
        from nxl_core.events.singletons import journal_log

        kind = str(args.get("kind", ""))
        limit = int(args.get("limit", 10))
        log = journal_log()
        matching = [e for e in log.read_all() if e.kind == kind]
        return {
            "ok": True,
            "data": {
                "events": [e.model_dump(mode="json") for e in matching[-limit:]],
            },
        }


# Convenience synchronous wrappers
def append(event: dict) -> str:
    from pydantic import TypeAdapter
    from nxl_core.events.schema import Event
    from nxl_core.events.singletons import journal_log

    ta = TypeAdapter(Event)
    event_obj = ta.validate_python(event)
    log = journal_log()
    return log.append(event_obj)


def tail(n: int) -> list[dict]:
    from nxl_core.events.singletons import journal_log

    log = journal_log()
    events = list(log.read_all())
    recent = events[-n:] if n < len(events) else events
    return [e.model_dump(mode="json") for e in recent]


def query(kind: str, limit: int) -> list[dict]:
    from nxl_core.events.singletons import journal_log

    log = journal_log()
    matching = [e for e in log.read_all() if e.kind == kind]
    return [e.model_dump(mode="json") for e in matching[-limit:]]