import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type DesignDocument } from '@ezerd/model';
import { describeChanges, describeDeletedValues, historyMessage } from './sync-history-labels.js';
const tableId = '10000000-0000-4000-8000-000000000001',
  columnId = '10000000-0000-4000-8000-000000000002';
const table = { id: tableId, domainId: 'd', physical: { name: 'users' }, logical: { name: '' } };
const column = {
  id: columnId,
  tableId,
  physical: {
    name: 'id',
    type: { name: 'integer', isArray: false },
    nullable: false,
    comment: '식별자',
  },
};
const doc = {
  ...createEmptyDocument(),
  domains: [{ id: 'd', name: '회원', description: '' }],
  tables: [table],
  columns: [column],
  layout: {
    nodes: [
      {
        id: 'node:' + tableId,
        objectId: tableId,
        viewId: 'd',
        x: 0,
        y: 0,
        width: 480,
        height: 280,
      },
    ],
    viewports: [],
  },
} as unknown as DesignDocument;
describe('readable history summaries', () => {
  it('names moved tables without exposing node identifiers', () => {
    const result = describeChanges(
      [
        {
          path: '/layout/nodes/node:' + tableId + '/position',
          before: { x: 0, y: 0 },
          after: { x: 10, y: 20 },
        },
      ],
      doc,
    ).join(' ');
    expect(result).toContain('테이블');
    expect(result).toContain('users');
    expect(result).toContain('이동');
    expect(result).not.toContain(tableId);
  });
  it('describes additions once despite their new layout', () => {
    const result = describeChanges(
      [
        {
          path: '/domains/new',
          before: null,
          after: { id: 'new', name: '주문', description: '' },
          beforeExists: false,
        },
        {
          path: '/layout/nodes/node:new',
          before: null,
          after: { id: 'node:new', objectId: 'new', viewId: 'overview' },
          beforeExists: false,
        },
      ],
      doc,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('도메인');
    expect(result[0]).toContain('주문');
    expect(result[0]).toContain('추가');
  });
  it('renders named type changes with parameters', () => {
    const text = describeChanges(
      [
        {
          path: '/columns/' + columnId + '/physical/type',
          before: { name: 'integer', isArray: false },
          after: { name: 'varchar', length: 32, isArray: false },
        },
      ],
      doc,
    ).join(' ');
    expect(text).toContain('users.id');
    expect(text).toContain('타입');
    expect(text).toContain('INTEGER');
    expect(text).toContain('VARCHAR(32)');
  });
  it('uses deleted object contents and historical parents to recover names', () => {
    const change = {
      path: '/columns/' + columnId,
      before: column,
      after: null,
      afterExists: false,
    };
    const history = [
      { changes: [{ path: '/tables/' + tableId, before: table, after: null, afterExists: false }] },
    ];
    const text = describeChanges([change], createEmptyDocument(), history).join(' ');
    expect(text).toContain('users.id');
    expect(text).toContain('삭제');
    expect(text).not.toContain(columnId);
    expect(text).not.toContain(tableId);
    const preview = describeDeletedValues(change, createEmptyDocument(), history).join(' ');
    expect(preview).toContain('INTEGER');
    expect(preview).not.toContain(tableId);
  });
  it('describes column order rather than showing before/after IDs', () => {
    const text = describeChanges(
      [{ path: '/columns/@move/' + columnId, before: null, after: 'other-column' }],
      doc,
    ).join(' ');
    expect(text).toContain('컬럼 순서');
    expect(text).toContain('users');
    expect(text).not.toContain('other-column');
  });
  it('shows old and new names', () => {
    const text = describeChanges(
      [{ path: '/tables/' + tableId + '/physical/name', before: 'users', after: 'accounts' }],
      doc,
    ).join(' ');
    expect(text).toContain('이름');
    expect(text).toContain('users');
    expect(text).toContain('accounts');
  });
  it('does not leak unknown IDs or raw JSON in unsupported changes', () => {
    const text = describeChanges(
      [{ path: '/mystery/' + tableId + '/data', before: { id: tableId }, after: { id: columnId } }],
      {} as DesignDocument,
    ).join(' ');
    expect(text).not.toContain(tableId);
    expect(text).not.toContain(columnId);
    expect(text).not.toContain('{');
    expect(text).toContain('변경');
  });
  it('sanitizes technical identifiers in server messages', () => {
    const text = historyMessage('충돌 /tables/' + tableId + '/physical/name ' + columnId);
    expect(text).not.toContain(tableId);
    expect(text).not.toContain(columnId);
    expect(text).not.toContain('/tables/');
  });
});
