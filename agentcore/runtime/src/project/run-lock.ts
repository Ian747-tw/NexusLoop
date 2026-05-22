import { randomUUID } from "node:crypto"
import { constants, copyFile, link, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

interface LockRecord {
  pid: number
  acquired_at: string
  token: string
}

type LockCandidate =
  | { raw: string; kind: "modern"; record: LockRecord }
  | { raw: string; kind: "legacy"; pid: number }
  | { raw: string; kind: "invalid" }

export interface RunLockOptions {
  staleAfterMs?: number
  now?: () => Date
  beforeRemoveStale?: () => Promise<void> | void
  beforeStaleRename?: () => Promise<void> | void
  beforeRestoreMovedLock?: () => Promise<void> | void
  beforeSecondOwnedLockPathCheck?: () => Promise<void> | void
  linkMovedLock?: (existingPath: string, newPath: string) => Promise<void>
}

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000

export class RunLock {
  private acquired = false
  private readonly staleAfterMs: number
  private readonly now: () => Date
  private readonly beforeRemoveStale?: () => Promise<void> | void
  private readonly beforeStaleRename?: () => Promise<void> | void
  private readonly beforeRestoreMovedLock?: () => Promise<void> | void
  private readonly beforeSecondOwnedLockPathCheck?: () => Promise<void> | void
  private readonly linkMovedLock: (existingPath: string, newPath: string) => Promise<void>
  private readonly token = randomUUID()

  constructor(readonly lockPath: string, options: RunLockOptions = {}) {
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
    this.now = options.now ?? (() => new Date())
    this.beforeRemoveStale = options.beforeRemoveStale
    this.beforeStaleRename = options.beforeStaleRename
    this.beforeRestoreMovedLock = options.beforeRestoreMovedLock
    this.beforeSecondOwnedLockPathCheck = options.beforeSecondOwnedLockPathCheck
    this.linkMovedLock = options.linkMovedLock ?? link
  }

  async acquire(): Promise<void> {
    await mkdir(dirname(this.lockPath), { recursive: true })
    await this.tryAcquire(false)
  }

  private async tryAcquire(retriedAfterStale: boolean): Promise<void> {
    let handle
    try {
      handle = await open(this.lockPath, "wx")
      await handle.writeFile(JSON.stringify({ pid: process.pid, acquired_at: this.now().toISOString(), token: this.token }) + "\n")
      this.acquired = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST" && !retriedAfterStale) {
        if (await this.removeIfStale()) {
          await this.tryAcquire(true)
          return
        }
        throw new Error(`runtime lock already held: ${this.lockPath}`)
      }
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`runtime lock already held: ${this.lockPath}`)
      }
      throw error
    } finally {
      await handle?.close()
    }
  }

  private async removeIfStale(): Promise<boolean> {
    const candidate = await this.readLockCandidate()
    if (!candidate) return true
    if (candidate.kind === "modern") {
      if (this.isProcessLive(candidate.record.pid)) return false
    }
    if (candidate.kind === "legacy" && this.isProcessLive(candidate.pid)) return false
    await this.beforeRemoveStale?.()
    const current = await this.readLockCandidate()
    if (!current || current.raw !== candidate.raw) return false
    const stalePath = `${this.lockPath}.${this.token}.stale`
    try {
      await this.beforeStaleRename?.()
      await rename(this.lockPath, stalePath)
      const moved = await readFile(stalePath, "utf8")
      if (moved !== candidate.raw) {
        await this.beforeRestoreMovedLock?.()
        await this.restoreMovedLockWithoutClobber(stalePath, moved)
        return false
      }
      await rm(stalePath, { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
      throw error
    }
    return true
  }

  private async restoreMovedLockWithoutClobber(stalePath: string, raw: string): Promise<void> {
    try {
      const current = await readFile(stalePath, "utf8")
      if (current !== raw) return
      await this.linkMovedLock(stalePath, this.lockPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (isUnsupportedHardLinkError(code)) {
        await this.copyMovedLockWithoutClobber(stalePath)
        return
      }
      if (code !== "EEXIST" && code !== "ENOENT") throw error
    } finally {
      await rm(stalePath, { force: true })
    }
  }

  private async copyMovedLockWithoutClobber(stalePath: string): Promise<void> {
    try {
      await copyFile(stalePath, this.lockPath, constants.COPYFILE_EXCL)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "EEXIST" && code !== "ENOENT") throw error
    }
  }

  private async readLockCandidate(): Promise<LockCandidate | null> {
    try {
      const text = await readFile(this.lockPath, "utf8")
      return this.parseLockCandidate(text)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      return null
    }
  }

  private parseLockCandidate(text: string): LockCandidate {
    const legacyPid = Number(text.trim())
    if (Number.isInteger(legacyPid) && legacyPid > 0) return { raw: text, kind: "legacy", pid: legacyPid }
    try {
      const raw = JSON.parse(text) as Partial<LockRecord>
      const pid = raw.pid
      if (!Number.isInteger(pid) || pid === undefined || pid <= 0 || typeof raw.acquired_at !== "string") return { raw: text, kind: "invalid" }
      if (typeof raw.token !== "string" || raw.token.length === 0) return { raw: text, kind: "invalid" }
      if (Number.isNaN(Date.parse(raw.acquired_at))) return { raw: text, kind: "invalid" }
      return { raw: text, kind: "modern", record: { pid, acquired_at: raw.acquired_at, token: raw.token } }
    } catch {
      return { raw: text, kind: "invalid" }
    }
  }

  private isExpired(acquiredAt: string): boolean {
    return this.now().getTime() - Date.parse(acquiredAt) > this.staleAfterMs
  }

  private isProcessLive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ESRCH") return false
      if (code === "EPERM") return true
      return false
    }
  }

  async release(): Promise<void> {
    if (!this.acquired) return
    await this.removeOwnedLockPath()
    await this.removeMovedLockForToken()
    await this.beforeSecondOwnedLockPathCheck?.()
    await this.removeOwnedLockPath()
    this.acquired = false
  }

  private async removeOwnedLockPath(): Promise<void> {
    const current = await this.readLockCandidate()
    if (current?.kind === "modern" && current.record.pid === process.pid && current.record.token === this.token) {
      await rm(this.lockPath, { force: true })
    }
  }

  isHeld(): boolean {
    return this.acquired
  }

  private async removeMovedLockForToken(): Promise<void> {
    const lockDir = dirname(this.lockPath)
    const prefix = `${basename(this.lockPath)}.`
    let entries: string[]
    try {
      entries = await readdir(lockDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      throw error
    }
    for (const entry of entries) {
      if (!entry.startsWith(prefix) || !entry.endsWith(".stale")) continue
      const stalePath = join(lockDir, entry)
      let candidate: LockCandidate
      try {
        candidate = this.parseLockCandidate(await readFile(stalePath, "utf8"))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
        throw error
      }
      if (candidate.kind === "modern" && candidate.record.pid === process.pid && candidate.record.token === this.token) {
        await rm(stalePath, { force: true })
      }
    }
  }
}

function isUnsupportedHardLinkError(code: string | undefined): boolean {
  return code === "EPERM" || code === "EOPNOTSUPP" || code === "ENOTSUP" || code === "EXDEV"
}
