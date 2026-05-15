import { resolve } from "path"
import { runTuiEntrypoint } from "./launch"

const projectDir = resolve(process.env.NXL_PROJECT_DIR ?? process.cwd())

await runTuiEntrypoint({ projectDir, env: process.env })
