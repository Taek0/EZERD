import { expect, it } from 'vitest';
import {
  addDomain,
  addTable,
  createEmptyDocument,
  diffSharedDocument,
  sharedDocument,
  upsertCombinedView,
  upsertTableRelation,
  upsertRelationLayout,
  mergeStoredPersonalState,
  extractPersonalState,
} from '@ezerd/model';

it('keeps combined view routes personal while preserving owner positions and routes across remote sync', () => {
  let doc = addDomain(
    createEmptyDocument(),
    { id: 'd', name: 'domain', description: '' },
    { x: 0, y: 0 },
  );
  doc = addTable(
    doc,
    {
      id: 't',
      domainId: 'd',
      scope: 'both',
      logical: { name: 'table', definition: '' },
      physical: { name: 'table', schema: 'public', comment: '' },
      customProperties: { common: {}, logical: {}, physical: {} },
    },
    { x: 20, y: 30 },
  );
  doc = upsertTableRelation(doc, {
    id: 'r',
    sourceTableId: 't',
    targetTableId: 't',
    scope: 'both',
    logical: { name: 'self', cardinality: 'one-to-many', required: false },
    physical: null,
  });
  doc = upsertCombinedView(doc, { id: 'combined', name: 'view', domainIds: ['d'] });
  doc = upsertRelationLayout(doc, {
    relationId: 'r',
    viewId: 'd',
    offset: 0,
    sourceAnchor: { side: 'left', ratio: 0.2 },
  });
  const changed = upsertRelationLayout(doc, {
    relationId: 'r',
    viewId: 'combined',
    offset: 0,
    sourceAnchor: { side: 'right', ratio: 0.6 },
    targetAnchor: { side: 'bottom', ratio: 0.4 },
  });
  expect(changed.layout.nodes).toEqual(doc.layout.nodes);
  expect(changed.layout.relations!.find((route) => route.viewId === 'd')).toEqual(
    doc.layout.relations![0],
  );
  expect(diffSharedDocument(doc, changed)).toEqual([]);
  const remote = addDomain(
    sharedDocument(doc),
    { id: 'remote', name: 'remote', description: '' },
    { x: 0, y: 0 },
  );
  const merged = mergeStoredPersonalState(remote, extractPersonalState(changed));
  expect(merged.layout.relations!.find((route) => route.viewId === 'combined')).toEqual(
    changed.layout.relations!.find((route) => route.viewId === 'combined'),
  );
  expect(merged.domains.some((domain) => domain.id === 'remote')).toBe(true);
});
