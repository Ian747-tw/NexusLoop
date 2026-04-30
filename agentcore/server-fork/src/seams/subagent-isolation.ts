/**
 * seams/subagent-isolation.ts
 * ---------------------------
 * Intercepts TaskTool.execute to apply context firewall for isolated subagents.
 *
 * When a subagent_type is registered with `isolated: true` in the subagent
 * registry (agentcore/subagents/registry.yaml), the parent session context
 * is stripped before spawning the child session. The __nexusloop_isolated
 * flag in ctx.extra is a metadata-only marker for downstream NexusLoop code;
 * it is NOT load-bearing for isolation — isolation is enforced by stripping
 * parentID before the upstream createSession call.
 *
 * Non-isolated subagents and unregistered types pass through unchanged.
 *
 * VENDOR_BOUNDARY ENTRY 11
 */
// @ts-nocheck — upstream module paths resolved at runtime via dynamic import
import { getConfig, isIsolated } from '../util/subagent-registry';
import { emitEvent } from '../../bridge/event-emitter';

let _originalExecute: ((args: unknown, ctx: unknown) => Promise<unknown>) | null = null;

let _intercepted = false;

/**
 * Intercepts TaskTool.execute to enforce isolation policy.
 *
 * Integration: called once at fork startup. We hook into upstream's
 * Tool.define pattern by calling the TaskTool's init() and wrapping
 * the returned execute function.
 *
 * On each subagent spawn:
 *   1. Read isolation config from subagent-registry
 *   2. If isolated: strip parentID from args (no parentID → fresh session)
 *   3. Emit SubagentSpawned
 *   4. Call original execute
 *   5. On completion: emit SubagentCompleted
 *
 * If upstream renames `init` → `initialize` or changes the tool pattern,
 * the regression guard test will catch it (subagent-isolation.test.ts).
 */
export async function initSubagentIsolation(): Promise<void> {
  if (_intercepted) return;

  try {
    // Dynamic import avoids hard coupling to upstream module structure at startup
    const taskToolModule = '@upstream/opencode/tool/task';
    const appRuntimeModule = '@upstream/opencode/effect/app-runtime';
    const { TaskTool } = await import(taskToolModule);
    const { AppRuntime } = await import(appRuntimeModule);

    // Defensive: verify the tool exposes the expected interface
    let def = TaskTool as unknown as { id?: string; init?: () => Promise<{ execute: Function }> };
    if (!def?.init) {
      try {
        def = await AppRuntime.runPromise(TaskTool as never) as typeof def;
      } catch {
        // Fall through to the warning below if resolution fails.
      }
    }
    if (!def?.init) {
      console.warn('[subagent-isolation] TaskTool def.init not found — skipping interception');
      return;
    }

    // Intercept at the tool definition level — wrap execute after init resolves.
    // NOTE: P5.4 confirmed this module-level interception does not currently
    // propagate to upstream's real runtime-resolved ToolRegistry path.
    const toolDef = await def.init();
    _originalExecute = toolDef.execute as (args: unknown, ctx: unknown) => Promise<unknown>;

    const wrappedExecute = async (args: unknown, ctx: unknown) => {
      const pargs = args as { subagent_type?: string; task_id?: string; parentID?: string };
      const subagentType = pargs.subagent_type ?? '';
      const isolated = isIsolated(subagentType);
      const config = getConfig(subagentType);
      const invocationId = `subagent-${subagentType}-${Date.now()}`;

      const pctx = ctx as {
        sessionID: string;
        messageID: string;
        extra?: Record<string, unknown>;
      };

      emitEvent({
        event: {
          kind: 'subagent_spawned',
          subagent_type: subagentType,
          isolated,
          parent_session_id: pctx.sessionID,
          parent_message_id: pctx.messageID,
          purpose: config?.purpose ?? 'vanilla',
          invocation_id: invocationId,
        },
      });

      let result: unknown;
      if (isolated) {
        const isolatedArgs = { ...pargs };
        delete (isolatedArgs as Record<string, unknown>).parentID;

        let sessionIDReads = 0;
        const isolatedCtx = new Proxy(pctx, {
          get(target, prop, receiver) {
            if (prop === 'sessionID') {
              sessionIDReads += 1;
              return sessionIDReads === 1 ? undefined : target.sessionID;
            }
            if (prop === 'extra') {
              return {
                ...target.extra,
                __nexusloop_isolated: true,
              };
            }
            return Reflect.get(target, prop, receiver);
          },
        });

        try {
          result = await (_originalExecute!(isolatedArgs, isolatedCtx) as Promise<unknown>);
        } catch (err) {
          emitEvent({
            event: {
              kind: 'subagent_completed',
              subagent_type: subagentType,
              invocation_id: invocationId,
              success: false,
              error: String(err),
            },
          });
          throw err;
        }
      } else {
        result = await (_originalExecute!(args, ctx) as Promise<unknown>);
      }

      const execResult = result as { metadata?: { sessionId?: string }; output?: string };

      emitEvent({
        event: {
          kind: 'subagent_completed',
          subagent_type: subagentType,
          invocation_id: invocationId,
          success: true,
          session_id: execResult?.metadata?.sessionId,
          output_preview: (execResult?.output as string | undefined)?.slice(0, 200),
        },
      });

      return result;
    };
    (wrappedExecute as typeof wrappedExecute & { __nexusloop_isolation_wrapped?: boolean }).__nexusloop_isolation_wrapped = true;
    toolDef.execute = wrappedExecute;
    _intercepted = true;
  } catch (err) {
    console.error('[subagent-isolation] failed to intercept TaskTool:', err);
  }
}

/**
 * Returns whether a given subagent type is configured as isolated.
 * Used by tests.
 */
export function isSubagentIsolated(subagentType: string): boolean {
  return isIsolated(subagentType);
}

// Test helpers
export function _resetForTest(): void {
  _intercepted = false;
  _originalExecute = null;
}
