const secretPatterns = [
  /sk-[A-Za-z0-9][A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:api[_-]?key|token|secret|password)=["']?[^"' \n\r\t|,;]+/gi,
  /\b(?:api[_-]?key|token|secret|password):\s*["']?[^"',\n\r\t|;]+/gi,
]

export function redactText(value: string): string {
  return secretPatterns.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value)
}

export function redactUnknown<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item)) as T
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactUnknown(item)]),
  ) as T
}
