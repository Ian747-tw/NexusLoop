const SENSITIVE_BASENAMES = new Set([
  ".env",
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
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "")
  const parts = normalized.split("/").filter(Boolean)
  if (parts[0] === ".git" || parts[0] === ".nxl") return true
  for (const sensitiveDir of SENSITIVE_DIRECTORIES) {
    if (normalized === sensitiveDir || normalized.startsWith(`${sensitiveDir}/`)) return true
  }
  const name = parts.at(-1) ?? normalized
  if (SENSITIVE_BASENAMES.has(name)) return true
  if (/^\.env(?:\.|$)/.test(name)) return true
  if (/\.env\.local$/.test(name)) return true
  if (/\.(pem|key|p12|pfx)$/i.test(name)) return true
  return false
}
