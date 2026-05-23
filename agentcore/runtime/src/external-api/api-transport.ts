import type { ExternalApiMethod } from "./api-connector-types"

export interface ExternalApiTransportRequest {
  method: ExternalApiMethod
  url: string
  headers: Record<string, string>
  body?: string
  timeout_ms: number
  max_response_bytes: number
}

export interface ExternalApiTransportResult {
  status_code: number
  headers?: Record<string, string>
  body: string
}

export interface ExternalApiTransport {
  request(input: ExternalApiTransportRequest): Promise<ExternalApiTransportResult>
}

export class FetchExternalApiTransport implements ExternalApiTransport {
  async request(input: ExternalApiTransportRequest): Promise<ExternalApiTransportResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.timeout_ms)
    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        redirect: "manual",
        signal: controller.signal,
      })
      return {
        status_code: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await readBoundedBody(response, input.max_response_bytes),
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
      const remaining = Math.max(0, maxBytes - total)
      if (chunk.byteLength > remaining) {
        if (remaining > 0) {
          chunks.push(chunk.slice(0, remaining))
          total += remaining
        }
        await reader.cancel()
        break
      }
      chunks.push(chunk)
      total += chunk.byteLength
      if (total >= maxBytes) {
        await reader.cancel()
        break
      }
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return decodeCompleteUtf8(bytes)
}

function decodeCompleteUtf8(bytes: Uint8Array): string {
  const decoder = new TextDecoder("utf-8", { fatal: true })
  for (let end = bytes.byteLength; end > 0; end -= 1) {
    try {
      return decoder.decode(bytes.slice(0, end))
    } catch {
      // Keep backing off until the slice ends on a complete UTF-8 codepoint.
    }
  }
  return ""
}

export class FakeExternalApiTransport implements ExternalApiTransport {
  readonly requests: ExternalApiTransportRequest[] = []

  constructor(private readonly responses: ExternalApiTransportResult[] = [{ status_code: 200, body: "{\"ok\":true,\"token\":\"fake-secret\"}" }]) {}

  async request(input: ExternalApiTransportRequest): Promise<ExternalApiTransportResult> {
    this.requests.push(input)
    return this.responses[Math.min(this.requests.length - 1, this.responses.length - 1)]
  }
}
