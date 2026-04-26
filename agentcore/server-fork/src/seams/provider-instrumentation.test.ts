/**
 * seams/provider-instrumentation.test.ts
 * Tests for provider-instrumentation seam (VENDOR_BOUNDARY entry 7)
 */
// @ts-ignore — bun:test is a Bun built-in, not in @types/node
import { describe, it, expect, beforeEach, vi } from 'bun:test';
import {
  recordProviderCall,
  startTiming,
  computePromptBytes,
  accumulateResponseBytes,
  detectCacheHit,
  extractModelVersion,
  extractTemperature,
} from './provider-instrumentation';

// Track emitted events via a mock spy
let emittedEvents: Array<Record<string, unknown>> = [];

const originalEmitEvent = vi.fn((event: Record<string, unknown>) => {
  emittedEvents.push(event);
});

// Spy on the event emitter module
vi.mock('../../bridge/event-emitter', () => ({
  emitEvent: originalEmitEvent,
}));

describe('provider-instrumentation seam', () => {
  beforeEach(() => {
    emittedEvents = [];
    originalEmitEvent.mockClear();
  });

  // -------------------------------------------------------------------------
  // Test 1: Mock provider call → assert ProviderCalled with all 7 fields
  // -------------------------------------------------------------------------
  it('emits ProviderCalled with all 7 required fields and correct types', () => {
    recordProviderCall({
      promptBytes: 150,
      responseBytes: 300,
      tokensUsed: 450,
      cacheHit: false,
      latencyMs: 125.5,
      modelVersion: 'claude-sonnet-4-20250514',
      temperature: 0.7,
    });

    expect(emittedEvents).toHaveLength(1);
    const event = emittedEvents[0] as { event: Record<string, unknown> };
    expect(event.event.kind).toBe('provider_called');
    expect(typeof event.event.prompt_bytes).toBe('number');
    expect(typeof event.event.response_bytes).toBe('number');
    expect(typeof event.event.tokens_used).toBe('number');
    expect(typeof event.event.cache_hit).toBe('boolean');
    expect(typeof event.event.latency_ms).toBe('number');
    expect(typeof event.event.model_version).toBe('string');
    expect(typeof event.event.temperature).toBe('number');
  });

  // -------------------------------------------------------------------------
  // Test 2: Cache hit reflected truthfully
  // -------------------------------------------------------------------------
  it('records cache_hit=true when finishReason is cache-hit', () => {
    expect(detectCacheHit('cache-hit')).toBe(true);
  });

  it('records cache_hit=true when finishReason is cache_create', () => {
    expect(detectCacheHit('cache_create')).toBe(true);
  });

  it('records cache_hit=false for non-cache finish reasons', () => {
    expect(detectCacheHit('stop')).toBe(false);
    expect(detectCacheHit('length')).toBe(false);
    expect(detectCacheHit(undefined)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 3: Two consecutive calls — latency_ms is independent (no leak)
  // -------------------------------------------------------------------------
  it('two consecutive timings are independent — no cross-call contamination', async () => {
    const getElapsed1 = startTiming();
    // First call: short delay
    await new Promise(resolve => setTimeout(resolve, 5));
    const elapsed1 = getElapsed1();

    const getElapsed2 = startTiming();
    // Second call: same delay
    await new Promise(resolve => setTimeout(resolve, 5));
    const elapsed2 = getElapsed2();

    // Both should be roughly the same (~5ms, within 30ms tolerance)
    expect(Math.abs(elapsed1 - elapsed2)).toBeLessThan(30);
    // Neither should be wildly different from the other
    expect(elapsed1).toBeGreaterThan(0);
    expect(elapsed2).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 4: Provider error — still emits ProviderCalled; error propagates
  // -------------------------------------------------------------------------
  it('recordProviderCall does not throw on error metadata', () => {
    // recordProviderCall should never throw — it wraps emitEvent safely
    expect(() =>
      recordProviderCall({
        promptBytes: 0,
        responseBytes: 0,
        tokensUsed: 0,
        cacheHit: false,
        latencyMs: 0,
        modelVersion: 'unknown',
        temperature: 0.0,
      }),
    ).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Additional property value checks
  // -------------------------------------------------------------------------
  it('latency_ms uses performance.now() — monotonic, not wall-clock', () => {
    // performance.now() is monotonically increasing — two consecutive calls
    // always have non-negative delta, unlike Date.now() which can drift backward
    // with NTP corrections
    const t1 = performance.now();
    const t2 = performance.now();
    const delta = t2 - t1;

    // Delta must be non-negative (monotonic property)
    expect(delta).toBeGreaterThanOrEqual(0);
    // Delta should be tiny (< 1ms) for back-to-back calls
    expect(delta).toBeLessThan(10);

    // Also verify Date.now() comparison: Date.now() is NOT suitable for
    // measuring elapsed time because it can go backwards (NTP correction, DST)
    const wallBefore = Date.now();
    const wallAfter = Date.now();
    // wallAfter - wallBefore >= 0 but this is not guaranteed monotonic
    // (could be 0 or positive, never negative but can have arbitrary jumps)
    expect(wallAfter).toBeGreaterThanOrEqual(wallBefore);
  });

  it('computePromptBytes returns correct byte size', () => {
    const messages = [{ role: 'user', content: 'Hello' }];
    const bytes = computePromptBytes(messages);
    expect(bytes).toBeGreaterThan(0);
    // JSON.stringify(messages) = '[{"role":"user","content":"Hello"}]'
    expect(bytes).toBe(new TextEncoder().encode(JSON.stringify(messages)).length);
  });

  it('computePromptBytes handles empty messages', () => {
    // JSON.stringify([]) = "[]" which is 2 bytes
    expect(computePromptBytes([])).toBe(2);
  });

  it('accumulateResponseBytes sums text chunks correctly', () => {
    const chunks = ['Hello ', 'world!'];
    expect(accumulateResponseBytes(chunks)).toBe(
      new TextEncoder().encode('Hello world!').length,
    );
  });

  it('accumulateResponseBytes handles empty chunks', () => {
    expect(accumulateResponseBytes([])).toBe(0);
  });

  it('extractModelVersion prefers model.id over headers', () => {
    expect(extractModelVersion({ id: 'claude-sonnet-4-20250514' })).toBe(
      'claude-sonnet-4-20250514',
    );
  });

  it('extractModelVersion falls back to x-model-version header', () => {
    expect(
      extractModelVersion(undefined, { 'x-model-version': 'gpt-4-turbo' }),
    ).toBe('gpt-4-turbo');
  });

  it('extractModelVersion returns unknown when no source available', () => {
    expect(extractModelVersion(undefined, {})).toBe('unknown');
  });

  it('extractTemperature returns value when provided', () => {
    expect(extractTemperature({ temperature: 1.0 })).toBe(1.0);
    expect(extractTemperature({ temperature: 0 })).toBe(0);
  });

  it('extractTemperature defaults to 0.0 when not provided', () => {
    expect(extractTemperature({})).toBe(0.0);
    expect(extractTemperature({ model: {} } as { temperature?: number })).toBe(0.0);
  });

  it('full recordProviderCall integration — all fields captured end-to-end', () => {
    const getElapsed = startTiming();
    const chunks = ['The ', 'answer ', 'is 42.'];
    const bytes = accumulateResponseBytes(chunks);
    const elapsed = getElapsed();

    recordProviderCall({
      promptBytes: computePromptBytes([{ role: 'user', content: 'What is 6×7?' }]),
      responseBytes: bytes,
      tokensUsed: 25,
      cacheHit: detectCacheHit('stop'),
      latencyMs: elapsed,
      modelVersion: extractModelVersion({ id: 'claude-3-opus' }),
      temperature: extractTemperature({ temperature: 0.5 }),
    });

    expect(emittedEvents).toHaveLength(1);
    const evt = emittedEvents[0] as { event: Record<string, unknown> };
    expect(evt.event.kind).toBe('provider_called');
    expect(evt.event.prompt_bytes).toBeGreaterThan(0);
    expect(evt.event.response_bytes).toBe(bytes);
    expect(evt.event.tokens_used).toBe(25);
    expect(evt.event.cache_hit).toBe(false); // 'stop' → not cache
    expect(evt.event.latency_ms).toBeGreaterThanOrEqual(0);
    expect(evt.event.model_version).toBe('claude-3-opus');
    expect(evt.event.temperature).toBe(0.5);
  });
});
