# Branch 9W4B1 Forbidden Scope

9W4B1 must not add or change:

- model-profile persistence, hot reload, mutation, CLI configuration, or TUI selection;
- OpenCode configuration or `auth.json` reads or writes from Commander;
- `provider.list`, models.dev, plugin, package, or catalog data as selection authority;
- credential values, environment names, URLs, headers, auth artifacts, provider objects, callbacks, plugins, or fetch functions in model configuration, projections, hashes, errors, events, logs, or UI state;
- shared Commander/Executor credential stores, provider objects, contexts, or lifecycle;
- auxiliary OpenCode small, title, summary, compaction, command, agent, or subagent model selection;
- Gemini, OpenAI Responses, provider discovery, fallback, failover, retry, or streaming;
- external MCP or `external_research.*` execution;
- proposals, governance, mutation, replay, or recovery expansion;
- `agentcore/upstream`, dependency manifests, lockfiles, or any `FROZEN.lock` path;
- `resume_supported=false`, `provider_tool_loop_enabled=false`, or `external_read_execution_enabled=false`.

An explicit runtime registry and legacy Commander environment authority may not
be merged. Caller provider/model fields are assertions and cannot override a
selected role projection.
