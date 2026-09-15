import { describe, it, expect } from 'vitest';
import {
  createEmptyDocument,
  upsertEnum,
  removeEnum,
  addDomain,
  diagnoseDocument,
  type DesignDocument,
} from './document.js';
const item = { id: 'status', schema: 'public', name: 'status', values: ['open', 'closed'] };
describe('project ENUM model', () => {
  it('creates and renames a stable definition without mutating inputs', () => {
    const empty = createEmptyDocument();
    const next = upsertEnum(empty, item);
    expect(empty.enums).toBeUndefined();
    item.values.push('archived');
    expect(next.enums![0]!.values).toEqual(['open', 'closed']);
    const renamed = upsertEnum(next, { ...next.enums![0]!, name: 'workflow' });
    expect(renamed.enums).toHaveLength(1);
    expect(renamed.enums![0]!.id).toBe('status');
    expect(removeEnum(renamed, 'status').enums).toEqual([]);
  });
  it('rejects duplicates, invalid labels, reserved and colliding IDs', () => {
    const doc = upsertEnum(createEmptyDocument(), item);
    expect(() => upsertEnum(doc, { ...item, id: 'another' })).toThrow();
    expect(() => upsertEnum(doc, { ...item, values: ['x', 'x'] })).toThrow();
    expect(() => upsertEnum(doc, { ...item, values: ['가'.repeat(22)] })).toThrow();
    expect(() => upsertEnum(doc, { ...item, id: 'overview' })).toThrow();
    expect(() =>
      addDomain(doc, { id: 'status', name: '', description: '' }, { x: 0, y: 0 }),
    ).toThrow();
  });
  it('blocks deletion in use and diagnoses unresolved references', () => {
    const doc = {
      ...upsertEnum(createEmptyDocument(), item),
      columns: [{ id: 'c', tableId: 't', scope: 'both', physical: { type: { enumId: 'status' } } }],
    } as DesignDocument;
    expect(() => removeEnum(doc, 'status')).toThrow(/사용/);
    expect(diagnoseDocument({ ...doc, enums: [] }).some((d) => d.code === 'missing-enum')).toBe(
      true,
    );
  });
});
