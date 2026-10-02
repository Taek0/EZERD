import { expect, it } from 'vitest';
import { TABLES_VIEW_ID, addTable, createEmptyDocument } from '@ezerd/model';
import {
  designDocumentSchema,
  projectTransferSchema,
  tableSchema,
  domainSchema,
  combinedViewSchema,
} from './index.js';

it('accepts unassigned tables and preserves colors in project file round trips', () => {
  const document = addTable(
    createEmptyDocument(),
    {
      id: 'users',
      domainId: null,
      color: '#465fff',
      scope: 'physical',
      logical: { name: 'Users', definition: '' },
      physical: { name: 'users', schema: 'public', comment: '' },
      customProperties: { common: {}, logical: {}, physical: {} },
    },
    { x: 10, y: 20 },
  );
  expect(designDocumentSchema.parse(document)).toEqual(document);
  const transfer = {
    format: 'ezerd-project',
    formatVersion: 1,
    exportedAt: '2026-10-01T00:00:00Z',
    project: { name: 'Direct' },
    document,
  };
  const parsed = projectTransferSchema.parse(JSON.parse(JSON.stringify(transfer)));
  expect(parsed.document.tables![0]!.color).toBe('#465fff');
  expect(parsed.document.tables![0]!.domainId).toBeNull();
  expect(parsed.document.layout.nodes[0]!.viewId).toBe(TABLES_VIEW_ID);
});

it('requires an explicit valid domain choice and validates table color', () => {
  const table = {
    id: 't',
    domainId: null,
    scope: 'physical',
    logical: { name: '', definition: '' },
    physical: { name: '', schema: 'public', comment: '' },
    customProperties: { common: {}, logical: {}, physical: {} },
  };
  expect(tableSchema.safeParse({ ...table, domainId: 'legacy-domain' }).success).toBe(true);
  expect(tableSchema.safeParse({ ...table, domainId: undefined }).success).toBe(false);
  for (const color of ['red', '#123', '#12345678', '', null])
    expect(tableSchema.safeParse({ ...table, color }).success).toBe(false);
  expect(tableSchema.safeParse({ ...table, color: '#A1B2C3' }).success).toBe(true);
  expect(tableSchema.safeParse({ ...table, id: TABLES_VIEW_ID }).success).toBe(false);
  expect(domainSchema.safeParse({ id: TABLES_VIEW_ID, name: '', description: '' }).success).toBe(
    false,
  );
  expect(
    combinedViewSchema.safeParse({ id: TABLES_VIEW_ID, name: '', domainIds: ['d'] }).success,
  ).toBe(false);
});
