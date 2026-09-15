import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type DesignDocument } from './document.js';
import {
  applyChanges,
  applyOperationsOverlay,
  canApplyInverse,
  claimedChangesMatch,
  diffSharedDocument,
  deriveStructuralDependencyPaths,
  findFieldVersionConflicts,
  inverseChanges,
  isEffectiveChange,
  isDeletionChange,
  mergeCandidateOntoDocument,
  requestFingerprint,
  retainPendingOperations,
  sharedDocument,
} from './sync.js';

function fixture(): DesignDocument {
  return {
    ...createEmptyDocument(),
    views: [{ id: 'combined', name: '함께 보기', domainIds: ['domain'] }],
    domains: [{ id: 'domain', name: '영업', description: '' }],
    tables: [
      {
        id: 'table',
        domainId: 'domain',
        scope: 'both',
        logical: { name: '주문', definition: '' },
        physical: { name: 'orders', schema: 'public', comment: '' },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
    ],
    layout: {
      nodes: [
        {
          id: 'node:table:domain',
          objectId: 'table',
          viewId: 'domain',
          x: 10,
          y: 20,
          width: 320,
          height: 260,
        },
        {
          id: 'node:table:combined',
          objectId: 'table',
          viewId: 'combined',
          x: 100,
          y: 200,
          width: 320,
          height: 260,
        },
      ],
      viewports: [{ viewId: 'domain', x: 1, y: 2, zoom: 1 }],
    },
  };
}

describe('shared document sync model', () => {
  it('merges disjoint field changes onto the same current document', () => {
    const base = fixture();
    const nameEdit = structuredClone(base);
    nameEdit.tables![0]!.logical.name = '결제 주문';
    const descriptionEdit = structuredClone(base);
    descriptionEdit.tables![0]!.logical.definition = '고객 주문';
    const merged = applyChanges(
      applyChanges(base, diffSharedDocument(base, nameEdit)),
      diffSharedDocument(base, descriptionEdit),
    );
    expect(merged.tables![0]!.logical).toEqual({ name: '결제 주문', definition: '고객 주문' });

    const serverCurrent = structuredClone(base);
    serverCurrent.tables![0]!.logical.definition = '서버 설명';
    expect(
      mergeCandidateOntoDocument(base, serverCurrent, nameEdit).document.tables![0]!.logical,
    ).toEqual({ name: '결제 주문', definition: '서버 설명' });
  });

  it('lets the latest server-approved online edit win on the same field', () => {
    const operation = {
      kind: 'online' as const,
      baseSequence: 1,
      changes: [{ path: '/tables/table/logical/name', before: '주문', after: '새 주문' }],
    };
    expect(findFieldVersionConflicts(operation, { '/tables/table/logical/name': 9 })).toEqual([]);
    expect(applyChanges(fixture(), operation.changes).tables![0]!.logical.name).toBe('새 주문');
  });

  it('rejects reconnect edits when their field changed after the baseline', () => {
    const operation = {
      kind: 'reconnect' as const,
      baseSequence: 4,
      dependencyPaths: ['/keys/key/columnIds'],
      changes: [{ path: '/tables/table/logical/name', before: '주문', after: '오프라인 주문' }],
    };
    expect(findFieldVersionConflicts(operation, { '/tables/table/logical/name': 5 })).toEqual([
      '/tables/table/logical/name',
    ]);
    expect(findFieldVersionConflicts(operation, { '/keys/key/columnIds': 6 })).toEqual([
      '/keys/key/columnIds',
    ]);
  });

  it('does not resurrect an object deleted before a late property edit', () => {
    const base = fixture();
    const deletion = { path: '/tables/table', before: base.tables![0], after: null };
    const deleted = applyChanges(base, [deletion]);
    expect(() =>
      applyChanges(deleted, [
        { path: '/tables/table/logical/name', before: '주문', after: '늦은 수정' },
      ]),
    ).toThrow('Missing sync target');
    expect(deleted.tables).toEqual([]);
    expect(isDeletionChange(deletion)).toBe(true);
  });

  it('removes only the acknowledged operation and retains its later overlay', () => {
    const first = {
      operationId: 'first',
      changes: [{ path: '/tables/table/logical/name', before: '주문', after: '주문 1' }],
    };
    const later = {
      operationId: 'later',
      changes: [{ path: '/tables/table/logical/name', before: '주문 1', after: '주문 12' }],
    };
    const pending = retainPendingOperations([first, later], 'first');
    expect(pending).toEqual([later]);
    expect(applyOperationsOverlay(fixture(), pending).tables![0]!.logical.name).toBe('주문 12');
  });

  it('excludes personal viewports and combined-view derived layouts', () => {
    const before = fixture();
    const after = structuredClone(before);
    after.layout.viewports[0]!.zoom = 2;
    after.layout.nodes[1]!.x = 999;
    after.views![0]!.domainIds = [];
    expect(diffSharedDocument(before, after)).toEqual([]);
    after.layout.nodes[0]!.x = 55;
    expect(diffSharedDocument(before, after).map((change) => change.path)).toContain(
      '/layout/nodes/node:table:domain/position',
    );
  });

  it('emits only node position when moving a table with unchanged primary keys', () => {
    const baseline = fixture();
    baseline.tables!.push({ ...structuredClone(baseline.tables![0]!), id: 'second-table' });
    baseline.keys = [
      {
        id: 'first-pk',
        tableId: 'table',
        scope: 'both',
        kind: 'primary',
        name: 'first_pk',
        columnIds: ['first-id'],
      },
      {
        id: 'second-pk',
        tableId: 'second-table',
        scope: 'both',
        kind: 'primary',
        name: 'second_pk',
        columnIds: ['second-id'],
      },
    ];
    baseline.layout.nodes.push({
      ...structuredClone(baseline.layout.nodes[0]!),
      id: 'node:second-table:domain',
      objectId: 'second-table',
      x: 400,
    });
    const candidate = structuredClone(baseline);
    candidate.layout.nodes[2]!.x = 450;

    expect(diffSharedDocument(baseline, candidate)).toEqual([
      {
        path: '/layout/nodes/node:second-table:domain/position',
        before: { x: 400, y: 20 },
        after: { x: 450, y: 20 },
      },
    ]);
  });

  it('treats structurally equal primitive arrays as unchanged', () => {
    const baseline = fixture();
    baseline.keys = [
      {
        id: 'pk',
        tableId: 'table',
        scope: 'both',
        kind: 'primary',
        name: 'pk',
        columnIds: ['first-id', 'second-id'],
      },
    ];
    baseline.enums = [{ id: 'status', name: 'status', schema: 'public', values: ['new', 'done'] }];

    expect(diffSharedDocument(baseline, structuredClone(baseline))).toEqual([]);

    const reorderedKey = structuredClone(baseline);
    reorderedKey.keys![0]!.columnIds.reverse();
    expect(diffSharedDocument(baseline, reorderedKey)).toContainEqual(
      expect.objectContaining({
        path: '/keys/pk/columnIds',
        before: ['first-id', 'second-id'],
        after: ['second-id', 'first-id'],
      }),
    );

    const changedEnum = structuredClone(baseline);
    changedEnum.enums![0]!.values[1] = 'archived';
    expect(diffSharedDocument(baseline, changedEnum)).toContainEqual(
      expect.objectContaining({
        path: '/enums/status/values',
        before: ['new', 'done'],
        after: ['new', 'archived'],
      }),
    );
  });

  it('keeps keyed-array reorder moves while ignoring structurally equal clones', () => {
    const baseline = fixture();
    baseline.tables!.push({ ...structuredClone(baseline.tables![0]!), id: 'second-table' });
    const reordered = structuredClone(baseline);
    reordered.tables!.reverse();

    expect(diffSharedDocument(baseline, reordered)).toContainEqual(
      expect.objectContaining({ path: '/tables/@move/second-table' }),
    );
  });

  it('recognizes effective changes while preserving property existence semantics', () => {
    expect(isEffectiveChange({ before: ['id'], after: ['id'] })).toBe(false);
    expect(isEffectiveChange({ before: ['id'], after: ['other-id'] })).toBe(true);
    expect(
      isEffectiveChange({ before: null, after: null, beforeExists: false, afterExists: true }),
    ).toBe(true);
    expect(
      isEffectiveChange({ before: null, after: null, beforeExists: false, afterExists: false }),
    ).toBe(false);
  });

  it('creates deterministic fingerprints and field-scoped inverse edits', () => {
    expect(requestFingerprint({ b: 2, a: 1 })).toBe(requestFingerprint({ a: 1, b: 2 }));
    const changes = [{ path: '/tables/table/logical/name', before: '주문', after: '결제 주문' }];
    expect(inverseChanges(changes)).toEqual([
      { path: '/tables/table/logical/name', before: '결제 주문', after: '주문' },
    ]);
    expect(canApplyInverse(changes, 5, { '/tables/table/logical/name': 5 })).toBe(true);
    expect(canApplyInverse(changes, 5, { '/tables/table/logical/name': 6 })).toBe(false);
    const create = [
      { path: '/tables/table', before: null, after: fixture().tables![0], beforeExists: false },
    ];
    expect(canApplyInverse(create, 5, { '/tables/table/logical/name': 6 })).toBe(false);
  });

  it('detects advisory claimed changes that differ from the semantic baseline diff', () => {
    const baseline = fixture();
    const candidate = structuredClone(baseline);
    candidate.tables![0]!.logical.name = '후보';
    const derived = diffSharedDocument(baseline, candidate);
    expect(claimedChangesMatch(derived, derived)).toBe(true);
    expect(
      claimedChangesMatch(derived, [
        { path: '/domains/domain/name', before: '영업', after: '조작' },
      ]),
    ).toBe(false);
  });

  it('keeps null distinct from removal of an optional property', () => {
    const baseline = fixture();
    baseline.tables![0]!.canvasDisplay = { showComment: true };
    const candidate = structuredClone(baseline);
    delete candidate.tables![0]!.canvasDisplay;
    const changes = diffSharedDocument(baseline, candidate);
    expect(changes).toContainEqual(
      expect.objectContaining({ path: '/tables/table/canvasDisplay', afterExists: false }),
    );
    expect(Object.hasOwn(applyChanges(baseline, changes).tables![0]!, 'canvasDisplay')).toBe(false);
  });

  it('groups node geometry and type changes into atomic paths', () => {
    const baseline = fixture();
    const candidate = structuredClone(baseline);
    candidate.layout.nodes[0]!.x = 50;
    candidate.layout.nodes[0]!.y = 60;
    expect(diffSharedDocument(baseline, candidate)).toContainEqual(
      expect.objectContaining({
        path: '/layout/nodes/node:table:domain/position',
        after: { x: 50, y: 60 },
      }),
    );
  });

  it('merges concurrent additions when an optional collection was absent at baseline', () => {
    const baseline = fixture();
    delete baseline.enums;
    const mine = structuredClone(baseline);
    mine.enums = [{ id: 'a', name: 'a', schema: 'public', values: ['a'] }];
    const current = structuredClone(baseline);
    current.enums = [{ id: 'b', name: 'b', schema: 'public', values: ['b'] }];
    expect(
      applyChanges(current, diffSharedDocument(baseline, mine)).enums?.map((item) => item.id),
    ).toEqual(['b', 'a']);
    expect(
      applyChanges(baseline, diffSharedDocument(baseline, mine)).enums?.map((item) => item.id),
    ).toEqual(['a']);
  });

  it('does not emit reorder moves caused only by deletion', () => {
    const column = (id: string) => ({
      id,
      tableId: 'table',
      scope: 'both' as const,
      logical: { name: id, definition: '', semanticType: '', required: false },
      physical: {
        name: id,
        type: { name: 'text', isArray: false },
        nullable: true,
        defaultExpression: null,
        comment: '',
      },
      customProperties: { common: {}, logical: {}, physical: {} },
    });
    const baseline = fixture();
    baseline.columns = ['a', 'b', 'c'].map(column);
    const candidate = structuredClone(baseline);
    candidate.columns = candidate.columns!.filter((item) => item.id !== 'a');
    const current = structuredClone(baseline);
    current.columns = [current.columns![0]!, current.columns![2]!, current.columns![1]!];
    const changes = diffSharedDocument(baseline, candidate);
    expect(changes.map((change) => change.path)).toEqual(['/columns/a']);
    expect(applyChanges(current, changes).columns?.map((item) => item.id)).toEqual(['c', 'b']);
  });

  it('rejects reconnect entity edits and dependencies changed at descendants', () => {
    const deletion = {
      kind: 'reconnect' as const,
      baseSequence: 1,
      changes: [{ path: '/tables/table', before: fixture().tables![0], after: null }],
    };
    expect(findFieldVersionConflicts(deletion, { '/tables/table/logical/name': 2 })).toEqual([
      '/tables/table',
    ]);
    const dependent = {
      kind: 'reconnect' as const,
      baseSequence: 1,
      dependencyPaths: ['/keys/key'],
      changes: [{ path: '/tables/table/logical/name', before: '주문', after: '주문2' }],
    };
    expect(findFieldVersionConflicts(dependent, { '/keys/key/columnIds': 2 })).toContain(
      '/keys/key',
    );
  });

  it('rejects a move whose non-null anchor no longer exists', () => {
    const baseline = fixture();
    expect(() =>
      applyChanges(baseline, [{ path: '/tables/@move/table', before: null, after: 'gone' }]),
    ).toThrow('Missing sync move anchor');
  });

  it('roundtrips first columns and middle insertions with ID anchors', () => {
    const column = (id: string) => ({
      id,
      tableId: 'table',
      scope: 'both' as const,
      logical: { name: id, definition: '', semanticType: '', required: false },
      physical: {
        name: id,
        type: { name: 'text', isArray: false },
        nullable: true,
        defaultExpression: null,
        comment: '',
      },
      customProperties: { common: {}, logical: {}, physical: {} },
    });
    const empty = fixture();
    delete empty.columns;
    const first = structuredClone(empty);
    first.columns = [column('a')];
    expect(
      applyChanges(empty, diffSharedDocument(empty, first)).columns?.map((item) => item.id),
    ).toEqual(['a']);
    const baseline = fixture();
    baseline.columns = [column('a'), column('c')];
    const candidate = structuredClone(baseline);
    candidate.columns = [column('a'), column('b'), column('c')];
    expect(
      applyChanges(baseline, diffSharedDocument(baseline, candidate)).columns?.map(
        (item) => item.id,
      ),
    ).toEqual(['a', 'b', 'c']);
  });

  it('roundtrips representative shared model actions through semantic changes', () => {
    const before = fixture();
    const after = structuredClone(before);
    after.enums = [{ id: 'status', name: 'status', schema: 'public', values: ['new', 'done'] }];
    after.columns = [
      {
        id: 'state',
        tableId: 'table',
        scope: 'both',
        logical: { name: '상태', definition: '', semanticType: '', required: true },
        physical: {
          name: 'state',
          type: { name: 'status', enumId: 'status', isArray: false },
          nullable: false,
          defaultExpression: null,
          comment: '',
        },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
    ];
    after.layout.nodes[0] = { ...after.layout.nodes[0]!, x: 80, y: 90, width: 400, height: 300 };
    after.layout.relations = [
      { relationId: 'relation', viewId: 'domain', offset: 12, bend: { x: 5, y: 6 } },
    ];
    const result = applyChanges(before, diffSharedDocument(before, after));
    expect(sharedDocument(result)).toEqual(sharedDocument(after));
  });

  it('derives structural dependencies from candidate FK, key, and enum references', () => {
    const candidate = fixture();
    candidate.tables!.push({ ...structuredClone(candidate.tables![0]!), id: 'parent' });
    const column = (id: string, tableId: string, enumId?: string) => ({
      id,
      tableId,
      scope: 'both' as const,
      logical: { name: id, definition: '', semanticType: '', required: false },
      physical: {
        name: id,
        type: { name: enumId ? 'status' : 'uuid', ...(enumId && { enumId }), isArray: false },
        nullable: false,
        defaultExpression: null,
        comment: '',
      },
      customProperties: { common: {}, logical: {}, physical: {} },
    });
    candidate.columns = [column('child-id', 'table'), column('parent-id', 'parent', 'status')];
    candidate.keys = [
      {
        id: 'parent-key',
        tableId: 'parent',
        scope: 'both',
        kind: 'primary',
        name: 'pk',
        columnIds: ['parent-id'],
      },
    ];
    candidate.tableRelations = [
      {
        id: 'fk',
        sourceTableId: 'table',
        targetTableId: 'parent',
        scope: 'both',
        logical: { name: '', cardinality: 'one-to-many', required: false },
        physical: {
          name: 'fk',
          sourceColumnIds: ['child-id'],
          targetColumnIds: ['parent-id'],
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
        },
      },
    ];
    const changes = [
      {
        path: '/tableRelations/fk/physical',
        before: null,
        after: candidate.tableRelations[0]!.physical,
      },
      { path: '/keys/parent-key/columnIds', before: [], after: ['parent-id'] },
      {
        path: '/columns/parent-id/physical/type',
        before: { name: 'uuid', isArray: false },
        after: candidate.columns[1]!.physical.type,
      },
    ];
    expect(deriveStructuralDependencyPaths(candidate, changes)).toEqual([
      '/columns/child-id/@exists',
      '/columns/child-id/physical/type',
      '/columns/child-id/tableId',
      '/columns/parent-id/@exists',
      '/columns/parent-id/physical/type',
      '/columns/parent-id/tableId',
      '/enums/status/@exists',
      '/keys/parent-key/@exists',
      '/keys/parent-key/columnIds',
      '/keys/parent-key/kind',
      '/keys/parent-key/tableId',
      '/tables/parent/@exists',
      '/tables/table/@exists',
    ]);
    const fkOnly = [changes[0]!];
    const dependencies = deriveStructuralDependencyPaths(candidate, fkOnly);
    expect(dependencies).toContain('/keys/parent-key/columnIds');
    expect(
      findFieldVersionConflicts(
        { kind: 'reconnect', baseSequence: 4, changes: fkOnly, dependencyPaths: dependencies },
        {
          '/keys/parent-key/columnIds': 5,
        },
      ),
    ).toContain('/keys/parent-key/columnIds');
  });

  it('does not make unrelated table labels a dependency of structural edits', () => {
    const candidate = fixture();
    candidate.columns = [
      {
        id: 'commented',
        tableId: 'table',
        scope: 'both',
        logical: { name: '', definition: '', semanticType: '', required: false },
        physical: {
          name: 'commented',
          type: { name: 'text', isArray: false },
          nullable: true,
          defaultExpression: null,
          comment: 'mine',
        },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
    ];
    const changes = [{ path: '/columns/commented/physical/comment', before: '', after: 'mine' }];
    const dependencies = deriveStructuralDependencyPaths(candidate, changes);
    expect(dependencies).toContain('/tables/table/@exists');
    expect(
      findFieldVersionConflicts(
        { kind: 'reconnect', baseSequence: 1, changes, dependencyPaths: dependencies },
        {
          '/tables/table/logical/name': 2,
        },
      ),
    ).toEqual([]);
  });
});
