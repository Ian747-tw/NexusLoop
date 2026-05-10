import { mkdir, open, readFile, rm } from "node:fs/promises"
import { dirname } from "node:path"

interface LockRecord {
  pid: number
  acquired_at: string
}

export class RunLock {
  private acquired = false

  constructor(readonly lockPath: string) {}

  async acquire(): Promise<void> {
    await mkdir(dirname(this.lockPath), { recursive: true })
    await this.tryAcquire(false)
  }

  private async tryAcquire(retriedAfterStale: boolean): Promise<void> {
    let handle
    try {
      handle = await open(this.lockPath, "wx")
      await handle.writeFile(JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() }) + "\n")
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
    const record = await this.readLockRecord()
    if (record && this.isProcessLive(record.pid)) return false
    await rm(this.lockPath, { force: true })
    return true
  }

  private async readLockRecord(): Promise<LockRecord | null> {
    try {
      const raw = JSON.parse(await readFile(this.lockPath, "utf8")) as Partial<LockRecord>
      const pid = raw.pid
      if (!Number.isInteger(pid) || pid === undefined || pid <= 0 || typeof raw.acquired_at !== "string") return null
      return { pid, acquired_at: raw.acquired_at }
    } catch {
      return null
    }
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
    await rm(this.lockPath, { force: true })
    this.acquired = false
  }

  isHeld(): boolean {
    return this.acquired
  }
}
