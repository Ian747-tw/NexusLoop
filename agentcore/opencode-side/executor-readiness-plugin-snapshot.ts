export type PluginAuthoritySnapshot = Readonly<{
  status: "present" | "absent" | "unknown"
  matches: readonly string[]
}>

type GlobScanner = {
  scan(pattern: string, options: { cwd: string; absolute: boolean; dot: boolean; symlink: boolean }): Promise<string[]>
}

export async function snapshotPluginAuthority(
  directories: readonly string[],
  glob: GlobScanner,
): Promise<PluginAuthoritySnapshot> {
  const matches = new Set<string>()
  for (const dir of directories) {
    try {
      for (const match of await glob.scan("{plugin,plugins}/*.{ts,js}", {
        cwd: dir,
        absolute: true,
        dot: true,
        symlink: true,
      })) matches.add(match)
    } catch {
      return Object.freeze({ status: "unknown", matches: Object.freeze([]) })
    }
  }
  const sorted = Object.freeze([...matches].sort())
  return Object.freeze({ status: sorted.length > 0 ? "present" : "absent", matches: sorted })
}

export function pluginAuthorityRemainedAbsent(
  before: PluginAuthoritySnapshot,
  after: PluginAuthoritySnapshot,
): boolean {
  return before.status === "absent"
    && after.status === "absent"
    && before.matches.length === 0
    && after.matches.length === 0
}
