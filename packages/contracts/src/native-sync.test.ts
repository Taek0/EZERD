import { syncEventReadSchema, syncOperationInputReadSchema } from './sync-read.js';
import { describe, it, expect } from 'vitest';
import {
  createEmptyDocument,
  createEmptyNativeDocument,
  defaultDatabaseContext,
  requestFingerprint,
} from '@ezerd/model';
import {
  nativeSyncOperationInputSchema,
  nativeSyncOperationResultSchema,
  nativeSyncSnapshotSchema,
} from './native-sync.js';
import { syncOperationInputSchema } from './sync.js';
const pg = defaultDatabaseContext('postgresql');
const document = createEmptyNativeDocument(pg);
const metadata = {
  operationId: '00000000-0000-4000-8000-000000000001',
  groupId: '00000000-0000-4000-8000-000000000002',
  clientId: '00000000-0000-4000-8000-000000000003',
  baselineId: '00000000-0000-4000-8000-000000000004',
  baseSequence: 0,
  baselineIssuedAt: '2026-10-01T00:00:00.000Z',
  kind: 'online',
  dependencyPaths: [],
  changes: [{ path: '/domains/d/name', before: 'old', after: 'new' }],
};
const input = {
  ...metadata,
  protocolVersion: 2,
  database: pg,
  databaseRevision: 0,
  baselineDocument: document,
  document,
};
const result = {
  protocolVersion: 2,
  operationId: metadata.operationId,
  groupId: metadata.groupId,
  sequence: 1,
  status: 'accepted',
  actor: { id: metadata.clientId, username: 'tester', color: '#112233' },
  changedPaths: ['/domains/d/name'],
  createdAt: metadata.baselineIssuedAt,
  database: pg,
  databaseRevision: 1,
  nextBaseline: {
    baselineId: metadata.baselineId,
    baseSequence: 1,
    baselineIssuedAt: metadata.baselineIssuedAt,
    databaseRevision: 1,
  },
  document,
};
describe('native sync transport preparation', () => {
  it('preserves shared defaults, change presence checks and path limits in the Native envelope', () => {
    const { dependencyPaths: _paths, ...withoutPaths } = input;
    expect(nativeSyncOperationInputSchema.parse(withoutPaths).dependencyPaths).toEqual([]);
    for (const changes of [
      [],
      [...metadata.changes, ...metadata.changes],
      [{ path: '/domains/d/name', after: 'new' }],
      [{ path: '/domains/d/name', before: 'old' }],
      [{ path: '/domains//name', before: null, after: null }],
      Array.from({ length: 1001 }, (_, i) => ({
        path: `/domains/d${i}/name`,
        before: '',
        after: 'n',
      })),
    ])
      expect(nativeSyncOperationInputSchema.safeParse({ ...input, changes }).success).toBe(false);
    expect(
      nativeSyncOperationInputSchema.safeParse({
        ...input,
        changes: [{ path: '/domains/d/name', before: undefined, after: null }],
      }).success,
    ).toBe(true);
  });
  it('preserves v1 and v2 raw requests without injecting revision defaults', () => {
    const old = {
      ...metadata,
      baselineDocument: createEmptyDocument(),
      document: createEmptyDocument(),
    };
    expect(syncOperationInputReadSchema.parse(old)).toEqual(old);
    expect(nativeSyncOperationInputSchema.parse(input)).toEqual(input);
    expect(requestFingerprint(syncOperationInputReadSchema.parse(input))).toBe(
      requestFingerprint(input),
    );
    expect(syncOperationInputSchema.safeParse(input).success).toBe(false);
  });
  it('requires revision/protocol/context and rejects actor spoofing and mixed versions', () => {
    for (const value of [
      { ...input, databaseRevision: undefined },
      { ...input, protocolVersion: 1 },
      { ...input, database: defaultDatabaseContext('mysql') },
      { ...input, document: createEmptyNativeDocument(defaultDatabaseContext('sqlite')) },
      { ...input, baselineDocument: createEmptyDocument() },
      { ...input, actor: result.actor },
    ])
      expect(nativeSyncOperationInputSchema.safeParse(value).success).toBe(false);
  });
  it('retains legacy source values for server comparison without authorizing new legacy copies', () => {
    const doc = {
      ...document,
      columns: [
        {
          id: 'c',
          tableId: 't',
          scope: 'physical',
          logical: { name: '', definition: '', semanticType: '', required: false },
          physical: {
            name: 'c',
            type: {
              kind: 'legacy',
              source: 'document-v1',
              original: { name: 'UNKNOWN ', isArray: false },
            },
            nullable: true,
            comment: '',
            generation: { kind: 'none' },
            defaultValue: { kind: 'legacyExpression', source: 'document-v1', original: 'raw() ' },
            options: { database: 'postgresql' },
          },
          customProperties: { common: {}, logical: {}, physical: {} },
        },
      ],
    };
    // This structural parse is intentionally not the trusted server repair policy.
    const parsed = nativeSyncOperationInputSchema.parse({
      ...input,
      baselineDocument: doc,
      document: doc,
    });
    expect(parsed.document.columns?.[0]?.physical.type).toEqual(doc.columns[0]!.physical.type);
    expect(parsed.document.columns?.[0]?.physical.defaultValue).toEqual(
      doc.columns[0]!.physical.defaultValue,
    );
  });
  it('requires accepted baseline revision consistency while retaining rejected old baselines', () => {
    expect(nativeSyncOperationResultSchema.parse(result)).toEqual(result);
    expect(
      nativeSyncOperationResultSchema.safeParse({
        ...result,
        nextBaseline: { ...result.nextBaseline, databaseRevision: 0 },
      }).success,
    ).toBe(false);
    expect(
      nativeSyncOperationResultSchema.safeParse({
        ...result,
        status: 'rejected',
        reasonCode: 'database.context-changed',
        nextBaseline: { ...result.nextBaseline, databaseRevision: 0 },
      }).success,
    ).toBe(true);
    expect(
      nativeSyncOperationResultSchema.safeParse({
        ...result,
        document: createEmptyNativeDocument(defaultDatabaseContext('mysql')),
      }).success,
    ).toBe(false);
    expect(syncEventReadSchema.parse({ ...result, changes: metadata.changes })).toMatchObject({
      protocolVersion: 2,
      databaseRevision: 1,
    });
  });
  it('binds baseline native context and bounds public rejection diagnostics', () => {
    const snapshot = {
      protocolVersion: 2,
      projectVersion: 0,
      sequence: 0,
      baselineId: metadata.baselineId,
      baselineIssuedAt: metadata.baselineIssuedAt,
      database: pg,
      databaseRevision: 0,
      document,
    };
    expect(nativeSyncSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      nativeSyncSnapshotSchema.safeParse({ ...snapshot, database: defaultDatabaseContext('mysql') })
        .success,
    ).toBe(false);
    const issue = {
      code: 'type.not-implemented',
      category: 'unsupported',
      severity: 'error',
      objectId: 'c',
      path: '/columns/c/physical/type',
      params: {},
    };
    expect(
      nativeSyncOperationResultSchema.safeParse({ ...result, status: 'rejected', issues: [issue] })
        .success,
    ).toBe(true);
    expect(
      nativeSyncOperationResultSchema.safeParse({
        ...result,
        status: 'rejected',
        issues: Array(1001).fill(issue),
      }).success,
    ).toBe(false);
  });
});
