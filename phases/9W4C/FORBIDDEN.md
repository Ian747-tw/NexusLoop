# Branch 9W4C Forbidden Scope

9W4C must not add or change:

- Vertex AI, OAuth, service accounts, project/location authority, Interactions,
  retained runs, streaming, live APIs, batch APIs, Files, uploads, caches, or
  model discovery;
- Google provider tools, search, URL context, maps, file search, computer use,
  code execution, remote MCP, multimodal input/output, provider options,
  safety-setting authority, thinking configuration, multiple candidates,
  retry, fallback, or failover;
- arbitrary endpoints, query credentials, bearer auth, cookies, caller headers,
  provider packages, callbacks, or fetch functions in model-profile authority;
- Commander authority derived from OpenCode config, auth, catalog, plugins,
  packages, `provider.list`, or `models.dev`;
- shared Commander/Executor credentials, provider objects, contexts, or
  lifecycle, or any auxiliary OpenCode model change;
- OpenAI Responses, 9W4E setup/UI, external MCP/research, proposals,
  governance, mutation, replay expansion, or later branch behavior;
- `agentcore/upstream`, any `FROZEN.lock` path, or any manifest/lockfile other
  than the exact runtime Google dependency and its necessary lock resolution;
- changes that set `resume_supported`, `provider_tool_loop_enabled`, or
  `external_read_execution_enabled` to true.

Gemini continuation metadata is transient process memory only. It must never be
persisted, hashed as authority, logged, audited, rendered, or transferred to
another provider, role, investigation, or recovery attempt.
