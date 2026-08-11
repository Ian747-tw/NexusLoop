# Branch 9W4B0 Forbidden Scope

9W4B0 defines an internal, pure model-configuration contract only. It must not
add or change:

- RuntimeServer activation or launch configuration;
- CLI, RuntimeClient, command, authority, or OpenTUI surfaces;
- OpenCode configuration or `auth.json` reads or writes;
- credential resolution, environment lookup, or secret persistence;
- provider construction, readiness probes, or network calls;
- Commander transport, audit, recovery, or lifecycle semantics;
- dynamic packages, plugins, model discovery, provider routing, fallback,
  failover, retry, or streaming;
- Gemini, OpenAI Responses, external MCP, or `external_research.*` execution;
- proposals, governance, mission mutation, or GitHub mutation;
- `agentcore/upstream`, dependency manifests, lockfiles, or any `FROZEN.lock`
  path;
- automatic profile creation from OpenCode observations;
- fallback from one role binding to another;
- `resume_supported=false`, `provider_tool_loop_enabled=false`, or
  `external_read_execution_enabled=false`.

The configuration must never contain an endpoint, header, package, plugin,
callback, fetch, environment-variable, OAuth, credential, or remote-catalog
authority field. Exact model IDs are inert external identifiers and cannot be
interpreted as any of those missing authority fields.
