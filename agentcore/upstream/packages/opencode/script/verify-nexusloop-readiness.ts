import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const platform = process.platform === "win32" ? "windows" : process.platform
const executable = process.platform === "win32" ? "opencode.exe" : "opencode"
const source = path.resolve(`dist/opencode-${platform}-${process.arch}/bin/${executable}`)

if (!(await Bun.file(source).exists())) throw new Error("Packaged OpenCode executable is unavailable")

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-readiness-package-"))
try {
  const binary = path.join(root, executable)
  await fs.copyFile(source, binary)
  await fs.chmod(binary, 0o755)
  for (const dir of ["project", "config", "data", "state", "cache", "home"]) {
    await fs.mkdir(path.join(root, dir), { recursive: true })
  }
  const before = await tree(root)
  const request = {
    request_version: "nexusloop_opencode_executor_readiness_request_v1",
    selection_projection_hash: "c".repeat(64),
    provider_id: "openai",
    model_id: "gpt-5",
    credential_binding_id: "executor-primary",
  }

  const connected = run(binary, root, JSON.stringify(request), {
    OPENCODE_AUTH_CONTENT: JSON.stringify({ openai: { type: "api", key: "sk-package-verifier-secret" } }),
  })
  assert(connected.exitCode === 0, "connected observation failed")
  assert(connected.stderr === "", "connected observation wrote diagnostics")
  const connectedResult = result(connected.stdout)
  assert(connectedResult.provider_availability_status === "available", "known model was not available")
  assert(connectedResult.credential_connection_status === "connected", "credential was not connected")

  const disconnected = result(run(binary, root, JSON.stringify(request), {}).stdout)
  assert(disconnected.provider_availability_status === "available", "availability depended on credentials")
  assert(disconnected.credential_connection_status === "disconnected", "missing credential was not disconnected")

  const unavailable = result(run(binary, root, JSON.stringify({ ...request, model_id: "missing-model" }), {}).stdout)
  assert(unavailable.provider_availability_status === "unavailable", "missing exact model was not unavailable")

  const duplicate = run(
    binary,
    root,
    `{"request_version":"nexusloop_opencode_executor_readiness_request_v1","selection_projection_hash":"${"c".repeat(64)}","provider_id":"openai","provider_id":"anthropic","model_id":"gpt-5","credential_binding_id":"executor-primary"}`,
    {},
  )
  assert(duplicate.exitCode === 2, "duplicate authority did not fail")
  assert(duplicate.stdout === "", "duplicate authority produced observation output")
  assert(duplicate.stderr === "NexusLoop Executor readiness observation failed\n", "failure diagnostics drifted")

  const oversized = run(binary, root, "x".repeat(5000), {})
  assert(oversized.exitCode === 2 && oversized.stdout === "", "oversized authority did not fail cleanly")

  const serialized = JSON.stringify({ connected, disconnected, unavailable, duplicate, oversized })
  for (const forbidden of [
    "sk-package-verifier-secret",
    "OPENCODE_AUTH_CONTENT",
    "OPENAI_API_KEY",
    "authorization",
    "auth.json",
    "node_modules",
  ]) {
    assert(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `output exposed ${forbidden}`)
  }
  assert(JSON.stringify(await tree(root)) === JSON.stringify(before), "readiness command wrote persistent state")
  process.stdout.write("packaged readiness executable: pass\n")
  process.stdout.write("source-tree dependency resolution: absent\n")
  process.stdout.write("persistent writes: 0\n")
  process.stdout.write("provider/model requests: 0\n")
} finally {
  await fs.rm(root, { recursive: true, force: true })
}

function run(binary: string, root: string, stdin: string, extra: Record<string, string>) {
  const process = Bun.spawnSync({
    cmd: [binary, "nexusloop", "executor-readiness-v1"],
    cwd: path.join(root, "project"),
    stdin: Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: processEnvPath(),
      HOME: path.join(root, "home"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_STATE_HOME: path.join(root, "state"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      ...extra,
    },
    timeout: 10_000,
  })
  return {
    exitCode: process.exitCode,
    stdout: process.stdout.toString(),
    stderr: process.stderr.toString(),
  }
}

function result(text: string): Record<string, unknown> {
  const lines = text.split("\n").filter(Boolean)
  assert(lines.length === 1, "command did not emit exactly one result")
  const value = JSON.parse(lines[0]!)
  assert(typeof value === "object" && value !== null && !Array.isArray(value), "result is not an object")
  const expected = [
    "credential_binding_id",
    "credential_connection_status",
    "evidence_id",
    "model_id",
    "observation_version",
    "provider_availability_status",
    "provider_id",
    "selection_projection_hash",
  ].sort()
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected), "result keys drifted")
  return value
}

async function tree(root: string): Promise<string[]> {
  const output: string[] = []
  async function scan(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const item = path.join(dir, entry.name)
      output.push(path.relative(root, item))
      if (entry.isDirectory()) await scan(item)
    }
  }
  await scan(root)
  return output
}

function processEnvPath() {
  return process.platform === "win32" ? process.env.PATH ?? "" : "/usr/bin:/bin"
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
