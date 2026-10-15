vi.mock('./NativeLogicalMode.js', () => ({ useNativeLogicalMode: () => ({ enabled: true }) }));
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advancedFixture } from './native-advanced-test-fixtures.js';
import {
  nativeFormatInitial,
  nativeFormatCommands,
  NativeFormatEditor,
} from './native-editor-format.js';
import { NativeStructureEditor } from './native-editor-structure.js';
import { setLocale } from '../../shared/i18n/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale('ko');
});
describe('native inspector metadata and contextual forms', () => {
  it('edits custom type text and returns to common types without engine reset confirmation', () => {
    const f = advancedFixture('generic'),
      column = f.columns[0]!;
    const before = nativeFormatInitial(f.table, column);
    const commands = nativeFormatCommands(
      f.document,
      f.table,
      column,
      { ...before, typeChoice: 'custom', customName: 'Money<KRW>' },
      before,
    );
    expect(commands[0]).toMatchObject({
      type: 'patch_column',
      patch: { physical: { type: { kind: 'custom', database: 'generic', name: 'Money<KRW>' } } },
    });
    column.physical.type = { kind: 'custom', database: 'generic', name: 'Money<KRW>' };
    const custom = nativeFormatInitial(f.table, column);
    expect(custom.typeChoice).toBe('custom');
    expect(custom.customName).toBe('Money<KRW>');
    expect(
      nativeFormatCommands(
        f.document,
        f.table,
        column,
        { ...custom, typeChoice: 'generic:text' },
        custom,
      )[0],
    ).toMatchObject({ patch: { physical: { type: { kind: 'builtin', typeId: 'generic:text' } } } });
    expect(() =>
      nativeFormatCommands(f.document, f.table, column, { ...custom, customName: '' }, custom),
    ).toThrow();
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'patches %s logical metadata without normalizing physical types or other scopes',
    (kind) => {
      const f = advancedFixture(kind),
        column = f.columns[0]!;
      column.customProperties = {
        common: { owner: 'Finance' },
        logical: { unit: 'KRW' },
        physical: { imported: '<literal>' },
      };
      const original = structuredClone(f.document),
        before = nativeFormatInitial(f.table, column);
      expect(nativeFormatCommands(f.document, f.table, column, before, before)).toEqual([]);
      const commands = nativeFormatCommands(
        f.document,
        f.table,
        column,
        {
          ...before,
          semanticType: 'money',
          required: 'true',
          'metadata:common': JSON.stringify([
            ['owner', 'Accounting'],
            ['audit', 'required'],
          ]),
        },
        before,
      );
      expect(commands).toEqual([
        {
          type: 'patch_column',
          id: column.id,
          patch: {
            logical: { semanticType: 'money', required: true },
            customProperties: {
              common: { owner: 'Accounting', audit: 'required' },
              logical: { unit: 'KRW' },
              physical: { imported: '<literal>' },
            },
          },
        },
      ]);
      expect(f.document).toEqual(original);
    },
  );
  it('uses the canvas style command for color reset and merges only edited display flags', () => {
    const f = advancedFixture();
    f.table.canvasDisplay = { showComment: false };
    const before = nativeFormatInitial(f.table);
    before.color = '#123456';
    const commands = nativeFormatCommands(
      f.document,
      f.table,
      undefined,
      { ...before, color: '', showComment: 'true' },
      before,
    );
    expect(commands).toEqual([
      {
        type: 'patch_canvas_style',
        target: { kind: 'table', id: f.table.id },
        patch: { color: null, canvasDisplay: { showComment: true } },
      },
    ]);
  });
  it.each([
    [
      ['same', 'a'],
      ['same', 'b'],
    ],
    [['', 'a']],
    [['nested', {}]],
  ])('rejects lossy metadata rows %j', (...rows) => {
    const f = advancedFixture(),
      before = nativeFormatInitial(f.table);
    expect(() =>
      nativeFormatCommands(
        f.document,
        f.table,
        undefined,
        { ...before, 'metadata:common': JSON.stringify(rows) },
        before,
      ),
    ).toThrow();
  });
  it.each(['ko', 'en'] as const)(
    'shows custom input and hides engine controls for structural models in %s',
    (locale) => {
      const f = advancedFixture('generic');
      f.columns[0]!.physical.type = { kind: 'custom', database: 'generic', name: 'Money<KRW>' };
      setLocale(locale);
      const html = renderToStaticMarkup(
        createElement(NativeFormatEditor, {
          context: f.context,
          document: f.document,
          table: f.table,
          column: f.columns[0]!,
          mode: 'physical',
        }),
      );
      expect(html).toContain(locale === 'ko' ? '사용자 정의 타입' : 'Custom type');
      expect(html).toContain('Money&lt;KRW&gt;');
      expect(html).not.toContain('Charset');
      expect(html).not.toContain('Collation');
      expect(html).not.toContain('ON UPDATE');
    },
  );
  it('opens logical controls and metadata rows through the existing format draft without physical input controls', () => {
    const f = advancedFixture();
    f.columns[0]!.customProperties.common = { owner: '<Finance>' };
    setLocale('ko');
    const html = renderToStaticMarkup(
      createElement(NativeFormatEditor, {
        context: f.context,
        document: f.document,
        table: f.table,
        column: f.columns[0]!,
        mode: 'logical',
      }),
    );
    expect(html).toContain('의미 타입');
    expect(html).toContain('필수');
    expect(html).toContain('속성 이름 1');
    expect(html).toContain('&lt;Finance&gt;');
    expect(html).not.toContain('타입 선택');
    expect(f.context.onSave).not.toHaveBeenCalled();
  });
  it('opens a contextual creation form with safe defaults while preserving its own durable identity', () => {
    const f = advancedFixture();
    const html = renderToStaticMarkup(
      createElement(NativeStructureEditor, {
        context: f.context,
        document: f.document,
        focused: true,
        initialSelection: { action: 'table', target: '' },
        initialValues: { logicalName: 'New sales', id: 'untrusted-suggested-id', scope: 'logical' },
      }),
    );
    expect(html).toContain('value="New sales"');
    expect(html).not.toContain('untrusted-suggested-id');
    expect(html).not.toContain('aria-label="구조 편집"');
    expect(f.context.onSave).not.toHaveBeenCalled();
  });
});
