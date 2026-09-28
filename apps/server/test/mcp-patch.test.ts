import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@ezerd/model';
import { applyPatchCommand, patchCommandSchema } from '../src/mcp/mcp-patch.js';

const properties = { common: {}, logical: {}, physical: {} };
function fixture() {
  const document = createEmptyDocument();
  document.domains = [
    { id: 'sales', name: 'Sales', description: 'Old', color: '#112233' },
    { id: 'users-domain', name: 'Users', description: '' },
  ];
  document.domainRelations = [
    {
      id: 'domain-link',
      sourceDomainId: 'sales',
      targetDomainId: 'users-domain',
      name: 'Old link',
      direction: 'forward',
      description: '',
    },
  ];
  document.tables = [
    {
      id: 'orders',
      domainId: 'sales',
      scope: 'both',
      logical: { name: 'Orders', definition: 'Keep definition' },
      physical: { name: 'orders', schema: 'public', comment: 'Keep comment' },
      customProperties: properties,
    },
  ];
  document.columns = [
    {
      id: 'order-id',
      tableId: 'orders',
      scope: 'both',
      logical: { name: 'ID', definition: 'Keep definition', semanticType: '', required: true },
      physical: {
        name: 'id',
        type: { name: 'uuid', isArray: false },
        nullable: false,
        defaultExpression: null,
        comment: 'Keep comment',
      },
      customProperties: properties,
    },
  ];
  document.keys = [
    {
      id: 'orders-pk',
      tableId: 'orders',
      scope: 'both',
      kind: 'primary',
      name: 'Old key',
      columnIds: ['order-id'],
    },
  ];
  document.tableRelations = [
    {
      id: 'orders-self',
      sourceTableId: 'orders',
      targetTableId: 'orders',
      scope: 'logical',
      logical: { name: 'Old relation', cardinality: 'one-to-many', required: false },
      physical: null,
    },
  ];
  document.enums = [{ id: 'status', name: 'status', schema: 'public', values: ['old'] }];
  document.notes = [{ id: 'note', viewId: 'sales', text: 'Old note', color: '#123456' }];
  return document;
}

describe('MCP partial patches', () => {
  it('changes selected nested fields and preserves other properties', () => {
    let document = fixture();
    const commands = [
      { type: 'patch_domain', id: 'sales', patch: { name: 'Sales new' } },
      { type: 'patch_table', id: 'orders', patch: { logical: { name: 'Orders new' } } },
      { type: 'patch_column', id: 'order-id', patch: { physical: { type: { name: 'text' } } } },
      { type: 'patch_domain_relation', id: 'domain-link', patch: { name: 'New link' } },
      { type: 'patch_key', id: 'orders-pk', patch: { name: 'New key' } },
      {
        type: 'patch_table_relation',
        id: 'orders-self',
        patch: { logical: { name: 'New relation' } },
      },
      { type: 'patch_enum', id: 'status', patch: { values: ['new'] } },
      { type: 'patch_note', id: 'note', patch: { text: 'New note' } },
    ] as const;
    for (const command of commands)
      document = applyPatchCommand(document, patchCommandSchema.parse(command));
    expect(document.domains[0]).toMatchObject({
      name: 'Sales new',
      description: 'Old',
      color: '#112233',
    });
    expect(document.tables?.[0]).toMatchObject({
      logical: { name: 'Orders new', definition: 'Keep definition' },
      physical: { comment: 'Keep comment' },
    });
    expect(document.columns?.[0]).toMatchObject({
      logical: { name: 'ID', definition: 'Keep definition' },
      physical: { type: { name: 'text', isArray: false }, comment: 'Keep comment' },
    });
    expect(document.domainRelations[0]?.name).toBe('New link');
    expect(document.keys?.[0]?.name).toBe('New key');
    expect(document.tableRelations?.[0]?.logical).toMatchObject({
      name: 'New relation',
      cardinality: 'one-to-many',
    });
    expect(document.enums?.[0]).toEqual({
      id: 'status',
      name: 'status',
      schema: 'public',
      values: ['new'],
    });
    expect(document.notes[0]).toMatchObject({
      text: 'New note',
      color: '#123456',
    });
  });

  it('allows clearing optional colors and rejects missing targets or empty patches', () => {
    const domain = applyPatchCommand(
      fixture(),
      patchCommandSchema.parse({ type: 'patch_domain', id: 'sales', patch: { color: null } }),
    );
    expect(domain.domains[0]?.color).toBeUndefined();
    const note = applyPatchCommand(
      domain,
      patchCommandSchema.parse({ type: 'patch_note', id: 'note', patch: { color: null } }),
    );
    expect(note.notes[0]?.color).toBeUndefined();
    expect(() =>
      applyPatchCommand(
        fixture(),
        patchCommandSchema.parse({
          type: 'patch_table',
          id: 'missing',
          patch: { scope: 'logical' },
        }),
      ),
    ).toThrow('수정할 객체를 찾을 수 없습니다.');
    expect(
      patchCommandSchema.safeParse({ type: 'patch_table', id: 'orders', patch: {} }).success,
    ).toBe(false);
  });
});
