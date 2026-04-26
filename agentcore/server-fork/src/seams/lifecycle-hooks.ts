/**
 * seams/lifecycle-hooks.ts
 * Handles graceful shutdown on SIGTERM/SIGINT/SIGHUP.
 *
 * On signal:
 * 1. Set draining flag (gated-dispatch reads it)
 * 2. Wait up to 5s for in-flight calls
 * 3. Flush queued events
 * 4. Write SessionShutdown event (synchronously, before handler returns)
 * 5. Release .nxl/run.lock if present (idempotent)
 * 6. Exit cleanly
 *
 * VENDOR_BOUNDARY ENTRY 8
 */
import { emitEvent } from '../../bridge/event-emitter';
import { rm } from 'fs/promises';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _draining = false;
let _inFlightCalls = 0;
let _shutdownStartTime = 0;
const DRAIN_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if the server is currently draining (shutdown in progress).
 * Used by gated-dispatch to refuse new tool calls during drain.
 */
export function isDraining(): boolean {
  return _draining;
}

/**
 * Called by gated-dispatch when a tool call starts.
 * Increments the in-flight counter.
 */
export function onCallStarted(callId: string): void {
  _inFlightCalls++;
}

/**
 * Called by gated-dispatch when a tool call ends.
 * Decrements the in-flight counter.
 */
export function onCallEnded(callId: string): void {
  if (_inFlightCalls > 0) {
    _inFlightCalls--;
  }
}

/**
 * Returns the ULID timestamp at which shutdown began.
 * Used to detect which calls started before shutdown.
 */
export function getShutdownStartTime(): number {
  return _shutdownStartTime;
}

// ---------------------------------------------------------------------------
// Testing support
// ---------------------------------------------------------------------------

/**
 * Resets all module-level state. Used by tests only.
 * DO NOT call this in production code.
 */
export function _resetForTest(): void {
  _draining = false;
  _inFlightCalls = 0;
  _shutdownStartTime = 0;
  _handlersRegistered = false;
}

// ---------------------------------------------------------------------------
// Signal handling
// ---------------------------------------------------------------------------

/**
 * Registers SIGTERM, SIGINT, and SIGHUP handlers.
 * Safe to call multiple times (only registers once).
 */
export function registerShutdownHandlers(): void {
  if (_handlersRegistered) return;
  _handlersRegistered = true;

  process.on('SIGTERM', () => _handleSignal('SIGTERM'));
  process.on('SIGINT', () => _handleSignal('SIGINT'));
  process.on('SIGHUP', () => _handleSignal('SIGHUP'));
}

let _handlersRegistered = false;

async function _handleSignal(signal: string): Promise<void> {
  if (_draining) return; // Already draining
  _draining = true;
  _shutdownStartTime = Date.now();

  // Emit SessionShutdown SYNCHRONOUSLY before any async work
  // This ensures the event is written to disk before we exit
  _emitSessionShutdown(signal);

  // Wait for in-flight calls with 5s timeout
  const drainOk = await _waitForInflightCalls(DRAIN_TIMEOUT_MS);

  if (!drainOk) {
    // Timed out — emit ToolCallTimedOut for the stuck call
    emitEvent({
      event: {
        kind: 'tool_call_timed_out',
        signal,
        drain_timeout_ms: DRAIN_TIMEOUT_MS,
        timed_out_at: Date.now(),
      },
    });
  }

  // Release pidfile if present (idempotent — no-op if absent)
  await _releasePidFile();

  // Exit cleanly
  process.exit(0);
}

function _emitSessionShutdown(signal: string): void {
  emitEvent({
    event: {
      kind: 'session_shutdown',
      signal,
      shutdown_at: Date.now(),
    },
  });
}

async function _waitForInflightCalls(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (_inFlightCalls > 0) {
    if (Date.now() >= deadline) {
      return false; // Timed out
    }
    // Wait 100ms before checking again
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return true; // All calls completed
}

async function _releasePidFile(): Promise<void> {
  const pidPath = resolve(process.cwd(), '.nxl', 'run.lock');
  try {
    await rm(pidPath, { force: true });
  } catch {
    // Idempotent — ignore errors if file doesn't exist
  }
}
