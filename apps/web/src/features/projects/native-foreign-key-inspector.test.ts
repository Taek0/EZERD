import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NativeTableRelation } from '@ezerd/model';
import { advancedFixture } from './native-advanced-test-fixtures.js';
import {
  nativeConstraintCommands,
  nativeConstraintInitial,
  nativeRelationMappingReviewToken,
  nativeRelationEndpointChange,
  NativeConstraintForm,
} from './native-editor-structure.js';
import { setLocale } from '../../shared/i18n/index.js';

const policy = vi.hoisted(() => ({ blocked: false }));
vi.mock('./native-editor-policy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./native-editor-policy.js')>();
  return {
    ...actual,
    nativeEditorPolicy: (...args: Parameters<typeof actual.nativeEditorPolicy>) => {
      const original = actual.nativeEditorPolicy(...args);
      return {
        ...original,
        feature: (...features: Parameters<typeof original.feature>) =>
          features[0] === 'foreignKey' && policy.blocked
            ? { ...original.feature(...features), usable: false, code: 'feature.not-implemented' }
            : original.feature(...features),
      };
    },
  };
});
function fixture(kind: Parameters<typeof advancedFixture>[0] = 'postgresql') {
  const f = advancedFixture(kind);
  const parent = structuredClone(f.table);
  parent.id = 'parent';
  parent.physical.name = 'parents';
  const target = structuredClone(f.columns[0]!);
  target.id = 'target';
  target.tableId = 'parent';
  f.document.tables!.push(parent);
  f.document.columns!.push(target);
  f.document.keys = [
    {
      id: 'pk',
      tableId: 'parent',
      scope: 'physical',
      kind: 'primary',
      name: 'pk_parent',
      columnIds: ['target'],
    },
  ];
  const relation: NativeTableRelation = {
    id: 'r',
    sourceTableId: 't',
    targetTableId: 'parent',
    scope: 'both',
    logical: {
      name: 'saved relation',
      description: 'saved semantics',
      cardinality: 'one-to-many',
      required: true,
      sourceCardinality: { min: 0, max: 'many' },
      targetCardinality: { min: 1, max: 1 },
    },
    physical: {
      name: 'fk_original',
      sourceColumnIds: ['a'],
      targetColumnIds: ['target'],
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION',
    },
  };
  f.document.tableRelations = [relation];
  return { ...f, relation, parent, target };
}
function reviewed(f: ReturnType<typeof fixture>, values: Record<string, string>) {
  return { ...values, mappingReview: nativeRelationMappingReviewToken(f.document, 'r', values) };
}
afterEach(() => {
  policy.blocked = false;
  setLocale('ko');
  vi.unstubAllGlobals();
});
describe('native foreign-key physical inspector transitions', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'adds a complete %s definition including unchanged defaults to a relation with physical:null',
    (kind) => {
      const f = fixture(kind);
      f.relation.physical = null;
      const original = structuredClone(f.document),
        before = nativeConstraintInitial(f.document, 'tableRelations', 'r');
      const values = reviewed(f, {
        ...before,
        physicalMode: 'present',
        name: 'fk_added',
        columnIds: 'a',
        targetColumnIds: 'target',
        mappingCount: '1',
      });
      expect(nativeConstraintCommands(f.document, 'tableRelations', 'r', values, before)).toEqual([
        {
          type: 'patch_foreign_key',
          id: 'r',
          patch: {
            physical: {
              name: 'fk_added',
              sourceColumnIds: ['a'],
              targetColumnIds: ['target'],
              onDelete: 'NO ACTION',
              onUpdate: 'NO ACTION',
            },
          },
        },
      ]);
      expect(f.document).toEqual(original);
    },
  );
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'removes %s physical definition with canonical null while preserving logical data and ignoring hidden physical edits',
    (kind) => {
      const f = fixture(kind),
        original = structuredClone(f.document),
        before = nativeConstraintInitial(f.document, 'tableRelations', 'r');
      const values = {
        ...before,
        physicalMode: 'none',
        name: 'unused',
        columnIds: '',
        targetColumnIds: '',
        onDelete: 'SET NULL',
        logicalDescription: 'new description',
      };
      expect(nativeConstraintCommands(f.document, 'tableRelations', 'r', values, before)).toEqual([
        {
          type: 'patch_foreign_key',
          id: 'r',
          patch: { logical: { description: 'new description' }, physical: null },
        },
      ]);
      expect(f.document).toEqual(original);
    },
  );
  it('promotes a purely logical relation explicitly to both scopes when adding its physical definition', () => {
    const f = fixture();
    f.relation.physical = null;
    f.relation.scope = 'logical';
    const before = nativeConstraintInitial(f.document, 'tableRelations', 'r'),
      values = reviewed(f, {
        ...before,
        physicalMode: 'present',
        name: 'fk_real',
        columnIds: 'a',
        targetColumnIds: 'target',
      });
    expect(
      nativeConstraintCommands(f.document, 'tableRelations', 'r', values, before),
    ).toMatchObject([
      {
        type: 'patch_foreign_key',
        patch: {
          scope: 'both',
          physical: {
            name: 'fk_real',
            sourceColumnIds: ['a'],
            targetColumnIds: ['target'],
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
          },
        },
      },
    ]);
  });
  it('restores all reviewed definition fields after a removal instead of sending only values changed since the null baseline', () => {
    const f = fixture(),
      sourcePhysicalRestore = structuredClone(f.relation.physical!);
    f.relation.physical = null;
    const before = nativeConstraintInitial(f.document, 'tableRelations', 'r'),
      values = reviewed(f, {
        ...before,
        name: sourcePhysicalRestore.name,
        columnIds: sourcePhysicalRestore.sourceColumnIds.join('\n'),
        targetColumnIds: sourcePhysicalRestore.targetColumnIds.join('\n'),
        onDelete: sourcePhysicalRestore.onDelete,
        onUpdate: sourcePhysicalRestore.onUpdate,
        physicalMode: 'present',
      });
    expect(nativeConstraintCommands(f.document, 'tableRelations', 'r', values, before)).toEqual([
      {
        type: 'patch_foreign_key',
        id: 'r',
        patch: {
          physical: {
            name: 'fk_original',
            sourceColumnIds: ['a'],
            targetColumnIds: ['target'],
            onDelete: 'CASCADE',
            onUpdate: 'NO ACTION',
          },
        },
      },
    ]);
  });
  it('keeps an existing definition patch partial and does not rewrite unedited types, defaults, generated values, options or logical endpoint data', () => {
    const f = fixture();
    f.relation.deferrable = { initially: 'deferred' };
    const original = structuredClone(f.document),
      before = nativeConstraintInitial(f.document, 'tableRelations', 'r');
    expect(
      nativeConstraintCommands(
        f.document,
        'tableRelations',
        'r',
        { ...before, name: 'renamed' },
        before,
      ),
    ).toEqual([{ type: 'patch_foreign_key', id: 'r', patch: { physical: { name: 'renamed' } } }]);
    expect(nativeConstraintCommands(f.document, 'tableRelations', 'r', before, before)).toEqual([]);
    expect(f.document).toEqual(original);
  });
  it('keeps old archived partial drafts compatible without manufacturing a physical replacement', () => {
    const f = fixture(),
      before = {
        name: 'fk_original',
        logicalName: 'saved relation',
        columnIds: 'a',
        targetColumnIds: 'target',
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
        deferrability: 'none',
        nullsNotDistinct: 'false',
      };
    expect(
      nativeConstraintCommands(
        f.document,
        'tableRelations',
        'r',
        { ...before, logicalName: 'rename logical' },
        before,
      ),
    ).toEqual([
      { type: 'patch_foreign_key', id: 'r', patch: { logical: { name: 'rename logical' } } },
    ]);
  });
  it('clears both lists/count/review on endpoint change and requires a review tied to newly selected pairs', () => {
    const f = fixture(),
      before = nativeConstraintInitial(f.document, 'tableRelations', 'r');
    const started = reviewed(f, before),
      changed = nativeRelationEndpointChange(started, 'sourceTableId', 'parent');
    expect(nativeRelationEndpointChange(started, 'sourceTableId', 't')).toEqual(started);
    expect(changed).toMatchObject({
      sourceTableId: 'parent',
      columnIds: '',
      targetColumnIds: '',
      mappingCount: '0',
      mappingReview: '',
    });
    const values = {
      ...changed,
      columnIds: 'target',
      targetColumnIds: 'target',
      mappingCount: '1',
    };
    expect(() =>
      nativeConstraintCommands(f.document, 'tableRelations', 'r', values, before),
    ).toThrow('foreign-key.mapping-review-required');
    expect(
      nativeConstraintCommands(f.document, 'tableRelations', 'r', reviewed(f, values), before),
    ).toEqual([
      {
        type: 'patch_foreign_key',
        id: 'r',
        patch: { sourceTableId: 'parent', physical: { sourceColumnIds: ['target'] } },
      },
    ]);
  });
  it('rejects a stale review after a pair, endpoint or original definition changes', () => {
    const f = fixture();
    f.relation.physical = null;
    const before = nativeConstraintInitial(f.document, 'tableRelations', 'r'),
      values = reviewed(f, {
        ...before,
        physicalMode: 'present',
        name: 'fk_new',
        columnIds: 'a',
        targetColumnIds: 'target',
      });
    expect(() =>
      nativeConstraintCommands(
        f.document,
        'tableRelations',
        'r',
        { ...values, columnIds: 'b' },
        before,
      ),
    ).toThrow('foreign-key.mapping-review-required');
    const previous = values.mappingReview;
    f.relation.logical.description = 'latest saved description';
    expect(nativeRelationMappingReviewToken(f.document, 'r', values)).not.toBe(previous);
  });
  it('validates ownership and pairing before considering a complete physical addition reviewed', () => {
    const f = fixture();
    f.relation.physical = null;
    const before = nativeConstraintInitial(f.document, 'tableRelations', 'r');
    for (const pairs of [
      { columnIds: '', targetColumnIds: 'target' },
      { columnIds: 'a\na', targetColumnIds: 'target\ntarget' },
      { columnIds: 'target', targetColumnIds: 'a' },
    ]) {
      const values = reviewed(f, { ...before, ...pairs, physicalMode: 'present' });
      expect(() =>
        nativeConstraintCommands(f.document, 'tableRelations', 'r', values, before),
      ).toThrow('foreign-key.columns-invalid');
    }
  });
  it('requires foreign-key capability for every physical change including rename, add and explicit removal', () => {
    const f = fixture(),
      before = nativeConstraintInitial(f.document, 'tableRelations', 'r');
    policy.blocked = true;
    for (const values of [
      { ...before, name: 'renamed' },
      { ...before, physicalMode: 'none' },
    ])
      expect(() =>
        nativeConstraintCommands(f.document, 'tableRelations', 'r', values, before),
      ).toThrow('feature.not-implemented');
    expect(
      nativeConstraintCommands(
        f.document,
        'tableRelations',
        'r',
        { ...before, logicalName: 'logical only' },
        before,
      ),
    ).toMatchObject([{ patch: { logical: { name: 'logical only' } } }]);
    f.relation.physical = null;
    const absent = nativeConstraintInitial(f.document, 'tableRelations', 'r');
    expect(() =>
      nativeConstraintCommands(
        f.document,
        'tableRelations',
        'r',
        reviewed(f, {
          ...absent,
          physicalMode: 'present',
          columnIds: 'a',
          targetColumnIds: 'target',
        }),
        absent,
      ),
    ).toThrow('feature.not-implemented');
  });
  it('allows explicit deferrability clearing together with physical:null and retains otherwise untouched options', () => {
    const f = fixture();
    f.relation.deferrable = { initially: 'deferred' };
    const before = nativeConstraintInitial(f.document, 'tableRelations', 'r');
    expect(
      nativeConstraintCommands(
        f.document,
        'tableRelations',
        'r',
        { ...before, physicalMode: 'none', deferrability: 'none' },
        before,
      ),
    ).toMatchObject([{ patch: { physical: null, deferrable: null } }]);
    expect(
      nativeConstraintCommands(
        f.document,
        'tableRelations',
        'r',
        { ...before, physicalMode: 'none' },
        before,
      ),
    ).toEqual([{ type: 'patch_foreign_key', id: 'r', patch: { physical: null } }]);
  });
  it('validates newly added PostgreSQL deferrability against the complete physical candidate rather than the old null definition', () => {
    const f = fixture();
    f.relation.physical = null;
    f.relation.scope = 'logical';
    const before = nativeConstraintInitial(f.document, 'tableRelations', 'r'),
      values = reviewed(f, {
        ...before,
        physicalMode: 'present',
        name: 'fk_added',
        columnIds: 'a',
        targetColumnIds: 'target',
        deferrability: 'deferred',
      });
    expect(
      nativeConstraintCommands(f.document, 'tableRelations', 'r', values, before),
    ).toMatchObject([
      {
        patch: {
          scope: 'both',
          physical: {
            sourceColumnIds: ['a'],
            targetColumnIds: ['target'],
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
          },
          deferrable: { initially: 'deferred' },
        },
      },
    ]);
  });
  it('renders a reachable physical addition for a logical-only relation while keeping the existing durable constraint form', () => {
    const f = fixture();
    f.relation.physical = null;
    setLocale('ko');
    const html = renderToStaticMarkup(
      createElement(NativeConstraintForm, {
        document: f.document,
        collection: 'tableRelations',
        id: 'r',
        context: f.context,
      }),
    );
    expect(html).toContain('FK 정의 추가');
    expect(html).toContain('출발 테이블 (PK)');
    expect(html).toContain('대상 테이블 (FK)');
    expect(html).not.toContain('현재 설계 형식에서는');
    expect(f.context.onSave).not.toHaveBeenCalled();
  });
});
