import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"

export function locateProjectRoot(startDir = process.cwd()): string {
  let current = resolve(startDir)
  while (true) {
    if (existsSync(resolve(current, ".nxl"))) return current
    const parent = dirname(current)
    if (parent === current) return resolve(startDir)
    current = parent
  }
}

export function projectName(projectDir: string): string {
  return resolve(projectDir).split(/[\\/]/).filter(Boolean).at(-1) ?? "project"
}
