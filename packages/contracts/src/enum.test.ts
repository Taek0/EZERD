import { describe, it, expect } from 'vitest';
import { designDocumentSchema } from './workspace.js';
const empty = { schemaVersion: 1, domains: [], domainRelations: [], notes: [], layout: { nodes: [], viewports: [] } };
const item = { id: 'e', name: 'status', schema: 'public', values: ['open', 'closed'] };
describe('ENUM document contract', () => {
  it('preserves legacy documents and new ENUM definitions', () => {
    expect(designDocumentSchema.parse(empty)).toEqual(empty);
    expect(designDocumentSchema.parse({ ...empty, enums: [item] }).enums).toEqual([item]);
  });
  it('rejects cross-object duplicate ids and malformed enum values', () => {
    expect(designDocumentSchema.safeParse({ ...empty, enums: [item], domains: [{ id: 'e', name: 'd', description: '' }] }).success).toBe(false);
    expect(designDocumentSchema.safeParse({ ...empty, enums: [{ ...item, values: ['x', 'x'] }] }).success).toBe(false);
    expect(designDocumentSchema.safeParse({ ...empty, enums: [{ ...item, values: ['가'.repeat(22)] }] }).success).toBe(false);
  });
});
import { tableRelationSchema, columnSchema } from './relational.js';
it('round-trips independent relationship endpoints and stable enum column reference', () => {
  const relation = { id: 'r', sourceTableId: 'a', targetTableId: 'b', scope: 'both', logical: { name: 'a.x:b', cardinality: 'one-to-many', required: false, description: 'independent', sourceCardinality: { min: 0, max: 'many' }, targetCardinality: { min: 1, max: 1 } }, physical: null };
  expect(tableRelationSchema.parse(relation)).toEqual(relation);
  expect(tableRelationSchema.safeParse({ ...relation, logical: { ...relation.logical, targetCardinality: { min: 2, max: 1 } } }).success).toBe(false);
  const column = { id: 'c', tableId: 't', scope: 'both', logical: { name: '', definition: '', semanticType: '', required: false }, physical: { name: 'state', type: { name: 'status', enumId: 'e', isArray: false }, nullable: true, defaultExpression: null, comment: '' }, customProperties: { common: {}, logical: {}, physical: {} } };
  expect(columnSchema.parse(column)).toEqual(column);
});
