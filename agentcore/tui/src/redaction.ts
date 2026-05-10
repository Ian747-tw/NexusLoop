const secretPatterns = [
  /sk-[A-Za-z0-9][A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
]

export function redactText(value: string): string {
  return secretPatterns.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value)
}
