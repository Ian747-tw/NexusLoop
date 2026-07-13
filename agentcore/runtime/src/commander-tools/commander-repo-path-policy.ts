const SENSITIVE_BASENAMES = new Set([
  ".env",
  ".envrc",
  "minimax.env",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "id_rsa",
  "id_ed25519",
  "credentials",
  "credentials.json",
  "credentials.yaml",
  "credentials.yml",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
  "service-account.json",
  "service_account.json",
  "kubeconfig",
])

const SENSITIVE_DIRECTORIES = new Set([
  ".aws",
  ".azure",
  ".config/gcloud",
  ".gcloud",
  ".gnupg",
  ".ssh",
])

export function isDeniedRepositoryPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase()
  const parts = normalized.split("/").filter(Boolean)
  if (parts.includes(".git") || parts.includes(".nxl")) return true
  for (const sensitiveDir of SENSITIVE_DIRECTORIES) {
    const sensitiveParts = sensitiveDir.split("/")
    for (let index = 0; index <= parts.length - sensitiveParts.length; index += 1) {
      if (sensitiveParts.every((part, offset) => parts[index + offset] === part)) return true
    }
  }
  const name = parts.at(-1) ?? normalized
  if (SENSITIVE_BASENAMES.has(name)) return true
  if (/^\.env(?:\.|$)/.test(name)) return true
  if (/\.env\.local$/.test(name)) return true
  if (/\.(pem|key|p12|pfx)$/i.test(name)) return true
  return false
}
