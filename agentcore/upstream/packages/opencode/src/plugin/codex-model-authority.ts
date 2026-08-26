const ALLOWED_CODEX_OAUTH_MODELS = new Set([
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.4-mini",
])

export function isCodexOAuthModelAllowed(modelID: string, apiModelID: string): boolean {
  if (modelID.includes("codex")) return true
  if (ALLOWED_CODEX_OAUTH_MODELS.has(apiModelID)) return true
  const match = apiModelID.match(/^gpt-(\d+\.\d+)/)
  return Boolean(match && Number.parseFloat(match[1]!) > 5.4)
}
