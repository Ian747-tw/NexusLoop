# Branch 9W4A Forbidden Scope

- No external MCP or `external_research.*` execution.
- No dynamic provider packages, model discovery, provider selection, fallback,
  failover, routing, retries, or connector streaming.
- No arbitrary Commander endpoints, headers, credentials, request transformers,
  provider options, beta features, or server-side tools.
- No Anthropic Files, Skills, Batch, web, computer-use, code-execution, MCP,
  containers, context-management, prompt-cache, thinking, service-tier, or
  retained-run features.
- No real credential inside an AI SDK provider object.
- No raw provider request, response, prompt, header, credential, SDK state,
  tool result, assistant prose, or chain of thought in durable state.
- No automatic investigation, automatic recovery, replay, second recovery
  attempt, proposal, governance, mission mutation, GitHub mutation, or later
  9Y/9Z/10A/10B/10C behavior.
- No edits to `agentcore/upstream` or any `FROZEN.lock` path.
- No changes that set `resume_supported`, `provider_tool_loop_enabled`, or
  `external_read_execution_enabled` to true.

