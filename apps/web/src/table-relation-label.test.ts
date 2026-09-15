import { expect, it } from 'vitest';
import type { DesignDocument, TableRelation } from '@ezerd/model';
import { tableRelationLabel } from './table-relation-label.js';
const doc = {
  columns: [
    { id: 'pk', physical: { name: 'id' } },
    { id: 'fk', physical: { name: 'user_id' } },
    { id: 'tenant-pk', physical: { name: 'tenant_id' } },
    { id: 'tenant-fk', physical: { name: 'tenant_id' } },
  ],
} as DesignDocument;
it('shows PK departure attribute followed by FK reference attribute without table names', () => {
  expect(
    tableRelationLabel(doc, {
      physical: { targetColumnIds: ['pk'], sourceColumnIds: ['fk'] },
    } as TableRelation),
  ).toBe('id:user_id');
});
it('keeps composite column correspondence in its defined order', () => {
  expect(
    tableRelationLabel(doc, {
      physical: { targetColumnIds: ['tenant-pk', 'pk'], sourceColumnIds: ['tenant-fk', 'fk'] },
    } as TableRelation),
  ).toBe('tenant_id:tenant_id · id:user_id');
});
it('does not expose IDs when attributes are missing', () => {
  expect(
    tableRelationLabel(doc, {
      physical: { targetColumnIds: ['missing'], sourceColumnIds: [] },
    } as unknown as TableRelation),
  ).toBe('?:?');
});
