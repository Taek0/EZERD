import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { advancedFixture } from './native-advanced-test-fixtures.js';
import { nativeDefaultChoices, nativeDefaultInput } from './native-editor-option-policy.js';
import {
  NativeFormatEditor,
  nativeFormatCommands,
  nativeFormatInitial,
} from './native-editor-format.js';
describe('XML/jsonpath typed default selector samples', () => {
  it.each([
    ['xml', '<root/>'],
    ['jsonpath', '$.items[0].value'],
  ] as const)(
    '%s offers a checked typedText sample through the existing format selector',
    (name, sample) => {
      const f = advancedFixture(),
        column = f.columns[0]!;
      column.physical.type = {
        kind: 'builtin',
        database: 'postgresql',
        typeId: `postgresql:${name}`,
        parameters: {},
      };
      const choices = nativeDefaultChoices(f.document, f.table, column);
      expect(choices.find((item) => item.choice === 'literal:typedText')).toMatchObject({
        sample,
        engineAllowed: true,
        productUsable: true,
        selectable: true,
      });
      expect(choices.find((item) => item.choice === 'literal:string')).toMatchObject({
        engineAllowed: false,
        selectable: false,
      });
      const markup = renderToStaticMarkup(
        createElement(NativeFormatEditor, {
          context: f.context,
          document: f.document,
          table: f.table,
          column,
        }),
      );
      const option = markup.match(/<option[^>]*value="literal:typedText"[^>]*>/)?.[0];
      expect(option).toBeDefined();
      expect(option).not.toContain('disabled');
      const input = nativeDefaultInput(
        f.document,
        f.table,
        column,
        'literal:typedText',
        sample,
        false,
      );
      expect(input.value).toEqual({ kind: 'literal', literalType: 'typedText', value: sample });
      expect(
        nativeFormatCommands(
          f.document,
          f.table,
          column,
          {
            ...nativeFormatInitial(f.table, column),
            defaultChoice: 'literal:typedText',
            defaultValue: sample,
          },
          nativeFormatInitial(f.table, column),
        ),
      ).toMatchObject([
        { type: 'patch_column', patch: { physical: { defaultValue: input.value } } },
      ]);
    },
  );
  it.each([
    ['xml', "  <r>O'Reilly &amp; 한</r>\n", '<!DOCTYPE r><r/>'],
    ['jsonpath', '$.items[0].value', '$.*'],
  ] as const)(
    '%s retains exact valid input and never offers implicit string casts or excluded syntax',
    (name, raw, bad) => {
      const f = advancedFixture(),
        column = f.columns[0]!;
      column.physical.type = {
        kind: 'builtin',
        database: 'postgresql',
        typeId: `postgresql:${name}`,
        parameters: {},
      };
      const before = structuredClone(f.document);
      expect(
        nativeDefaultInput(f.document, f.table, column, 'literal:typedText', raw, false).value,
      ).toMatchObject({ value: raw });
      expect(() =>
        nativeDefaultInput(f.document, f.table, column, 'literal:string', raw, false),
      ).toThrow('default.type-mismatch');
      expect(() =>
        nativeDefaultInput(f.document, f.table, column, 'literal:typedText', bad, false),
      ).toThrow();
      expect(f.document).toEqual(before);
    },
  );
});
