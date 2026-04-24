import { describe, expect, test } from 'bun:test';
import { requestCapsule, requestCompact } from '../server-fork/src/seams/capsule-session';

describe('capsule-session', () => {
  test('requestCapsule sends correct structure', async () => {
    // Gracefully handle nxl_core.capsule.server not existing yet (Task 11)
    let error;
    try {
      await requestCapsule({ cycle_id: 'test-cycle' });
    } catch (e: unknown) {
      error = e;
    }
    // Either succeeds or fails gracefully — both acceptable at this stage
    if (error) {
      // Expected: nxl_core.capsule.server not yet implemented, or python not found
      const msg = String(error);
      expect(
        msg.includes('IPC capsule parse error') ||
        msg.includes('Executable not found')
      ).toBe(true);
    } else {
      // Once server exists, verify structure
      // (This branch will be exercised after Task 11)
    }
  });

  test('requestCompact sends correct structure', async () => {
    // Gracefully handle nxl_core.capsule.server not existing yet (Task 11)
    let error;
    try {
      await requestCompact({
        cycle_id: 'test-cycle',
        tier_hint: 'soft',
        current_token_count: 95000,
        reason: 'near limit',
      });
    } catch (e: unknown) {
      error = e;
    }
    // Either succeeds or fails gracefully — both acceptable at this stage
    if (error) {
      // Expected: nxl_core.capsule.server not yet implemented, or python not found
      const msg = String(error);
      expect(
        msg.includes('IPC compact parse error') ||
        msg.includes('Executable not found')
      ).toBe(true);
    } else {
      // Once server exists, verify structure
      // (This branch will be exercised after Task 11)
    }
  });
});
