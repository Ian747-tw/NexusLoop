# OpenCode Upstream Map — v1.14.22

## Fork Point
Package: `packages/opencode`
Root: `agentcore/upstream/packages/opencode/`

## Key Files Replaced by Seam

| Concern | Upstream File | Our Seam |
|---------|---------------|----------|
| Tool dispatch | `src/tool/registry.ts`, `src/tool/index.ts` | `seams/gated-dispatch.ts` |
| Permission/Intervention | `src/permission/evaluate.ts`, `src/permission/index.ts` | `seams/intervention-hook.ts` |
| Session/Context | `src/session/session.ts`, `src/session/llm.ts` | `seams/capsule-session.ts` |
| Turn loop | `src/session/processor.ts`, `src/v2/session-entry-stepper.ts` | `seams/cycle-driver.ts` |

## Turn Loop Owner

The turn loop is owned by `SessionProcessor.Service` in `src/session/processor.ts`.
It drives the LLM stream (`session/llm.ts`) and tool execution via `stepWith()` in `v2/session-entry-stepper.ts`.

## Preserved (NOT replaced)
- `src/provider/` — provider adapters (Anthropic, OpenAI, Ollama)
- `src/tool/bash.ts`, `src/tool/read.ts`, `src/tool/edit.ts`, etc. — tool implementations
- `src/mcp/` — MCP registry and client
- `src/server/adapter.ts` — HTTP/WS transport
- `src/streaming/` — token streaming plumbing
- `src/agent/agent.ts` — agent config/metadata service (not turn loop owner)

## Workspace Structure
- `agentcore/upstream/` — vendored readonly
- `agentcore/server-fork/` — overlay workspace with path aliases to upstream