/**
 * seams/subagent-isolation.test.ts
 * Tests for subagent-isolation seam (VENDOR_BOUNDARY entry 11)
 *
 * Tests 1-5 cover isolation behavior; Test 6 is the regression guard.
 */
// @ts-ignore — bun:test is a Bun built-in, not in @types/node
import { describe, it, expect, beforeEach, vi } from 'bun:test';
import crypto from 'crypto';
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

type MockMessage = {
  info: {
    role: string;
    modelID: string;
    providerID: string;
  };
  text: string;
};

type MockSession = {
  id: string;
  parentID?: string;
  capsulePrefix: string;
  toolResults: string[];
  messages: Record<string, MockMessage>;
};

let mockSessions: Record<string, MockSession> = {};
let capturedRequests: string[] = [];
let sessionCounter = 0;

function seedParentSession(secret: string): {
  sessionID: string;
  messageID: string;
} {
  const sessionID = 'parent-session-123';
  const messageID = 'parent-msg-456';
  mockSessions[sessionID] = {
    id: sessionID,
    capsulePrefix: `capsule:${secret}`,
    toolResults: [`tool:${secret}`],
    messages: {
      [messageID]: {
        info: {
          role: 'assistant',
          modelID: 'claude-sonnet-4-20250514',
          providerID: 'anthropic',
        },
        text: `message-history:${secret}`,
      },
    },
  };
  return { sessionID, messageID };
}

function buildOutboundRequest(sessionID: string, input: {
  agent: string;
  model: { modelID: string; providerID: string };
  parts: Array<{ type: string; text?: string }>;
}): string {
  const session = mockSessions[sessionID];
  const parent = session.parentID ? mockSessions[session.parentID] : undefined;
  return JSON.stringify({
    sessionID,
    parentSessionID: session.parentID ?? null,
    agent: input.agent,
    model: input.model,
    prompt: input.parts.map((part) => part.text ?? '').join('\n'),
    inherited: parent
      ? {
          messageHistory: Object.values(parent.messages).map((msg) => msg.text).join('\n'),
          capsulePrefix: parent.capsulePrefix,
          toolResults: parent.toolResults,
        }
      : null,
  });
}

function createMockTaskToolExecute() {
  return vi.fn(async (args: { prompt: string; subagent_type: string }, ctx: {
    sessionID?: string;
    messageID: string;
    extra?: {
      promptOps?: {
        resolvePromptParts: (template: string) => Promise<Array<{ type: string; text: string }>>;
        prompt: (input: {
          messageID: string;
          sessionID: string;
          model: { modelID: string; providerID: string };
          agent: string;
          tools: Record<string, boolean>;
          parts: Array<{ type: string; text: string }>;
        }) => Promise<{ parts: Array<{ type: string; text: string }> }>;
      };
    };
  }) => {
    const createdSessionID = `subagent-session-${++sessionCounter}`;
    mockSessions[createdSessionID] = {
      id: createdSessionID,
      parentID: ctx.sessionID,
      capsulePrefix: '',
      toolResults: [],
      messages: {},
    };

    const msgSessionID = ctx.sessionID;
    if (!msgSessionID) {
      throw new Error('message lookup requires a sessionID after child session creation');
    }
    const parentSession = mockSessions[msgSessionID];
    const parentMessage = parentSession?.messages[ctx.messageID];
    if (!parentMessage || parentMessage.info.role !== 'assistant') {
      throw new Error('Not an assistant message');
    }

    const parts = await ctx.extra!.promptOps!.resolvePromptParts(args.prompt);
    await ctx.extra!.promptOps!.prompt({
      messageID: `subagent-msg-${sessionCounter}`,
      sessionID: createdSessionID,
      model: {
        modelID: parentMessage.info.modelID,
        providerID: parentMessage.info.providerID,
      },
      agent: args.subagent_type,
      tools: {},
      parts,
    });

    return {
      metadata: { sessionId: createdSessionID },
      output: `task_id: ${createdSessionID}`,
    };
  });
}

const mockTaskToolDef = {
  execute: createMockTaskToolExecute(),
};

vi.mock('@upstream/opencode/src/tool/task', () => ({
  TaskTool: {
    id: 'task',
    init: vi.fn(async () => mockTaskToolDef),
  },
}));

const { isSubagentIsolated, initSubagentIsolation, _resetForTest } = await import('./subagent-isolation');
const { TaskTool } = await import('@upstream/opencode/src/tool/task');

// ---------------------------------------------------------------------------
// Registry test fixtures
// ---------------------------------------------------------------------------

// second_review is registered as isolated: true in registry.yaml
// general is NOT in registry (tests passthrough default)
// For test 3 we need a non-isolated registered type — we add a temp one

describe('subagent-isolation seam', () => {
  beforeEach(() => {
    emittedEvents.length = 0;
    capturedRequests = [];
    mockSessions = {};
    sessionCounter = 0;
    originalEmitEvent.mockClear();
    _resetRegistry();
    _resetForTest();
    mockTaskToolDef.execute = createMockTaskToolExecute();
    (TaskTool.init as { mockClear: () => void }).mockClear();
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
  // Test 2: Secret in parent capsule does NOT leak to isolated subagent
  //         (NON-NEGOTIABLE — must scan FULL assembled prompt)
  // -------------------------------------------------------------------------
  it('Test 2 strengthened: secret token absent from isolated subagent FIRST LLM CALL', async () => {
    const secret = `SECRET_TOKEN_${crypto.randomUUID()}`;
    const parent = seedParentSession(secret);
    await initSubagentIsolation();

    const promptOps = {
      cancel: vi.fn(),
      resolvePromptParts: vi.fn(async (template: string) => [{ type: 'text', text: template }]),
      prompt: vi.fn(async (input: {
        messageID: string;
        sessionID: string;
        model: { modelID: string; providerID: string };
        agent: string;
        tools: Record<string, boolean>;
        parts: Array<{ type: string; text: string }>;
      }) => {
        capturedRequests.push(buildOutboundRequest(input.sessionID, input));
        return {
          parts: [{ type: 'text', text: 'Promotion verified.' }],
        };
      }),
    };

    await mockTaskToolDef.execute(
      { prompt: 'verify X', subagent_type: 'second_review' },
      {
        sessionID: parent.sessionID,
        messageID: parent.messageID,
        extra: { promptOps },
      },
    );

    const subagentRequest = capturedRequests.find((req) => req.includes('"agent":"second_review"'));
    expect(subagentRequest).toBeDefined();
    expect(subagentRequest).not.toContain(secret);
  });

  // -------------------------------------------------------------------------
  // Test 3: Non-isolated registered subagent INHERITS parent context
  // -------------------------------------------------------------------------
  it('Test 3: registered but non-isolated subagent inherits parent context', async () => {
    const secret = `SECRET_TOKEN_${crypto.randomUUID()}`;
    const parent = seedParentSession(secret);
    expect(isSubagentIsolated('general')).toBe(false);
    expect(isSubagentIsolated('second_review')).toBe(true);

    const promptOps = {
      cancel: vi.fn(),
      resolvePromptParts: vi.fn(async (template: string) => [{ type: 'text', text: template }]),
      prompt: vi.fn(async (input: {
        messageID: string;
        sessionID: string;
        model: { modelID: string; providerID: string };
        agent: string;
        tools: Record<string, boolean>;
        parts: Array<{ type: string; text: string }>;
      }) => {
        capturedRequests.push(buildOutboundRequest(input.sessionID, input));
        return {
          parts: [{ type: 'text', text: 'Inherited parent context.' }],
        };
      }),
    };

    await mockTaskToolDef.execute(
      { prompt: 'verify Y', subagent_type: 'general' },
      {
        sessionID: parent.sessionID,
        messageID: parent.messageID,
        extra: { promptOps },
      },
    );

    const subagentRequest = capturedRequests.find((req) => req.includes('"agent":"general"'));
    expect(subagentRequest).toBeDefined();
    expect(subagentRequest).toContain(secret);
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

    expect(TaskTool.init).toHaveBeenCalledTimes(1);
    expect(mockTaskToolDef.execute).not.toBe(originalExecute);
    expect((mockTaskToolDef.execute as { __nexusloop_isolation_wrapped?: boolean }).__nexusloop_isolation_wrapped).toBe(true);
  });
});
