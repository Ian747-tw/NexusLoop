// @ts-ignore
import { beforeEach, describe, expect, it, vi } from "bun:test";

const mockEmitEvent = vi.fn();

vi.mock("../../bridge/event-emitter", () => ({
  emitEvent: mockEmitEvent,
}));

const {
  CircuitOpenError,
  _getCircuitStateForTest,
  _resetCircuitBreakersForTest,
  invokeWithCircuitBreaker,
} = await import("./circuit-breaker");

describe("circuit-breaker", () => {
  beforeEach(() => {
    mockEmitEvent.mockReset();
    _resetCircuitBreakersForTest();
  });

  it("healthy MCP stays closed", async () => {
    const result = await invokeWithCircuitBreaker("healthy", async () => "ok");
    expect(result).toBe("ok");
    expect(_getCircuitStateForTest("healthy")).toBe("closed");
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it("flaky MCP retries 3 times then succeeds on attempt 4", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await invokeWithCircuitBreaker(
      "flaky",
      async (attempt) => {
        calls += 1;
        if (attempt < 4) throw new Error(`fail-${attempt}`);
        return "recovered";
      },
      {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );

    expect(result).toBe("recovered");
    expect(calls).toBe(4);
    expect(sleeps).toEqual([100, 400, 1600]);
    expect(
      mockEmitEvent.mock.calls.filter((call) => call[0].event.kind === "mcp_call_retry").length,
    ).toBe(3);
  });

  it("dead MCP opens after 5 failed calls and next call fails fast", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("dead");
    });
    const sleep = async () => {};

    for (let i = 0; i < 4; i += 1) {
      await expect(invokeWithCircuitBreaker("dead", invoke, { sleep })).rejects.toThrow("dead");
    }
    await expect(invokeWithCircuitBreaker("dead", invoke, { sleep })).rejects.toBeInstanceOf(CircuitOpenError);
    expect(_getCircuitStateForTest("dead")).toBe("open");

    const before = invoke.mock.calls.length;
    await expect(invokeWithCircuitBreaker("dead", invoke, { sleep })).rejects.toBeInstanceOf(CircuitOpenError);
    expect(invoke.mock.calls.length).toBe(before);
  });

  it("after 30s, half_open success closes the circuit", async () => {
    let nowMs = 0;
    const sleep = async () => {};
    const dead = vi.fn(async () => {
      throw new Error("dead");
    });

    for (let i = 0; i < 5; i += 1) {
      await expect(invokeWithCircuitBreaker("recovering", dead, { sleep, now: () => nowMs })).rejects.toThrow();
      nowMs += 1;
    }

    nowMs = 30_100;
    const result = await invokeWithCircuitBreaker(
      "recovering",
      async () => "ok",
      { now: () => nowMs, sleep },
    );
    expect(result).toBe("ok");
    expect(_getCircuitStateForTest("recovering")).toBe("closed");
  });

  it("half_open failure reopens for another 30s", async () => {
    let nowMs = 0;
    const sleep = async () => {};
    const dead = vi.fn(async () => {
      throw new Error("dead");
    });

    for (let i = 0; i < 5; i += 1) {
      await expect(invokeWithCircuitBreaker("half-open-fail", dead, { sleep, now: () => nowMs })).rejects.toThrow();
      nowMs += 1;
    }

    nowMs = 30_100;
    await expect(
      invokeWithCircuitBreaker(
        "half-open-fail",
        async () => {
          throw new Error("still-dead");
        },
        { now: () => nowMs, sleep },
      ),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(_getCircuitStateForTest("half-open-fail")).toBe("open");
  });
});
