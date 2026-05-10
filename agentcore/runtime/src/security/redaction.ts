const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"',\s}]+/gi,
]

export function redactText(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value)
}

export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T
  if (Array.isArray(value)) return value.map((item) => redactValue(item)) as T
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      output[key] = /secret|token|api[_-]?key|password/i.test(key) ? "[REDACTED]" : redactValue(item)
    }
    return output as T
  }
  return value
}
