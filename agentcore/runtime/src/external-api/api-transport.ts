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
      const text = await response.text()
      return {
        status_code: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: truncateUtf8(text, input.max_response_bytes),
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(value)
  if (bytes.byteLength <= maxBytes) return value
  return new TextDecoder().decode(bytes.slice(0, maxBytes))
}

export class FakeExternalApiTransport implements ExternalApiTransport {
  readonly requests: ExternalApiTransportRequest[] = []

  constructor(private readonly responses: ExternalApiTransportResult[] = [{ status_code: 200, body: "{\"ok\":true,\"token\":\"fake-secret\"}" }]) {}

  async request(input: ExternalApiTransportRequest): Promise<ExternalApiTransportResult> {
    this.requests.push(input)
    return this.responses[Math.min(this.requests.length - 1, this.responses.length - 1)]
  }
}
