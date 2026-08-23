import { createHash } from "node:crypto"
import { lstat, readFile, stat } from "node:fs/promises"
import path from "node:path"

const MAX_CONFIG_FILE_BYTES = 65_536
const MAX_CONFIG_TOTAL_BYTES = 262_144

type PresentConfigSnapshot = Readonly<{
  source: string
  text: string
  size: number
  mtimeMs: number
  ino: number
  contentHash: string
}>

export type ConfigAuthoritySnapshot = Readonly<{
  present: readonly PresentConfigSnapshot[]
  missing: readonly string[]
}>

export async function captureConfigAuthority(files: readonly string[]): Promise<ConfigAuthoritySnapshot | undefined> {
  const present: PresentConfigSnapshot[] = []
  const missing: string[] = []
  for (const source of new Set(files)) {
    let before
    try {
      before = await lstat(source)
    } catch (error) {
      if (isMissing(error)) {
        missing.push(source)
        continue
      }
      return
    }
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_CONFIG_FILE_BYTES) return
    const text = await readFile(source, "utf8").catch(() => undefined)
    if (text === undefined || Buffer.byteLength(text, "utf8") > MAX_CONFIG_FILE_BYTES) return
    const after = await stat(source).catch(() => undefined)
    if (!after || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) return
    present.push(Object.freeze({
      source,
      text,
      size: after.size,
      mtimeMs: after.mtimeMs,
      ino: after.ino,
      contentHash: hashConfigText(text),
    }))
  }
  return Object.freeze({ present: Object.freeze(present), missing: Object.freeze(missing) })
}

export async function configAuthorityUnchanged(snapshot: ConfigAuthoritySnapshot): Promise<boolean> {
  for (const item of snapshot.present) {
    const current = await stat(item.source).catch(() => undefined)
    if (!current || current.size !== item.size || current.mtimeMs !== item.mtimeMs || current.ino !== item.ino) return false
    const text = await readFile(item.source, "utf8").catch(() => undefined)
    if (text === undefined || Buffer.byteLength(text, "utf8") > MAX_CONFIG_FILE_BYTES) return false
    const after = await stat(item.source).catch(() => undefined)
    if (!after || after.size !== current.size || after.mtimeMs !== current.mtimeMs || after.ino !== current.ino) return false
    if (hashConfigText(text) !== item.contentHash) return false
  }
  for (const source of snapshot.missing) {
    try {
      await lstat(source)
      return false
    } catch (error) {
      if (!isMissing(error)) return false
    }
  }
  return true
}

function hashConfigText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

export function replayConfigAuthority(
  snapshot: ConfigAuthoritySnapshot,
  files: readonly string[],
): Array<{ source: string; text: string }> | undefined {
  const bySource = new Map(snapshot.present.map((item) => [item.source, item]))
  const replay: Array<{ source: string; text: string }> = []
  let totalBytes = 0
  for (const source of files) {
    const item = bySource.get(source)
    if (!item) continue
    totalBytes += item.size
    if (totalBytes > MAX_CONFIG_TOTAL_BYTES) return
    replay.push({ source, text: item.text })
  }
  return replay
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

export function managedPreferenceAuthorityPaths(platform: string, username: string): readonly string[] {
  if (platform !== "darwin") return Object.freeze([])
  return Object.freeze([
    path.join("/Library/Managed Preferences", username, "ai.opencode.managed.plist"),
    path.join("/Library/Managed Preferences", "ai.opencode.managed.plist"),
  ])
}
