import { lookup as dnsLookup } from "node:dns/promises"
import { isIP } from "node:net"
import type { ExternalApiMethod } from "./api-connector-types"

export interface ExternalApiTransportRequest {
  method: ExternalApiMethod
  url: string
  headers: Record<string, string>
  body?: string
  timeout_ms: number
  max_response_bytes: number
  allow_local_test_host?: boolean
}

export interface ExternalApiTransportResult {
  status_code: number
  headers?: Record<string, string>
  body: string
}

export interface ExternalApiTransport {
  readonly requiresResolvedHostValidation?: boolean
  request(input: ExternalApiTransportRequest): Promise<ExternalApiTransportResult>
}

export interface ExternalApiResolvedAddress {
  address: string
  family?: number
}

export type ExternalApiHostResolver = (hostname: string) => Promise<ExternalApiResolvedAddress[]>

export class FetchExternalApiTransport implements ExternalApiTransport {
  readonly requiresResolvedHostValidation = true

  constructor(private readonly options: { resolveHostAddresses?: ExternalApiHostResolver } = {}) {}

  async request(input: ExternalApiTransportRequest): Promise<ExternalApiTransportResult> {
    const url = new URL(input.url)
    await validateResolvedHost(url.hostname, this.options.resolveHostAddresses, {
      allowLocalTestHost: input.allow_local_test_host === true && url.protocol === "http:" && isLocalTestHost(url.hostname),
    })
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

export interface ExternalApiResolvedHostValidationOptions {
  allowLocalTestHost?: boolean
}

export async function validateResolvedHost(hostname: string, resolver: ExternalApiHostResolver = defaultResolveHostAddresses, options: ExternalApiResolvedHostValidationOptions = {}): Promise<void> {
  const addresses = await resolver(hostname)
  if (addresses.length === 0) throw new Error(`host resolution returned no addresses: ${hostname}`)
  for (const address of addresses) {
    if (options.allowLocalTestHost === true && isLocalTestHost(hostname)) continue
    if (isPrivateOrLocalExternalApiAddress(address.address)) throw new Error(`resolved host is local/private: ${hostname}`)
  }
}

export async function defaultResolveHostAddresses(hostname: string): Promise<ExternalApiResolvedAddress[]> {
  const normalized = normalizeHost(hostname)
  if (normalized === "localhost") return [{ address: normalized }]
  const ipFamily = isIP(normalized)
  if (ipFamily !== 0) return [{ address: normalized, family: ipFamily }]
  return dnsLookup(normalized, { all: true, verbatim: true })
}

export function isPrivateOrLocalExternalApiAddress(address: string): boolean {
  const normalized = normalizeHost(address)
  const mappedIpv4 = mappedIpv4Address(normalized)
  if (mappedIpv4) return isPrivateOrLocalExternalApiAddress(mappedIpv4)
  const ipFamily = isIP(normalized)
  if (normalized === "localhost" || normalized === "::1" || normalized === "::" || normalized === "0.0.0.0" || (ipFamily === 4 && normalized.startsWith("127."))) return true
  if (/^f[cd][0-9a-f]{0,2}:/.test(normalized) || /^fe[89ab][0-9a-f]?:/.test(normalized)) return true
  return ipFamily === 4 && (normalized.startsWith("10.") ||
    normalized.startsWith("169.254.") ||
    normalized.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized))
}

function isLocalTestHost(host: string): boolean {
  const normalized = normalizeHost(host)
  return normalized === "localhost" || normalized.endsWith(".test")
}

function mappedIpv4Address(normalized: string): string | null {
  const dotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) return dotted[1] ?? null
  const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (!hex) return null
  const high = Number.parseInt(hex[1] ?? "", 16)
  const low = Number.parseInt(hex[2] ?? "", 16)
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) return null
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "")
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
