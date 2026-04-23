# /drl-init — Initialize NexusLoop Project

You are setting up a NexusLoop project. The user has opened their own
training project directory — this is NOT the autoresearch-RL repo. Follow these
steps to initialize it.

## Step 1: Check if nxl is installed

Run:
```bash
nxl --version
```

If the command is not found, install it once for the current user:
```bash
# recommended: user-level tool install from source
cd /path/to/autoresearch-RL
uv tool update-shell
uv tool install --force .
which nxl

# reopen the shell once if needed, then run it from any project directory
nxl --version
```

## Step 2: Check initialization status

Check if `.nxl/state.json` exists in the current directory.

- **YES**: Tell the user the project is already initialized. Show current state:
  `nxl status`
  Ask: "Do you want to re-initialize? This will regenerate config but NOT touch
  your logs or experiment history."
- **NO**: Proceed with initialization.

## Step 3: Run init with plugin selection

```bash
nxl init
```

This will:
1. Scaffold `.nxl/`, `logs/`, `skills/`, `NON_NEGOTIABLE_RULES.md`
2. Run onboarding to capture the user's project spec, other context, and hard rules
3. Ask which skill-pack mode to use:
   - **Provided DRL pack** — keep the bundled compact DRL skills
   - **Custom pack** — remove the bundled DRL skills from this project and install `.nxl/backend/skill_generator.md` so the agent can research and generate a compact domain-specific replacement pack
4. Ask which project mode to use:
   - **Build mode** — from-scratch design/build workflow; run compact deep research and create compact `implementation_plan/*.md` before normal training loops
   - **Improve mode** — assume a working model already exists and optimize it directly
5. Ask which AI agent plugin(s) to install:
   - **Claude Code** — installs `/drl-*` slash commands into `.claude/commands/`
   - **Codex** — installs `AGENT.md` operating guide
   - **Both** (recommended)
   - **None**
6. Run best-effort environment remediation from onboarding preferences (venv + required package setup), then advise running doctor.
7. Auto-generate compact spec navigation artifacts:
   - `.nxl/spec_compact.md`
   - `.nxl/spec_index.json`
   These are token-saving indexes with source line pointers; originals remain source of truth.

For non-interactive CI environments:
```bash
nxl init --auto                  # installs both plugins, keeps DRL pack
nxl init --refresh               # clean re-init managed files, then onboard again
nxl init --plugin cc             # Claude Code only
nxl init --plugin codex          # Codex only
nxl init --plugin both           # both, skip prompt
nxl init --plugin none           # no plugins
nxl init --skill-pack custom     # use custom compact skill-pack path
nxl init --project-mode build    # build-from-scratch mode
```

## Step 4: Review generated files

After init, confirm with the user:

1. **`NON_NEGOTIABLE_RULES.md`** — Read rules aloud.
   Ask: "Any rules to add or change?"

2. **`.nxl/permissions.yaml`** — Confirm permission mode.
   Permission modes: `locked` (default) | `prompted` | `open` | `bootstrap-only` | `project-only`
   Ask: "Is `locked` the right policy? For overnight autonomous runs, consider `open`."

## Step 5: Run doctor

```bash
nxl doctor
# if dependencies are missing:
nxl doctor --fix
```

Show the full output. All 14 checks must pass before running experiments.
If any fail, explain what to fix.

## Step 6: Confirm ready

Tell the user:
- ✓ Project initialized at: `{project_dir}`
- ✓ Hard rules active: `NON_NEGOTIABLE_RULES.md`
- ✓ Plugin(s) installed: `{list}`
- ✓ Dashboard: `nxl dashboard &` then open http://localhost:8765

**Next steps:**
```bash
# Start dashboard (optional but recommended)
nxl dashboard &

# Run one autonomous cycle to validate the runtime
nxl run --once

# Start the continuous autonomous experiment loop
/drl-run
```
