# 9XB Forbidden

These restrictions bind 9XB0 and every later 9XB implementation unless a new
accepted ADR explicitly replaces them.

- No executable `external_research` descriptor, binding, runtime command, TUI
  surface, or live Commander network path in 9XB0.
- No arbitrary MCP server URL, server ID, remote tool name, JSON-RPC method,
  prompt, resource, schema, header, query, or URL supplied by the model.
- No automatic exposure of `tools/list`, remote descriptions, annotations,
  prompts, resources, or capabilities to Commander.
- No trust in `readOnlyHint`, `destructiveHint`, `openWorldHint`, or any other
  server-supplied annotation as NexusLoop authority.
- No generic MCP marketplace, ambient OpenCode MCP configuration, dynamic
  schema-to-descriptor conversion, wildcard allowlist, fallback provider, or
  provider failover.
- No stdio process, legacy HTTP+SSE fallback, long-lived GET stream, event
  resumption, request replay, retained run, task, sampling, elicitation, root,
  logging, completion, subscription, or server-driven tool-list change.
- No SDK transport that bypasses `ExternalApiRequestService` credential, DNS,
  redirect, audit, cancellation, response-bound, or lifecycle ownership.
- No unbounded text parser, raw MCP result, raw JSON-RPC body, response body,
  session ID, request ID, cursor, prompt, resource, image, audio, or embedded
  resource in Commander evidence or journal state.
- No unrestricted source URL, arbitrary fetch, private/local destination,
  cross-source crawl, search-result-triggered execution, or URL persistence
  without a separate bounded source-scope contract.
- No hidden retry. NexusLoop client retries are zero, rate limits are not
  retried, and a provider with unobservable downstream retries is not approved.
- No proposal creation, research DB ingestion, governance intent, GitHub
  mutation, OpenCode action, automatic investigation, automatic recovery,
  approval revocation, second attempt, replay, or exact resume.
- No change to `resume_supported=false`, `provider_tool_loop_enabled=false`, or
  `external_read_execution_enabled=false`.
- No edit to any path listed in `FROZEN.lock`, including the frozen MCP gate and
  shared Python MCP contracts.

