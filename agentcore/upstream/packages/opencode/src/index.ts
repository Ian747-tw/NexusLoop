const args = process.argv.slice(2)

if (args.length === 2 && args[0] === "nexusloop" && args[1] === "executor-readiness-v1") {
  const command = await import("./cli/cmd/nexusloop")
  process.exitCode = await command.runNexusLoopExecutorReadinessCommand()
} else {
  await import("./cli-main")
}
