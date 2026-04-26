/**
 * agentcore/tests/test_mcp_gate_tool_requested.test.ts
 * -----------------------------------------------------
 * Tests that dispatchMCP emits a well-formed tool_requested event
 * from the fork side (single-writer invariant verification).
 *
 * The event-emitter module resolves paths at import time from the
 * process.cwd() at module scope.  Tests must therefore pre-create
 * events.jsonl + lock in the original CWD so the module can open them.
 * (This is the same pattern used in event-emitter.test.ts.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { unlinkSync, writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

import {
  dispatchMCP,
  registerMCP,
  type MCPToolDefinition,
} from '../server-fork/src/seams/mcp-gate';

// event-emitter resolves paths from this CWD at import time
const ORIGINAL_CWD = process.cwd();
const EVENTS_IN_CWD = resolve(ORIGINAL_CWD, 'events.jsonl');
const LOCK_IN_CWD = resolve(ORIGINAL_CWD, 'events.jsonl.lock');

function setup() {
  writeFileSync(EVENTS_IN_CWD, '');
  writeFileSync(LOCK_IN_CWD, '');
}

function readLines(): string[] {
  return readFileSync(EVENTS_IN_CWD, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '');
}

function teardown() {
  try { unlinkSync(EVENTS_IN_CWD); } catch {}
  try { unlinkSync(LOCK_IN_CWD); } catch {}
}

describe('dispatchMCP emits tool_requested from fork side', () => {
  beforeEach(() => {
    try { unlinkSync(EVENTS_IN_CWD); } catch {}
    try { unlinkSync(LOCK_IN_CWD); } catch {}
    setup();
  });
  afterEach(teardown);

  it('emits a tool_requested event with correct fields and SHA-256 args_hash', async () => {
    const tools: MCPToolDefinition[] = [
      { name: 'test_tool', description: 'test', inputSchema: { type: 'object' } },
    ];
    const handler = async (name: string, args: Record<string, unknown>) => ({ result: 'ok' });
    registerMCP('test_mcp', tools, handler);

    await dispatchMCP('test_mcp', 'test_tool', { foo: 'bar', n: 42 });
    await new Promise((r) => setTimeout(r, 200));

    const lines = readLines();
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const toolRequested = lines.find((l) => {
      try {
        const evt = JSON.parse(l);
        return evt.event?.kind === 'tool_requested';
      } catch { return false; }
    });
    expect(toolRequested).toBeDefined();

    const evt = JSON.parse(toolRequested!);
    expect(evt.event.kind).toBe('tool_requested');
    expect(evt.event.tool_name).toBe('test_mcp.test_tool');
    expect(evt.event.args_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(evt.event.requesting_skill).toBeNull();
    expect(evt.event.event_id).toBeDefined();
    expect(evt.event.timestamp).toBeDefined();
  });

  it('produces the same args_hash for same args regardless of insertion order', async () => {
    const tools: MCPToolDefinition[] = [
      { name: 'tool', description: '', inputSchema: { type: 'object' } },
    ];
    const handler = async (name: string, args: Record<string, unknown>) => ({});
    registerMCP('mcp1', tools, handler);
    registerMCP('mcp2', tools, handler);

    await dispatchMCP('mcp1', 'tool', { b: 2, a: 1 });
    await new Promise((r) => setTimeout(r, 200));
    const line1 = readLines().find((l) => {
      try { return JSON.parse(l).event?.kind === 'tool_requested'; } catch { return false; }
    });
    const hash1 = JSON.parse(line1!).event.args_hash;

    // Reset for second MCP
    try { unlinkSync(EVENTS_IN_CWD); } catch {}
    try { unlinkSync(LOCK_IN_CWD); } catch {}
    writeFileSync(EVENTS_IN_CWD, '');
    writeFileSync(LOCK_IN_CWD, '');
    await dispatchMCP('mcp2', 'tool', { a: 1, b: 2 });
    await new Promise((r) => setTimeout(r, 200));
    const line2 = readLines().find((l) => {
      try { return JSON.parse(l).event?.kind === 'tool_requested'; } catch { return false; }
    });
    const hash2 = JSON.parse(line2!).event.args_hash;

    expect(hash1).toBe(hash2);
  });
});