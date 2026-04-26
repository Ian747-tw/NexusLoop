import { describe, expect, test } from 'bun:test';
import {
  PolicyDecision,
  ToolCallRequest,
  CapsuleResponse,
  CompactRequest,
  EventEmissionRequest,
  EventEmissionAck,
} from '../server-fork/bridge/protocol';

describe('protocol round-trip', () => {
  test('PolicyDecision allow round-trip', () => {
    const msg = { kind: 'allow' as const };
    const decoded = PolicyDecision.parse(msg);
    expect(decoded.kind).toBe('allow');
    const reEncoded = JSON.stringify(decoded);
    expect(JSON.parse(reEncoded)).toEqual(msg);
  });

  test('PolicyDecision deny round-trip', () => {
    const msg = { kind: 'deny' as const, reason: 'unsafe' };
    const decoded = PolicyDecision.parse(msg);
    expect(decoded.kind).toBe('deny');
    expect(decoded.reason).toBe('unsafe');
    const reEncoded = JSON.stringify(decoded);
    expect(JSON.parse(reEncoded)).toEqual(msg);
  });

  test('PolicyDecision ask round-trip', () => {
    const msg = { kind: 'ask' as const, verb: 'confirm', payload: { tool: 'write_file' } };
    const decoded = PolicyDecision.parse(msg);
    expect(decoded.kind).toBe('ask');
    expect(decoded.verb).toBe('confirm');
    const reEncoded = JSON.stringify(decoded);
    expect(JSON.parse(reEncoded)).toEqual(msg);
  });

  test('PolicyDecision narrow round-trip', () => {
    const msg = { kind: 'narrow' as const, narrowed_args: { path: '/safe' }, reason: 'path sanitized' };
    const decoded = PolicyDecision.parse(msg);
    expect(decoded.kind).toBe('narrow');
    expect(decoded.narrowed_args).toEqual({ path: '/safe' });
    const reEncoded = JSON.stringify(decoded);
    expect(JSON.parse(reEncoded)).toEqual(msg);
  });

  test('ToolCallRequest round-trip', () => {
    const msg = {
      id: 'req-1',
      name: 'read_file',
      args: { path: '/tmp/foo' },
      ctx: {
        cycle_id: 'cycle-42',
        turn: 1,
        capsule_bytes: 'aGVsbG8=',
        provider: 'anthropic' as const,
      },
    };
    const decoded = ToolCallRequest.parse(msg);
    expect(decoded.id).toBe('req-1');
    expect(decoded.ctx.provider).toBe('anthropic');
    const reEncoded = JSON.stringify(decoded);
    expect(JSON.parse(reEncoded)).toEqual(msg);
  });

  test('CapsuleResponse round-trip', () => {
    const msg = { prefix: '<session>...</session>', cache_break: '<cache>...' };
    const decoded = CapsuleResponse.parse(msg);
    expect(decoded.prefix).toBe('<session>...</session>');
    const reEncoded = JSON.stringify(decoded);
    expect(JSON.parse(reEncoded)).toEqual(msg);
  });

  test('CompactRequest round-trip', () => {
    const msg = {
      cycle_id: 'cycle-42',
      tier_hint: 'soft' as const,
      current_token_count: 95000,
      reason: 'near limit',
    };
    const decoded = CompactRequest.parse(msg);
    expect(decoded.tier_hint).toBe('soft');
    expect(decoded.current_token_count).toBe(95000);
    const reEncoded = JSON.stringify(decoded);
    expect(JSON.parse(reEncoded)).toEqual(msg);
  });

  test('EventEmissionRequest round-trip', () => {
    const msg = {
      kind: 'EventEmissionRequest' as const,
      request_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      event: {
        event_id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
        kind: 'cycle_started',
        brief_hash: 'abc123',
        hypothesis_id: 'h1',
        started_at: 1712000000000,
      },
      origin_mcp: 'journal',
    };
    const decoded = EventEmissionRequest.parse(msg);
    expect(decoded.request_id).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(decoded.event.kind).toBe('cycle_started');
    expect(decoded.origin_mcp).toBe('journal');
    const reEncoded = JSON.stringify(decoded);
    expect(JSON.parse(reEncoded)).toEqual(msg);
  });

  test('EventEmissionAck success round-trip', () => {
    const msg = {
      kind: 'EventEmissionAck' as const,
      request_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      event_id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    };
    const decoded = EventEmissionAck.parse(msg);
    expect(decoded.event_id).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAW');
    expect(decoded.error).toBeUndefined();
    const reEncoded = JSON.stringify(decoded);
    expect(JSON.parse(reEncoded)).toEqual(msg);
  });

  test('EventEmissionAck error round-trip', () => {
    const msg = {
      kind: 'EventEmissionAck' as const,
      request_id: 'req-1',
      event_id: null,
      error: 'unknown event kind',
    };
    const decoded = EventEmissionAck.parse(msg);
    expect(decoded.event_id).toBeNull();
    expect(decoded.error).toBe('unknown event kind');
    const reEncoded = JSON.stringify(decoded);
    expect(JSON.parse(reEncoded)).toEqual(msg);
  });
});