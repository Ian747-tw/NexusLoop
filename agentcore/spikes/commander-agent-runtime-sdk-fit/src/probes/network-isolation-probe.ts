export type NetworkGuard = {
  attempted: string[]
  restore(): void
}

export function installNetworkGuard(allowedOrigins: string[]): NetworkGuard {
  const originalFetch = globalThis.fetch
  const attempted: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" || input instanceof URL ? new URL(input) : new URL(input.url)
    if (!allowedOrigins.includes(url.origin)) {
      attempted.push(`${url.protocol}//${url.host}`)
      throw new Error(`network guard blocked ${url.protocol}//${url.host}`)
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    for (const [key, value] of headers.entries()) {
      if (/authorization|api[-_]key|token/i.test(key) && /sk-|real|live/i.test(value)) {
        throw new Error("network guard blocked real-looking credential")
      }
    }
    return originalFetch(input as RequestInfo, init)
  }) as typeof fetch
  return {
    attempted,
    restore() {
      globalThis.fetch = originalFetch
    },
  }
}
