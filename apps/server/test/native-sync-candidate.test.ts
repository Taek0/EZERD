import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  createEmptyDocument,
  defaultDatabaseContext,
  deriveOperationChanges,
  migrateDesignDocumentV1,
  sharedDocument,
  type NativeDesignDocument,
} from '@ezerd/model';
import { type NativeSyncOperationInput } from '@ezerd/contracts';
import {
  prepareNativeSyncCandidate,
  type LockedNativeProject,
  type TrustedNativeBaseline,
} from '../src/shared/native-sync-candidate.js';

const now = Date.parse('2026-10-01T02:00:00Z');
const actorId = randomUUID();
function fixture() {
  const v1 = createEmptyDocument();
  v1.tables = [
    {
      id: 't',
      domainId: null,
      scope: 'both',
      logical: { name: 't', definition: '' },
      physical: { name: 't', schema: 'public', comment: '' },
      customProperties: { common: {}, logical: {}, physical: {} },
    },
  ];
  v1.columns = ['a', 'b'].map((id) => ({
    id,
    tableId: 't',
    scope: 'both',
    logical: { name: id, definition: '', semanticType: '', required: false },
    physical: {
      name: id,
      type: { name: 'unknown', isArray: false },
      nullable: true,
      defaultExpression: 'old()',
      comment: '',
    },
    customProperties: { common: {}, logical: {}, physical: {} },
  }));
  v1.layout.nodes = [
    { id: 'nt', viewId: '__tables__', objectId: 't', x: 0, y: 0, width: 320, height: 260 },
  ];
  const context = defaultDatabaseContext('postgresql');
  const document = migrateDesignDocumentV1(v1, context).document;
  const project: LockedNativeProject = {
    id: randomUUID(),
    status: 'active',
    syncSequence: 0,
    database: { ...context, revision: 3 },
    document: structuredClone(document),
  };
  const baseline: TrustedNativeBaseline = {
    projectId: project.id,
    userId: actorId,
    clientId: randomUUID(),
    baselineId: randomUUID(),
    lastSequence: 0,
    databaseRevision: 3,
    lastSuccessfulSyncAt: new Date(now),
    document: sharedDocument(document),
  };
  const request = (edit: (value: NativeDesignDocument) => void): NativeSyncOperationInput => {
    const source = sharedDocument(document);
    const candidate = structuredClone(source);
    edit(candidate);
    return {
      protocolVersion: 2,
      operationId: randomUUID(),
      groupId: randomUUID(),
      clientId: baseline.clientId,
      baselineId: baseline.baselineId,
      baseSequence: 0,
      baselineIssuedAt: new Date(now).toISOString(),
      database: context,
      databaseRevision: 3,
      kind: 'online',
      dependencyPaths: [],
      baselineDocument: source,
      document: candidate,
      changes: deriveOperationChanges(source, candidate),
    };
  };
  return { document, project, baseline, request };
}
function code(result: ReturnType<typeof prepareNativeSyncCandidate>) {
  return result.status === 'rejected' ? result.code : result.status;
}
function badRequestCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return (error.getResponse() as { code: string }).code;
  }
  return undefined;
}
describe('server native candidate preparation under trusted context', () => {
  it('merges only changed fields onto current, preserves remote repairs and all original inputs', () => {
    const { project, baseline, request } = fixture();
    const current = project.document as NativeDesignDocument;
    current.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:integer',
      parameters: {},
    };
    current.columns![0]!.physical.defaultValue = { kind: 'none' };
    current.tables![0]!.physical.comment = 'remote';
    project.syncSequence = 1;
    const input = request((doc) => {
      doc.columns![0]!.physical.comment = 'local';
    });
    const originals = structuredClone({ project, baseline, input });
    const result = prepareNativeSyncCandidate(input, project, baseline, actorId, new Map(), now);
    expect(result.status).toBe('prepared');
    if (result.status !== 'prepared') throw new Error('Expected a prepared candidate');
    expect(result.document.columns![0]!.physical.type).toEqual(current.columns![0]!.physical.type);
    expect(result.document.tables![0]!.physical.comment).toBe('remote');
    expect(result.document.columns![0]!.physical.comment).toBe('local');
    expect(result.changes.map((item) => item.path)).toEqual(['/columns/a/physical/comment']);
    expect({ project, baseline, input }).toEqual(originals);
  });
  it('verifies raw claims before a parser can trim IDs, and authenticates the baseline document', () => {
    const { project, baseline, request } = fixture();
    const input = request((doc) => {
      doc.columns![0]!.physical.comment = 'local';
    });
    expect(
      badRequestCode(() =>
        prepareNativeSyncCandidate(
          { ...input, changes: [{ ...input.changes[0]!, before: 'forged' }] },
          project,
          baseline,
          actorId,
          new Map(),
          now,
        ),
      ),
    ).toBe('sync.claims-invalid');
    const trimmed = structuredClone(input);
    trimmed.document.columns![0]!.tableId = ' t ';
    trimmed.changes = deriveOperationChanges(trimmed.baselineDocument, trimmed.document);
    expect(
      badRequestCode(() =>
        prepareNativeSyncCandidate(trimmed, project, baseline, actorId, new Map(), now),
      ),
    ).toBe('sync.raw-input-changed');
    const forged = structuredClone(input);
    forged.baselineDocument.columns![0]!.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'fake', isArray: false },
    };
    forged.document.columns![0]!.physical.type = structuredClone(
      forged.baselineDocument.columns![0]!.physical.type,
    );
    forged.changes = deriveOperationChanges(forged.baselineDocument, forged.document);
    expect(
      code(prepareNativeSyncCandidate(forged, project, baseline, actorId, new Map(), now)),
    ).toBe('sync.baseline-invalid');
  });
  it.each([
    'revision',
    'baseline-revision',
    'project',
    'actor',
    'client',
    'baseline-id',
    'sequence',
    'issued-at',
    'expired',
  ] as const)('rejects a mismatched/expired trusted context: %s', (scenario) => {
    const { project, baseline, request } = fixture();
    const input = request((doc) => {
      doc.columns![0]!.physical.comment = 'local';
    });
    if (scenario === 'revision') input.databaseRevision++;
    if (scenario === 'baseline-revision') baseline.databaseRevision++;
    if (scenario === 'project') baseline.projectId = randomUUID();
    if (scenario === 'actor') baseline.userId = randomUUID();
    if (scenario === 'client') baseline.clientId = randomUUID();
    if (scenario === 'baseline-id') baseline.baselineId = randomUUID();
    if (scenario === 'sequence') baseline.lastSequence++;
    if (scenario === 'issued-at') baseline.lastSuccessfulSyncAt = new Date(now - 1);
    const result = prepareNativeSyncCandidate(
      input,
      project,
      baseline,
      actorId,
      new Map(),
      scenario === 'expired' ? now + 24 * 60 * 60 * 1000 + 1 : now,
    );
    expect(code(result)).toBe(
      ['revision', 'baseline-revision'].includes(scenario)
        ? 'database.context-changed'
        : 'sync.baseline-invalid',
    );
  });
  it('does not mix native candidates with v1 storage or a different project DB', () => {
    const { project, baseline, request } = fixture();
    const input = request((doc) => {
      doc.columns![0]!.physical.comment = 'local';
    });
    project.document = createEmptyDocument();
    expect(
      code(prepareNativeSyncCandidate(input, project, baseline, actorId, new Map(), now)),
    ).toBe('document.native-upgrade-required');
    project.database = { ...defaultDatabaseContext('mysql'), revision: 3 };
    expect(
      code(prepareNativeSyncCandidate(input, project, baseline, actorId, new Map(), now)),
    ).toBe('database.context-changed');
  });
  it('derives referenced index columns on the server even when the client read-set is empty', () => {
    const { project, baseline, request } = fixture();
    const input = request((doc) => {
      doc.indexes = [
        {
          id: 'index',
          tableId: 't',
          name: 'index',
          scope: 'physical',
          unique: false,
          parts: [{ expression: { kind: 'column', columnId: 'a' }, direction: 'asc' }],
          options: { database: 'postgresql', method: 'btree', includeColumnIds: ['b'] },
        },
      ];
    });
    (project.document as NativeDesignDocument).columns!.pop();
    project.syncSequence = 1;
    const result = prepareNativeSyncCandidate(
      input,
      project,
      baseline,
      actorId,
      new Map([['/columns/b', 1]]),
      now,
    );
    expect(result).toMatchObject({
      status: 'rejected',
      code: 'sync.field-conflict',
      conflictingPaths: expect.arrayContaining(['/columns/b/@exists']),
    });
  });
  it('honors reconnect and explicit read conflicts while online unrelated writes keep their existing semantics', () => {
    const { project, baseline, request } = fixture();
    project.syncSequence = 1;
    const input = request((doc) => {
      doc.columns![0]!.physical.comment = 'local';
    });
    const versions = { '/columns/a/physical/comment': 1 };
    expect(code(prepareNativeSyncCandidate(input, project, baseline, actorId, versions, now))).toBe(
      'prepared',
    );
    input.kind = 'reconnect';
    expect(code(prepareNativeSyncCandidate(input, project, baseline, actorId, versions, now))).toBe(
      'sync.field-conflict',
    );
    input.kind = 'online';
    input.dependencyPaths = ['/columns/a'];
    expect(code(prepareNativeSyncCandidate(input, project, baseline, actorId, versions, now))).toBe(
      'sync.field-conflict',
    );
  });
  it('rejects new native functionality and copied logical legacy using current storage as previous', () => {
    const { project, baseline, request } = fixture();
    const native = request((doc) => {
      doc.columns![0]!.physical.type = {
        kind: 'builtin',
        database: 'postgresql',
        typeId: 'postgresql:txid_snapshot',
        parameters: {},
      };
      doc.columns![0]!.physical.defaultValue = { kind: 'none' };
    });
    expect(
      prepareNativeSyncCandidate(native, project, baseline, actorId, new Map(), now),
    ).toMatchObject({
      status: 'rejected',
      code: 'database.candidate-invalid',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'type.not-implemented' })]),
    });
    const copied = request((doc) => {
      doc.columns!.push({ ...structuredClone(doc.columns![0]!), id: 'copied', scope: 'logical' });
    });
    expect(
      prepareNativeSyncCandidate(copied, project, baseline, actorId, new Map(), now),
    ).toMatchObject({
      status: 'rejected',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'legacy.source-not-trusted', objectId: 'copied' }),
      ]),
    });
  });
  it('does not reuse retired native index/check identities', () => {
    const { project, baseline, request } = fixture();
    const input = request((doc) => {
      doc.checks = [
        {
          id: 'retired',
          tableId: 't',
          name: '',
          scope: 'logical',
          expression: { kind: 'literal', literalType: 'boolean', value: true },
        },
      ];
    });
    project.syncSequence = 1;
    expect(
      code(
        prepareNativeSyncCandidate(
          input,
          project,
          baseline,
          actorId,
          new Map([['/checks/retired', 1]]),
          now,
        ),
      ),
    ).toBe('sync.identity-retired');
  });
  it('rejects new dangling logical references through the same final-candidate policy', () => {
    const { project, baseline, request } = fixture();
    const input = request((doc) => {
      doc.checks = [
        {
          id: 'check',
          tableId: 'missing',
          name: '',
          scope: 'logical',
          expression: { kind: 'column', columnId: 'a' },
        },
      ];
    });
    expect(
      prepareNativeSyncCandidate(input, project, baseline, actorId, new Map(), now),
    ).toMatchObject({
      status: 'rejected',
      code: 'database.candidate-invalid',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'document.owner-table-not-found' }),
      ]),
    });
  });
  it('checks the final merged document budget, not only the smaller submitted document', () => {
    const { project, baseline, request } = fixture();
    (project.document as NativeDesignDocument).domains = Array.from(
      { length: 149 },
      (_, index) => ({ id: `remote-${index}`, name: '', description: 'x'.repeat(10000) }),
    );
    project.syncSequence = 1;
    const input = request((doc) => {
      doc.domains.push({ id: 'local', name: '', description: 'x'.repeat(10000) });
    });
    expect(
      code(prepareNativeSyncCandidate(input, project, baseline, actorId, new Map(), now)),
    ).toBe('sync.candidate-invalid');
  });
  it('runs DB validation against the merged candidate when a remote table occupies the new name', () => {
    const { project, baseline, request } = fixture();
    const current = project.document as NativeDesignDocument;
    current.tables!.push({
      ...structuredClone(current.tables![0]!),
      id: 'remote',
      physical: { ...structuredClone(current.tables![0]!.physical), name: 'occupied' },
    });
    project.syncSequence = 1;
    const input = request((doc) => {
      doc.tables![0]!.physical.name = 'occupied';
    });
    const result = prepareNativeSyncCandidate(input, project, baseline, actorId, new Map(), now);
    expect(result).toMatchObject({
      status: 'rejected',
      code: 'database.candidate-invalid',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'table.duplicate-name' })]),
    });
  });
  it('distinguishes corrupt stored native data from a valid v1 upgrade and protects archived/sequence limits', () => {
    const { project, baseline, request } = fixture();
    const input = request((doc) => {
      doc.columns![0]!.physical.comment = 'local';
    });
    project.status = 'archived';
    expect(
      code(prepareNativeSyncCandidate(input, project, baseline, actorId, new Map(), now)),
    ).toBe('project.archived');
    project.status = 'active';
    project.syncSequence = Number.MAX_SAFE_INTEGER;
    expect(
      code(prepareNativeSyncCandidate(input, project, baseline, actorId, new Map(), now)),
    ).toBe('sync.sequence-limit');
    project.syncSequence = 0;
    project.document = { schemaVersion: 2 };
    expect(
      code(prepareNativeSyncCandidate(input, project, baseline, actorId, new Map(), now)),
    ).toBe('sync.stored-document-invalid');
  });
});
