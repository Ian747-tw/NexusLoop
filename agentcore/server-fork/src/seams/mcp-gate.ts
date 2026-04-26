/**
 * mcp-gate.ts — wraps OpenCode MCP registry with PolicyEngine.
 *
 * Intercepts every incoming MCP tool call before dispatching to the
 * underlying FastMCP server. Calls gated-dispatch.ts → policy-client.ts → Python PolicyEngine.
 * On allow: forwards to FastMCP. On deny: returns error. On ask: triggers intervention-hook.
 */
import { createHash } from 'crypto';
import { checkToolPolicy } from './gated-dispatch';
import { enqueueIntervention } from './intervention-hook';
import { emitEvent } from '../../bridge/event-emitter';
import type { ToolCallRequest, ToolCallResult } from '../../bridge/protocol';

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const _mcpRegistry = new Map<string, MCPToolDefinition[]>();
const _mcpHandlers = new Map<string, (name: string, args: Record<string, unknown>) => Promise<unknown>>();

/**
 * Compute a deterministic SHA-256 args hash (hex, first 16 chars).
 * Canonical JSON: sorted keys, no extra whitespace.
 */
function computeArgsHash(args: Record<string, unknown>): string {
  const canonical = JSON.stringify(Object.keys(args).sort().map((k) => [k, args[k]]));
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function registerMCP(name: string, tools: MCPToolDefinition[], handler: (name: string, args: Record<string, unknown>) => Promise<unknown>): void {
  _mcpRegistry.set(name, tools);
  _mcpHandlers.set(name, handler);
  void emitEvent({ event: { kind: 'MCPRegistered', mcp: name, tools: tools.map(t => t.name) } });
}

export async function dispatchMCP(mcp: string, tool: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  const req: ToolCallRequest = {
    id: `mcp-${mcp}-${tool}-${Date.now()}`,
    name: `${mcp}.${tool}`,
    args,
    ctx: {} as any,  // ctx is required by ToolCallRequest but MCP calls may not have full session ctx
  };

  // Emit ToolRequested from fork side (single-writer invariant)
  void emitEvent({
    event: {
      kind: 'tool_requested',
      tool_name: `${mcp}.${tool}`,
      args_hash: computeArgsHash(args),
      requesting_skill: null,
    },
  });

  try {
    const decision = await checkToolPolicy(req);
    switch (decision.kind) {
      case 'allow': {
        const handler = _mcpHandlers.get(mcp);
        if (!handler) return { id: req.id, allowed: false, error: `MCP ${mcp} not registered` };
        const result = await handler(tool, args);
        void emitEvent({ event: { kind: 'MCPToolCompleted', mcp, tool, result } });
        return { id: req.id, allowed: true, result };
      }
      case 'deny': {
        void emitEvent({ event: { kind: 'MCPToolDenied', mcp, tool, reason: decision.reason } });
        return { id: req.id, allowed: false, error: decision.reason };
      }
      case 'ask': {
        enqueueIntervention({ verb: decision.verb, payload: decision.payload });
        return { id: req.id, allowed: false, error: `ask:${decision.verb}` };
      }
      case 'narrow': {
        const handler = _mcpHandlers.get(mcp);
        if (!handler) return { id: req.id, allowed: false, error: `MCP ${mcp} not registered` };
        const result = await handler(tool, decision.narrowed_args);
        return { id: req.id, allowed: true, result };
      }
    }
  } catch (err) {
    return { id: req.id, allowed: false, error: String(err) };
  }
}

export function listMCPTools(mcp: string): MCPToolDefinition[] {
  return _mcpRegistry.get(mcp) || [];
}