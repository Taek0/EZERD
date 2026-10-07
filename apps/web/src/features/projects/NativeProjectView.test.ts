import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createEmptyNativeDocument, defaultDatabaseContext } from '@ezerd/model';
import { projectEntry } from './project-entry.js';
import { NativeProjectView } from './NativeProjectView.js';
import { setLocale } from '../../shared/i18n/index.js';

function entry() {
  const doc = createEmptyNativeDocument(defaultDatabaseContext('mysql'));
  doc.tables = [
    {
      id: 't',
      domainId: null,
      scope: 'both',
      logical: { name: 'order', definition: '' },
      physical: {
        name: 'orders',
        comment: 'saved',
        namespace: { kind: 'mysqlCurrentDatabase' },
        options: { database: 'mysql', engine: 'InnoDB' },
      },
      customProperties: { common: {}, logical: {}, physical: {} },
    },
  ];
  doc.columns = [
    {
      id: 'c',
      tableId: 't',
      scope: 'both',
      logical: { name: 'amount', definition: '', semanticType: 'money', required: true },
      physical: {
        name: 'amount',
        type: {
          kind: 'builtin',
          database: 'mysql',
          typeId: 'mysql:decimal',
          parameters: { precision: 18, scale: 2 },
        },
        defaultValue: { kind: 'literal', literalType: 'number', value: '9007199254740993' },
        generation: { kind: 'none' },
        nullable: false,
        options: { database: 'mysql' },
        comment: '<script>literal</script>',
      },
      customProperties: { common: {}, logical: {}, physical: {} },
    },
  ];
  doc.keys = [
    {
      id: 'k',
      tableId: 't',
      scope: 'physical',
      kind: 'primary',
      columnIds: ['c'],
      name: 'pk_orders',
    },
  ];
  doc.indexes = [
    {
      id: 'i',
      tableId: 't',
      scope: 'physical',
      name: 'idx_amount',
      unique: false,
      parts: [{ expression: { kind: 'column', columnId: 'c' }, direction: 'asc' }],
      options: { database: 'mysql', kind: 'btree', invisible: true },
    },
  ];
  doc.checks = [
    {
      id: 'q',
      tableId: 't',
      scope: 'physical',
      name: 'positive',
      expression: {
        kind: 'binary',
        operator: '>',
        left: { kind: 'column', columnId: 'c' },
        right: { kind: 'literal', literalType: 'number', value: '0' },
      },
    },
  ];
  const result = projectEntry({
    protocolVersion: 2,
    project: {
      id: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      name: 'Native',
      databaseKind: 'mysql',
      databaseProfileId: 'mysql-8.4-innodb-v1',
      databaseRevision: 2,
      version: 9,
      status: 'active',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    },
    sequence: 10,
    sourceDocument: doc,
    native: { status: 'available', document: doc, migrationIssues: [], issues: [] },
  });
  if (result.kind !== 'native') throw new Error('Expected native');
  return result;
}
describe('native readonly project view', () => {
  it('keeps design issues out of the sidebar until the toolbar menu opens them', () => {
    setLocale('ko');
    const input = entry();
    if (input.snapshot.native.status !== 'available') throw Error('Expected available');
    input.snapshot.native.issues = [
      {
        code: 'test.issue',
        category: 'incomplete',
        severity: 'warning',
        params: {},
        objectId: 't',
        path: '/tables/t',
      },
    ];
    const html = renderToStaticMarkup(
      createElement(NativeProjectView, { entry: input, onLeave() {}, onReload() {} }),
    );
    expect(html).not.toContain('native-issues-list');
    expect(html).not.toContain('설계 확인 항목 · 1');
    expect(html).not.toContain('물리 설계를 완성해 주세요.');
  });
  it('renders native types/options/constraints as data without write actions or v1 projections', () => {
    setLocale('ko');
    const input = entry();
    const before = structuredClone(input);
    const html = renderToStaticMarkup(
      createElement(NativeProjectView, { entry: input, onLeave() {}, onReload() {} }),
    );
    for (const value of [
      '조회 전용',
      'MySQL',
      'DECIMAL(18,2)',
      '9007199254740993',
      'pk_orders',
      'idx_amount',
      'INVISIBLE',
      'positive',
      'amount &gt; 0',
    ])
      expect(html).toContain(value);
    expect(html).not.toContain('<script>literal');
    expect(html).toContain('&lt;script&gt;literal&lt;/script&gt;');
    expect(html).not.toContain('contenteditable');
    expect(html).not.toContain('○ 오프라인');
    expect(html).not.toContain('동기화됨');
    expect(input).toEqual(before);
  });
  it('renders an unavailable preview as an explicit state instead of using a v1 editor', () => {
    const input = entry();
    input.document = null;
    input.snapshot.native = { status: 'unavailable', code: 'database.context-changed' };
    const html = renderToStaticMarkup(
      createElement(NativeProjectView, { entry: input, onLeave() {}, onReload() {} }),
    );
    expect(html).toContain('DB 설정과 저장된 설계의 종류가 다릅니다.');
    expect(html).not.toContain('DECIMAL');
    expect(html).toContain('! 확인 필요');
  });
});

it.each(['ko', 'en'] as const)(
  'consolidates native metadata and removes obsolete chrome in %s',
  (locale) => {
    setLocale(locale);
    const html = renderToStaticMarkup(
      createElement(NativeProjectView, {
        entry: entry(),
        onLeave() {},
        onReload() {},
      }),
    );
    expect(html).toMatch(/class="editor-heading"[\s\S]*class="native-project-context"/);
    expect(html).toContain(locale === 'ko' ? '목표 DB 버전' : 'Target DB version');
    expect(html).not.toMatch(
      /다시 불러오기|Reload|>도구<|>Tools<|미저장 배치가 있습니다|A save request is unconfirmed or unapplied/,
    );
    setLocale('ko');
  },
);
