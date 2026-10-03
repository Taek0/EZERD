import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NativeTableKey, NativeTableRelation } from '@ezerd/model';
import { nativeEditorCommandSchema, nativeStoredDesignDocumentSchema } from '@ezerd/contracts';
import { setLocale } from '../../shared/i18n/index.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';
import { serializeNativeLabels } from './native-label-draft.js';
import {
  nativeConstraintOptionsInitial,
  nativeConstraintOptionsPatch,
  nativeConstraintOptionsDecision,
  nativeEnumOptionsDecision,
  nativeSelectedArrayPolicy,
  nativeSridParameterDecision,
} from './native-constraint-options.js';
import {
  NativeConstraintOptionFields,
  NativeEnumOptionSummary,
  NativeSridParameterField,
} from './native-constraint-option-fields.js';
import {
  nativeConstraintInitial,
  nativeConstraintCommands,
  nativeStructureCommands,
  NativeStructureEditor,
} from './native-editor-structure.js';
import {
  nativeFormatInitial,
  nativeFormatCommands,
  NativeFormatEditor,
} from './native-editor-format.js';
afterEach(() => setLocale('ko'));
function key(): NativeTableKey {
  return {
    id: 'k',
    tableId: 't',
    scope: 'physical',
    name: 'key_a',
    kind: 'primary',
    columnIds: ['a'],
  };
}
function relation(): NativeTableRelation {
  return {
    id: 'r',
    scope: 'physical',
    sourceTableId: 't',
    targetTableId: 't',
    logical: { name: 'relation', cardinality: 'one-to-many', required: false },
    physical: {
      name: 'fk_b_a',
      sourceColumnIds: ['b'],
      targetColumnIds: ['a'],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    },
  };
}
describe('native missing constraint option consumers', () => {
  it('consumes the shared verified SRID rules without promoting current readiness', () => {
    const f = advancedFixture('mysql'),
      column = f.columns[0]!;
    column.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:point',
      parameters: { srid: 999999 },
    };
    const source = structuredClone(f.document);
    for (const token of ['0', '4326'])
      expect(nativeSridParameterDecision(f.document, column, 'mysql:point', token)).toMatchObject({
        allowed: true,
        usable: true,
      });
    expect(nativeSridParameterDecision(f.document, column, 'mysql:point', '999998')).toMatchObject({
      allowed: false,
      usable: false,
      code: 'type.srid-unverified',
    });
    expect(nativeSridParameterDecision(f.document, column, 'mysql:point', '20e').allowed).toBe(
      false,
    );
    expect(nativeSridParameterDecision(f.document, column, 'mysql:int', '0')).toMatchObject({
      allowed: false,
      code: 'type.option-not-supported',
    });
    expect(f.document).toEqual(source);
    f.table.scope = 'logical';
    column.scope = 'logical';
    expect(nativeSridParameterDecision(f.document, column, 'mysql:point', '999998').code).toBe(
      'type.srid-unverified',
    );
  });
  it('preserves an unverified stored SRID while blocking new unverified parameters and allowing explicit removal', () => {
    const f = advancedFixture('mysql'),
      column = f.columns[0]!;
    column.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:point',
      parameters: { srid: 999999 },
    };
    const before = nativeFormatInitial(f.table, column),
      source = structuredClone(f.document);
    expect(nativeFormatCommands(f.document, f.table, column, before, before)).toEqual([]);
    expect(
      nativeFormatCommands(f.document, f.table, column, { ...before, nullable: 'true' }, before),
    ).toEqual([{ type: 'patch_column', id: 'a', patch: { physical: { nullable: true } } }]);
    expect(() =>
      nativeFormatCommands(
        f.document,
        f.table,
        column,
        { ...before, 'parameter:srid': '999998', confirmTypeReset: 'true' },
        before,
      ),
    ).toThrow('type.srid-unverified');
    expect(
      nativeFormatCommands(
        f.document,
        f.table,
        column,
        { ...before, 'parameter:srid': '4326', confirmTypeReset: 'true' },
        before,
      ),
    ).toMatchObject([{ patch: { physical: { type: { parameters: { srid: 4326 } } } } }]);
    expect(
      nativeFormatCommands(
        f.document,
        f.table,
        column,
        { ...before, 'parameter:srid': '', confirmTypeReset: 'true' },
        before,
      ),
    ).toMatchObject([{ type: 'patch_column', patch: { physical: { type: { parameters: {} } } } }]);
    expect(f.document).toEqual(source);
  });
  it('shows bilingual SRID guidance and preserves the current selection without schema details', () => {
    const f = advancedFixture('mysql'),
      column = f.columns[0]!,
      change = vi.fn();
    column.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:point',
      parameters: { srid: 999999 },
    };
    for (const locale of ['ko', 'en'] as const) {
      setLocale(locale);
      const html = renderToStaticMarkup(
        createElement(NativeSridParameterField, {
          document: f.document,
          column,
          typeId: 'mysql:point',
          value: '999999',
          onChange: change,
        }),
      );
      expect(html).toMatch(/<option value="999999" disabled="" selected=""/);
      expect(html).toContain('SRID 0');
      expect(html).toContain('SRID 4326');
      expect(html).toContain(
        locale === 'ko'
          ? '공간 참조계는 검증된 SRID 0 또는 4326을 사용하세요.'
          : 'Use verified spatial reference SRID 0 or 4326.',
      );
      expect(html).not.toContain('type.srid-unverified');
      expect(html).not.toContain('ZodError');
      const form = renderToStaticMarkup(
        createElement(NativeFormatEditor, {
          context: f.context,
          document: f.document,
          table: f.table,
          column,
        }),
      );
      expect(form).toContain(
        locale === 'ko' ? '공간 참조계 (SRID)' : 'Spatial reference system (SRID)',
      );
      expect(form).toContain('value="999999"');
      expect(form).not.toContain('type.srid-unverified');
    }
    expect(change).not.toHaveBeenCalled();
  });
  it('prepares minimal typed options, preserves explicit false and prepares explicit nullable removal', () => {
    const current = { deferrable: { initially: 'immediate' as const }, nullsNotDistinct: true },
      before = nativeConstraintOptionsInitial(current);
    expect(nativeConstraintOptionsPatch('key', before, before, current)).toEqual({});
    const patch = nativeConstraintOptionsPatch(
      'key',
      { ...before, deferrability: 'deferred', nullsNotDistinct: 'false' },
      before,
      current,
    );
    expect(patch).toEqual({ deferrable: { initially: 'deferred' }, nullsNotDistinct: false });
    expect(nativeEditorCommandSchema.safeParse({ type: 'patch_key', id: 'k', patch }).success).toBe(
      true,
    );
    expect(
      nativeConstraintOptionsPatch('key', { ...before, deferrability: 'none' }, before, current),
    ).toEqual({ deferrable: null });
    expect(() => nativeConstraintOptionsPatch('key', { nullsNotDistinct: 'unfinished' })).toThrow(
      'native.boolean-invalid',
    );
  });
  it.each(['primary', 'unique'] as const)(
    'uses real PG %s deferrability policy and prepares activated patches',
    (kind) => {
      const f = advancedFixture(),
        item = { ...key(), kind };
      f.document.keys = [item];
      const source = structuredClone(f.document),
        patch = { deferrable: { initially: 'deferred' as const } };
      const decision = nativeConstraintOptionsDecision(f.document, 'key', item, patch);
      expect(decision.allowed).toBe(true);
      expect(decision.usable).toBe(true);
      expect(decision.candidate?.keys?.[0]).toMatchObject(patch);
      const before = nativeConstraintInitial(f.document, 'keys', 'k');
      expect(
        nativeConstraintCommands(
          f.document,
          'keys',
          'k',
          { ...before, deferrability: 'deferred' },
          before,
        ),
      ).toEqual([{ type: 'patch_key', id: 'k', patch: { deferrable: { initially: 'deferred' } } }]);
      expect(
        nativeConstraintCommands(f.document, 'keys', 'k', { ...before, name: 'renamed' }, before),
      ).toEqual([{ type: 'patch_key', id: 'k', patch: { name: 'renamed' } }]);
      expect(f.document).toEqual(source);
    },
  );
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'checks actual %s key and FK unions without raising flags',
    (kind) => {
      const f = advancedFixture(kind),
        item = key(),
        fk = relation();
      f.document.keys = [item];
      f.document.tableRelations = [fk];
      const source = structuredClone(f.document),
        patch = { deferrable: { initially: 'immediate' as const } };
      const fkDecision = nativeConstraintOptionsDecision(f.document, 'foreignKey', fk, patch);
      expect(fkDecision.allowed).toBe(kind !== 'mysql');
      expect(fkDecision.usable).toBe(kind !== 'mysql');
      if (kind === 'mysql')
        expect(fkDecision.issues.some((i) => i.code === 'feature.not-supported')).toBe(true);
      f.document.tableRelations = [];
      const keyDecision = nativeConstraintOptionsDecision(f.document, 'key', item, patch);
      expect(keyDecision.allowed).toBe(kind === 'postgresql');
      expect(keyDecision.usable).toBe(kind === 'postgresql');
      if (kind !== 'postgresql') expect(keyDecision.code).toBe('key.deferrable-not-supported');
      expect(source.tableRelations?.[0]).toEqual(fk);
      const html = renderToStaticMarkup(
        createElement(NativeConstraintOptionFields, {
          document: f.document,
          kind: 'foreignKey',
          values: nativeConstraintOptionsInitial(),
          change: vi.fn(),
          disabled: true,
        }),
      );
      expect(html.includes('제약 검사 시점')).toBe(kind !== 'mysql');
    },
  );
  it('requires PG UNIQUE for NULLS NOT DISTINCT and preserves untouched root options in patches', () => {
    const f = advancedFixture(),
      item = {
        ...key(),
        kind: 'unique' as const,
        deferrable: { initially: 'deferred' as const },
        nullsNotDistinct: false,
      };
    f.document.keys = [item];
    expect(
      nativeConstraintOptionsDecision(f.document, 'key', item, { nullsNotDistinct: true }),
    ).toMatchObject({ allowed: true, usable: true });
    const primary = { ...item, kind: 'primary' as const };
    expect(
      nativeConstraintOptionsDecision(f.document, 'key', primary, { nullsNotDistinct: true }).code,
    ).toBe('key.nulls-policy-requires-unique');
    const before = nativeConstraintInitial(f.document, 'keys', 'k');
    expect(before.deferrability).toBe('deferred');
    expect(before.nullsNotDistinct).toBe('false');
    expect(
      nativeConstraintCommands(f.document, 'keys', 'k', { ...before, name: 'renamed' }, before),
    ).toEqual([{ type: 'patch_key', id: 'k', patch: { name: 'renamed' } }]);
    expect(f.document.keys[0]).toEqual(item);
  });
  it('connects options to creation and existing root recovery forms with bilingual removal guidance', () => {
    const f = advancedFixture();
    f.document.keys = [
      { ...key(), kind: 'unique', deferrable: { initially: 'deferred' }, nullsNotDistinct: true },
    ];
    for (const locale of ['ko', 'en'] as const) {
      setLocale(locale);
      const existing = renderToStaticMarkup(
        createElement(NativeStructureEditor, {
          context: f.context,
          document: f.document,
          table: f.table,
          initialSelection: { action: 'patch', target: JSON.stringify(['keys', 'k']) },
        }),
      );
      expect(existing).toContain(locale === 'ko' ? '제약 검사 시점' : 'Constraint check timing');
      expect(existing).toContain(
        locale === 'ko' ? 'NULL을 같은 값으로 취급' : 'Treat NULL values as equal',
      );
      expect(existing).toMatch(/<option value="none">/);
      expect(existing).not.toMatch(/<option value="none" disabled=""/);
      const created = renderToStaticMarkup(
        createElement(NativeStructureEditor, {
          context: f.context,
          document: f.document,
          table: f.table,
          initialSelection: { action: 'foreignKey', target: '' },
        }),
      );
      expect(created).toContain(locale === 'ko' ? '제약 검사 시점' : 'Constraint check timing');
    }
    expect(f.context.onSave).not.toHaveBeenCalled();
  });
  it('prepares mapped and derived FK root timing with actual readiness', () => {
    const f = advancedFixture();
    f.document.keys = [key()];
    const values = {
      id: 'r',
      scope: 'physical',
      name: 'fk',
      foreignMode: 'mapped',
      columnIds: 'b',
      targetTableId: 't',
      targetColumnIds: 'a',
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
      deferrability: 'deferred',
    };
    expect(nativeStructureCommands(f.document, f.table, 'foreignKey', values)).toMatchObject([
      { type: 'add_foreign_key', value: { deferrable: { initially: 'deferred' } } },
    ]);
    expect(
      nativeStructureCommands(f.document, f.table, 'foreignKey', {
        ...values,
        foreignMode: 'derived',
        primaryKeyId: 'k',
        generatedColumnIds: 'new_b',
      }),
    ).toEqual([
      {
        type: 'create_foreign_key',
        primaryTableId: 't',
        foreignTableId: 't',
        primaryKeyId: 'k',
        relationId: 'r',
        columnIds: ['new_b'],
      },
      { type: 'patch_foreign_key', id: 'r', patch: { deferrable: { initially: 'deferred' } } },
    ]);
  });
  it('preserves FK mappings when renaming and emits explicit nullable timing removal', () => {
    const f = advancedFixture(),
      fk = { ...relation(), deferrable: { initially: 'deferred' as const } };
    f.document.keys = [key()];
    f.document.tableRelations = [fk];
    const before = nativeConstraintInitial(f.document, 'tableRelations', 'r');
    expect(before.deferrability).toBe('deferred');
    expect(
      nativeConstraintCommands(
        f.document,
        'tableRelations',
        'r',
        { ...before, name: 'renamed' },
        before,
      ),
    ).toEqual([{ type: 'patch_foreign_key', id: 'r', patch: { physical: { name: 'renamed' } } }]);
    expect(
      nativeConstraintCommands(
        f.document,
        'tableRelations',
        'r',
        { ...before, deferrability: 'none' },
        before,
      ),
    ).toEqual([{ type: 'patch_foreign_key', id: 'r', patch: { deferrable: null } }]);
    expect(f.document.tableRelations[0]).toEqual(fk);
  });
  it('checks exact enum UTF-8 namespace/label boundaries with actual activated product availability', () => {
    const f = advancedFixture();
    const valid = nativeEnumOptionsDecision(
      f.document,
      'e',
      'state',
      '',
      serializeNativeLabels(['가'.repeat(21)]),
    );
    expect(valid).toMatchObject({ allowed: true, usable: true, byteCounts: [63] });
    expect(
      nativeEnumOptionsDecision(
        f.document,
        'e',
        'state',
        '',
        serializeNativeLabels(['가'.repeat(22)]),
      ),
    ).toMatchObject({
      allowed: false,
      code: 'enum.values-invalid',
      byteCounts: [66],
    });
    expect(
      nativeEnumOptionsDecision(
        f.document,
        'e',
        'state',
        'x'.repeat(64),
        serializeNativeLabels(['a']),
      ).allowed,
    ).toBe(false);
    expect(
      nativeEnumOptionsDecision(f.document, 'e', 'state', '', serializeNativeLabels(['a', 'a']))
        .code,
    ).toBe('enum.values-invalid');
    const html = renderToStaticMarkup(
      createElement(NativeEnumOptionSummary, {
        document: f.document,
        id: 'e',
        name: 'state',
        schema: '',
        text: serializeNativeLabels(['가'.repeat(21)]),
      }),
    );
    expect(html).toContain('63바이트');
    expect(html).not.toContain('enum.values-invalid');
  });
  it('preserves engine-valid empty/newline labels using exact arrays and rejects old text edits', () => {
    const f = advancedFixture();
    f.document.enums = [{ id: 'e', name: 'state', schema: '', values: ['', 'line\nbreak'] }];
    expect(nativeStoredDesignDocumentSchema.safeParse(f.document).success).toBe(true);
    const before = nativeConstraintInitial(f.document, 'enums', 'e');
    const status = nativeEnumOptionsDecision(f.document, 'e', 'state', '', before.enumLabelsJSON!);
    expect(status).toMatchObject({ allowed: true, usable: true, byteCounts: [0, 10] });
    expect(
      nativeConstraintCommands(f.document, 'enums', 'e', { ...before, name: 'renamed' }, before),
    ).toEqual([{ type: 'patch_enum', id: 'e', patch: { name: 'renamed' } }]);
    expect(() =>
      nativeConstraintCommands(
        f.document,
        'enums',
        'e',
        { ...before, enumValues: 'replacement' },
        before,
      ),
    ).toThrow('native.labels-draft-upgrade-required');
    const my = advancedFixture('mysql'),
      column = my.columns[0]!;
    column.physical.type = {
      kind: 'valueList',
      database: 'mysql',
      typeId: 'mysql:enum',
      values: ['', 'x\ny'],
    };
    column.physical.options = { database: 'mysql', collation: 'utf8mb4_bin' };
    const initial = nativeFormatInitial(my.table, column);
    expect(nativeFormatCommands(my.document, my.table, column, initial, initial)).toEqual([]);
    expect(() =>
      nativeFormatCommands(
        my.document,
        my.table,
        column,
        { ...initial, values: 'replacement' },
        initial,
      ),
    ).toThrow('native.labels-draft-upgrade-required');
    expect(column.physical.type.values).toEqual(['', 'x\ny']);
    const commands = nativeFormatCommands(
      my.document,
      my.table,
      column,
      { ...initial, typeChoice: 'mysql:set', confirmTypeReset: 'true' },
      initial,
    );
    expect(commands).toMatchObject([
      {
        type: 'patch_column',
        patch: {
          physical: { type: { kind: 'valueList', typeId: 'mysql:set', values: ['', 'x\ny'] } },
        },
      },
    ]);
  });
  it('uses selected enum array facts without the previous builtin typeId and excludes unsupported DB enum menus', () => {
    const f = advancedFixture();
    f.document.enums = [{ id: 'e', name: 'state', schema: '', values: ['a'] }];
    expect(
      nativeSelectedArrayPolicy(f.document, f.table, f.columns[0]!, 'enum:e', true),
    ).toMatchObject({ supported: true, usable: true });
    expect(
      nativeSelectedArrayPolicy(f.document, f.table, f.columns[0]!, 'postgresql:integer', true),
    ).toMatchObject({ supported: true, usable: true });
    const my = advancedFixture('mysql');
    expect(
      nativeSelectedArrayPolicy(my.document, my.table, my.columns[0]!, 'mysql:int'),
    ).toMatchObject({ supported: false, usable: false });
    const html = renderToStaticMarkup(
      createElement(NativeStructureEditor, {
        context: my.context,
        document: my.document,
        table: my.table,
      }),
    );
    expect(html).toMatch(/<option value="enum" disabled=""/);
  });
});
