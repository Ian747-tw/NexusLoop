export async function runBunImportProbe() {
  await import("ai")
  await import("@ai-sdk/openai-compatible")
  const agents = await import("@openai/agents")
  agents.setTracingDisabled(true)
  return { status: "pass" as const }
}
