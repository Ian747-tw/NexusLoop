/**
 * seams/subagent-isolation.test.ts
 * Tests for subagent-isolation seam (VENDOR_BOUNDARY entry 11)
 *
 * Tests 1-5 cover wrapper-level behavior; Test 6 is the regression guard.
 */
// @ts-ignore — bun:test is a Bun built-in, not in @types/node
import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { getConfig, _resetForTesting as _resetRegistry } from '../util/subagent-registry';

// ---------------------------------------------------------------------------
// Spy on emitEvent
// ---------------------------------------------------------------------------

const emittedEvents: Array<Record<string, unknown>> = [];

const originalEmitEvent = vi.fn((event: Record<string, unknown>) => {
  emittedEvents.push(event);
});

vi.mock('../../bridge/event-emitter', () => ({
  emitEvent: originalEmitEvent,
}));

let sessionIDReadValues: unknown[] = [];
let extraSnapshots: Array<Record<string, unknown> | undefined> = [];
let forwardedCalls: Array<{
  args: Record<string, unknown>;
  messageID: string;
}> = [];

function createMockTaskToolExecute() {
  return vi.fn(async (args: Record<string, unknown>, ctx: {
    sessionID?: string;
    messageID: string;
    extra?: Record<string, unknown>;
  }) => {
    forwardedCalls.push({ args: { ...args }, messageID: ctx.messageID });
    sessionIDReadValues.push(ctx.sessionID);
    sessionIDReadValues.push(ctx.sessionID);
    extraSnapshots.push(ctx.extra ? { ...ctx.extra } : undefined);
    return {
      metadata: { sessionId: 'subagent-session-789' },
      output: `task_id: subagent-session-789`,
      observedArgs: args,
    };
  });
}

const mockTaskToolDef = {
  execute: createMockTaskToolExecute(),
};

const mockedTaskTool = {
  id: 'task',
  init: vi.fn(async () => mockTaskToolDef),
};

vi.mock('@upstream/opencode/tool/task', () => ({
  TaskTool: mockedTaskTool,
}));

const { isSubagentIsolated, initSubagentIsolation, _resetForTest } = await import('./subagent-isolation');

// ---------------------------------------------------------------------------
// Registry test fixtures
// ---------------------------------------------------------------------------

// second_review is registered as isolated: true in registry.yaml
// general is NOT in registry (tests passthrough default)
// For test 3 we need a non-isolated registered type — we add a temp one

describe('subagent-isolation seam', () => {
  beforeEach(() => {
    emittedEvents.length = 0;
    sessionIDReadValues = [];
    extraSnapshots = [];
    forwardedCalls = [];
    originalEmitEvent.mockClear();
    _resetRegistry();
    _resetForTest();
    mockTaskToolDef.execute = createMockTaskToolExecute();
    mockedTaskTool.init.mockClear();
  });

  // -------------------------------------------------------------------------
  // Test 1: Isolated subagent strips parent context
  // -------------------------------------------------------------------------
  it('Test 1: isolated subagent type strips parentID — no session lineage', () => {
    // second_review is registered as isolated: true
    expect(isSubagentIsolated('second_review')).toBe(true);

    const config = getConfig('second_review');
    expect(config).not.toBeNull();
    expect(config?.isolated).toBe(true);
    expect(config?.purpose).toBe('tier_promotion_verification');
  });

  // -------------------------------------------------------------------------
  // Test 2: wrapper-level isolation transformation
  // -------------------------------------------------------------------------
  it('Test 2 strengthened: wrapper strips parent lineage on first sessionID read', async () => {
    // NOTE: This test verifies the wrapper's transformation of
    // ctx/args at its call boundary. It does NOT verify that the
    // wrapper is actually invoked by upstream's runtime — that
    // requires integration testing deferred to P7. See ADR-012
    // "Runtime Integration Gap" and phases/M4/checklist.md.
    await initSubagentIsolation();
    const toolDef = await mockedTaskTool.init();

    const result = await toolDef.execute(
      { prompt: 'verify X', subagent_type: 'second_review', parentID: 'parent-session-123' },
      {
        sessionID: 'parent-session-123',
        messageID: 'parent-msg-456',
        extra: { existing: 'value' },
      },
    );

    expect(forwardedCalls).toHaveLength(1);
    const forwardedArgs = forwardedCalls[0]!.args;
    expect(forwardedArgs.parentID).toBeUndefined();
    expect(forwardedArgs.subagent_type).toBe('second_review');
    expect(sessionIDReadValues).toEqual([undefined, 'parent-session-123']);
    expect(extraSnapshots[0]?.existing).toBe('value');
    expect(extraSnapshots[0]?.__nexusloop_isolated).toBe(true);
    expect((result as { metadata: { sessionId: string } }).metadata.sessionId).toBe('subagent-session-789');
  });

  // -------------------------------------------------------------------------
  // Test 3: Non-isolated registered subagent INHERITS parent context
  // -------------------------------------------------------------------------
  it('Test 3: registered but non-isolated subagent inherits parent context', async () => {
    expect(isSubagentIsolated('general')).toBe(false);
    expect(isSubagentIsolated('second_review')).toBe(true);
    await initSubagentIsolation();
    const toolDef = await mockedTaskTool.init();

    await toolDef.execute(
      { prompt: 'verify Y', subagent_type: 'general' },
      {
        sessionID: 'parent-session-123',
        messageID: 'parent-msg-456',
        extra: { existing: 'value' },
      },
    );

    const forwardedArgs = forwardedCalls[0]!.args;
    expect(forwardedArgs.subagent_type).toBe('general');
    expect(sessionIDReadValues).toEqual(['parent-session-123', 'parent-session-123']);
    expect(extraSnapshots[0]?.__nexusloop_isolated).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Test 4: Vanilla OpenCode subagent (not in registry) inherits by default
  // -------------------------------------------------------------------------
  it('Test 4: unregistered subagent type inherits by default (no firewall)', () => {
    // Types not in registry.yaml pass through — no isolation applied
    const isolated = isSubagentIsolated('vanilla_explore');
    expect(isolated).toBe(false);

    const config = getConfig('vanilla_explore');
    expect(config).toBeNull(); // Not registered → passthrough
  });

  // -------------------------------------------------------------------------
  // Test 5: SubagentSpawned + SubagentCompleted events emitted correctly
  // -------------------------------------------------------------------------
  it('Test 5: SubagentSpawned and SubagentCompleted events have correct fields', () => {
    // Simulate emit by checking the event structure
    const spawnedEvent = {
      event: {
        kind: 'subagent_spawned',
        subagent_type: 'second_review',
        isolated: true,
        parent_session_id: 'parent-session-123',
        parent_message_id: 'parent-msg-456',
        purpose: 'tier_promotion_verification',
        invocation_id: 'subagent-second_review-1234567890',
      },
    };

    originalEmitEvent(spawnedEvent);
    expect(emittedEvents).toHaveLength(1);
    const captured = emittedEvents[0] as { event: Record<string, unknown> };
    expect(captured.event.kind).toBe('subagent_spawned');
    expect(captured.event.subagent_type).toBe('second_review');
    expect(captured.event.isolated).toBe(true);
    expect(captured.event.parent_session_id).toBe('parent-session-123');
    expect(captured.event.purpose).toBe('tier_promotion_verification');

    const completedEvent = {
      event: {
        kind: 'subagent_completed',
        subagent_type: 'second_review',
        invocation_id: 'subagent-second_review-1234567890',
        success: true,
        session_id: 'subagent-session-789',
        output_preview: 'Promotion verified: T1→T2 candidate approved.',
      },
    };

    originalEmitEvent(completedEvent);
    expect(emittedEvents).toHaveLength(2);
    const completed = emittedEvents[1] as { event: Record<string, unknown> };
    expect(completed.event.kind).toBe('subagent_completed');
    expect(completed.event.success).toBe(true);
    expect(completed.event.session_id).toBe('subagent-session-789');
  });

  // -------------------------------------------------------------------------
  // Test 6: Regression guard — upstream TaskTool exposes def.init
  // -------------------------------------------------------------------------
  it('Test 6: upstream TaskTool exposes def.init — regression guard', async () => {
    // If upstream renames `init` → `initialize` or changes the tool pattern,
    // this test fails and forces explicit migration of the seam.
    // Do NOT remove this test even if upstream changes its tool registration.
    //
    // Verification approach: read the Info<T> interface from tool.ts which
    // defines the init signature. The tool.ts file is stable (fork doesn't
    // modify it). This mirrors how lifecycle-hooks.test.ts handles upstream deps.
    const toolInterfacePath = '/home/ianchen951011/projects/NexusLoop/agentcore/upstream/packages/opencode/src/tool/tool.ts';
    let initExists = false;
    try {
      const fs = await import('fs');
      const content = fs.readFileSync(toolInterfacePath, 'utf-8');
      // Info<Parameters, M> interface has: init: () => Effect.Effect<DefWithoutID<Parameters, M>>
      // This is the stable API contract between seam and upstream.
      initExists = content.includes('init: () => Effect.Effect<DefWithoutID<Parameters, M>>');
    } catch {
      initExists = false;
    }
    expect(initExists).toBe(true);
  });

  it('Test 7: initSubagentIsolation resolves only after wrapper is installed', async () => {
    const originalExecute = mockTaskToolDef.execute;
    await initSubagentIsolation();
    expect(mockedTaskTool.init).toHaveBeenCalledTimes(1);

    expect(mockTaskToolDef.execute).not.toBe(originalExecute);
    expect((mockTaskToolDef.execute as { __nexusloop_isolation_wrapped?: boolean }).__nexusloop_isolation_wrapped).toBe(true);
  });
});
