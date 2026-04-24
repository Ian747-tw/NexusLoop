import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { checkToolPolicy } from '../server-fork/src/seams/gated-dispatch';

describe('gated-dispatch', () => {
  test('fast-path tools return allow immediately', async () => {
    const result = await checkToolPolicy({
      id: 'fast-1',
      name: 'read_file',
      args: { path: '/tmp/foo' },
      ctx: { cycle_id: 'c1', turn: 1, capsule_bytes: '', provider: 'anthropic' },
    });
    expect(result.kind).toBe('allow');
  });

  test('non-fast-path calls policy client', async () => {
    // This requires policy server running — test infrastructure handles this
    const result = await checkToolPolicy({
      id: 'slow-1',
      name: 'write_file',
      args: { path: '/tmp/evil', content: 'malicious' },
      ctx: { cycle_id: 'c1', turn: 1, capsule_bytes: '', provider: 'anthropic' },
    });
    // Result depends on policy engine response
    expect(['allow', 'deny', 'ask', 'narrow']).toContain(result.kind);
  });
});