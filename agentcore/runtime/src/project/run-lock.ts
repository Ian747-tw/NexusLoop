import { mkdir, open, rm } from "node:fs/promises"
import { dirname } from "node:path"

export class RunLock {
  private acquired = false

  constructor(readonly lockPath: string) {}

  async acquire(): Promise<void> {
    await mkdir(dirname(this.lockPath), { recursive: true })
    let handle
    try {
      handle = await open(this.lockPath, "wx")
      await handle.writeFile(JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() }) + "\n")
      this.acquired = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`runtime lock already held: ${this.lockPath}`)
      }
      throw error
    } finally {
      await handle?.close()
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
