import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NativeTableKey, NativeTableRelation } from '@ezerd/model';
import { nativeEditorCommandSchema, nativeStoredDesignDocumentSchema } from '@ezerd/contracts';
import { setLocale } from '../../shared/i18n/index.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';
import {
  nativeConstraintOptionsInitial,
  nativeConstraintOptionsPatch,
  nativeConstraintOptionsDecision,
} from './native-constraint-options.js';
import { NativeConstraintOptionFields } from './native-constraint-option-fields.js';
import {
  nativeConstraintInitial,
  nativeConstraintCommands,
  nativeStructureCommands,
} from './native-editor-structure.js';
afterEach(() => setLocale('ko'));
const key = (): NativeTableKey => ({
  id: 'k',
  tableId: 't',
  scope: 'physical',
  kind: 'primary',
  name: 'pk',
  columnIds: ['a'],
});
const fk = (): NativeTableRelation => ({
  id: 'r',
  sourceTableId: 't',
  targetTableId: 't',
  scope: 'physical',
  logical: { name: 'relation', cardinality: 'one-to-many', required: false },
  physical: {
    name: 'fk',
    sourceColumnIds: ['b'],
    targetColumnIds: ['a'],
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
});
describe('explicit NONE option patch consumers', () => {
  it('retains nullable wire tokens, refuses explicit undefined, and omits fresh NONE', () => {
    for (const type of ['patch_key', 'patch_foreign_key']) {
      const command = { type, id: 'k', patch: { deferrable: null } };
      expect(nativeEditorCommandSchema.safeParse(command).success).toBe(true);
      expect(JSON.parse(JSON.stringify(command)).patch).toEqual({ deferrable: null });
      expect(
        nativeEditorCommandSchema.safeParse({ type, id: 'k', patch: { deferrable: undefined } })
          .success,
      ).toBe(false);
    }
    const fresh = nativeConstraintOptionsInitial();
    expect(nativeConstraintOptionsPatch('key', fresh)).toEqual({});
    expect(nativeConstraintOptionsPatch('foreignKey', fresh)).toEqual({});
  });
  it.each(['primary', 'unique'] as const)(
    'clears PG %s timing in the candidate and keeps other root/column fields',
    (kind) => {
      const f = advancedFixture(),
        item = {
          ...key(),
          kind,
          deferrable: { initially: 'deferred' as const },
          nullsNotDistinct: false,
        };
      f.document.keys = [item];
      const source = structuredClone(f.document),
        before = nativeConstraintInitial(f.document, 'keys', 'k');
      const patch = nativeConstraintOptionsPatch(
        'key',
        { ...before, deferrability: 'none' },
        before,
        item,
      );
      expect(patch).toEqual({ deferrable: null });
      expect(
        nativeConstraintCommands(
          f.document,
          'keys',
          'k',
          { ...before, deferrability: 'none' },
          before,
        ),
      ).toEqual([{ type: 'patch_key', id: 'k', patch }]);
      const decision = nativeConstraintOptionsDecision(f.document, 'key', item, patch);
      expect(decision).toMatchObject({ allowed: true, usable: true });
      expect(decision.candidate!.keys![0]).not.toHaveProperty('deferrable');
      expect(decision.candidate!.keys![0]).toMatchObject({
        kind,
        columnIds: ['a'],
        nullsNotDistinct: false,
        name: 'pk',
      });
      expect(nativeStoredDesignDocumentSchema.safeParse(decision.candidate).success).toBe(true);
      expect(f.document).toEqual(source);
    },
  );
  it.each(['postgresql', 'sqlite'] as const)(
    'clears existing %s FK root timing while preserving its physical mappings',
    (kind) => {
      const f = advancedFixture(kind),
        item = { ...fk(), deferrable: { initially: 'immediate' as const } };
      f.document.keys = [key()];
      f.document.tableRelations = [item];
      const before = nativeConstraintInitial(f.document, 'tableRelations', 'r'),
        source = structuredClone(f.document);
      const commands = nativeConstraintCommands(
        f.document,
        'tableRelations',
        'r',
        { ...before, deferrability: 'none' },
        before,
      );
      expect(commands).toEqual([
        { type: 'patch_foreign_key', id: 'r', patch: { deferrable: null } },
      ]);
      const decision = nativeConstraintOptionsDecision(f.document, 'foreignKey', item, {
        deferrable: null,
      });
      expect(decision).toMatchObject({ allowed: true, usable: true });
      expect(decision.candidate!.tableRelations![0]).not.toHaveProperty('deferrable');
      expect(decision.candidate!.tableRelations![0]!.physical).toEqual(item.physical);
      expect(f.document).toEqual(source);
    },
  );
  it('allows NONE repair for an unsupported MySQL old root while keeping new timing choices inactive', () => {
    const f = advancedFixture('mysql'),
      item = { ...fk(), deferrable: { initially: 'immediate' as const } };
    f.document.keys = [key()];
    f.document.tableRelations = [item];
    const before = nativeConstraintInitial(f.document, 'tableRelations', 'r');
    expect(
      nativeConstraintCommands(
        f.document,
        'tableRelations',
        'r',
        { ...before, deferrability: 'none' },
        before,
      ),
    ).toEqual([{ type: 'patch_foreign_key', id: 'r', patch: { deferrable: null } }]);
    const html = renderToStaticMarkup(
      createElement(NativeConstraintOptionFields, {
        document: f.document,
        kind: 'foreignKey',
        values: before,
        current: item,
        change: vi.fn(),
      }),
    );
    expect(html).toMatch(/<option value="none">/);
    expect(html).toMatch(/<option value="deferred" disabled=""/);
  });
  it('omits fresh NONE for mapped and derived creation and preserves existing sparse old-root fields', () => {
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
      deferrability: 'none',
    };
    const mapped = nativeStructureCommands(f.document, f.table, 'foreignKey', values);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({ type: 'add_foreign_key' });
    if (mapped[0]!.type !== 'add_foreign_key') throw Error('fixture');
    expect(mapped[0]!.value).not.toHaveProperty('deferrable');
    const derived = nativeStructureCommands(f.document, f.table, 'foreignKey', {
      ...values,
      foreignMode: 'derived',
      primaryKeyId: 'k',
      generatedColumnIds: 'new_b',
    });
    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({ type: 'create_foreign_key' });
    const current = { ...key(), deferrable: { initially: 'deferred' as const } };
    f.document.keys = [current];
    const before = nativeConstraintInitial(f.document, 'keys', 'k');
    delete before.deferrability;
    delete before.nullsNotDistinct;
    expect(
      nativeConstraintCommands(f.document, 'keys', 'k', { ...before, name: 'renamed' }, before),
    ).toEqual([{ type: 'patch_key', id: 'k', patch: { name: 'renamed' } }]);
    expect(
      nativeConstraintCommands(
        f.document,
        'keys',
        'k',
        { ...before, deferrability: 'none' },
        before,
      ),
    ).toEqual([{ type: 'patch_key', id: 'k', patch: { deferrable: null } }]);
    expect(f.document.keys[0]).toEqual(current);
  });
  it('exposes an enabled explicit NONE selection in both languages without auto-emitting a patch', () => {
    const f = advancedFixture(),
      current = { ...key(), deferrable: { initially: 'deferred' as const } },
      values = nativeConstraintOptionsInitial(current),
      change = vi.fn();
    for (const locale of ['ko', 'en'] as const) {
      setLocale(locale);
      const html = renderToStaticMarkup(
        createElement(NativeConstraintOptionFields, {
          document: f.document,
          kind: 'key',
          keyKind: 'primary',
          values,
          current,
          change,
        }),
      );
      expect(html).toContain(locale === 'ko' ? '지연 불가' : 'Not deferrable');
      expect(html).toMatch(/<option value="none">/);
      expect(html).not.toMatch(/<option value="none" disabled=""/);
    }
    expect(change).not.toHaveBeenCalled();
    expect(nativeConstraintOptionsPatch('key', values, values, current)).toEqual({});
    expect(
      nativeConstraintOptionsPatch('key', { ...values, deferrability: 'none' }, values, current),
    ).toEqual({ deferrable: null });
  });
});
