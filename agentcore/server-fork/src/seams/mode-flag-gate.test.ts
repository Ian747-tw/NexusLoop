import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { applyModeFlagGate } from './mode-flag-gate';
import { _resetForTesting as _resetFlagRegistry } from '../util/mode-flag-registry';

vi.mock('../../bridge/event-emitter', () => ({
  emitEvent: vi.fn(),
}));

const { emitEvent } = await import('../../bridge/event-emitter');

describe('mode-flag-gate', () => {
  beforeEach(() => {
    _resetFlagRegistry();
    vi.clearAllMocks();
  });

  it('Test 1: --allow-edit-without-approval set + default_verdict deny → flag false, ModeFlagDenied emitted', () => {
    // The registry marks allow-edit-without-approval with default_verdict: deny
    const flags = { 'allow-edit-without-approval': true };
    const result = applyModeFlagGate(flags, 'cycle-1');

    expect(result['allow-edit-without-approval']).toBe(false);
    expect(emitEvent).toHaveBeenCalledWith({
      event: expect.objectContaining({
        kind: 'mode_flag_denied',
        flag_name: 'allow-edit-without-approval',
      }),
    });
  });

  it('Test 2: --allow-edit-without-approval NOT set → passthrough, no event', () => {
    const flags = { 'allow-edit-without-approval': false };
    const result = applyModeFlagGate(flags, 'cycle-1');

    expect(result['allow-edit-without-approval']).toBe(false);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('Test 3: multiple gated flags set simultaneously → each evaluated independently', () => {
    const flags = {
      'allow-edit-without-approval': true,
      'allow-shell-without-approval': true,
      'skip-policy-check': true,
    };
    const result = applyModeFlagGate(flags, 'cycle-1');

    // All three are denied by default → all forced to false
    expect(result['allow-edit-without-approval']).toBe(false);
    expect(result['allow-shell-without-approval']).toBe(false);
    expect(result['skip-policy-check']).toBe(false);

    // Three separate denial events
    expect(emitEvent).toHaveBeenCalledTimes(3);
    expect(emitEvent).toHaveBeenCalledWith({
      event: expect.objectContaining({ kind: 'mode_flag_denied', flag_name: 'allow-edit-without-approval' }),
    });
    expect(emitEvent).toHaveBeenCalledWith({
      event: expect.objectContaining({ kind: 'mode_flag_denied', flag_name: 'allow-shell-without-approval' }),
    });
    expect(emitEvent).toHaveBeenCalledWith({
      event: expect.objectContaining({ kind: 'mode_flag_denied', flag_name: 'skip-policy-check' }),
    });
  });

  it('Test 4: unregistered flag → passes through unchanged, no event', () => {
    const flags = { 'some-other-flag': true };
    const result = applyModeFlagGate(flags, 'cycle-1');

    expect(result['some-other-flag']).toBe(true);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('Test 5: mix of registered denied and registered allowed flags → only denied overridden', () => {
    // No flag in our registry has default_verdict: allow, so all registered
    // flags with default_verdict: deny are overridden
    const flags = {
      'allow-edit-without-approval': true,
      'unregistered-flag': true,
    };
    const result = applyModeFlagGate(flags, 'cycle-1');

    expect(result['allow-edit-without-approval']).toBe(false); // denied → overridden
    expect(result['unregistered-flag']).toBe(true); // passthrough
    expect(emitEvent).toHaveBeenCalledTimes(1);
  });
});
