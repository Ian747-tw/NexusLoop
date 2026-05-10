import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rm } from "node:fs/promises"
import { dirname } from "node:path"

interface LockRecord {
  pid: number
  acquired_at: string
  token: string
}

export interface RunLockOptions {
  staleAfterMs?: number
  now?: () => Date
  beforeRemoveStale?: () => Promise<void> | void
}

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000

export class RunLock {
  private acquired = false
  private readonly staleAfterMs: number
  private readonly now: () => Date
  private readonly beforeRemoveStale?: () => Promise<void> | void
  private readonly token = randomUUID()

  constructor(readonly lockPath: string, options: RunLockOptions = {}) {
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
    this.now = options.now ?? (() => new Date())
    this.beforeRemoveStale = options.beforeRemoveStale
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
    if (candidate.record) {
      if (this.isProcessLive(candidate.record.pid)) return false
      if (!this.isExpired(candidate.record.acquired_at)) return false
    }
    await this.beforeRemoveStale?.()
    const current = await this.readLockCandidate()
    if (!current || current.raw !== candidate.raw) return false
    await rm(this.lockPath, { force: true })
    return true
  }

  private async readLockCandidate(): Promise<{ raw: string; record: LockRecord | null } | null> {
    try {
      const text = await readFile(this.lockPath, "utf8")
      return { raw: text, record: this.parseLockRecord(text) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      return null
    }
  }

  private parseLockRecord(text: string): LockRecord | null {
    try {
      const raw = JSON.parse(text) as Partial<LockRecord>
      const pid = raw.pid
      if (!Number.isInteger(pid) || pid === undefined || pid <= 0 || typeof raw.acquired_at !== "string") return null
      if (typeof raw.token !== "string" || raw.token.length === 0) return null
      if (Number.isNaN(Date.parse(raw.acquired_at))) return null
      return { pid, acquired_at: raw.acquired_at, token: raw.token }
    } catch {
      return null
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
    const current = await this.readLockCandidate()
    if (current?.record?.pid === process.pid && current.record.token === this.token) {
      await rm(this.lockPath, { force: true })
    }
    this.acquired = false
  }

  isHeld(): boolean {
    return this.acquired
  }
}
