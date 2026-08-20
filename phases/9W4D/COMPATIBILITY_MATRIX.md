# Verified Commander Provider Compatibility Matrix Contract

The production matrix contains exactly four protocol evidence entries:

1. OpenAI-compatible Chat Completions, package `@ai-sdk/openai-compatible@3.0.11`.
2. Native Anthropic Messages, package `@ai-sdk/anthropic@4.0.15`.
3. Native Google Generative AI, package `@ai-sdk/google@4.0.15`.
4. Native OpenAI Responses, package `@ai-sdk/openai@4.0.15`.

Each cell records static bounded protocol facts and a semantic evidence hash.
It records no model catalog claim, URL, credential, header, availability,
connection, timestamp, or Executor observation. The matrix does not authorize
profiles, conformance, readiness, fallback, or execution.

Executable tests must cover every claimed transport's current golden request,
tool, audit, retry, and recovery behavior. A matrix entry may say native
structured output is unavailable even when a provider advertises it.
