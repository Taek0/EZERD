import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeTable,
  createNativeColumn,
  defaultDatabaseContext,
  validateDatabaseDocument,
  type NativeDesignDocument,
} from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
import {
  nativeFormatInitial,
  nativeFormatCommands,
  NativeFormatEditor,
} from './native-editor-format.js';
import { nativeEditorPolicy } from './native-editor-policy.js';
import {
  nativeStructureCommands,
  nativeConstraintInitial,
  nativeConstraintCommands,
  NativeStructureEditor,
} from './native-editor-structure.js';
import { nativeExpressionFromInputs } from './native-editor-expression.js';
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
      id: uuid,
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
    context: { userId: uuid, snapshot, busy: false, onSave: async () => true },
  };
}
describe('native structured forms and availability', () => {
  it('shows schema and engine meanings for preserved MySQL namespace data without raw JSON', () => {
    setLocale('ko');
    const f = fixture('mysql');
    f.table.physical.namespace = {
      kind: 'legacyNamespace',
      source: 'document-v1',
      original: 'public',
    };
    const before = structuredClone(f.document);
    const html = renderToStaticMarkup(
      createElement(NativeFormatEditor, {
        context: f.context,
        document: f.document,
        table: f.table,
      }),
    );
    expect(html).toContain('스키마: public');
    expect(html).toContain('엔진: InnoDB');
    for (const internal of [
      'legacyNamespace',
      'document-v1',
      'namespaceJSON',
      'optionsJSON',
      '&quot;database&quot;',
    ])
      expect(html).not.toContain(internal);
    const submit = html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0];
    expect(submit).toContain('disabled=""');
    expect(f.document).toEqual(before);
  });
  it('shows SQLite table modes as labels and leaves a clean format form disabled', () => {
    setLocale('ko');
    const f = fixture('sqlite');
    f.table.physical.options = { database: 'sqlite', strict: true, withoutRowid: false };
    const html = renderToStaticMarkup(
      createElement(NativeFormatEditor, {
        context: f.context,
        document: f.document,
        table: f.table,
      }),
    );
    expect(html).toContain('스키마: main');
    expect(html).toContain('STRICT: 사용');
    expect(html).toContain('WITHOUT ROWID: 사용 안 함');
    expect(html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0]).toContain('disabled=""');
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'renders the type union, current values and unavailable reasons for %s',
    (kind) => {
      setLocale('ko');
      const f = fixture(kind),
        before = structuredClone(f.document);
      const policy = nativeEditorPolicy(f.document, f.table, f.column);
      expect(policy.types.filter((type) => type.usable)).toEqual([]);
      const html = renderToStaticMarkup(
        createElement(NativeFormatEditor, { ...f, context: f.context }),
      );
      for (const label of [
        'postgresql:integer',
        'mysql:int',
        'sqlite:integer',
        '미구현 또는 실행 검증 미완료',
        '이 DB에서 지원하지 않음',
        '현재 값',
      ])
        expect(html).toContain(label);
      expect(html).toMatch(/disabled=""[^>]*>postgresql:integer/);
      expect(f.document).toEqual(before);
      const initial = nativeFormatInitial(f.table, f.column);
      expect(nativeFormatCommands(f.document, f.table, f.column, initial, initial)).toEqual([]);
    },
  );
  it('blocks unverified type selection in the helper as well as the select element', () => {
    const f = fixture('postgresql'),
      initial = nativeFormatInitial(f.table, f.column);
    expect(() =>
      nativeFormatCommands(
        f.document,
        f.table,
        f.column,
        { ...initial, typeChoice: 'postgresql:integer', confirmTypeReset: 'true' },
        initial,
      ),
    ).toThrow('type.not-implemented');
    expect(() =>
      nativeStructureCommands(f.document, f.table, 'key', {
        id: 'key',
        name: 'pk',
        keyKind: 'primary',
        scope: 'physical',
        columnIds: 'c',
      }),
    ).toThrow('feature.not-implemented');
  });
  it('allows actual logical table/column drafts without activating physical coverage', () => {
    const f = fixture('postgresql');
    const [table] = nativeStructureCommands(f.document, undefined, 'table', {
      id: 'new',
      name: 'stored_physical_name',
      logicalName: '초안',
      scope: 'logical',
      domainId: '',
    });
    expect(table).toMatchObject({
      type: 'add_table',
      value: {
        id: 'new',
        scope: 'logical',
        physical: { namespace: { kind: 'postgresSchema', name: 'public' } },
      },
    });
    const [column] = nativeStructureCommands(f.document, f.table, 'column', {
      id: 'new-column',
      name: '',
      logicalName: '초안',
      scope: 'logical',
    });
    expect(column).toMatchObject({
      type: 'add_column',
      value: {
        scope: 'logical',
        physical: { type: { kind: 'builtin', typeId: 'postgresql:text' } },
      },
    });
    const html = renderToStaticMarkup(
      createElement(NativeStructureEditor, { ...f, context: f.context }),
    );
    expect(html).toContain('논리 초안은 저장할 수 있습니다.');
    expect(() =>
      nativeStructureCommands(f.document, undefined, 'table', { id: 'blocked', scope: 'both' }),
    ).toThrow('feature.not-implemented');
  });
  it('preserves legacy/current type and independently removes default/generation for recovery', () => {
    const f = fixture('postgresql');
    f.column.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'opaque()', isArray: false },
    };
    f.column.physical.defaultValue = {
      kind: 'legacyExpression',
      source: 'document-v1',
      original: 'old()',
    };
    f.column.physical.generation = { kind: 'serial', database: 'postgresql' };
    const initial = nativeFormatInitial(f.table, f.column);
    expect(
      nativeFormatCommands(
        f.document,
        f.table,
        f.column,
        { ...initial, nullable: 'true' },
        initial,
      ),
    ).toEqual([{ type: 'patch_column', id: 'c', patch: { physical: { nullable: true } } }]);
    expect(
      nativeFormatCommands(
        f.document,
        f.table,
        f.column,
        { ...initial, defaultChoice: 'none', generationChoice: 'none' },
        initial,
      ),
    ).toEqual([
      {
        type: 'patch_column',
        id: 'c',
        patch: { physical: { defaultValue: { kind: 'none' }, generation: { kind: 'none' } } },
      },
    ]);
    expect(f.column.physical.defaultValue.kind).toBe('legacyExpression');
  });
  it('renames constraints without dropping compound parts/options or unknown-to-form AST structure', () => {
    const f = fixture('postgresql');
    f.document.indexes = [
      {
        id: 'idx',
        tableId: 't',
        scope: 'physical',
        name: 'original',
        unique: true,
        parts: [
          {
            direction: 'asc',
            expression: {
              kind: 'call',
              functionId: 'postgresql:lower',
              args: [{ kind: 'column', columnId: 'c' }],
            },
          },
          { direction: 'desc', expression: { kind: 'column', columnId: 'c' } },
        ],
        options: {
          database: 'postgresql',
          method: 'btree',
          includeColumnIds: ['c'],
          predicate: { kind: 'isNull', negate: true, operand: { kind: 'column', columnId: 'c' } },
          nullsNotDistinct: true,
        },
      },
    ];
    const before = nativeConstraintInitial(f.document, 'indexes', 'idx');
    expect(
      nativeConstraintCommands(
        f.document,
        'indexes',
        'idx',
        { ...before, name: 'renamed' },
        before,
      ),
    ).toEqual([{ type: 'patch_index', id: 'idx', patch: { name: 'renamed' } }]);
    expect(() =>
      nativeConstraintCommands(
        f.document,
        'indexes',
        'idx',
        { ...before, direction: 'desc' },
        before,
      ),
    ).toThrow('feature.not-implemented');
  });
  it('keeps decimal/integer tokens as strings in structured expressions', () => {
    expect(
      nativeExpressionFromInputs({
        expressionColumn: 'c',
        expressionOperator: '>',
        expressionLiteralType: 'number',
        expressionValue: '9007199254740993',
      }),
    ).toMatchObject({ right: { literalType: 'number', value: '9007199254740993' } });
    expect(() =>
      nativeExpressionFromInputs({
        expressionColumn: 'c',
        expressionOperator: '>',
        expressionLiteralType: 'number',
        expressionValue: '0;DROP TABLE t',
      }),
    ).toThrow();
  });
  it('does not change coverage when creating a fixture or a logical draft', () => {
    const f = fixture('sqlite');
    const issues = validateDatabaseDocument(f.document, f.document.database, {
      mode: 'write',
      previous: createEmptyNativeDocument(f.document.database),
    });
    expect(issues.some((issue) => issue.code === 'type.not-implemented')).toBe(true);
    expect(
      nativeEditorPolicy(f.document, f.table).capabilities.features.some(
        (feature) => feature.usable,
      ),
    ).toBe(false);
  });
});
