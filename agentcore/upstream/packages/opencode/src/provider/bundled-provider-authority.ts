export const BUNDLED_PROVIDER_PACKAGE_IDS = [
  "@ai-sdk/amazon-bedrock",
  "@ai-sdk/anthropic",
  "@ai-sdk/azure",
  "@ai-sdk/google",
  "@ai-sdk/google-vertex",
  "@ai-sdk/google-vertex/anthropic",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
  "@openrouter/ai-sdk-provider",
  "@ai-sdk/xai",
  "@ai-sdk/mistral",
  "@ai-sdk/groq",
  "@ai-sdk/deepinfra",
  "@ai-sdk/cerebras",
  "@ai-sdk/cohere",
  "@ai-sdk/gateway",
  "@ai-sdk/togetherai",
  "@ai-sdk/perplexity",
  "@ai-sdk/vercel",
  "@ai-sdk/alibaba",
  "gitlab-ai-provider",
  "@ai-sdk/github-copilot",
  "venice-ai-sdk-provider",
] as const

export type BundledProviderPackageID = (typeof BUNDLED_PROVIDER_PACKAGE_IDS)[number]

const packages = new Set<string>(BUNDLED_PROVIDER_PACKAGE_IDS)

export function isBundledProviderPackage(value: string): value is BundledProviderPackageID {
  return packages.has(value)
}
