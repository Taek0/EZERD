import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describeChanges, nativeHistoryPreview } from './native-history-labels.js';
import { NativeHistoryChanges } from './NativeHistoryDialog.js';
import { decorationFixture } from './native-canvas-decoration-test-fixtures.js';
import { setLocale } from '../../shared/i18n/index.js';

const change = (path: string, before: unknown, after: unknown) => ({ path, before, after });
afterEach(() => setLocale('ko'));
describe('native readable history', () => {
  it('names moved tables and domains from raw layout changes without inventing key edits', () => {
    const document = decorationFixture();
    expect(
      describeChanges(
        [
          change('/layout/nodes/nt/position', { x: 0, y: 0 }, { x: 12, y: 8 }),
          change('/keys/k/columnIds', ['c'], ['c']),
        ],
        document,
      ),
    ).toEqual(['테이블 ‘records’ 이동']);
    expect(describeChanges([change('/layout/nodes/na/position/x', 0, 12)], document)).toEqual([
      '도메인 ‘Orders’ 이동',
    ]);
  });
  it('renders native type, default, generation and display values without conversion', () => {
    const document = decorationFixture();
    const changes = [
      change(
        '/columns/c/physical/type',
        { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:uuid', parameters: {} },
        { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:integer', parameters: {} },
      ),
      change(
        '/columns/c/physical/defaultValue',
        { kind: 'none' },
        { kind: 'literal', literalType: 'number', value: '9007199254740993' },
      ),
      change(
        '/columns/c/physical/generation',
        { kind: 'none' },
        { kind: 'identity', database: 'postgresql', mode: 'always' },
      ),
      change('/tables/t/canvasDisplay/showComment', false, true),
    ];
    const original = structuredClone(changes);
    const labels = describeChanges(changes, document);
    expect(labels[0]).toContain('records.opaque’ 타입 변경: UUID → INTEGER');
    expect(labels[1]).toContain('기본값 변경: 없음 → 9007199254740993');
    expect(labels[2]).toContain('자동 생성 변경: 없음 → IDENTITY ALWAYS');
    expect(labels[3]).toContain('comment 표시 변경: 허용 안함 → 허용');
    expect(changes).toEqual(original);
    setLocale('en');
    expect(describeChanges(changes, document)[0]).toContain('Column');
    expect(describeChanges(changes, document)[0]).toContain('UUID → INTEGER');
  });
  it('recovers deleted names from audit before values and hides unknown paths and identifiers', () => {
    const document = decorationFixture();
    const deleted = document.columns![0]!;
    document.columns = [];
    expect(
      describeChanges(
        [{ ...change('/columns/c', deleted, null), afterExists: false }],
        document,
      )[0],
    ).toContain('records.opaque’ 삭제');
    const id = '10000000-0000-4000-8000-000000000001';
    expect(describeChanges([change('/future/' + id, false, true)], document)).toEqual([
      '설계 변경',
    ]);
    expect(
      describeChanges([change('/tables/' + id + '/unknown', id, id + 'x')], document).join(),
    ).not.toContain(id);
  });
  it('limits the collapsed preview while keeping long full details and safe markup behind a disclosure', () => {
    const document = decorationFixture();
    const long = '<script>unsafe</script>' + 'long detail '.repeat(1000);
    const changes = [change('/columns/c/physical/comment', 'old', long)];
    const lines = describeChanges(changes, document);
    expect(lines[0]).toContain(long);
    const preview = nativeHistoryPreview(lines);
    expect(preview.expandable).toBe(true);
    expect(preview.lines[0]!.length).toBe(140);
    expect(nativeHistoryPreview(['a', 'b', 'c', 'd']).lines).toEqual(['a', 'b', 'c']);
    const markup = renderToStaticMarkup(createElement(NativeHistoryChanges, { lines }));
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls=');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('inert=""');
    expect(markup).toContain('변경 내용 더보기');
    expect(markup).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
    expect(markup).not.toContain('<script>unsafe</script>');
    expect(changes[0]!.after).toBe(long);
  });
});
