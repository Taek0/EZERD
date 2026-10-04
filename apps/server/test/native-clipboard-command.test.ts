import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyNativeDocument,
  defaultDatabaseContext,
  deriveOperationChanges,
} from '@ezerd/model';
import {
  clipboardCommand,
  clipboardFixture,
} from '../../web/src/features/projects/native-clipboard-test-fixtures.js';
import {
  nativeEditorCandidate,
  McpNativeDocumentService,
  applyNativeProjectChangesMetadataSchema,
} from '../src/mcp/mcp-native-document.service.js';
import type { NativeSyncService } from '../src/sync/native-sync.service.js';
import type { AuthenticatedUser } from '../src/identity/session.js';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { nativeSyncOperationInputSchema } from '@ezerd/contracts';
describe('native clipboard ordinary renderer and MCP handler', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'applies a %s logical fragment as a complete ordinary candidate',
    (kind) => {
      const source = clipboardFixture(kind),
        baseline = createEmptyNativeDocument(source.database),
        before = structuredClone(baseline),
        command = clipboardCommand(source);
      const candidate = nativeEditorCandidate(baseline, [command]);
      expect(candidate.tables).toHaveLength(2);
      expect(candidate.columns).toHaveLength(2);
      expect(candidate.keys).toHaveLength(1);
      expect(candidate.tableRelations).toHaveLength(1);
      expect(candidate.indexes).toHaveLength(1);
      expect(candidate.checks).toHaveLength(1);
      expect(candidate.layout.nodes.map((node) => node.id)).toEqual(command.newIds.slice(-2));
      expect(deriveOperationChanges(baseline, candidate).length).toBeGreaterThan(0);
      expect(baseline).toEqual(before);
    },
  );
  it('rejects foreign DB, logical legacy, identity reuse and invalid physical index combinations', () => {
    const command = clipboardCommand(),
      baseline = createEmptyNativeDocument(command.clipboard.sourceDatabase);
    expect(() =>
      nativeEditorCandidate(createEmptyNativeDocument(defaultDatabaseContext('mysql')), [command]),
    ).toThrow('clipboard.database-mismatch');
    const legacy = structuredClone(command);
    legacy.clipboard.document.columns![0]!.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'opaque', isArray: false },
    };
    expect(() => nativeEditorCandidate(baseline, [legacy])).toThrow(
      'clipboard.legacy-copy-not-supported',
    );
    const pasted = nativeEditorCandidate(baseline, [command]);
    expect(() =>
      nativeEditorCandidate(pasted, [
        {
          type: 'delete_objects',
          targets: pasted.tables!.map((table) => ({ collection: 'tables' as const, id: table.id })),
        },
        command,
      ]),
    ).toThrow('document.duplicate-identities');
    expect(() => nativeEditorCandidate(baseline, [command, command])).toThrow();
    const physical = clipboardFixture();
    physical.tables!.forEach((item) => {
      item.scope = 'both';
    });
    physical.columns!.forEach((item) => {
      item.scope = 'both';
      item.physical.defaultValue = { kind: 'none' };
    });
    physical.indexes = [
      {
        id: 'physical-index',
        tableId: physical.tables![0]!.id,
        scope: 'both',
        name: 'idx',
        unique: false,
        parts: [
          { expression: { kind: 'column', columnId: physical.columns![0]!.id }, direction: 'asc' },
        ],
        options: { database: 'postgresql', method: 'btree' },
      },
    ];
    const validCommand = clipboardCommand(physical);
    const valid = nativeEditorCandidate(baseline, [validCommand]);
    expect(valid.indexes).toMatchObject([{ unique: false, options: { method: 'btree' } }]);
    const invalidCommand = structuredClone(validCommand);
    invalidCommand.clipboard.document.indexes![0]!.unique = true;
    invalidCommand.clipboard.document.indexes![0]!.options = {
      database: 'postgresql',
      method: 'hash',
    };
    expect(() => nativeEditorCandidate(baseline, [invalidCommand])).toThrow(
      'index.unique-method-not-supported',
    );
    expect(baseline.tables).toBeUndefined();
  });
  it('keeps an unverified native type blocked by ordinary write policy', () => {
    const source = clipboardFixture();
    source.tables!.forEach((table) => {
      table.scope = 'both';
    });
    source.columns!.forEach((column) => {
      column.scope = 'both';
      column.physical.defaultValue = { kind: 'none' };
    });
    source.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:txid_snapshot',
      parameters: {},
    };
    const command = clipboardCommand(source),
      baseline = createEmptyNativeDocument(source.database),
      before = structuredClone(baseline);
    try {
      nativeEditorCandidate(baseline, [command]);
      throw Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'clipboard.policy-blocked',
        issues: expect.arrayContaining([expect.objectContaining({ code: 'type.not-implemented' })]),
      });
    }
    expect(baseline).toEqual(before);
  });
  it('routes paste metadata and actual strict handler preparation through locked sync', async () => {
    const command = clipboardCommand(),
      document = createEmptyNativeDocument(command.clipboard.sourceDatabase);
    const id = randomUUID(),
      operationId = randomUUID(),
      clientId = randomUUID();
    const input = {
      projectId: id,
      operationId,
      groupId: operationId,
      clientId,
      expectedVersion: 7,
      expectedSequence: 10,
      expectedDatabaseRevision: 3,
      commands: [command],
      includeDocument: true,
    };
    expect(applyNativeProjectChangesMetadataSchema.safeParse(input).success).toBe(true);
    const baseline = {
        document,
        database: document.database,
        databaseRevision: 3,
        baselineId: randomUUID(),
        sequence: 10,
        baselineIssuedAt: '2026-10-02T00:00:00Z',
      },
      issue = vi.fn().mockResolvedValue(baseline);
    type Preparation = NonNullable<Parameters<NativeSyncService['apply']>[4]>;
    let prepared: ReturnType<typeof nativeSyncOperationInputSchema.parse> | undefined;
    const sync = {
      apply: vi.fn(
        async (
          _project: string,
          _raw: unknown,
          _user: AuthenticatedUser,
          _hash: string,
          prepare: Preparation,
        ) => {
          prepared = nativeSyncOperationInputSchema.parse(await prepare(issue));
          return { status: 'accepted', document: prepared.document };
        },
      ),
    };
    const service = new McpNativeDocumentService(sync as unknown as NativeSyncService);
    await service.apply(input, { id } as AuthenticatedUser);
    expect(issue).toHaveBeenCalledWith(clientId, { version: 7, sequence: 10, databaseRevision: 3 });
    expect(prepared?.document.tables).toHaveLength(2);
    expect(prepared?.baselineDocument).toEqual(document);
  });
  it('keeps old clipboard replay before validation and baseline issuance', async () => {
    const sync = { apply: vi.fn().mockResolvedValue({ status: 'accepted' }) };
    const service = new McpNativeDocumentService(sync as unknown as NativeSyncService);
    expect(
      await service.apply(
        {
          projectId: randomUUID(),
          operationId: randomUUID(),
          commands: [{ type: 'paste_native_clipboard', retiredShape: true }],
        },
        { id: randomUUID() } as AuthenticatedUser,
      ),
    ).toEqual({ status: 'accepted' });
  });
});
