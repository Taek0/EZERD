import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createEmptyDocument, defaultDatabaseContext, migrateDesignDocumentV1 } from '@ezerd/model';
import {
  nativeHistoryCommandSchema,
  nativeHistoryCommandResultSchema,
  nativeHistoryPageSchema,
  nativeHistoryQuerySchema,
} from './native-history.js';

const uuid = () => randomUUID();
const context = defaultDatabaseContext('postgresql');
const input = () => ({
  operationId: uuid(),
  groupId: uuid(),
  clientId: uuid(),
  baselineId: uuid(),
  baselineIssuedAt: '2026-10-02T00:00:00.000Z',
  expectedVersion: 3,
  expectedSequence: 5,
  database: context,
  databaseRevision: 2,
});
function result(protocolVersion = 2) {
  const common = {
    operationId: uuid(),
    groupId: uuid(),
    sequence: 1,
    status: 'accepted',
    actor: { id: uuid(), username: 'actor', color: '#123456' },
    changedPaths: [],
    createdAt: input().baselineIssuedAt,
    nextBaseline: {
      baselineId: uuid(),
      baseSequence: 1,
      baselineIssuedAt: input().baselineIssuedAt,
      databaseRevision: 0,
    },
  };
  return protocolVersion === 2
    ? {
        ...common,
        protocolVersion: 2,
        database: context,
        databaseRevision: 0,
        document: migrateDesignDocumentV1(createEmptyDocument(), context).document,
      }
    : { ...common, document: createEmptyDocument() };
}
describe('native history contracts', () => {
  it('requires server baseline and exact context/counter coordinates', () => {
    expect(nativeHistoryCommandSchema.parse(input())).toMatchObject({
      expectedVersion: 3,
      expectedSequence: 5,
    });
    for (const key of [
      'baselineId',
      'baselineIssuedAt',
      'database',
      'databaseRevision',
      'expectedVersion',
      'expectedSequence',
    ]) {
      const missing: Record<string, unknown> = input();
      delete missing[key];
      expect(nativeHistoryCommandSchema.safeParse(missing).success).toBe(false);
    }
    expect(
      nativeHistoryCommandSchema.safeParse({
        ...input(),
        database: { kind: 'mysql', profileId: context.profileId },
      }).success,
    ).toBe(false);
    expect(
      nativeHistoryCommandSchema.safeParse({ ...input(), expectedSequence: 2147483648 }).success,
    ).toBe(false);
  });
  it('rejects client recovery/legacy/identity/before/read-set claims', () => {
    for (const key of [
      'document',
      'before',
      'previous',
      'identityMap',
      'deletionSnapshot',
      'trustedOrigin',
      'changes',
      'dependencyPaths',
    ])
      expect(nativeHistoryCommandSchema.safeParse({ ...input(), [key]: {} }).success).toBe(false);
  });
  it('bounds pagination and rejects unknown options', () => {
    expect(nativeHistoryQuerySchema.parse({})).toEqual({ since: 0, limit: 25 });
    expect(nativeHistoryQuerySchema.parse({ since: '12', limit: '10' })).toEqual({
      since: 12,
      limit: 10,
    });
    for (const invalid of [
      { since: -1 },
      { limit: 0 },
      { limit: 101 },
      { limit: 'bad' },
      { cursor: 'unknown' },
    ])
      expect(nativeHistoryQuerySchema.safeParse(invalid).success).toBe(false);
  });
  it('preserves legacy/upgrade raw evidence alongside native ledger records', () => {
    const old = result(1);
    old.document.domains = [{ id: ' raw-id ', name: 'Raw', description: '' }];
    const upgraded = { ...result(), reasonCode: 'document.upgraded' };
    const audit = {
      command: 'upgrade',
      sourceDocument: old.document,
      sourceDatabase: { ...context, revision: 0 },
    };
    const page = {
      protocolVersion: 2,
      projectId: uuid(),
      version: 2,
      sequence: 3,
      database: { ...context, revision: 1 },
      history: [
        {
          operationId: old.operationId,
          sequence: 1,
          clientId: uuid(),
          kind: 'online',
          format: 'legacy',
          result: old,
          changes: [],
        },
        {
          operationId: upgraded.operationId,
          sequence: 2,
          clientId: uuid(),
          kind: 'online',
          format: 'upgrade',
          result: upgraded,
          changes: [],
          deletionSnapshot: audit,
        },
        {
          operationId: uuid(),
          sequence: 3,
          clientId: uuid(),
          kind: 'online',
          format: 'native',
          result: result(),
          changes: [],
        },
      ],
      nextSince: null,
    };
    expect(nativeHistoryPageSchema.parse(page)).toEqual(page);
  });
  it('outputs kind-specific remapped identities and enforces native result context', () => {
    const output = {
      result: result(),
      command: 'restore',
      sourceOperationId: uuid(),
      identityMap: [{ kind: 'entity', from: 'old', to: uuid() }],
    };
    expect(nativeHistoryCommandResultSchema.parse(output)).toEqual(output);
    expect(
      nativeHistoryCommandResultSchema.safeParse({
        ...output,
        identityMap: [{ from: 'old', to: uuid() }],
      }).success,
    ).toBe(false);
    expect(
      nativeHistoryCommandResultSchema.safeParse({
        ...output,
        result: { ...output.result, database: defaultDatabaseContext('mysql') },
      }).success,
    ).toBe(false);
  });
});
