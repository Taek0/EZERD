import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { storeNativeDraft, rebaseNativeDraft } from './native-save.js';
const autosaveSpy = vi.hoisted(() => vi.fn());
vi.mock('./use-native-autosave.js', () => ({
  useNativeAutosave: (options: unknown) => {
    autosaveSpy(options);
    return { markChanged: vi.fn(), flush: vi.fn(), compositionProps: {} };
  },
  requiresNativeConfirmation: () => false,
}));
import {
  createEmptyNativeDocument,
  createNativeTable,
  createNativeColumn,
  defaultDatabaseContext,
  type NativeDesignDocument,
} from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
import { NativePropertyEditor } from './NativePropertyEditor.js';
import {
  nativeFormatCommands,
  nativeFormatInitial,
  nativeFormatDraftIssue,
} from './native-editor-format.js';
import { nativeTypeOptionLabel } from './native-editor-policy.js';
import { setLocale } from '../../shared/i18n/index.js';
const uuid = '00000000-0000-4000-8000-000000000001';
function fixture(kind: 'postgresql' | 'mysql' | 'sqlite') {
  const database = defaultDatabaseContext(kind),
    table = createNativeTable(database, 't'),
    column = createNativeColumn(database, table, 'c');
  table.physical.name = 'records';
  column.physical.name = 'amount';
  const document: NativeDesignDocument = {
    ...createEmptyNativeDocument(database),
    tables: [table],
    columns: [column],
  };
  const snapshot: ProjectDocumentState = {
    protocolVersion: 2,
    project: {
      id: crypto.randomUUID(),
      workspaceId: uuid,
      name: 'Native',
      status: 'active',
      version: 7,
      databaseKind: kind,
      databaseProfileId: database.profileId,
      databaseRevision: 3,
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    },
    sequence: 10,
    sourceDocument: document,
    native: { status: 'available', document, issues: [], migrationIssues: [] },
  };
  return {
    document,
    table,
    column,
    context: { userId: crypto.randomUUID(), snapshot, busy: false, onSave: async () => true },
  };
}

describe('sidebar properties', () => {
  it('places type between name and description without nesting forms and collapses options', () => {
    setLocale('ko');
    const f = fixture('postgresql');
    const html = renderToStaticMarkup(
      createElement(NativePropertyEditor, {
        ...f.context,
        table: f.table,
        column: f.column,
        mode: 'physical',
      }),
    );
    expect(html.indexOf('컬럼명')).toBeLessThan(html.indexOf('>타입<'));
    expect(html.indexOf('>타입<')).toBeLessThan(html.indexOf('>설명<'));
    expect(html.indexOf('>NULL<')).toBeLessThan(html.indexOf('>기본값<'));
    expect(html.indexOf('>기본값<')).toBeLessThan(html.indexOf('>배열 차원<'));
    expect(html).not.toContain('미검증 기능은 새로');
    expect(html).not.toContain('저장 요청');
    expect(html).not.toContain('입력 초기화');
    expect(html).not.toMatch(/<details[^>]*open/);
    let depth = 0;
    for (const tag of html.matchAll(/<\/?form\b[^>]*>/g)) {
      depth += tag[0].startsWith('</') ? -1 : 1;
      expect(depth).toBeLessThanOrEqual(1);
    }
    expect(depth).toBe(0);
    expect(html).toContain('role="combobox"');
    expect(html.indexOf('>설명<')).toBeLessThan(html.indexOf('기본 키(PK)'));
    expect(html.indexOf('기본 키(PK)')).toBeLessThan(html.indexOf('>NULL<'));
    expect(html).not.toContain('속성 편집');
    expect(html).not.toContain('형식·DB 옵션 편집');
    expect(html).not.toContain('현재 값');
    expect(nativeTypeOptionLabel('postgresql:varchar')).toBe('varchar');
  });
  it('preserves existing unverified SQLite type for unrelated NULL edits while blocking new use', () => {
    const f = fixture('sqlite');
    f.column.physical.type = { kind: 'untyped', database: 'sqlite' };
    const before = nativeFormatInitial(f.table, f.column);
    const values = { ...before, nullable: before.nullable === 'true' ? 'false' : 'true' };
    expect(nativeFormatDraftIssue(f.document, f.table, f.column, values)).toBeUndefined();
    expect(nativeFormatCommands(f.document, f.table, f.column, values, before)).toEqual([
      {
        type: 'patch_column',
        id: f.column.id,
        patch: { physical: { nullable: values.nullable === 'true' } },
      },
    ]);
    const builtin = createNativeColumn(f.document.database, f.table, 'other');
    const initial = nativeFormatInitial(f.table, builtin);
    expect(
      nativeFormatDraftIssue(f.document, f.table, builtin, {
        ...initial,
        typeChoice: 'untyped',
        confirmTypeReset: 'true',
      }),
    ).toBe('type.not-implemented');
  });
  it('distinguishes malformed input from a product verification block', () => {
    const f = fixture('postgresql');
    const before = nativeFormatInitial(f.table, f.column);
    const issue = nativeFormatDraftIssue(f.document, f.table, f.column, {
      ...before,
      nullable: 'invalid',
    });
    expect(issue).toBeTruthy();
    expect(issue).not.toBe('type.not-implemented');
    expect(issue).not.toBe('feature.not-implemented');
    expect(nativeFormatDraftIssue(f.document, f.table, f.column, before)).toBeUndefined();
  });
  it('allows blank names by patch contract and sends the rebased next edit', async () => {
    const f = fixture('postgresql');
    f.column.logical.name = '';
    f.column.physical.name = '';
    const original = { physicalName: '', logicalName: '', comment: '', definition: '' };
    const sent = {
      userId: f.context.userId,
      projectId: f.context.snapshot.project.id,
      kind: 'column' as const,
      objectId: f.column.id,
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      before: original,
      values: { ...original, comment: 'first' },
    };
    const following = {
      ...sent,
      values: { ...sent.values, comment: 'second' },
      before: { ...sent.values },
    };
    const next = rebaseNativeDraft(
      following,
      { version: 8, sequence: 11, databaseRevision: 3 },
      sent.values,
    );
    expect(next.values.comment).toBe('second');
    expect(next.before.comment).toBe('first');
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    });
    storeNativeDraft(next);
    f.context.snapshot.project.version = 8;
    f.context.snapshot.sequence = 11;
    f.column.physical.comment = 'first';
    const onSave = vi.fn(async () => true);
    const html = renderToStaticMarkup(
      createElement(NativePropertyEditor, {
        ...f.context,
        onSave,
        table: f.table,
        column: f.column,
        mode: 'physical',
      }),
    );
    const options = autosaveSpy.mock.calls
      .slice()
      .reverse()
      .map(([option]) => option)
      .find((option) => option.save.name === 'submit');
    expect(options.blocked).toBe(false);
    await options.save();
    expect(onSave).toHaveBeenCalledWith(
      [
        {
          type: 'patch_column',
          id: f.column.id,
          patch: { physical: { comment: 'second' }, logical: {} },
        },
      ],
      { version: 8, sequence: 11, databaseRevision: 3 },
    );
    expect(html).not.toContain('<fieldset disabled="">');
  });

  it('keeps a fresh PostgreSQL column editable despite unavailable catalog options', () => {
    const f = fixture('postgresql');
    f.column = createNativeColumn(f.document.database, f.table, 'fresh');
    f.document.columns = [f.column];
    const initial = nativeFormatInitial(f.table, f.column);
    for (const values of [
      initial,
      { ...initial, nullable: initial.nullable === 'true' ? 'false' : 'true' },
      { ...initial, defaultChoice: 'literal:string', defaultValue: 'hello' },
      {
        ...initial,
        typeChoice: 'postgresql:varchar',
        'parameter:length': '80',
        confirmTypeReset: 'true',
      },
    ]) {
      expect(nativeFormatDraftIssue(f.document, f.table, f.column, values)).toBeUndefined();
    }
    expect(
      nativeFormatDraftIssue(f.document, f.table, f.column, {
        ...initial,
        typeChoice: 'postgresql:txid_snapshot',
        confirmTypeReset: 'true',
      }),
    ).toBe('type.not-implemented');
  });
});
