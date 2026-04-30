import { emitEvent } from "../../bridge/event-emitter";

type CircuitStateName = "closed" | "open" | "half_open";

interface CircuitState {
  state: CircuitStateName;
  consecutiveFailures: number;
  openedAtMs: number | null;
}

interface InvokeDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class CircuitOpenError extends Error {
  constructor(
    readonly mcp: string,
    readonly reopenAtMs: number,
  ) {
    super(`mcp_circuit_open:${mcp}`);
  }
}

const BACKOFF_MS = [100, 400, 1600] as const;
const FAILURE_THRESHOLD = 5;
const OPEN_WINDOW_MS = 30_000;

const circuitStates = new Map<string, CircuitState>();

function getState(mcp: string): CircuitState {
  const existing = circuitStates.get(mcp);
  if (existing) return existing;
  const created: CircuitState = {
    state: "closed",
    consecutiveFailures: 0,
    openedAtMs: null,
  };
  circuitStates.set(mcp, created);
  return created;
}

function openCircuit(mcp: string, state: CircuitState, reason: string, nowMs: number): never {
  state.state = "open";
  state.openedAtMs = nowMs;
  emitEvent({
    event: {
      kind: "mcp_circuit_open",
      mcp,
      reason,
      consecutive_failures: state.consecutiveFailures,
      retry_after_ms: OPEN_WINDOW_MS,
    },
  });
  throw new CircuitOpenError(mcp, nowMs + OPEN_WINDOW_MS);
}

function closeCircuit(mcp: string, state: CircuitState): void {
  state.state = "closed";
  state.consecutiveFailures = 0;
  state.openedAtMs = null;
  emitEvent({
    event: {
      kind: "mcp_circuit_closed",
      mcp,
    },
  });
}

export async function invokeWithCircuitBreaker<T>(
  mcp: string,
  invoke: (attempt: number) => Promise<T>,
  deps: InvokeDeps = {},
): Promise<T> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const state = getState(mcp);
  const nowMs = now();

  if (state.state === "open") {
    const openedAt = state.openedAtMs ?? nowMs;
    if (nowMs - openedAt < OPEN_WINDOW_MS) {
      emitEvent({
        event: {
          kind: "mcp_circuit_open",
          mcp,
          reason: "fail_fast",
          consecutive_failures: state.consecutiveFailures,
          retry_after_ms: OPEN_WINDOW_MS - (nowMs - openedAt),
        },
      });
      throw new CircuitOpenError(mcp, openedAt + OPEN_WINDOW_MS);
    }
    state.state = "half_open";
    emitEvent({
      event: {
        kind: "mcp_circuit_half_open",
        mcp,
      },
    });
  }

  if (state.state === "half_open") {
    try {
      const result = await invoke(1);
      closeCircuit(mcp, state);
      return result;
    } catch (error) {
      state.consecutiveFailures = FAILURE_THRESHOLD;
      openCircuit(mcp, state, "half_open_failure", now());
    }
  }

  let lastError: unknown;
  const maxAttempts = BACKOFF_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await invoke(attempt);
      state.consecutiveFailures = 0;
      state.state = "closed";
      state.openedAtMs = null;
      return result;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      emitEvent({
        event: {
          kind: "mcp_call_retry",
          mcp,
          attempt,
          max_attempts: maxAttempts,
          backoff_ms: BACKOFF_MS[attempt - 1],
          error: String(error),
        },
      });
      await sleep(BACKOFF_MS[attempt - 1]);
    }
  }

  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
    openCircuit(mcp, state, "failure_threshold_reached", now());
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function _resetCircuitBreakersForTest(): void {
  circuitStates.clear();
}

export function _getCircuitStateForTest(mcp: string): CircuitStateName {
  return getState(mcp).state;
}
