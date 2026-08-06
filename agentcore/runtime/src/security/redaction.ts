const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\b(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^"',\s}]+)/gi,
  /\b(?:aws[_-]?access[_-]?key[_-]?id|aws[_-]?secret[_-]?access[_-]?key|aws[_-]?session[_-]?token|aws[_-]?security[_-]?token|access[_-]?token|refresh[_-]?token|oauth[_-]?token|client[_-]?secret|client[_-]?key[_-]?data|private[_-]?key|auth)["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^"',\s}]+)/gi,
]

export function redactText(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value)
}

export function containsConcreteCredentialPayload(value: string): boolean {
  return /https?:\/\/|(?:^|\s)Bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|\b(?:api[_-]?key|token|secret|password|aws[_-]?access[_-]?key[_-]?id|aws[_-]?secret[_-]?access[_-]?key|aws[_-]?session[_-]?token|aws[_-]?security[_-]?token|access[_-]?token|refresh[_-]?token|oauth[_-]?token|client[_-]?secret|client[_-]?key[_-]?data|private[_-]?key|authorization|auth)["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^"',\s}]+)/i.test(value)
}

export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T
  if (Array.isArray(value)) return value.map((item) => redactValue(item)) as T
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const safeNumericTokenMetadata = typeof item === "number" && /(?:_tokens|_token_count)$/i.test(key)
      output[key] = /secret|token|api[_-]?key|password|aws[_-]?access[_-]?key[_-]?id|^auth$|private[_-]?key/i.test(key) && !safeNumericTokenMetadata ? "[REDACTED]" : redactValue(item)
    }
    return output as T
  }
  return value
}
