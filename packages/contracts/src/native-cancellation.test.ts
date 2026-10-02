import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { defaultDatabaseContext, requestFingerprint } from '@ezerd/model';
import {
  MAX_NATIVE_CANCELLATION_BYTES,
  NATIVE_CANCELLATION_REASON,
  nativeCancellationInputSchema,
  nativeCancellationResultSchema,
} from './native-cancellation.js';

const identity = () => ({
  operationId: randomUUID(),
  groupId: randomUUID(),
  clientId: randomUUID(),
});
const oldAck = () => ({
  operationId: randomUUID(),
  groupId: randomUUID(),
  sequence: 3,
  status: 'accepted',
  actor: { id: randomUUID(), username: ' historical actor ', color: '#112233' },
  changedPaths: [],
  createdAt: '2026-10-02T00:00:00.000Z',
  nextBaseline: {
    baselineId: randomUUID(),
    baseSequence: 3,
    baselineIssuedAt: '2026-10-02T00:00:00.000Z',
  },
});
const nativeAck = () => ({
  ...oldAck(),
  protocolVersion: 2,
  database: defaultDatabaseContext('postgresql'),
  databaseRevision: 1,
  nextBaseline: { ...oldAck().nextBaseline, databaseRevision: 1 },
});
const cancelled = () => ({
  ...nativeAck(),
  status: 'rejected',
  reason: NATIVE_CANCELLATION_REASON,
  reasonCode: NATIVE_CANCELLATION_REASON,
});

describe('native request cancellation contracts', () => {
  it.each(['protocol-operation', 'native-command', 'history-undo', 'history-restore'] as const)(
    'reads only the common UUID identity for %s and preserves obsolete raw fields',
    (kind) => {
      const request = {
        ...identity(),
        obsolete: { previous: ' raw ', document: { unknown: true } },
      };
      const input = {
        kind,
        request,
        ...(kind.startsWith('history-') ? { sourceOperationId: randomUUID() } : {}),
      };
      expect(nativeCancellationInputSchema.parse(input)).toEqual(input);
      expect(requestFingerprint(nativeCancellationInputSchema.parse(input).request)).toBe(
        requestFingerprint(request),
      );
    },
  );
  it('requires common UUIDs and history source identity and rejects envelope authority claims', () => {
    const valid = { kind: 'protocol-operation', request: identity() };
    for (const input of [
      { ...valid, kind: 'upgrade' },
      { ...valid, sourceOperationId: randomUUID() },
      { ...valid, trustedOrigin: true },
      { ...valid, fingerprint: 'arbitrary' },
      { ...valid, request: { ...valid.request, operationId: 'old' } },
      { ...valid, request: { operationId: randomUUID() } },
      { kind: 'history-undo', request: identity() },
      { kind: 'history-restore', request: identity(), sourceOperationId: 'old' },
    ])
      expect(nativeCancellationInputSchema.safeParse(input).success).toBe(false);
  });
  it('reads native upgrade identity without groupId and retains its old request fields', () => {
    const input = {
      kind: 'native-upgrade',
      request: {
        operationId: randomUUID(),
        clientId: randomUUID(),
        expectedVersion: 'historical',
        extra: ' raw ',
      },
    };
    expect(nativeCancellationInputSchema.parse(input)).toEqual(input);
    expect(
      nativeCancellationInputSchema.safeParse({ ...input, request: { operationId: randomUUID() } })
        .success,
    ).toBe(false);
  });
  it('preserves all raw JSON request keys including __proto__ without normalization', () => {
    const request = JSON.parse(
      JSON.stringify(identity()).slice(0, -1) + ',"__proto__":{"raw":" value "}}',
    );
    const parsed = nativeCancellationInputSchema.parse({ kind: 'native-command', request });
    expect(JSON.stringify(parsed.request)).toBe(JSON.stringify(request));
    expect(Object.hasOwn(parsed.request, '__proto__')).toBe(true);
  });
  it('enforces the original UTF-8 envelope budget including unknown fields', () => {
    const input = { kind: 'protocol-operation', request: { ...identity(), old: '' } };
    const base = Buffer.byteLength(JSON.stringify(input));
    input.request.old = 'x'.repeat(MAX_NATIVE_CANCELLATION_BYTES - base);
    expect(nativeCancellationInputSchema.safeParse(input).success).toBe(true);
    input.request.old += 'x';
    expect(nativeCancellationInputSchema.safeParse(input).success).toBe(false);
    input.request.old = '가'.repeat(Math.ceil(MAX_NATIVE_CANCELLATION_BYTES / 3));
    expect(nativeCancellationInputSchema.safeParse(input).success).toBe(false);
  });
  it('rejects non-JSON and cyclic requests', () => {
    const cyclic: Record<string, unknown> = identity();
    cyclic.self = cyclic;
    for (const request of [
      cyclic,
      { ...identity(), extra: BigInt(1) },
      { ...identity(), extra: undefined },
      { ...identity(), extra: NaN },
    ])
      expect(
        nativeCancellationInputSchema.safeParse({ kind: 'protocol-operation', request }).success,
      ).toBe(false);
  });
  it.each([oldAck(), nativeAck()])(
    'retains the raw recorded protocol ACK without trimming',
    (result) => {
      expect(nativeCancellationResultSchema.parse({ outcome: 'recorded', result }).result).toEqual(
        result,
      );
    },
  );
  it('accepts only a native rejected cancellation ACK as cancellation proof', () => {
    const result = cancelled();
    expect(nativeCancellationResultSchema.parse({ outcome: 'cancelled', result }).result).toEqual(
      result,
    );
    for (const invalid of [
      oldAck(),
      nativeAck(),
      { ...result, status: 'accepted' },
      { ...result, reasonCode: 'other' },
      { ...result, changedPaths: ['/domains/a'] },
      { ...result, document: undefined },
    ])
      expect(
        nativeCancellationResultSchema.safeParse({ outcome: 'cancelled', result: invalid }).success,
      ).toBe(false);
  });
  it('rejects unknown outcome/envelope keys and mixed or malformed protocol ACKs', () => {
    const valid = { outcome: 'recorded', result: nativeAck() };
    for (const invalid of [
      { ...valid, outcome: 'not-found' },
      { ...valid, cancelled: true },
      { ...valid, result: { ...valid.result, protocolVersion: 1 } },
      { ...valid, result: { ...valid.result, actor: null } },
    ])
      expect(nativeCancellationResultSchema.safeParse(invalid).success).toBe(false);
  });
});
