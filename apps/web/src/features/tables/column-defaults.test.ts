import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Column } from '@ezerd/model';
import {
  applyColumnDefault,
  columnDefaultOptions,
  patchColumnPhysical,
} from './column-defaults.js';
import { ColumnDefaultControl } from './TableEditor.js';

const physical = (name: string): Column['physical'] => ({
  name: 'value',
  type: { name, isArray: false },
  nullable: true,
  comment: '',
  defaultExpression: null,
});
describe('column defaults', () => {
  it.each([
    ['timestamp', 'now()'],
    ['timestamptz', 'CURRENT_TIMESTAMP'],
    ['date', 'CURRENT_DATE'],
    ['time', 'CURRENT_TIME'],
    ['timetz', 'CURRENT_TIME'],
    ['boolean', 'FALSE'],
    ['text', "''"],
    ['uuid', 'gen_random_uuid()'],
    ['integer', '0'],
  ])('offers a supported default for %s', (name, value) => {
    expect(columnDefaultOptions(physical(name)).map((option) => option.value)).toContain(value);
  });
  it('distinguishes fixed 1 from the sequence starting at 1 and can turn automatic numbering off', () => {
    for (const [name, serial] of [
      ['integer', 'serial'],
      ['bigint', 'bigserial'],
      ['smallint', 'smallserial'],
    ]) {
      const value = physical(name!);
      expect(applyColumnDefault(value, '1').defaultExpression).toBe('1');
      const auto = applyColumnDefault(value, '@auto');
      expect(auto.type.name).toBe(serial);
      expect(auto.defaultExpression).toBeNull();
      expect(auto.nullable).toBe(false);
      expect(applyColumnDefault(auto, '').type.name).toBe(name);
    }
  });
  it('rejects arbitrary expressions and excludes scalar defaults for arrays', () => {
    const value = { ...physical('integer'), type: { name: 'integer', isArray: true } };
    expect(columnDefaultOptions(value).map((option) => option.value)).toEqual(['', 'NULL']);
    expect(applyColumnDefault(value, '@auto')).toBe(value);
    expect(applyColumnDefault(value, 'now(); DROP TABLE t')).toBe(value);
  });
  it('quotes enum labels and does not offer values outside the enum', () => {
    const value = { ...physical('status'), type: { name: 'status', enumId: 'e', isArray: false } };
    const enums = [{ id: 'e', name: 'status', schema: 'public', values: ["owner's", 'ready'] }];
    expect(applyColumnDefault(value, "'owner''s'", enums).defaultExpression).toBe("'owner''s'");
    expect(applyColumnDefault(value, "'missing'", enums)).toBe(value);
  });
  it('clears stale defaults on type changes and NULL on required changes', () => {
    const value = { ...physical('timestamp'), defaultExpression: 'now()' };
    expect(
      patchColumnPhysical(value, { type: { name: 'integer', isArray: false } }).defaultExpression,
    ).toBeNull();
    expect(patchColumnPhysical(value, { comment: 'keep' }).defaultExpression).toBe('now()');
    expect(
      patchColumnPhysical({ ...value, defaultExpression: 'NULL' }, { nullable: false })
        .defaultExpression,
    ).toBeNull();
    expect(
      columnDefaultOptions({ ...value, nullable: false }).map((option) => option.value),
    ).not.toContain('NULL');
  });
  it('does not offer 1 when numeric precision and scale cannot hold it', () => {
    const value = {
      ...physical('numeric'),
      type: { name: 'numeric', isArray: false, precision: 2, scale: 2 },
    };
    expect(columnDefaultOptions(value).map((option) => option.value)).not.toContain('1');
    expect(columnDefaultOptions(value).map((option) => option.value)).toContain('0');
  });
  it('renders a labeled selection, preserves imported defaults visibly and explains reset behavior', () => {
    const html = renderToStaticMarkup(
      createElement(ColumnDefaultControl, {
        physical: { ...physical('integer'), defaultExpression: '42' },
        enums: [],
        onChange: () => {},
      }),
    );
    expect(html).toContain('컬럼 기본값');
    expect(html).toContain('기존 값 · 42');
    expect(html).toContain('타입 변경 시 기본값이 초기화됩니다.');
    expect(html).not.toContain('<input');
  });
});
