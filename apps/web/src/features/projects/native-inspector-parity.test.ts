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
