/**
 * seams/provider-instrumentation.ts
 * ---------------------------------
 * Provides per-call LLM telemetry recording.
 *
 * On every provider call, a ProviderCalled event is emitted with:
 *   prompt_bytes, response_bytes, tokens_used, cache_hit,
 *   latency_ms (monotonic clock), model_version, temperature
 *
 * VENDOR_BOUNDARY ENTRY 7
 */
import { emitEvent } from '../../bridge/event-emitter';

/**
 * Records a completed provider call by emitting a ProviderCalled event.
 * This function is called by the fork's LLM instrumentation after each call.
 *
 * @param params - The telemetry parameters from the call
 */
export function recordProviderCall(params: {
  promptBytes: number;
  responseBytes: number;
  tokensUsed: number;
  cacheHit: boolean;
  latencyMs: number;
  modelVersion: string;
  temperature: number;
}): void {
  emitEvent({
    event: {
      kind: 'provider_called',
      prompt_bytes: params.promptBytes,
      response_bytes: params.responseBytes,
      tokens_used: params.tokensUsed,
      cache_hit: params.cacheHit,
      latency_ms: params.latencyMs,
      model_version: params.modelVersion,
      temperature: params.temperature,
    },
  });
}

/**
 * Creates a timing guard that measures elapsed time using performance.now().
 * Use returned function to get elapsed milliseconds.
 */
export function startTiming(): () => number {
  const start = performance.now();
  return () => performance.now() - start;
}

/**
 * Computes prompt size in bytes from a messages array.
 */
export function computePromptBytes(messages: unknown[]): number {
  try {
    return new TextEncoder().encode(JSON.stringify(messages)).length;
  } catch {
    return 0;
  }
}

/**
 * Accumulates response bytes from an array of text chunks.
 */
export function accumulateResponseBytes(chunks: string[]): number {
  const encoder = new TextEncoder();
  return chunks.reduce((total, chunk) => total + encoder.encode(chunk).length, 0);
}

/**
 * Detects cache hit from AI SDK finish reason strings.
 */
export function detectCacheHit(finishReason: string | undefined): boolean {
  return finishReason === 'cache-hit' || finishReason === 'cache_create';
}

/**
 * Extracts model version from a model object or headers.
 */
export function extractModelVersion(
  model: { id?: string; providerID?: string } | undefined,
  headers: Record<string, string> = {},
): string {
  if (model?.id) return model.id;
  if (headers['x-model-version']) return headers['x-model-version'];
  return 'unknown';
}

/**
 * Extracts temperature from stream options, defaulting to 0.0.
 */
export function extractTemperature(opts: { temperature?: number }): number {
  return typeof opts.temperature === 'number' ? opts.temperature : 0.0;
}
