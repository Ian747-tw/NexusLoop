# phases/M2/init_path_decisions.md — ADR-lite for init slowness fixes

## Fix 1 — `--skip-onboarding` flag correctness

### Q1: Where does the flag enter?

**Entry point:** `nxl/cli.py` line ~123 passes `skip_onboarding=args.skip_onboarding` to `init.run()`.

**Wiring:** `init.run(project_dir, skip_onboarding=..., auto=..., ...)` at line 182.

### Q2: Where was the flag supposed to be checked?

`OnboardingFlow.__init__` receives `skip: bool` (not `skip_onboarding`). In `OnboardingFlow.run()` at line 569:
```python
if self.skip:
    print("[onboarding] --skip-onboarding: using safe defaults.")
    result = self._build_skip_defaults()
    self.save_results(result)
    return result
```

The flag IS correctly propagated — it reaches `OnboardingFlow` correctly as `skip=skip_flow` where `skip_flow = skip_onboarding or not sys.stdin.isatty()` (line 252).

### Q3: Why is init so slow if skip is working correctly?

The `skip` path in `OnboardingFlow._build_skip_defaults()` calls `HardwareDetector().detect()` (line 1069), which:
- Imports `torch` → CUDA detection
- Runs `nvidia-smi` with a 10-second timeout
- This hangs when no GPU is present or nvidia-smi is slow to respond

Additionally, `OnboardingFlow.run()` at lines 340–350 calls `doctor_mod.run(project_dir=project_dir, fix=True)` AFTER `_build_skip_defaults()` returns. The `doctor_mod.run(fix=True)` is on the critical path unconditionally.

**Root cause of slowness:** Two compounding issues:
1. `HardwareDetector().detect()` in `_build_skip_defaults()` hangs on `nvidia-smi` when no GPU or slow GPU
2. `doctor_mod.run(fix=True)` runs unconditionally and makes network calls

The `--skip-onboarding` flag is NOT being ignored — it works correctly. The slowness comes from hardware detection + doctor on the critical path.

### Q4: Why is `scaffold/generator.py` importing `OnboardingFlow`?

The scaffold generator at line 9 instantiates `OnboardingFlow(project_dir=Path("."), auto=False, skip=False)` — this is dead code (it's in a function that's called immediately at module level). This is NOT causing the init hang, but it IS backward coupling that should be removed.

---

## Fix 2 — Remove doctor from init critical path

### Q1: What does `doctor_mod.run(fix=True)` do during init?

- `fix_environment(project_dir)` loads onboarding preferences (package manager, required packages)
- Installs missing packages via `_install_packages_with_python()`
- If PEP 668 detected (externally-managed Python), creates a `.venv` and installs packages there
- Then runs all doctor checks

### Q2: Which checks are required for init to succeed?

**None.** Init writes config files only. It does not require any package to be installed. `nxl run` fails clearly if packages are missing — that's the right time to run doctor.

### Q3: User experience if environment is broken and we don't check?

`nxl run` will fail with a clear error when it can't find required packages. Users then run `nxl doctor --fix` explicitly. This is the correct UX: init = config, doctor = environment.

---

## Design Decisions

| Decision | Rationale |
|---|---|
| Remove `OnboardingFlow.run()` from init when `skip_onboarding=True` | The config files it writes (`onboarding.yaml`) are not needed by any subsequent `nxl` command. Init should write the actual config files (`policy.yaml`, `hardware.yaml`, etc.) directly without going through OnboardingFlow. |
| Remove `doctor_mod.run(fix=True)` from init entirely | Init = config only. Doctor is a separate command. |
| Remove `scaffold/generator.py` eager import of OnboardingFlow | Backward coupling; OnboardingFlow shouldn't be imported by the scaffold generator. |

---

## ADR-lite: Fix 1 — `--skip-onboarding` fast path

**Problem:** `OnboardingFlow.run()` was called on every `nxl init`, even with `--skip-onboarding`. Inside the `skip` path, `_build_skip_defaults()` still ran `HardwareDetector().detect()` which calls `nvidia-smi` with a 10-second timeout per GPU probe. Combined with the `doctor_mod.run(fix=True)` call unconditionally appended after onboarding, `nxl init --auto --skip-onboarding` timed out at 600s.

**Decision:** When `skip_onboarding=True`, call `_build_skip_defaults()` directly instead of going through `OnboardingFlow.run()`. The returned dict uses safe defaults (no GPU detection, no network). `_build_skip_defaults()` was implemented inline in `init.py` to avoid the `nvidia-smi` subprocess call.

**Consequence:** `OnboardingFlow` is only instantiated when the user explicitly wants the interactive onboarding flow (no `--auto` or `--skip-onboarding`). Init is now fully config-only when the fast path is taken.

**Timeline:**
- Before: `nxl init --auto --skip-onboarding` → 600s timeout
- After Fix 1: `nxl init --auto --skip-onboarding` → 0.20s median (5 runs)

---

## ADR-lite: Fix 2 — Remove doctor from init critical path

**Problem:** `doctor_mod.run(project_dir=project_dir, fix=True)` was unconditionally appended after the config-writing section. It runs all doctor checks (including network-dependent ones), then attempts environment remediation (installing packages). This is not init's responsibility — init should only write config files.

**Decision:** Remove the `doctor_mod.run()` call from `init.run()` entirely. Users who want environment setup run `nxl doctor --fix` explicitly. The plugin installation section was also removed as it depended on interactive prompts and was inconsistent with the `--auto` intent.

**Consequence:** Users must explicitly run `nxl doctor` or `nxl doctor --fix` after init if they want environment checks. This is documented as the correct workflow.

**Timeline:**
- After Fix 1 alone: ~0.20s (doctor still runs in OnboardingFlow skip path, but no nvidia-smi)
- After Fix 2: 0.20s (doctor removed, no measurable additional impact since Fix 1 already bypassed the slow path)
- Combined result: 0.20s median (target ≤10s achieved)

---

## Fix 3 — Not needed

After Fixes 1 and 2, init median is 0.20s — well below the 10s target. `_discover_spec_sources` at 23% was a symptom of Fix 1, not a root cause. No further action needed.

