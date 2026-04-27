/**
 * mode-flag-gate.ts — enforces PolicyEngine verdicts on runtime mode flags.
 *
 * Flags listed in agentcore/mode-flags/registry.yaml are checked at startup
 * (or when set). If a flag is true and PolicyEngine denies it, the flag is
 * overridden to false and a ModeFlagDenied event is recorded.
 *
 * Flags NOT listed in the registry pass through unchanged (passthrough).
 */
import { emitEvent } from '../../bridge/event-emitter';
import { PolicyClient } from '../../bridge/policy-client';
import { isRegisteredFlag, getFlagConfig } from '../util/mode-flag-registry';

const policyClient = new PolicyClient();

/**
 * Check a set of mode flags against PolicyEngine.
 *
 * For each registered flag that is currently true, calls PolicyEngine.
 * If the verdict is "deny", the flag is overridden to false and a
 * ModeFlagDenied event is emitted.
 *
 * @param flags     Map of flag name → effective value
 * @param cycleId   Cycle ID for event context
 * @returns new flags map with denied flags forced to false
 */
export function applyModeFlagGate(
  flags: Record<string, boolean>,
  cycleId: string,
): Record<string, boolean> {
  const result = { ...flags };

  for (const [flagName, value] of Object.entries(result)) {
    if (!value) continue; // only check flags that are currently enabled
    if (!isRegisteredFlag(flagName)) continue; // passthrough for unregistered

    const verdict = getFlagConfig(flagName)?.default_verdict ?? 'deny';
    if (verdict === 'allow') continue; // registry says allow by default

    // Registry says deny by default — emit denial event and override
    emitEvent({
      event: {
        kind: 'mode_flag_denied',
        flag_name: flagName,
        reason: `PolicyEngine denied --${flagName} (default_verdict=deny)`,
        rule_id: null,
      },
    });

    result[flagName] = false;
  }

  return result;
}

/**
 * Check a single flag by name against PolicyEngine (async, for runtime checks).
 *
 * Used when a flag is set dynamically during a session, not just at startup.
 *
 * @param flagName  The flag to check
 * @param cycleId   Cycle ID for event context
 * @returns 'allow' if the flag is allowed, 'deny' if blocked
 */
export async function checkFlagPolicy(
  flagName: string,
  cycleId: string,
): Promise<'allow' | 'deny'> {
  if (!isRegisteredFlag(flagName)) {
    return 'allow'; // passthrough
  }

  try {
    const decision = await policyClient.check({
      id: `flag-${flagName}-${Date.now()}`,
      name: flagName,
      args: {},
    });

    switch (decision.kind) {
      case 'allow':
        return 'allow';
      case 'deny':
        emitEvent({
          event: {
            kind: 'mode_flag_denied',
            flag_name: flagName,
            reason: decision.reason,
            rule_id: null,
          },
        });
        return 'deny';
      case 'deny_non_negotiable':
        emitEvent({
          event: {
            kind: 'mode_flag_denied',
            flag_name: flagName,
            reason: decision.reason,
            rule_id: decision.rule_id,
          },
        });
        return 'deny';
      case 'ask':
      case 'narrow':
        // ask/narrow don't apply to flag checks — treat as deny
        emitEvent({
          event: {
            kind: 'mode_flag_denied',
            flag_name: flagName,
            reason: `Unexpected verdict ${decision.kind} for flag check`,
            rule_id: null,
          },
        });
        return 'deny';
    }
  } catch {
    // On error, fail open (allow the flag) but log
    return 'allow';
  }
}
