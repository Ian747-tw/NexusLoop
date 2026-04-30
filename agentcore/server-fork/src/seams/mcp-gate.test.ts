import { beforeEach, describe, expect, it, vi } from 'bun:test';

const mockCheckToolPolicy = vi.fn();
const mockEmitEvent = vi.fn();
const mockEnqueueIntervention = vi.fn();
const mockHandler = vi.fn(async (tool: string, args: Record<string, unknown>) => ({ tool, args }));

vi.mock('./gated-dispatch', () => ({
  checkToolPolicy: mockCheckToolPolicy,
}));

vi.mock('../../bridge/event-emitter', () => ({
  emitEvent: mockEmitEvent,
}));

vi.mock('./intervention-hook', () => ({
  enqueueIntervention: mockEnqueueIntervention,
}));

const { dispatchMCP, registerMCP } = await import('./mcp-gate');
const { _resetForTest: resetTripwireState, isTripwireBlocked } = await import('./tripwire-gate');

describe('mcp-gate', () => {
  beforeEach(() => {
    mockCheckToolPolicy.mockReset();
    mockEmitEvent.mockReset();
    mockEnqueueIntervention.mockReset();
    mockHandler.mockClear();
    resetTripwireState();
    registerMCP(
      'test-mcp',
      [
        { name: 'test-tool', description: 'test tool', inputSchema: {} },
        { name: 'other-tool', description: 'other tool', inputSchema: {} },
      ],
      mockHandler,
    );
  });

  it('Test 1: non-negotiable denial through mcp-gate fires tripwire and blocks later MCP calls', async () => {
    mockCheckToolPolicy.mockResolvedValueOnce({
      kind: 'deny_non_negotiable',
      rule_id: 'NN-1',
      reason: 'non-negotiable MCP denial',
    });

    const first = await dispatchMCP('test-mcp', 'test-tool', {});
    expect(first.allowed).toBe(false);
    expect(first.error).toMatch(/tripwire fired/);
    expect(isTripwireBlocked()).toBe(true);

    mockCheckToolPolicy.mockResolvedValueOnce({ kind: 'allow' });
    const second = await dispatchMCP('test-mcp', 'other-tool', {});
    expect(second.allowed).toBe(false);
    expect(second.error).toMatch(/tripwire_active:/);
    expect(mockCheckToolPolicy).toHaveBeenCalledTimes(1);
    expect(mockHandler).not.toHaveBeenCalled();
  });
});
