const SENSITIVE_BASENAMES = new Set([
  ".env",
  ".envrc",
  "minimax.env",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  "id_rsa",
  "id_ed25519",
  "credentials",
  "credentials.json",
  "credentials.yaml",
  "credentials.yml",
  "credentials.tfrc.json",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
  "service-account.json",
  "service_account.json",
  "application_default_credentials.json",
  "auth.json",
  "auth.toml",
  ".vault-token",
  ".pgpass",
  ".s3cfg",
  ".terraformrc",
  "terraform.rc",
  "pip.conf",
  "pip.ini",
  "kubeconfig",
])

const SENSITIVE_DIRECTORIES = new Set([
  ".aws",
  ".azure",
  ".config/containers",
  ".config/gh",
  ".config/gcloud",
  ".config/hub",
  ".config/pip",
  ".config/pypoetry",
  ".docker",
  ".gcloud",
  ".gnupg",
  ".kube",
  ".ssh",
  ".terraform.d",
])

export function isDeniedRepositoryPath(path: string): boolean {
  if (/[\x00-\x1f\x7f]/.test(path)) return true
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase()
  const parts = normalized.split("/").filter(Boolean)
  if (parts.includes(".git") || parts.includes(".nxl")) return true
  for (const sensitiveDir of SENSITIVE_DIRECTORIES) {
    const sensitiveParts = sensitiveDir.split("/")
    for (let index = 0; index <= parts.length - sensitiveParts.length; index += 1) {
      if (sensitiveParts.every((part, offset) => parts[index + offset] === part)) return true
    }
  }
  if (parts.some((part) => SENSITIVE_BASENAMES.has(part))) return true
  if (parts.some((part) => /^\.env(?:\.|$)/.test(part))) return true
  if (parts.some((part) => /\.env\.local$/.test(part))) return true
  const name = parts.at(-1) ?? normalized
  if (/\.(pem|key|p12|pfx)$/i.test(name)) return true
  return false
}
