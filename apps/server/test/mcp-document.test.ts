import { describe, expect, it, vi } from 'vitest';
import { McpDocumentService } from '../src/mcp/mcp-document.service.js';
import { ForbiddenException } from '@nestjs/common';

const actor = { id: crypto.randomUUID(), username: 'actor', color: '#4169e1' };
const empty = {
  schemaVersion: 1 as const,
  domains: [],
  domainRelations: [],
  notes: [],
  layout: { nodes: [], viewports: [{ viewId: 'overview', x: 0, y: 0, zoom: 1 }] },
};
const request = {
  projectId: crypto.randomUUID(),
  expectedVersion: 4,
  expectedSequence: 3,
  operationId: crypto.randomUUID(),
  groupId: crypto.randomUUID(),
  clientId: crypto.randomUUID(),
  commands: [
    {
      type: 'upsert_domain' as const,
      value: { id: 'sales', name: 'Sales', description: 'Sales domain' },
      placement: {
        x: 10,
        y: 20,
        width: 240,
        height: 140,
      },
    },
  ],
};

describe('MCP document changes', () => {
  it('does not build or apply a document when the secured replay lookup denies current access', async () => {
    const sync = {
      findReplay: vi.fn(async () => {
        throw new ForbiddenException('공간 접근 권한이 없습니다.');
      }),
      establishBaseline: vi.fn(),
      apply: vi.fn(),
    };
    const service = new McpDocumentService(sync as never);
    await expect(service.apply(request, actor)).rejects.toMatchObject({ status: 403 });
    expect(sync.findReplay).toHaveBeenCalledWith(
      request.projectId,
      request.operationId,
      expect.any(String),
      actor,
    );
    expect(sync.establishBaseline).not.toHaveBeenCalled();
    expect(sync.apply).not.toHaveBeenCalled();
  });
  it('uses caller-observed version and sequence with a stable command fingerprint', async () => {
    const accepted = {
      operationId: request.operationId,
      groupId: request.groupId,
      sequence: 4,
      status: 'accepted' as const,
      actor,
      changedPaths: ['/domains/sales'],
      createdAt: new Date().toISOString(),
      nextBaseline: {
        baselineId: crypto.randomUUID(),
        baseSequence: 4,
        baselineIssuedAt: new Date().toISOString(),
      },
    };
    const sync = {
      findReplay: vi.fn(async () => undefined),
      establishBaseline: vi.fn(async () => ({
        baselineId: crypto.randomUUID(),
        sequence: 3,
        baselineIssuedAt: new Date().toISOString(),
        document: empty,
      })),
      apply: vi.fn(async () => accepted),
    };
    const service = new McpDocumentService(sync as never);
    await expect(service.apply(request, actor)).resolves.toEqual(accepted);
    expect(sync.establishBaseline).toHaveBeenCalledWith(
      request.projectId,
      request.clientId,
      actor,
      { version: 4, sequence: 3 },
    );
    const [projectId, operation, user, options] = sync.apply.mock.calls[0]!;
    expect(projectId).toBe(request.projectId);
    expect(user).toBe(actor);
    expect(operation.kind).toBe('reconnect');
    expect(operation.document.domains).toContainEqual(request.commands[0]!.value);
    expect(operation.document.layout.nodes).toContainEqual(
      expect.objectContaining({
        objectId: 'sales',
        viewId: 'overview',
        ...request.commands[0]!.placement,
      }),
    );
    expect(options.requestHash).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(sync.findReplay).toHaveBeenCalledWith(
      request.projectId,
      request.operationId,
      options.requestHash,
      actor,
    );
  });

  it('returns an actor-bound replay before issuing a new baseline', async () => {
    const replay = { status: 'accepted' as const, operationId: request.operationId };
    const sync = {
      findReplay: vi.fn(async () => replay),
      establishBaseline: vi.fn(),
      apply: vi.fn(),
    };
    const service = new McpDocumentService(sync as never);
    await expect(service.apply(request, actor)).resolves.toBe(replay);
    expect(sync.establishBaseline).not.toHaveBeenCalled();
    expect(sync.apply).not.toHaveBeenCalled();
  });

  it('uses model cascades for table deletion and defaults new placements', async () => {
    const properties = { common: {}, logical: {}, physical: {} };
    const table = {
      id: 'orders',
      domainId: 'sales',
      scope: 'both' as const,
      logical: { name: 'Orders', definition: '' },
      physical: { name: 'orders', schema: 'public', comment: '' },
      customProperties: properties,
    };
    const column = {
      id: 'order-id',
      tableId: table.id,
      scope: 'both' as const,
      logical: { name: 'ID', definition: '', semanticType: '', required: true },
      physical: {
        name: 'id',
        type: { name: 'uuid', isArray: false },
        nullable: false,
        defaultExpression: null,
        comment: '',
      },
      customProperties: properties,
    };
    const document = {
      ...empty,
      domains: [{ id: 'sales', name: 'Sales', description: '' }],
      tables: [table],
      columns: [column],
      keys: [
        {
          id: 'orders-pk',
          tableId: table.id,
          scope: 'both' as const,
          kind: 'primary' as const,
          name: 'orders_pk',
          columnIds: [column.id],
        },
      ],
      layout: {
        ...empty.layout,
        nodes: [
          {
            id: 'node:sales',
            objectId: 'sales',
            viewId: 'overview',
            x: 0,
            y: 0,
            width: 240,
            height: 140,
          },
          {
            id: 'node:orders',
            objectId: 'orders',
            viewId: 'sales',
            x: 0,
            y: 0,
            width: 240,
            height: 180,
          },
        ],
        viewports: [...empty.layout.viewports, { viewId: 'sales', x: 0, y: 0, zoom: 1 }],
      },
    };
    const sync = {
      findReplay: vi.fn(async () => undefined),
      establishBaseline: vi.fn(async () => ({
        baselineId: crypto.randomUUID(),
        sequence: 3,
        baselineIssuedAt: new Date().toISOString(),
        document,
      })),
      apply: vi.fn(async (_projectId, operation) => ({
        operationId: operation.operationId,
        groupId: operation.groupId,
        sequence: 4,
        status: 'accepted' as const,
        actor,
        changedPaths: operation.changes.map((change) => change.path),
        createdAt: new Date().toISOString(),
        nextBaseline: {
          baselineId: crypto.randomUUID(),
          baseSequence: 4,
          baselineIssuedAt: new Date().toISOString(),
        },
      })),
    };
    const service = new McpDocumentService(sync as never);
    await service.apply({ ...request, commands: [{ type: 'delete_table', id: table.id }] }, actor);
    const deleted = sync.apply.mock.calls[0]![1].document;
    expect(deleted.tables).toEqual([]);
    expect(deleted.columns).toEqual([]);
    expect(deleted.keys).toEqual([]);
    expect(deleted.layout.nodes.some((node) => node.objectId === table.id)).toBe(false);

    sync.apply.mockClear();
    sync.establishBaseline.mockResolvedValueOnce({
      baselineId: crypto.randomUUID(),
      sequence: 3,
      baselineIssuedAt: new Date().toISOString(),
      document: empty,
    });
    await service.apply(
      {
        ...request,
        operationId: crypto.randomUUID(),
        commands: [
          { type: 'upsert_domain', value: { id: 'default', name: 'Default', description: '' } },
        ],
      },
      actor,
    );
    expect(sync.apply.mock.calls[0]![1].document.layout.nodes).toContainEqual(
      expect.objectContaining({ objectId: 'default', viewId: 'overview', x: 0, y: 0 }),
    );
  });

  it('creates and removes ENUMs through model commands', async () => {
    const enumValue = {
      id: 'order-status',
      name: 'order_status',
      schema: 'public',
      values: ['new'],
    };
    let baseline = empty;
    const sync = {
      findReplay: vi.fn(async () => undefined),
      establishBaseline: vi.fn(async () => ({
        baselineId: crypto.randomUUID(),
        sequence: 3,
        baselineIssuedAt: new Date().toISOString(),
        document: baseline,
      })),
      apply: vi.fn(async (_projectId, operation) => ({
        status: 'accepted' as const,
        operationId: operation.operationId,
      })),
    };
    const service = new McpDocumentService(sync as never);
    await service.apply(
      {
        ...request,
        commands: [{ type: 'upsert_enum', value: enumValue }],
      },
      actor,
    );
    const created = sync.apply.mock.calls[0]![1].document;
    expect(created.enums).toEqual([enumValue]);

    baseline = created;
    await service.apply(
      {
        ...request,
        operationId: crypto.randomUUID(),
        commands: [{ type: 'delete_enum', id: enumValue.id }],
      },
      actor,
    );
    const deleted = sync.apply.mock.calls[1]![1].document;
    expect(deleted.enums).toEqual([]);
  });

  it('edits shared node geometry and relation routes', async () => {
    const properties = { common: {}, logical: {}, physical: {} };
    const table = (id: string) => ({
      id,
      domainId: 'sales',
      scope: 'both' as const,
      logical: { name: id, definition: '' },
      physical: { name: id, schema: 'public', comment: '' },
      customProperties: properties,
    });
    let baseline = {
      ...empty,
      domains: [{ id: 'sales', name: 'Sales', description: '' }],
      tables: [table('orders'), table('users')],
      tableRelations: [
        {
          id: 'orders-users',
          sourceTableId: 'orders',
          targetTableId: 'users',
          scope: 'logical' as const,
          logical: { name: 'owner', cardinality: 'many-to-many' as const, required: false },
          physical: null,
        },
      ],
      layout: {
        ...empty.layout,
        nodes: [
          {
            id: 'node:sales',
            objectId: 'sales',
            viewId: 'overview',
            x: 0,
            y: 0,
            width: 240,
            height: 140,
          },
          {
            id: 'node:orders',
            objectId: 'orders',
            viewId: 'sales',
            x: 0,
            y: 0,
            width: 240,
            height: 180,
          },
          {
            id: 'node:users',
            objectId: 'users',
            viewId: 'sales',
            x: 300,
            y: 0,
            width: 240,
            height: 180,
          },
        ],
        viewports: [...empty.layout.viewports, { viewId: 'sales', x: 0, y: 0, zoom: 1 }],
      },
    };
    const sync = {
      findReplay: vi.fn(async () => undefined),
      establishBaseline: vi.fn(async () => ({
        baselineId: crypto.randomUUID(),
        sequence: 3,
        baselineIssuedAt: new Date().toISOString(),
        document: baseline,
      })),
      apply: vi.fn(async (_projectId, operation) => ({
        status: 'accepted' as const,
        operationId: operation.operationId,
      })),
    };
    const service = new McpDocumentService(sync as never);
    await service.apply(
      {
        ...request,
        commands: [
          { type: 'update_node_layout', nodeId: 'node:orders', patch: { x: 30, width: 260 } },
          {
            type: 'upsert_relation_layout',
            value: { relationId: 'orders-users', viewId: 'sales', offset: 12 },
          },
        ],
      },
      actor,
    );
    const edited = sync.apply.mock.calls[0]![1].document;
    expect(edited.layout.nodes).toContainEqual(
      expect.objectContaining({
        id: 'node:orders',
        x: 30,
        y: 0,
        width: 260,
        height: 180,
      }),
    );
    expect(edited.layout.relations).toContainEqual({
      relationId: 'orders-users',
      viewId: 'sales',
      offset: 12,
    });

    baseline = edited;
    await service.apply(
      {
        ...request,
        operationId: crypto.randomUUID(),
        commands: [{ type: 'delete_relation_layout', relationId: 'orders-users', viewId: 'sales' }],
      },
      actor,
    );
    const removed = sync.apply.mock.calls[1]![1].document;
    expect(removed.layout.relations).toEqual([]);
    expect(removed.tables).toHaveLength(2);
  });
});
