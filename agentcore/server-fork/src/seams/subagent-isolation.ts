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

const TASK_TOOL_ID = 'task';

/**
 * Holds the original TaskTool.execute wrapped by the interceptor.
 * Set once on first interception; used to restore if needed.
 */
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

  // Dynamic import avoids hard coupling to upstream module structure at startup
  const { TaskTool } = await import('@upstream/opencode/src/tool/task');

  // Defensive: verify the tool exposes the expected interface
  const def = TaskTool as unknown as { id?: string; init?: () => Promise<{ execute: Function }> };
  if (!def) {
    console.warn('[subagent-isolation] TaskTool def not found — skipping interception');
    return;
  }

  // Intercept at the tool definition level — wrap execute after init resolves
  def.init?.().then((toolDef: { execute: Function }) => {
    _originalExecute = toolDef.execute as (args: unknown, ctx: unknown) => Promise<unknown>;
    _intercepted = true;

    toolDef.execute = async (args: unknown, ctx: unknown) => {
      const pargs = args as { subagent_type?: string; task_id?: string };
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
        // Isolate: strip parentID. The subagent gets a fresh session with no
        // lineage to parent's message history. This is the load-bearing action.
        // The __nexusloop_isolated marker is metadata-only for downstream
        // NexusLoop code — not load-bearing for the isolation itself.
        const isolatedArgs = { ...pargs };
        delete (isolatedArgs as Record<string, unknown>).parentID;

        const isolatedCtx = {
          ...pctx,
          extra: {
            ...pctx.extra,
            __nexusloop_isolated: true,
            // metadata-only marker for downstream NexusLoop code;
            // not load-bearing. The isolation happens by stripping parentID.
          },
        };

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
  }).catch((err) => {
    console.error('[subagent-isolation] failed to intercept TaskTool:', err);
  });
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