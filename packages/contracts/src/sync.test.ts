import { describe, expect, it } from 'vitest';
import { syncEventSchema, syncOperationInputSchema } from './sync.js';

const document = {
  schemaVersion: 1,
  domains: [],
  domainRelations: [],
  notes: [],
  layout: { nodes: [], viewports: [] },
};
const operation = {
  operationId: '00000000-0000-4000-8000-000000000001',
  groupId: '00000000-0000-4000-8000-000000000002',
  clientId: '00000000-0000-4000-8000-000000000003',
  baselineId: '00000000-0000-4000-8000-000000000004',
  baseSequence: 0,
  baselineIssuedAt: '2026-09-15T00:00:00.000Z',
  kind: 'online',
  dependencyPaths: [],
  changes: [{ path: '/domains/domain/name', before: '이전', after: '다음' }],
  baselineDocument: document,
  document,
};

describe('sync contracts', () => {
  it('accepts a complete operation without a client-supplied actor', () => {
    expect(syncOperationInputSchema.parse(operation)).toEqual(operation);
    expect(
      syncOperationInputSchema.safeParse({ ...operation, actor: { id: operation.clientId } })
        .success,
    ).toBe(false);
  });

  it('requires server actor and ordering metadata on events', () => {
    expect(
      syncEventSchema.safeParse({
        operationId: operation.operationId,
        groupId: operation.groupId,
        sequence: 1,
        status: 'accepted',
        actor: { id: operation.clientId, username: '사용자', color: '#123abc' },
        changes: operation.changes,
        changedPaths: ['/domains/domain/name'],
        createdAt: '2026-09-15T00:00:01.000Z',
        nextBaseline: {
          baselineId: operation.baselineId,
          baseSequence: 1,
          baselineIssuedAt: '2026-09-15T00:00:01.000Z',
        },
        document,
      }).success,
    ).toBe(true);
  });

  it('rejects duplicate and malformed paths', () => {
    expect(
      syncOperationInputSchema.safeParse({
        ...operation,
        changes: [...operation.changes, ...operation.changes],
      }).success,
    ).toBe(false);
    expect(
      syncOperationInputSchema.safeParse({
        ...operation,
        changes: [{ ...operation.changes[0], path: '/domains//name' }],
      }).success,
    ).toBe(false);
  });

  it('requires a server-issued baseline identity and baseline document', () => {
    const { baselineId: _id, ...withoutId } = operation;
    const { baselineDocument: _document, ...withoutDocument } = operation;
    expect(syncOperationInputSchema.safeParse(withoutId).success).toBe(false);
    expect(syncOperationInputSchema.safeParse(withoutDocument).success).toBe(false);
  });
});
