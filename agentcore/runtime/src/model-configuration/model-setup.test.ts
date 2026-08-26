import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { EventStore } from "../events/event-store"
import {
  MODEL_SETUP_CATALOG_POLICY_VERSION,
  MODEL_SETUP_EVENT_KIND,
  ModelSetupService,
  buildModelSetupCandidate,
  modelSetupCatalog,
  projectModelSetupEvents,
  readPersistedModelSetupAuthority,
} from "./model-setup"

describe("9W4E model setup authority", () => {
  test("catalog is immutable, credential-free, and limits Commander to exact recipes", () => {
    const catalog = modelSetupCatalog()
    expect(catalog.policy_version).toBe(MODEL_SETUP_CATALOG_POLICY_VERSION)
    expect(catalog.commander_recipes.map((item) => item.recipe_id)).toEqual([
      "commander-anthropic-claude-sonnet-4-5",
      "commander-google-gemini-2-5-flash",
      "commander-openai-gpt-4-1-mini-responses",
    ])
    expect(Object.isFrozen(catalog)).toBe(true)
    expect(Object.isFrozen(catalog.commander_recipes)).toBe(true)
    const serialized = JSON.stringify(catalog)
    for (const forbidden of ["base_url", "env_name", "api_key", "authorization", "header", "package", "plugin"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden)
    }
  })

  test("builds same, different, and explicitly unconfigured role choices without fallback", () => {
    const same = buildModelSetupCandidate({
      commander_recipe_id: "commander-anthropic-claude-sonnet-4-5",
      executor_recipe_id: "executor-anthropic-claude-sonnet-4-5",
    })
    expect(same.commander_selection?.model_id).toBe("claude-sonnet-4-5-20250929")
    expect(same.executor_selection?.model_id).toBe("claude-sonnet-4-5-20250929")
    expect(same.commander_selection?.projection_hash).not.toBe(same.executor_selection?.projection_hash)

    const different = buildModelSetupCandidate({
      commander_recipe_id: "commander-openai-gpt-4-1-mini-responses",
      executor_recipe_id: "executor-google-gemini-2-5-flash",
    })
    expect(different.commander_selection?.provider_kind).toBe("openai")
    expect(different.executor_selection?.provider_kind).toBe("google")

    const commanderOnly = buildModelSetupCandidate({ commander_recipe_id: "commander-google-gemini-2-5-flash", executor_recipe_id: null })
    expect(commanderOnly.commander_selection).toBeDefined()
    expect(commanderOnly.executor_selection).toBeUndefined()
    const executorOnly = buildModelSetupCandidate({ commander_recipe_id: null, executor_recipe_id: "executor-openai-gpt-4-1-mini" })
    expect(executorOnly.commander_selection).toBeUndefined()
    expect(executorOnly.executor_selection).toBeDefined()
  })

  test("rejects unknown recipes, unknown fields, accessors, symbols, and caller mutation", () => {
    expect(() => buildModelSetupCandidate({ commander_recipe_id: "unknown", executor_recipe_id: null })).toThrow("unknown Commander setup recipe")
    expect(() => buildModelSetupCandidate({ commander_recipe_id: null, executor_recipe_id: null, extra: true } as never)).toThrow("unknown")
    let getterCalls = 0
    const accessor = Object.defineProperty({ executor_recipe_id: null }, "commander_recipe_id", {
      enumerable: true,
      get() { getterCalls += 1; return null },
    })
    expect(() => buildModelSetupCandidate(accessor as never)).toThrow()
    expect(getterCalls).toBe(0)
    const symbolic = { commander_recipe_id: null, executor_recipe_id: null } as Record<PropertyKey, unknown>
    symbolic[Symbol("hidden")] = "secret"
    expect(() => buildModelSetupCandidate(symbolic as never)).toThrow()

    const input = { commander_recipe_id: "commander-google-gemini-2-5-flash", executor_recipe_id: null }
    const candidate = buildModelSetupCandidate(input)
    input.commander_recipe_id = "commander-openai-gpt-4-1-mini-responses"
    expect(candidate.commander_selection?.model_id).toBe("gemini-2.5-flash")
    expect(Object.isFrozen(candidate.configuration)).toBe(true)
  })

  test("rejects inherited fields, arrays, live proxies, and revoked proxies without executing caller code", () => {
    let inheritedCalls = 0
    const prototype = Object.create(null)
    Object.defineProperty(prototype, "commander_recipe_id", { get() { inheritedCalls += 1; return null } })
    const inherited = Object.create(prototype)
    Object.defineProperty(inherited, "executor_recipe_id", { value: null, enumerable: true })
    expect(() => buildModelSetupCandidate(inherited)).toThrow()
    expect(inheritedCalls).toBe(0)
    expect(() => buildModelSetupCandidate(new Array(3))).toThrow("plain object")

    let traps = 0
    const proxied = new Proxy({ commander_recipe_id: null, executor_recipe_id: null }, {
      ownKeys() { traps += 1; return [] },
      getOwnPropertyDescriptor() { traps += 1; return undefined },
      getPrototypeOf() { traps += 1; return Object.prototype },
    })
    expect(() => buildModelSetupCandidate(proxied)).toThrow("Proxy")
    expect(traps).toBe(0)
    const revoked = Proxy.revocable({ commander_recipe_id: null, executor_recipe_id: null }, {})
    revoked.revoke()
    expect(() => buildModelSetupCandidate(revoked.proxy)).toThrow("Proxy")
  })

  test("rejects authority-shaped operator identity without persisting it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nxl-model-setup-identity-"))
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    const service = new ModelSetupService({ eventStore: store })
    const choices = { commander_recipe_id: null, executor_recipe_id: null } as const
    const preview = await service.preview(choices)
    for (const confirmedBy of ["AWS_PROFILE", "AUTH_JSON", "NXL_REGION", "https://host.example", "Authorization"]) {
      await expect(service.confirm({ ...choices, expected_revision: 0, candidate_hash: preview.candidate_hash, confirmed_by: confirmedBy, confirmation: "CONFIRM_MODEL_SETUP" })).rejects.toThrow()
    }
    expect(await store.readAll()).toHaveLength(0)
  })

  test("previews and atomically commits one revision with idempotent exact replay", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nxl-model-setup-"))
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    const service = new ModelSetupService({ eventStore: store, now: () => new Date("2026-08-22T00:00:00.000Z") })
    const choices = { commander_recipe_id: "commander-openai-gpt-4-1-mini-responses", executor_recipe_id: "executor-anthropic-claude-sonnet-4-5" } as const
    const preview = await service.preview(choices)
    expect(preview.expected_revision).toBe(0)
    expect(preview.restart_required).toBe(true)
    const input = { ...choices, expected_revision: 0, candidate_hash: preview.candidate_hash, confirmed_by: "human-operator", confirmation: "CONFIRM_MODEL_SETUP" } as const
    const [left, right] = await Promise.all([service.confirm(input), service.confirm(input)])
    expect([left.status, right.status].sort()).toEqual(["committed", "idempotent"])
    const events = await store.readAll()
    expect(events.filter((event) => event.kind === MODEL_SETUP_EVENT_KIND)).toHaveLength(1)
    const setup = events.find((event) => event.kind === MODEL_SETUP_EVENT_KIND)!
    expect(setup.revision).toBe(1)
    expect(JSON.stringify(setup)).not.toMatch(/secret|env_name|base_url|authorization|header/i)

    const currentPreview = await service.preview(choices)
    const unchanged = await service.confirm({ ...input, expected_revision: currentPreview.expected_revision })
    expect(unchanged).toMatchObject({ status: "idempotent", revision: 1, setup_hash: setup.event_payload_hash })
    expect((await store.readAll()).filter((event) => event.kind === MODEL_SETUP_EVENT_KIND)).toHaveLength(1)
    await expect(service.confirm({ ...input, confirmed_by: "different-operator" })).rejects.toThrow("stale")
    expect((await store.readAll()).filter((event) => event.kind === MODEL_SETUP_EVENT_KIND)).toHaveLength(1)
  })

  test("stale revisions and candidate hashes fail without appending", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nxl-model-setup-stale-"))
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    const service = new ModelSetupService({ eventStore: store })
    const choices = { commander_recipe_id: null, executor_recipe_id: "executor-google-gemini-2-5-flash" } as const
    const preview = await service.preview(choices)
    await expect(service.confirm({ ...choices, expected_revision: 1, candidate_hash: preview.candidate_hash, confirmed_by: "operator", confirmation: "CONFIRM_MODEL_SETUP" })).rejects.toThrow("stale")
    await expect(service.confirm({ ...choices, expected_revision: 0, candidate_hash: "0".repeat(64), confirmed_by: "operator", confirmation: "CONFIRM_MODEL_SETUP" })).rejects.toThrow("candidate hash")
    expect((await store.readAll()).filter((event) => event.kind === MODEL_SETUP_EVENT_KIND)).toHaveLength(0)
  })

  test("concurrent different confirmations produce one durable winner", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nxl-model-setup-concurrent-"))
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    const left = new ModelSetupService({ eventStore: store })
    const right = new ModelSetupService({ eventStore: store })
    const leftChoices = { commander_recipe_id: null, executor_recipe_id: "executor-google-gemini-2-5-flash" } as const
    const rightChoices = { commander_recipe_id: null, executor_recipe_id: "executor-openai-gpt-4-1-mini" } as const
    const [leftPreview, rightPreview] = await Promise.all([left.preview(leftChoices), right.preview(rightChoices)])
    const settled = await Promise.allSettled([
      left.confirm({ ...leftChoices, expected_revision: 0, candidate_hash: leftPreview.candidate_hash, confirmed_by: "operator-left", confirmation: "CONFIRM_MODEL_SETUP" }),
      right.confirm({ ...rightChoices, expected_revision: 0, candidate_hash: rightPreview.candidate_hash, confirmed_by: "operator-right", confirmation: "CONFIRM_MODEL_SETUP" }),
    ])
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1)
    expect(settled.filter((item) => item.status === "rejected")).toHaveLength(1)
    expect((await store.readAll()).filter((event) => event.kind === MODEL_SETUP_EVENT_KIND)).toHaveLength(1)
  })

  test("concurrent identical confirmations reconcile one semantic winner across different timestamps", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nxl-model-setup-identical-concurrent-"))
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    const left = new ModelSetupService({ eventStore: store, now: () => new Date("2026-08-22T00:00:00.000Z") })
    const right = new ModelSetupService({ eventStore: store, now: () => new Date("2026-08-22T00:00:01.000Z") })
    const choices = { commander_recipe_id: null, executor_recipe_id: "executor-openai-gpt-4-1-mini" } as const
    const preview = await left.preview(choices)
    const input = { ...choices, expected_revision: 0, candidate_hash: preview.candidate_hash, confirmed_by: "operator", confirmation: "CONFIRM_MODEL_SETUP" } as const
    const settled = await Promise.all([left.confirm(input), right.confirm(input)])
    expect(settled.map((item) => item.status).sort()).toEqual(["committed", "idempotent"])
    expect(new Set(settled.map((item) => item.setup_hash)).size).toBe(1)
    expect((await store.readAll()).filter((event) => event.kind === MODEL_SETUP_EVENT_KIND)).toHaveLength(1)
  })

  test("confirmation ignores sustained unrelated tail appends without weakening setup revision authority", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nxl-model-setup-unrelated-tail-"))
    const store = new EventStore(join(dir, ".nxl", "events.jsonl"))
    const service = new ModelSetupService({ eventStore: store })
    const choices = { commander_recipe_id: null, executor_recipe_id: "executor-openai-gpt-4-1-mini" } as const
    const preview = await service.preview(choices)
    const original = store.appendIfLatestKind.bind(store)
    let attempts = 0
    store.appendIfLatestKind = (async (...args: Parameters<typeof original>) => {
      attempts += 1
      for (let index = 0; index < 5; index += 1) {
        await store.append({ kind: "runtime_status_observed", observation_sequence: index })
      }
      return original(...args)
    }) as typeof store.appendIfLatestKind

    await expect(service.confirm({ ...choices, expected_revision: 0, candidate_hash: preview.candidate_hash, confirmed_by: "operator", confirmation: "CONFIRM_MODEL_SETUP" })).resolves.toMatchObject({ status: "committed", revision: 1 })
    expect(attempts).toBe(1)
    expect((await store.readAll()).filter((event) => event.kind === MODEL_SETUP_EVENT_KIND)).toHaveLength(1)
  })

  test("projection and startup reader fail closed on corrupt, duplicate, and truncated setup records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nxl-model-setup-corrupt-"))
    const path = join(dir, ".nxl", "events.jsonl")
    const store = new EventStore(path)
    const service = new ModelSetupService({ eventStore: store })
    const choices = { commander_recipe_id: "commander-anthropic-claude-sonnet-4-5", executor_recipe_id: null } as const
    const preview = await service.preview(choices)
    await service.confirm({ ...choices, expected_revision: 0, candidate_hash: preview.candidate_hash, confirmed_by: "operator", confirmation: "CONFIRM_MODEL_SETUP" })
    const events = await store.readAll()
    const authority = readPersistedModelSetupAuthority(dir)
    expect(authority?.candidate.commander_selection?.model_id).toBe("claude-sonnet-4-5-20250929")
    const setupEvent = events.find((event) => event.kind === MODEL_SETUP_EVENT_KIND)!
    const { event_id: _eventId, timestamp: _timestamp, ...payloadOnly } = setupEvent
    expect(() => projectModelSetupEvents([payloadOnly as typeof setupEvent])).toThrow("EventStore envelope")
    expect(() => projectModelSetupEvents([{ ...setupEvent, event_id: "" }])).toThrow("event_id")
    expect(() => projectModelSetupEvents([{ ...setupEvent, timestamp: "not-a-timestamp" }])).toThrow("timestamp")
    const noncanonicalCommit: Record<string, unknown> = { ...setupEvent, committed_at: "2026-08-22" }
    noncanonicalCommit.event_payload_hash = setupPayloadHash(noncanonicalCommit)
    expect(() => projectModelSetupEvents([noncanonicalCommit])).toThrow("committed_at")
    expect(() => projectModelSetupEvents([...events, events.find((event) => event.kind === MODEL_SETUP_EVENT_KIND)!])).toThrow("revision")
    await writeFile(path, `${await readFile(path, "utf8")}{\"kind\":\"${MODEL_SETUP_EVENT_KIND}\"`, "utf8")
    expect(() => readPersistedModelSetupAuthority(dir)).toThrow("model setup journal is malformed")
  })
})

function setupPayloadHash(event: Record<string, unknown>): string {
  const { kind: _kind, event_id: _eventId, timestamp: _timestamp, event_payload_hash: _hash, ...payload } = event
  return createHash("sha256").update(canonicalJson(payload)).digest("hex")
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`
}
