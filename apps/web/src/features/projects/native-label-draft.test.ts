import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLocale } from '../../shared/i18n/index.js';
import {
  serializeNativeLabels,
  parseNativeLabels,
  addNativeLabel,
  changeNativeLabel,
  moveNativeLabel,
  removeNativeLabel,
  nativeLabelsForCommand,
  nativeLabelsFromLines,
} from './native-label-draft.js';
import { NativeLabelFields } from './NativeLabelFields.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';
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
import {
  storeNativeEditorDraft,
  loadNativeEditorDraft,
  rebaseNativeEditorDraft,
} from './native-editor-draft.js';
afterEach(() => {
  setLocale('ko');
  vi.unstubAllGlobals();
});
const originals = ['', 'line\nbreak', 'CR\rLF\r\n', ' leading', '😀', 'x\"\\\t'];
describe('exact ordered label drafts and consumers', () => {
  it('parses bulk paste in order, ignoring blank separators without trimming labels', () => {
    expect(
      parseNativeLabels(nativeLabelsFromLines(' first \r\n\r\nsecond\nthird\rfourth\r\n')),
    ).toEqual([' first ', 'second', 'third', 'fourth']);
    expect(parseNativeLabels(nativeLabelsFromLines(' \nfirst\nfirst'))).toEqual([
      ' ',
      'first',
      'first',
    ]);
    expect(parseNativeLabels(nativeLabelsFromLines('\r\n\n'))).toEqual([]);
    expect(parseNativeLabels(nativeLabelsFromLines(''))).toEqual([]);
    expect(() => nativeLabelsFromLines(Array(1001).fill('value').join('\n'))).toThrow();
  });
  it.each(['ko', 'en'] as const)(
    'renders one bulk textarea for ordinary values in %s',
    (locale) => {
      setLocale(locale);
      const change = vi.fn();
      const html = renderToStaticMarkup(
        createElement(NativeLabelFields, {
          value: serializeNativeLabels(['first', ' second ']),
          onChange: change,
        }),
      );
      expect((html.match(/<textarea/g) ?? []).length).toBe(1);
      expect(html).toContain('first\n second ');
      expect(html).toContain(locale === 'ko' ? '값 목록 (한 줄에 하나)' : 'Values (one per line)');
      expect(change).not.toHaveBeenCalled();
    },
  );
  it('uses the same bulk arrays in ENUM creation and editing commands', () => {
    const f = advancedFixture();
    f.document.enums = [{ id: 'e', name: 'state', schema: '', values: ['old'] }];
    const raw = nativeLabelsFromLines('new\r\nother\r\n');
    const before = nativeConstraintInitial(f.document, 'enums', 'e');
    expect(
      nativeStructureCommands(f.document, undefined, 'enum', {
        id: 'fresh',
        name: 'fresh',
        schema: '',
        enumLabelsJSON: raw,
      }),
    ).toMatchObject([{ type: 'add_enum', value: { values: ['new', 'other'] } }]);
    expect(
      nativeConstraintCommands(
        f.document,
        'enums',
        'e',
        { ...before, enumLabelsJSON: raw },
        before,
      ),
    ).toEqual([{ type: 'patch_enum', id: 'e', patch: { values: ['new', 'other'] } }]);
  });
  it('roundtrips exact raw arrays and distinguishes no labels from one empty label', () => {
    const raw = serializeNativeLabels(originals);
    expect(parseNativeLabels(raw)).toEqual(originals);
    expect(parseNativeLabels(serializeNativeLabels([]))).toEqual([]);
    expect(parseNativeLabels(addNativeLabel('[]'))).toEqual(['']);
    expect(parseNativeLabels(moveNativeLabel(raw, 1, -1))).toEqual([
      originals[1],
      originals[0],
      ...originals.slice(2),
    ]);
    expect(parseNativeLabels(changeNativeLabel(raw, 0, 'a\nb'))).toEqual([
      'a\nb',
      ...originals.slice(1),
    ]);
    expect(parseNativeLabels(removeNativeLabel(raw, 1))).toEqual([
      originals[0],
      ...originals.slice(2),
    ]);
    expect(parseNativeLabels(raw)).toEqual(originals);
  });
  it.each(['{broken', '{}', '[1]', '[null]', '{"values":["a"]}'])(
    'rejects malformed %s without transforming the stored draft',
    (raw) => {
      expect(() => parseNativeLabels(raw)).toThrow('native.labels-draft-invalid');
      const change = vi.fn(),
        html = renderToStaticMarkup(
          createElement(NativeLabelFields, { value: raw, onChange: change }),
        );
      expect(html).toContain('원문은 보존됩니다.');
      expect(html).not.toContain('ZodError');
      expect(html).not.toContain('<textarea');
      expect(change).not.toHaveBeenCalled();
    },
  );
  it('enforces raw budgets and safe positions without coercion, trimming or duplicate filtering', () => {
    expect(parseNativeLabels('["a","a",""]')).toEqual(['a', 'a', '']);
    expect(() => serializeNativeLabels(Array(1001).fill('a'))).toThrow();
    expect(() => parseNativeLabels(' '.repeat(1600000))).toThrow('native.labels-draft-too-large');
    expect(() => changeNativeLabel('["a"]', -1, 'b')).toThrow('native.label-position-invalid');
    expect(() => moveNativeLabel('["a"]', 0, -1)).toThrow('native.label-position-invalid');
  });
  it.each(['ko', 'en'] as const)(
    'renders individual empty/multiline labels with ordered readonly %s controls',
    (locale) => {
      setLocale(locale);
      const change = vi.fn();
      const html = renderToStaticMarkup(
        createElement(NativeLabelFields, {
          value: serializeNativeLabels(['', 'line\nbreak']),
          onChange: change,
          disabled: true,
        }),
      );
      expect((html.match(/<textarea/g) ?? []).length).toBe(2);
      expect(html).toContain('line\nbreak');
      expect(html).toContain(locale === 'ko' ? '빈 문자열' : 'Empty string');
      expect(html).toContain(locale === 'ko' ? '값 2개' : '2 values');
      expect(html).toContain('<fieldset disabled="">');
      expect(html).not.toContain('[&quot;');
      expect(change).not.toHaveBeenCalled();
    },
  );
  it('caps new SET rows at64 without dropping an oversized repair draft', () => {
    const raw = serializeNativeLabels(Array.from({ length: 65 }, (_, i) => String(i)));
    const html = renderToStaticMarkup(
      createElement(NativeLabelFields, { value: raw, onChange: vi.fn(), maxItems: 64 }),
    );
    expect((html.match(/<textarea/g) ?? []).length).toBe(1);
    expect(html).toMatch(/disabled=""[^>]*>[\s\S]*?빈 문자열 추가/);
    expect(parseNativeLabels(raw)).toHaveLength(65);
    expect(
      parseNativeLabels(
        nativeLabelsFromLines(Array.from({ length: 64 }, (_, i) => String(i)).join('\n'), 64),
      ),
    ).toHaveLength(64);
    expect(() => nativeLabelsFromLines(parseNativeLabels(raw).join('\n'), 64)).toThrow(
      'native.labels-draft-invalid',
    );
    expect(parseNativeLabels(raw)).toHaveLength(65);
  });
  it('prepares exact PG ENUM add/patch and leaves malformed unchanged fields/source intact on rename', () => {
    const f = advancedFixture();
    f.document.enums = [{ id: 'e', name: 'state', schema: '', values: ['', 'line\nbreak'] }];
    const before = nativeConstraintInitial(f.document, 'enums', 'e'),
      source = structuredClone(f.document),
      values = ['line\nbreak', '', 'new'];
    expect(parseNativeLabels(before.enumLabelsJSON!)).toEqual(source.enums![0]!.values);
    expect(
      nativeConstraintCommands(
        f.document,
        'enums',
        'e',
        { ...before, enumLabelsJSON: serializeNativeLabels(values) },
        before,
      ),
    ).toEqual([{ type: 'patch_enum', id: 'e', patch: { values } }]);
    expect(
      nativeStructureCommands(f.document, undefined, 'enum', {
        id: 'fresh',
        name: 'fresh',
        schema: '',
        enumLabelsJSON: serializeNativeLabels(['']),
      }),
    ).toMatchObject([{ type: 'add_enum', value: { values: [''] } }]);
    const broken = { ...before, enumLabelsJSON: '{raw' };
    expect(
      nativeConstraintCommands(f.document, 'enums', 'e', { ...broken, name: 'renamed' }, broken),
    ).toEqual([{ type: 'patch_enum', id: 'e', patch: { name: 'renamed' } }]);
    expect(() =>
      nativeConstraintCommands(
        f.document,
        'enums',
        'e',
        { ...before, enumLabelsJSON: '{raw' },
        before,
      ),
    ).toThrow('native.labels-draft-invalid');
    expect(f.document).toEqual(source);
    const html = renderToStaticMarkup(
      createElement(NativeStructureEditor, {
        context: f.context,
        document: f.document,
        table: f.table,
        initialSelection: { action: 'patch', target: JSON.stringify(['enums', 'e']) },
      }),
    );
    expect((html.match(/<textarea/g) ?? []).length).toBe(2);
    expect(html).toContain('line\nbreak');
    expect(f.context.onSave).not.toHaveBeenCalled();
  });
  it.each(['mysql:enum', 'mysql:set'] as const)(
    'prepares exact %s arrays using verified binary collation and current type-reset protection',
    (typeId) => {
      const f = advancedFixture('mysql'),
        column = f.columns[0]!;
      column.physical.options = { database: 'mysql', collation: 'utf8mb4_bin' };
      column.physical.type = {
        kind: 'valueList',
        database: 'mysql',
        typeId,
        values: ['', 'line\nbreak'],
      };
      const before = nativeFormatInitial(f.table, column),
        source = structuredClone(f.document),
        labels = ['line\nbreak', '', 'é'];
      expect(nativeFormatCommands(f.document, f.table, column, before, before)).toEqual([]);
      expect(() =>
        nativeFormatCommands(
          f.document,
          f.table,
          column,
          { ...before, labelsJSON: serializeNativeLabels(labels) },
          before,
        ),
      ).toThrow('native.type-reset-review-required');
      expect(
        nativeFormatCommands(
          f.document,
          f.table,
          column,
          { ...before, labelsJSON: serializeNativeLabels(labels), confirmTypeReset: 'true' },
          before,
        ),
      ).toMatchObject([
        { type: 'patch_column', patch: { physical: { type: { typeId, values: labels } } } },
      ]);
      expect(() =>
        nativeFormatCommands(
          f.document,
          f.table,
          column,
          { ...before, labelsJSON: '{"wrong":[]}', confirmTypeReset: 'true' },
          before,
        ),
      ).toThrow('native.labels-draft-invalid');
      const html = renderToStaticMarkup(
        createElement(NativeFormatEditor, {
          context: f.context,
          document: f.document,
          table: f.table,
          column,
        }),
      );
      expect((html.match(/<textarea/g) ?? []).length).toBe(2);
      expect(html).toContain('line\nbreak');
      expect(f.document).toEqual(source);
    },
  );
  it('keeps common PG bytes/MySQL charset, length, trailing-space, collation and SET restrictions', () => {
    const f = advancedFixture();
    f.document.enums = [{ id: 'e', name: 'state', schema: '', values: ['a'] }];
    const before = nativeConstraintInitial(f.document, 'enums', 'e');
    expect(() =>
      nativeConstraintCommands(
        f.document,
        'enums',
        'e',
        { ...before, enumLabelsJSON: serializeNativeLabels(['가'.repeat(22)]) },
        before,
      ),
    ).toThrow('enum.values-invalid');
    const my = advancedFixture('mysql'),
      column = my.columns[0]!;
    column.physical.options = { database: 'mysql', collation: 'utf8mb4_bin' };
    column.physical.type = {
      kind: 'valueList',
      database: 'mysql',
      typeId: 'mysql:set',
      values: ['a'],
    };
    const initial = nativeFormatInitial(my.table, column);
    const build = (labels: string[]) =>
      nativeFormatCommands(
        my.document,
        my.table,
        column,
        { ...initial, labelsJSON: serializeNativeLabels(labels), confirmTypeReset: 'true' },
        initial,
      );
    for (const labels of [
      ['a,b'],
      Array.from({ length: 65 }, (_, i) => String(i)),
      ['a', 'a'],
      ['bad\0value'],
    ])
      expect(() => build(labels)).toThrow();
    expect(() => build(['x'.repeat(256)])).toThrow('mysql.value-list-label-too-long');
    expect(() => build(['trailing '])).toThrow('mysql.value-list-trailing-space');
    column.physical.options = { database: 'mysql', collation: 'utf8mb4_0900_ai_ci' };
    const ci = nativeFormatInitial(my.table, column);
    expect(() =>
      nativeFormatCommands(
        my.document,
        my.table,
        column,
        { ...ci, labelsJSON: serializeNativeLabels(['é', 'e']), confirmTypeReset: 'true' },
        ci,
      ),
    ).toThrow('mysql.value-list-collation-unverified');
  });
  it('preserves old archive strings and rejects edited legacy text without newline reparsing', () => {
    const labels = ['', 'line\nbreak'],
      before = { enumValues: '\nline\nbreak' };
    expect(nativeLabelsForCommand(before, before, 'enumLabelsJSON', 'enumValues', labels)).toEqual(
      labels,
    );
    expect(() =>
      nativeLabelsForCommand(
        { enumValues: 'replacement' },
        before,
        'enumLabelsJSON',
        'enumValues',
        labels,
      ),
    ).toThrow('native.labels-draft-upgrade-required');
    const onChange = vi.fn(),
      html = renderToStaticMarkup(
        createElement(NativeLabelFields, { value: '["latest"]', legacyDraft: true, onChange }),
      );
    expect(html).toContain('자동으로 값을 분리하지 않습니다.');
    expect(html).not.toContain('<textarea');
    expect(onChange).not.toHaveBeenCalled();
  });
  it('stores malformed/exact JSON under the original actor/project and preserves before/counters on rebase', () => {
    const data = new Map<string, string>(),
      storage = {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          data.set(k, v);
        },
        removeItem: (k: string) => {
          data.delete(k);
        },
      };
    const f = advancedFixture(),
      initial = serializeNativeLabels(['']),
      raw = serializeNativeLabels(originals);
    const draft = {
      userId: f.context.userId,
      projectId: f.snapshot.project.id,
      key: 'constraint:enums:e',
      revision: crypto.randomUUID(),
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      before: { enumLabelsJSON: initial },
      values: { enumLabelsJSON: raw },
    };
    storeNativeEditorDraft(draft, storage);
    expect(loadNativeEditorDraft(draft.userId, draft.projectId, draft.key, storage)).toEqual(draft);
    expect(
      loadNativeEditorDraft(crypto.randomUUID(), draft.projectId, draft.key, storage),
    ).toBeNull();
    const fresh = rebaseNativeEditorDraft(
      draft,
      { version: 8, sequence: 11, databaseRevision: 3 },
      { enumLabelsJSON: '["latest"]' },
    );
    expect(fresh.values.enumLabelsJSON).toBe(raw);
    expect(fresh.before.enumLabelsJSON).toBe('["latest"]');
    expect(fresh.revision).not.toBe(draft.revision);
    expect(() =>
      rebaseNativeEditorDraft(draft, { ...draft.expected, databaseRevision: 4 }, {}),
    ).toThrow('database.context-changed');
    const malformed = { ...draft, values: { enumLabelsJSON: '{original' } };
    storeNativeEditorDraft(malformed, storage);
    expect(loadNativeEditorDraft(draft.userId, draft.projectId, draft.key, storage)).toEqual(
      malformed,
    );
  });
});
