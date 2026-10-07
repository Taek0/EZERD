import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { createNativeTable, sharedDocument, validateDatabaseDocument } from '@ezerd/model';
import { nativeEditorCommandSchema } from '@ezerd/contracts';
import { decorationFixture } from '../../web/src/features/projects/native-canvas-decoration-test-fixtures.js';
import { McpServerFactory } from '../src/mcp/mcp-server.js';
import { McpNativeDocumentService } from '../src/mcp/mcp-native-document.service.js';
import { prepareNativeSyncCandidate } from '../src/shared/native-sync-candidate.js';
import type { NativeSyncService } from '../src/sync/native-sync.service.js';

async function harness() {
  const user = { id: randomUUID(), username: 'owner', color: '#4169e1' };
  const source = decorationFixture('sqlite');
  source.enums = [{ id: 'enum', name: 'State', schema: 'public', values: ['active'] }];
  source.columns![0]!.physical.type = {
    kind: 'legacy',
    source: 'document-v1',
    original: { name: 'enum', enumId: 'enum', isArray: false },
  };
  const projectId = randomUUID();
  const database = { ...source.database, revision: 2 };
  const now = new Date();
  const issueBaseline = vi.fn();
  const sync = {
    apply: vi.fn(async (...args: Parameters<NativeSyncService['apply']>) => {
      const prepared = await args[4]!(issueBaseline);
      const result = prepareNativeSyncCandidate(
        prepared,
        { id: projectId, status: 'active', syncSequence: 51, database, document: source },
        {
          projectId,
          userId: user.id,
          clientId: prepared.clientId,
          baselineId: prepared.baselineId,
          lastSequence: 51,
          databaseRevision: 2,
          lastSuccessfulSyncAt: now,
          document: sharedDocument(source),
        },
        user.id,
        new Map(),
        now.getTime(),
      );
      return {
        protocolVersion: 2,
        database: source.database,
        databaseRevision: 2,
        operationId: prepared.operationId,
        groupId: prepared.groupId,
        sequence: 52,
        status: result.status === 'prepared' ? 'accepted' : 'rejected',
        ...(result.status === 'prepared'
          ? { document: result.document }
          : { reasonCode: result.code, issues: result.issues }),
        actor: user,
        changedPaths: result.status === 'prepared' ? result.changes.map((row) => row.path) : [],
        createdAt: now.toISOString(),
        nextBaseline: {
          baselineId: randomUUID(),
          baseSequence: 52,
          baselineIssuedAt: now.toISOString(),
          databaseRevision: 2,
        },
      };
    }),
  };
  const factory = new McpServerFactory(
    {} as never,
    {} as never,
    { write: vi.fn() } as never,
    {} as never,
    new McpNativeDocumentService(sync as unknown as NativeSyncService),
    {} as never,
    { assertActiveToken: vi.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const server = factory.create(user, randomUUID(), randomUUID());
  const client = new Client({ name: 'native-command-validation', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const input = (commands: unknown[]) => {
    const clientId = randomUUID();
    issueBaseline.mockResolvedValue({
      document: sharedDocument(source),
      database: source.database,
      databaseRevision: 2,
      sequence: 51,
      baselineId: randomUUID(),
      baselineIssuedAt: now.toISOString(),
    });
    return {
      projectId,
      clientId,
      groupId: randomUUID(),
      operationId: randomUUID(),
      expectedVersion: 54,
      expectedSequence: 51,
      expectedDatabaseRevision: 2,
      includeDocument: true,
      commands,
    };
  };
  return {
    client,
    source,
    sync,
    issueBaseline,
    input,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe('native MCP command discovery and diagnostics', () => {
  it('publishes every command shape with table values, SQLite namespace and separate placement', async () => {
    const session = await harness();
    try {
      const tool = (await session.client.listTools()).tools.find(
        (row) => row.name === 'apply_native_project_changes',
      )!;
      const commands = tool.inputSchema.properties!.commands as {
        items: { oneOf: Array<{ properties: Record<string, any>; required: string[] }> };
      };
      expect(commands.items.oneOf).toHaveLength(nativeEditorCommandSchema.options.length);
      const table = commands.items.oneOf.find((row) => row.properties.type.const === 'add_table')!;
      expect(table.required).toEqual(['type', 'value']);
      expect(table.properties).not.toHaveProperty('placement');
      expect(table.properties.value.required).toEqual(
        expect.arrayContaining([
          'id',
          'domainId',
          'scope',
          'logical',
          'physical',
          'customProperties',
        ]),
      );
      expect(JSON.stringify(table.properties.value.properties.physical)).toContain('sqliteMain');
      expect(JSON.stringify(table.properties.value.properties.physical)).not.toContain('"none"');
      const reference = commands.items.oneOf.find(
        (row) => row.properties.type.const === 'add_table_reference',
      )!;
      expect(reference.required).toEqual(['type', 'tableId', 'viewId', 'placement']);
      expect(reference.properties.placement.properties).toHaveProperty('width');
      expect(tool.description).toContain('sqliteMain');
    } finally {
      await session.close();
    }
  });

  it('reports the supplied request namespace and placement errors before issuing a baseline', async () => {
    const session = await harness();
    try {
      const table = createNativeTable(session.source.database, randomUUID());
      table.physical.namespace = { kind: 'none' } as never;
      const result = await session.client.callTool({
        name: 'apply_native_project_changes',
        arguments: session.input([
          {
            type: 'add_table',
            value: table,
            placement: { viewId: '__tables__', x: 1500, y: 180, width: 400, height: 260 },
          },
        ]),
      });
      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
      expect(error).toMatchObject({ status: 400, code: 'native.command-invalid' });
      expect(error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['commands', 0, 'value', 'physical', 'namespace'] }),
          expect.objectContaining({ path: ['commands', 0], keys: ['placement'] }),
        ]),
      );
      expect(error.requestId).toEqual(expect.any(String));
      expect(error).not.toHaveProperty('stack');
      expect(session.issueBaseline).not.toHaveBeenCalled();
      expect(session.source.tables).toHaveLength(1);
    } finally {
      await session.close();
    }
  });

  it('accepts five unrelated SQLite tables and placements while preserving all four existing legacy diagnostics', async () => {
    const session = await harness();
    try {
      const before = structuredClone(session.source);
      const codes = validateDatabaseDocument(before, before.database, { mode: 'read' }).map(
        (issue) => issue.code,
      );
      expect(codes).toEqual(
        expect.arrayContaining([
          'legacy.namespace-unresolved',
          'legacy.type-unresolved',
          'legacy.default-unresolved',
          'legacy.enum-context-mismatch',
        ]),
      );
      const tables = ['categories', 'products', 'customers', 'orders', 'order_items'].map(
        (name) => {
          const table = createNativeTable(before.database, randomUUID());
          table.physical.name = name;
          return table;
        },
      );
      const result = await session.client.callTool({
        name: 'apply_native_project_changes',
        arguments: session.input(
          tables.flatMap((table, index) => [
            { type: 'add_table', value: table },
            {
              type: 'add_table_reference',
              tableId: table.id,
              viewId: '__tables__',
              placement: { x: 1500 + index * 440, y: 180, width: 400, height: 260 },
            },
          ]),
        ),
      });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(result.structuredContent!.status, JSON.stringify(result.structuredContent)).toBe(
        'accepted',
      );
      expect(result.structuredContent).toMatchObject({
        status: 'accepted',
        document: { tables: [before.tables![0], ...tables], columns: before.columns },
      });
      expect(session.source).toEqual(before);
      expect((result.structuredContent!.document as typeof before).layout.nodes).toHaveLength(
        before.layout.nodes.length + 5,
      );
    } finally {
      await session.close();
    }
  });

  it('keeps policy reason codes and hides unexpected internal failures', async () => {
    const session = await harness();
    try {
      const args = session.input([{ type: 'delete_note', id: 'n' }]);
      session.sync.apply.mockRejectedValueOnce(
        new BadRequestException({
          code: 'deletion.blocked',
          blockers: [{ code: 'reference.in-use', objectId: 'n' }],
        }),
      );
      const denied = await session.client.callTool({
        name: 'apply_native_project_changes',
        arguments: args,
      });
      expect(JSON.parse((denied.content as Array<{ text: string }>)[0]!.text)).toMatchObject({
        status: 400,
        code: 'deletion.blocked',
        blockers: [{ objectId: 'n' }],
      });
      session.sync.apply.mockRejectedValueOnce(new Error('INTERNAL_SECRET'));
      const failed = await session.client.callTool({
        name: 'apply_native_project_changes',
        arguments: args,
      });
      expect(failed.isError).toBe(true);
      expect(JSON.stringify(failed)).not.toContain('INTERNAL_SECRET');
    } finally {
      await session.close();
    }
  });
});
