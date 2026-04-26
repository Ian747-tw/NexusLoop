import { describe, expect, test, beforeEach } from 'bun:test';
import { checkToolPolicy, dispatchWithPolicy } from '../server-fork/src/seams/gated-dispatch';
import { _resetForTest as _resetLifecycleHooks } from '../server-fork/src/seams/lifecycle-hooks';

describe('gated-dispatch', () => {
  beforeEach(() => {
    _resetLifecycleHooks();
  });

  test('fast-path tools return allow immediately', async () => {
    const result = await checkToolPolicy({
      id: 'fast-1',
      name: 'read_file',
      args: { path: '/tmp/foo' },
      ctx: { cycle_id: 'c1', turn: 1, capsule_bytes: '', provider: 'anthropic' },
    });
    expect(result.kind).toBe('allow');
  });

  test('dispatchWithPolicy allows non-draining calls through', async () => {
    const req = {
      id: 'dispatch-1',
      name: 'read_file',
      args: { path: '/tmp/foo' },
      ctx: { cycle_id: 'c1', turn: 1, capsule_bytes: '', provider: 'anthropic' },
    };
    const executor = async (name: string, args: Record<string, unknown>) => ({ name, args });
    const result = await dispatchWithPolicy(req, executor);
    expect(result.allowed).toBe(true);
  });
});
