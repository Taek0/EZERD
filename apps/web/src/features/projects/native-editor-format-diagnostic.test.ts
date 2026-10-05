import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLocale } from '../../shared/i18n/index.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';
import {
  NativeFormatEditor,
  nativeFormatInitial,
  nativeFormatDraftIssue,
  nativeFormatCommands,
} from './native-editor-format.js';
import { storeNativeEditorDraft, loadNativeEditorDraft } from './native-editor-draft.js';

afterEach(() => {
  setLocale('ko');
  vi.unstubAllGlobals();
});
const schemaDetails = [
  '&quot;origin&quot;',
  '&quot;path&quot;',
  'too_small',
  'ZodError',
  '(undefined)',
];
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
function render(f: ReturnType<typeof advancedFixture>) {
  return renderToStaticMarkup(
    createElement(NativeFormatEditor, {
      context: f.context,
      document: f.document,
      table: f.table,
      column: f.columns[0]!,
    }),
  );
}
function persist(f: ReturnType<typeof advancedFixture>, values: Record<string, string>) {
  const store = storage();
  vi.stubGlobal('localStorage', store);
  f.snapshot.project.id = crypto.randomUUID();
  const before = nativeFormatInitial(f.table, f.columns[0]!);
  const draft = {
    userId: f.context.userId,
    projectId: f.snapshot.project.id,
    key: 'format:column:a',
    revision: crypto.randomUUID(),
    expected: {
      version: f.snapshot.project.version,
      sequence: f.snapshot.sequence,
      databaseRevision: f.snapshot.project.databaseRevision,
    },
    before,
    values: { ...before, ...values },
  };
  storeNativeEditorDraft(draft);
  return draft;
}
describe('format option condition diagnostics', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'shows bilingual guidance for empty %s computed probes without schema JSON',
    (kind) => {
      const f = advancedFixture(kind),
        original = structuredClone(f.document);
      for (const locale of ['ko', 'en'] as const) {
        setLocale(locale);
        const html = render(f);
        const option = html.match(/<option value="computed:stored"[^>]*>([\s\S]*?)<\/option>/)?.[0];
        expect(option).toContain(
          locale === 'ko'
            ? '식에서 사용할 컬럼을 선택하세요.'
            : 'Select a column for the expression.',
        );
        expect(option).toContain('disabled=""');
        for (const detail of [...schemaDetails, 'expression.column-required'])
          expect(html).not.toContain(detail);
      }
      expect(f.document).toEqual(original);
      expect(f.context.onSave).not.toHaveBeenCalled();
    },
  );
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'retains a missing-column %s generated draft and displays the stable prerequisite',
    (kind) => {
      const f = advancedFixture(kind);
      const draft = persist(f, {
        generationChoice: 'computed:stored',
        generationExpressionMode: 'compare',
        expressionColumn: '',
        expressionValue: '20e',
      });
      const original = structuredClone(draft);
      expect(nativeFormatDraftIssue(f.document, f.table, f.columns[0]!, draft.values)).toBe(
        'expression.column-required',
      );
      for (const locale of ['ko', 'en'] as const) {
        setLocale(locale);
        const html = render(f);
        expect(html).toContain(
          locale === 'ko'
            ? '식에서 사용할 컬럼을 선택하세요.'
            : 'Select a column for the expression.',
        );
        for (const detail of [...schemaDetails, 'expression.column-required'])
          expect(html).not.toContain(detail);
        expect(html).toContain('value="20e"');
        expect(html).toMatch(/type="submit"[^>]*disabled=""/);
      }
      expect(loadNativeEditorDraft(draft.userId, draft.projectId, draft.key)).toEqual(original);
      expect(f.context.onSave).not.toHaveBeenCalled();
    },
  );
  it('preserves legacy JSON-like original text and exact generation/before fields', () => {
    const f = advancedFixture(),
      column = f.columns[0]!;
    const original = '  legacy_call({"origin":"user-original","minimum":1})  ';
    column.physical.defaultValue = { kind: 'legacyExpression', source: 'document-v1', original };
    column.physical.generation = {
      kind: 'identity',
      database: 'postgresql',
      mode: 'always',
      sequence: { start: '+00020', increment: '+0002' },
    };
    const before = nativeFormatInitial(f.table, column),
      source = structuredClone(f.document);
    const html = render(f);
    expect(html).toContain(
      '  legacy_call({&quot;origin&quot;:&quot;user-original&quot;,&quot;minimum&quot;:1})  ',
    );
    expect(html).toContain('start=+00020');
    expect(nativeFormatInitial(f.table, column)).toEqual(before);
    expect(JSON.parse(before.defaultJSON!).original).toBe(original);
    expect(JSON.parse(before.generationJSON!).sequence.start).toBe('+00020');
    expect(nativeFormatCommands(f.document, f.table, column, before, before)).toEqual([]);
    expect(f.document).toEqual(source);
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'uses readable conditions for existing %s default function choices',
    (kind) => {
      const f = advancedFixture(kind),
        column = f.columns[0]!;
      column.physical.defaultValue = {
        kind: 'expression',
        expression: { kind: 'call', functionId: `${kind}:current_timestamp`, args: [] },
      };
      const source = structuredClone(f.document),
        before = nativeFormatInitial(f.table, column);
      for (const locale of ['ko', 'en'] as const) {
        setLocale(locale);
        const html = render(f);
        const lower = html.match(
          new RegExp(`<option value="${kind}:lower"[^>]*>([\\s\\S]*?)<\\/option>`),
        )?.[0];
        expect(lower).toContain(locale === 'ko' ? '인자 입력 필요' : 'Arguments are required');
        for (const detail of [...schemaDetails, '(default.', '(expression.'])
          expect(html).not.toContain(detail);
        expect(html).toContain('CURRENT_TIMESTAMP');
      }
      expect(nativeFormatInitial(f.table, column)).toEqual(before);
      expect(f.document).toEqual(source);
      expect(f.context.onSave).not.toHaveBeenCalled();
    },
  );
  it('uses the same conditions for MySQL ON UPDATE choices while retaining the pending draft', () => {
    const f = advancedFixture('mysql'),
      draft = persist(f, { onUpdateMode: 'function', onUpdateFunction: 'mysql:current_timestamp' });
    for (const locale of ['ko', 'en'] as const) {
      setLocale(locale);
      const html = render(f);
      const lower = html.match(/<option value="mysql:lower"[^>]*>([\s\S]*?)<\/option>/)?.[0];
      expect(lower).toContain(locale === 'ko' ? '인자 입력 필요' : 'Arguments are required');
      for (const detail of [...schemaDetails, '(column.on-update', '(expression.'])
        expect(html).not.toContain(detail);
    }
    expect(loadNativeEditorDraft(draft.userId, draft.projectId, draft.key)).toEqual(draft);
    expect(f.context.onSave).not.toHaveBeenCalled();
  });
});

it('labels MySQL none and preserved numeric defaults plainly in both languages without changing policy', () => {
  const f = advancedFixture('mysql'),
    column = f.columns[0]!;
  column.physical.type = {
    kind: 'builtin',
    database: 'mysql',
    typeId: 'mysql:int',
    parameters: { unsigned: true },
  };
  for (const locale of ['ko', 'en'] as const) {
    setLocale(locale);
    column.physical.defaultValue = { kind: 'none' };
    const none = render(f).match(/<option value="none"[^>]*>([\s\S]*?)<\/option>/)?.[1];
    expect(none).toBe(locale === 'ko' ? '기본값 없음' : 'No default');
    column.physical.defaultValue = { kind: 'literal', literalType: 'number', value: '7' };
    const initial = nativeFormatInitial(f.table, column);
    const current = render(f).match(
      /<option value="literal:number"[^>]*>([\s\S]*?)<\/option>/,
    )?.[1];
    expect(current).toBe(
      locale === 'ko' ? 'literal:number · 현재값 유지' : 'literal:number · Keep current value',
    );
    expect(nativeFormatCommands(f.document, f.table, column, initial, initial)).toEqual([]);
  }
  expect(f.context.onSave).not.toHaveBeenCalled();
});

// These policy tests inspect option props. RAC's SSR hidden select omits disabled
// attributes; the actual common Select is exercised by browser/UI tests.
vi.mock('../../components/ui/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/ui/index.js')>();
  return {
    ...actual,
    Select: ({
      children,
      value,
      disabled,
    }: {
      children: import('react').ReactNode;
      value?: string;
      disabled?: boolean;
    }) => createElement('select', { value, disabled, onChange() {} }, children),
  };
});
