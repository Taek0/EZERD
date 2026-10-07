import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NativeTableRelation } from '@ezerd/model';
import { advancedFixture } from './native-advanced-test-fixtures.js';
import {
  nativeConstraintInitial,
  nativeConstraintCommands,
  NativeConstraintForm,
} from './native-editor-structure.js';
import { nativePrimaryKeyPlan } from './native-primary-key.js';
import {
  nativeInspectorMatches,
  nativeInspectorOutline,
  nativeInspectorLocation,
  nativeInspectorSaveStatus,
} from './native-inspector-state.js';
import { NativeTableRelationInspector } from './NativeTableRelationInspector.js';
import { NativeDomainRelationEditor } from './NativeDomainRelationEditor.js';
import { nativeTableCanvasRows } from './native-canvas-style.js';
import { nativeFormatInitial } from './native-editor-format.js';
import { NativeProjectView } from './NativeProjectView.js';
import { projectEntry } from './project-entry.js';
import { setLocale } from '../../shared/i18n/index.js';

function fixture(kind: Parameters<typeof advancedFixture>[0] = 'postgresql') {
  const f = advancedFixture(kind);
  f.document.domains = [
    { id: 'sales', name: 'Sales', description: '' },
    { id: 'billing', name: 'Billing', description: '' },
  ];
  f.table.domainId = 'sales';
  const parent = structuredClone(f.table);
  parent.id = 'parent';
  parent.domainId = 'billing';
  parent.physical.name = 'customers';
  const target = structuredClone(f.columns[0]!);
  target.id = 'customer_id';
  target.tableId = parent.id;
  f.document.tables!.push(parent);
  f.document.columns!.push(target);
  f.document.keys = [
    {
      id: 'pk',
      tableId: parent.id,
      scope: 'physical',
      name: 'pk_customers',
      kind: 'primary',
      columnIds: [target.id],
    },
  ];
  const relation: NativeTableRelation = {
    id: 'r',
    sourceTableId: f.table.id,
    targetTableId: parent.id,
    scope: 'both',
    logical: {
      name: 'owns',
      description: '<Korean 설명>',
      cardinality: 'one-to-many',
      required: true,
      sourceCardinality: { min: 0, max: 'many' },
      targetCardinality: { min: 1, max: 1 },
    },
    physical: {
      name: 'fk_owner',
      sourceColumnIds: ['a'],
      targetColumnIds: [target.id],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    },
  };
  f.document.tableRelations = [relation];
  f.document.domainRelations = [
    {
      id: 'dr',
      sourceDomainId: 'sales',
      targetDomainId: 'billing',
      direction: 'both',
      name: 'request',
      description: 'domain explanation',
    },
  ];
  return { ...f, relation, parent, target };
}
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale('ko');
});
describe('native inspector audit semantics', () => {
  it('trims whitespace and finds endpoint names without changing scope or data', () => {
    expect(nativeInspectorMatches('  bILLing  ', 'request', 'Sales', 'Billing')).toBe(true);
    expect(nativeInspectorMatches('  ', undefined)).toBe(true);
    const f = fixture(),
      original = structuredClone(f.document);
    const scope = {
      viewId: '__tables__',
      filter: { domainIds: ['sales'], unassigned: false },
      visibleObjectIds: ['t'],
      selectedObjectId: null,
      selectedNode: null,
    };
    expect(nativeInspectorOutline(f.document, 'physical', scope, '__tables__')).toMatchObject({
      tables: [{ id: 't' }],
      relations: [],
    });
    scope.visibleObjectIds.push('parent');
    expect(
      nativeInspectorOutline(f.document, 'physical', scope, '__tables__').relations.map(
        (r) => r.id,
      ),
    ).toEqual(['r']);
    expect(
      nativeInspectorLocation(
        f.document,
        scope.viewId,
        scope.filter,
        'All tables',
        'Map',
        'Unassigned',
        'None',
      ),
    ).toBe('All tables · Sales');
    expect(f.document).toEqual(original);
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'patches %s relation semantics independently from physical mappings and explicit other endpoint',
    (kind) => {
      const f = fixture(kind),
        original = structuredClone(f.document),
        before = nativeConstraintInitial(f.document, 'tableRelations', 'r');
      const commands = nativeConstraintCommands(
        f.document,
        'tableRelations',
        'r',
        {
          ...before,
          logicalDescription: 'Long 설명',
          sourceCardinality: '1:many',
          required: 'false',
        },
        before,
      );
      expect(commands).toEqual([
        {
          type: 'patch_foreign_key',
          id: 'r',
          patch: {
            logical: {
              description: 'Long 설명',
              required: false,
              sourceCardinality: { min: 1, max: 'many' },
            },
          },
        },
      ]);
      expect(f.document).toEqual(original);
    },
  );
  it('derives fallback endpoints without adding stored fields until edited and keeps old archived drafts compatible', () => {
    const f = fixture();
    delete f.relation.logical.sourceCardinality;
    delete f.relation.logical.targetCardinality;
    const before = nativeConstraintInitial(f.document, 'tableRelations', 'r');
    expect(before.sourceCardinality).toBe('fallback');
    expect(before.targetCardinality).toBe('fallback');
    const old = {
      logicalName: 'owns',
      columnIds: 'a',
      targetColumnIds: 'customer_id',
      name: 'fk_owner',
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
      deferrability: 'none',
      nullsNotDistinct: 'false',
    };
    expect(
      nativeConstraintCommands(
        f.document,
        'tableRelations',
        'r',
        { ...old, logicalName: 'new name' },
        old,
      ),
    ).toEqual([{ type: 'patch_foreign_key', id: 'r', patch: { logical: { name: 'new name' } } }]);
  });
  it('rejects mismatched, duplicate and unrelated FK pairing and renders numbered coupled selectors', () => {
    const f = fixture(),
      before = nativeConstraintInitial(f.document, 'tableRelations', 'r');
    for (const changes of [
      { columnIds: 'a\nb' },
      { columnIds: 'a\na', targetColumnIds: 'customer_id\ncustomer_id' },
      { columnIds: 's', targetColumnIds: 'missing' },
    ])
      expect(() =>
        nativeConstraintCommands(
          f.document,
          'tableRelations',
          'r',
          { ...before, ...changes },
          before,
        ),
      ).toThrow('foreign-key.columns-invalid');
    const html = renderToStaticMarkup(
      createElement(NativeConstraintForm, {
        document: f.document,
        context: f.context,
        collection: 'tableRelations',
        id: 'r',
      }),
    );
    for (const label of [
      '관계 설명',
      '출발 끝점 (PK)',
      '대상 끝점 (FK)',
      'PK / UNIQUE 컬럼 1',
      'FK 컬럼 1',
      'FK 정의 제거',
    ])
      expect(html).toContain(label);
    expect(f.context.onSave).not.toHaveBeenCalled();
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'plans %s PK membership and nullable adjustment as one validated native batch',
    (kind) => {
      const f = advancedFixture(kind);
      f.columns[0]!.physical.nullable = true;
      const original = structuredClone(f.document),
        plan = nativePrimaryKeyPlan(f.document, 'a', true, 'newpk');
      expect(plan.code).toBeUndefined();
      expect(plan.commands).toMatchObject([
        { type: 'patch_column', id: 'a', patch: { physical: { nullable: false } } },
        { type: 'add_key', value: { id: 'newpk', kind: 'primary', columnIds: ['a'] } },
      ]);
      expect(f.document).toEqual(original);
    },
  );
  it('blocks referenced PK changes rather than removing dependent physical FKs, but permits an equivalent UNIQUE key', () => {
    const f = fixture(),
      original = structuredClone(f.document);
    expect(nativePrimaryKeyPlan(f.document, 'customer_id', false, 'ignored')).toMatchObject({
      commands: [],
      code: 'foreign-key.target-key-required',
    });
    expect(f.document).toEqual(original);
    f.document.keys!.push({ ...f.document.keys![0]!, id: 'alternative', kind: 'unique' });
    expect(nativePrimaryKeyPlan(f.document, 'customer_id', false, 'ignored')).toMatchObject({
      commands: [{ type: 'delete_objects', targets: [{ collection: 'keys', id: 'pk' }] }],
    });
  });
  it('preserves key options and blocks SQLite WITHOUT ROWID last-PK removal', () => {
    const f = advancedFixture();
    f.document.keys = [
      {
        id: 'pk',
        tableId: 't',
        scope: 'physical',
        name: 'existing',
        kind: 'primary',
        columnIds: ['a'],
        deferrable: { initially: 'deferred' },
      },
    ];
    expect(nativePrimaryKeyPlan(f.document, 'b', true, 'ignored')).toMatchObject({
      commands: [{ type: 'patch_key', id: 'pk', patch: { columnIds: ['a', 'b'] } }],
    });
    expect(f.document.keys[0]!.deferrable).toEqual({ initially: 'deferred' });
    const sqlite = advancedFixture('sqlite');
    sqlite.table.physical.options = { database: 'sqlite', strict: false, withoutRowid: true };
    sqlite.document.keys = [
      { id: 'pk', tableId: 't', scope: 'physical', name: 'pk', kind: 'primary', columnIds: ['a'] },
    ];
    expect(nativePrimaryKeyPlan(sqlite.document, 'a', false, 'ignored')).toMatchObject({
      commands: [],
      code: 'deletion.primary-key-required',
    });
  });
  it('uses all PK FK UQ memberships and canonical unset comment display', () => {
    const f = fixture();
    f.document.keys!.push(
      {
        id: 'sourcepk',
        tableId: 't',
        scope: 'physical',
        name: 'pk',
        kind: 'primary',
        columnIds: ['a'],
      },
      {
        id: 'sourceuq',
        tableId: 't',
        scope: 'physical',
        name: 'uq',
        kind: 'unique',
        columnIds: ['a'],
      },
    );
    expect(
      nativeTableCanvasRows(f.document, f.table, 'physical').find((row) => row.column.id === 'a')!
        .keys,
    ).toBe('PK FK UQ');
    expect(nativeFormatInitial(f.table).showComment).toBe('true');
  });
  it('offers readonly relationship semantics and a selected contextual domain relationship', () => {
    setLocale('ko');
    const f = fixture();
    const relation = renderToStaticMarkup(
      createElement(NativeTableRelationInspector, { document: f.document, relation: f.relation }),
    );
    expect(relation).toContain('customers (PK) → records (FK)');
    expect(relation).toContain('&lt;Korean 설명&gt;');
    expect(relation).toContain('0..N');
    expect(relation).not.toContain('type="submit"');
    const domain = renderToStaticMarkup(
      createElement(NativeDomainRelationEditor, {
        document: f.document,
        editable: false,
        selectedId: 'dr',
      }),
    );
    expect(domain).toContain('Billing');
    expect(domain).toContain('domain explanation');
    expect(domain).toContain('↔');
    expect(domain).not.toContain('<form');
  });
  it('reads optional shared inspector preferences and mounts the original heading hosts', () => {
    const f = fixture();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'ezerd.inspector' ? 'hidden' : key === 'ezerd.inspectorWidth' ? '480' : null,
    });
    const entry = projectEntry(f.snapshot);
    if (entry.kind !== 'native') throw Error('native expected');
    const html = renderToStaticMarkup(
      createElement(NativeProjectView, { entry, onLeave() {}, onReload() {} }),
    );
    expect(html).toContain('editor-path-host');
    expect(html).toContain('editor-toolbar-host');
    expect(html).toContain('save-controls');
    expect(html).toContain('inspector-closed');
    expect(html).toContain('aria-valuenow="480"');
    expect(html).not.toContain('PROJECT / DOMAIN WORKSPACE');
  });
  it('does not call an unconfirmed queue synchronized or hide preserved local input', () => {
    const status = {
      offline: false,
      saving: false,
      initializing: false,
      pending: false,
      durable: 'empty',
      dirty: false,
      error: false,
    };
    expect(nativeInspectorSaveStatus(status)).toBe('snapshot');
    expect(nativeInspectorSaveStatus({ ...status, dirty: true })).toBe('draft');
    expect(nativeInspectorSaveStatus({ ...status, durable: 'unknown' })).toBe('attention');
    expect(nativeInspectorSaveStatus({ ...status, durable: 'sending' })).toBe('saving');
    expect(nativeInspectorSaveStatus({ ...status, pending: true })).toBe('saving');
    expect(nativeInspectorSaveStatus({ ...status, durable: 'pending' })).toBe('saving');
    expect(nativeInspectorSaveStatus({ ...status, pending: true, saving: true })).toBe('saving');
    expect(nativeInspectorSaveStatus({ ...status, pending: true, offline: true })).toBe('offline');
    expect(nativeInspectorSaveStatus({ ...status, pending: true, error: true })).toBe('attention');
    expect(nativeInspectorSaveStatus({ ...status, offline: true })).toBe('offline');
  });
});
