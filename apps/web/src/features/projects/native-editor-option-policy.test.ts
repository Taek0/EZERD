import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
  type NativeColumnType,
  type NativeDesignDocument,
  type NativeGeneration,
} from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
import {
  nativeBuiltinDefaultInput,
  nativeBuiltinFunctionChoices,
  nativeDefaultChoices,
  nativeDefaultInput,
  nativeIdentityInitial,
  nativeIdentityInput,
  nativeKeyColumnPolicies,
  nativeKeyInput,
  nativeLiteralFromToken,
  nativeLiteralPolicy,
  nativeOnUpdateInput,
  nativeBuiltinDefaultPolicy,
  nativeOnUpdatePolicy,
  nativeGenerationPolicy,
  nativeFunctionOptionPolicies,
} from './native-editor-option-policy.js';
import {
  nativeFormatCommands,
  nativeFormatInitial,
  NativeFormatEditor,
} from './native-editor-format.js';
import {
  nativeConstraintCommands,
  nativeConstraintInitial,
  NativeOrderedColumns,
  nativeStructureCommands,
} from './native-editor-structure.js';
import { storeNativeEditorDraft, loadNativeEditorDraft } from './native-editor-draft.js';
import { setLocale } from '../../shared/i18n/index.js';
const uuid = '00000000-0000-4000-8000-000000000001';
function fixture(kind: 'postgresql' | 'mysql' | 'sqlite' = 'postgresql') {
  const database = defaultDatabaseContext(kind);
  const table = createNativeTable(database, 't');
  table.physical.name = 'records';
  const column = createNativeColumn(database, table, 'c');
  column.physical.name = 'value';
  const document: NativeDesignDocument = {
    ...createEmptyNativeDocument(database),
    tables: [table],
    columns: [column],
  };
  const snapshot = {
    protocolVersion: 2,
    sequence: 11,
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
    sourceDocument: document,
    native: { status: 'available', document, issues: [], migrationIssues: [] },
  } as ProjectDocumentState;
  return {
    document,
    table,
    column,
    context: {
      userId: crypto.randomUUID(),
      snapshot,
      busy: false,
      onSave: vi.fn(async () => true),
    },
  };
}
afterEach(() => vi.unstubAllGlobals());
describe('native default and key UI policies without coverage promotion', () => {
  it('resolves MySQL collation-only charset for exact defaults and key sizes', () => {
    const { document, table, column } = fixture('mysql');
    column.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 1 },
    };
    column.physical.options = { database: 'mysql', collation: 'ascii_bin' };
    expect(
      nativeLiteralPolicy(document, table, column, {
        kind: 'literal',
        literalType: 'string',
        value: 'é',
      }),
    ).toMatchObject({ engineAllowed: false, code: 'default.charset-value-invalid' });
    column.physical.options = { database: 'mysql', charset: 'binary' };
    expect(
      nativeLiteralPolicy(document, table, column, {
        kind: 'literal',
        literalType: 'string',
        value: 'é',
      }),
    ).toMatchObject({ engineAllowed: false, code: 'default.length-exceeded' });
    column.physical.type.parameters = { length: 1000 };
    column.physical.options = { database: 'mysql', collation: 'latin1_bin' };
    expect(nativeKeyColumnPolicies(document, table, 'unique')[0]!.engineAllowed).toBe(true);
    column.physical.options = { database: 'mysql', charset: 'utf8mb4' };
    expect(nativeKeyColumnPolicies(document, table, 'unique')[0]!.code).toBe('key.length-exceeded');
  });
  it.each([
    [
      { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:integer', parameters: {} },
      'number',
    ],
    [
      { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:uuid', parameters: {} },
      'typedText',
    ],
    [
      { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:bytea', parameters: {} },
      'binary',
    ],
    [
      { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:jsonb', parameters: {} },
      'json',
    ],
    [
      { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:boolean', parameters: {} },
      'boolean',
    ],
    [
      { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:text', parameters: {} },
      'string',
    ],
  ] satisfies [NativeColumnType, string][])(
    'labels the engine-compatible literal kind for $0.typeId while keeping product readiness false',
    (type, expected) => {
      const f = fixture();
      f.column.physical.type = type;
      const choices = nativeDefaultChoices(f.document, f.table, f.column);
      expect(choices.find((item) => item.choice === `literal:${expected}`)).toMatchObject({
        engineAllowed: true,
        productUsable: false,
        selectable: false,
      });
      expect(choices.find((item) => item.choice === 'none')).toMatchObject({ selectable: true });
      expect(choices.every((item) => !item.productUsable)).toBe(true);
    },
  );
  it('uses nullable, primary key, strict mode and enum values from the current document', () => {
    const f = fixture();
    f.column.physical.nullable = true;
    expect(nativeLiteralPolicy(f.document, f.table, f.column, { kind: 'null' }).engineAllowed).toBe(
      true,
    );
    f.document.keys = [
      { id: 'k', tableId: 't', scope: 'physical', kind: 'primary', name: 'pk', columnIds: ['c'] },
    ];
    expect(nativeLiteralPolicy(f.document, f.table, f.column, { kind: 'null' })).toMatchObject({
      engineAllowed: false,
      code: 'default.null-not-supported',
    });
    f.column.physical.type = { kind: 'projectEnum', database: 'postgresql', enumId: 'e' };
    f.document.enums = [{ id: 'e', schema: 'public', name: 'state', values: ['active'] }];
    expect(
      nativeDefaultInput(f.document, f.table, f.column, 'literal:string', 'active', true).decision
        .engineAllowed,
    ).toBe(true);
    expect(() =>
      nativeDefaultInput(f.document, f.table, f.column, 'literal:string', 'unknown', true),
    ).toThrow('default.enum-value-invalid');
    const sq = fixture('sqlite');
    sq.table.physical.options = { database: 'sqlite', strict: true, withoutRowid: false };
    sq.column.physical.type = {
      kind: 'builtin',
      database: 'sqlite',
      typeId: 'sqlite:blob',
      parameters: {},
    };
    expect(() =>
      nativeDefaultInput(sq.document, sq.table, sq.column, 'literal:string', '00', true),
    ).toThrow('default.type-mismatch');
  });
  it('retains exact numeric and JSON tokens and does not activate their writes', () => {
    const f = fixture();
    f.column.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:numeric',
      parameters: { precision: 20, scale: 2 },
    };
    const token = '+0009007199254740993.00';
    const input = nativeDefaultInput(f.document, f.table, f.column, 'literal:number', token, false);
    expect(input.value).toEqual({ kind: 'literal', literalType: 'number', value: token });
    expect(input.decision).toMatchObject({ engineAllowed: true, productUsable: false });
    const initial = nativeFormatInitial(f.table, f.column);
    expect(() =>
      nativeFormatCommands(
        f.document,
        f.table,
        f.column,
        { ...initial, defaultChoice: 'literal:number', defaultValue: token },
        initial,
      ),
    ).toThrow('default.not-ready');
    expect(nativeLiteralFromToken('json', '{ "n":9007199254740993, "e":1e2 }')).toMatchObject({
      value: '{ "n":9007199254740993, "e":1e2 }',
    });
  });
  it.each(['', '-', '+', '.', '20e', '20,', 'NaN', 'Infinity', ' 20 '])(
    'never coerces unfinished numeric token %s into 0/NaN',
    (token) => {
      expect(() => nativeLiteralFromToken('number', token)).toThrow('literal.number-invalid');
    },
  );
  it.each(['', '1', '0', 'True', 'false '])(
    'does not coerce boolean token %s to false',
    (token) => {
      expect(() => nativeLiteralFromToken('boolean', token)).toThrow(
        'native.boolean-token-incomplete',
      );
    },
  );
  it('blocks incomplete dates and environment-dependent PG values but preserves originals and recovery', () => {
    setLocale('ko');
    const f = fixture();
    f.column.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:date',
      parameters: {},
    };
    expect(() =>
      nativeDefaultInput(f.document, f.table, f.column, 'literal:typedText', '2026-10-', false),
    ).toThrow('default.literal-format-invalid');
    f.column.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:money',
      parameters: {},
    };
    f.column.physical.defaultValue = { kind: 'literal', literalType: 'typedText', value: '$1.00' };
    const before = nativeFormatInitial(f.table, f.column);
    const original = structuredClone(f.document);
    const html = renderToStaticMarkup(createElement(NativeFormatEditor, f));
    expect(html).toContain('환경 확인 후 기본값을 제거하거나 검증된 값으로 복구하세요.');
    expect(html).toContain('default.environment-value-unverified');
    expect(
      nativeFormatCommands(f.document, f.table, f.column, { ...before, nullable: 'true' }, before),
    ).toMatchObject([{ patch: { physical: { nullable: true } } }]);
    expect(
      nativeFormatCommands(
        f.document,
        f.table,
        f.column,
        { ...before, defaultChoice: 'none' },
        before,
      ),
    ).toMatchObject([{ patch: { physical: { defaultValue: { kind: 'none' } } } }]);
    expect(f.document).toEqual(original);
  });
  it('stores exact unfinished drafts/before and disables submit while retaining the export blocker form', () => {
    setLocale('ko');
    const f = fixture();
    f.column.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:numeric',
      parameters: { precision: 20 },
    };
    const before = nativeFormatInitial(f.table, f.column);
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    };
    vi.stubGlobal('localStorage', storage);
    const draft = {
      userId: f.context.userId,
      projectId: f.context.snapshot.project.id,
      key: 'format:column:c',
      revision: uuid,
      expected: { version: 7, sequence: 11, databaseRevision: 3 },
      before,
      values: { ...before, defaultChoice: 'literal:number', defaultValue: '20e-' },
    };
    storeNativeEditorDraft(draft);
    const html = renderToStaticMarkup(createElement(NativeFormatEditor, f));
    expect(html).toContain('value="20e-"');
    expect(html).toContain('literal.number-invalid');
    expect(html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0]).toContain('disabled=""');
    expect(loadNativeEditorDraft(draft.userId, draft.projectId, draft.key)).toEqual(draft);
    expect(f.context.onSave).not.toHaveBeenCalled();
  });
  it('shows valid and invalid key candidates with reasons while preserving a stored invalid selection', () => {
    setLocale('ko');
    const f = fixture();
    f.column.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:json',
      parameters: {},
    };
    const valid = createNativeColumn(f.document.database, f.table, 'good');
    valid.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:integer',
      parameters: {},
    };
    valid.physical.name = 'id';
    f.document.columns!.push(valid);
    const choices = nativeKeyColumnPolicies(f.document, f.table, 'primary', ['c']);
    expect(choices.find((item) => item.column.id === 'c')).toMatchObject({
      engineAllowed: false,
      preserved: true,
      code: 'key.type-not-supported',
    });
    expect(choices.find((item) => item.column.id === 'good')).toMatchObject({
      engineAllowed: true,
      productUsable: false,
    });
    const html = renderToStaticMarkup(
      createElement(NativeOrderedColumns, {
        document: f.document,
        tableId: 't',
        value: 'c',
        keyKind: 'primary',
        change: () => undefined,
      }),
    );
    expect(html).toContain('key.type-not-supported');
    expect(html).toContain('엔진에서 허용');
    expect(html).toContain('제품 검증 미완료');
    expect(() =>
      nativeStructureCommands(f.document, f.table, 'key', {
        id: 'k',
        keyKind: 'primary',
        columnIds: 'c',
        scope: 'physical',
      }),
    ).toThrow('key.type-not-supported');
    f.document.keys = [
      { id: 'k', tableId: 't', kind: 'primary', columnIds: ['c'], scope: 'physical', name: 'old' },
    ];
    const before = nativeConstraintInitial(f.document, 'keys', 'k');
    expect(
      nativeConstraintCommands(f.document, 'keys', 'k', { ...before, name: 'renamed' }, before),
    ).toMatchObject([{ patch: { name: 'renamed' } }]);
  });
  it('honors MySQL inherited charset, composite length and SQLite generated PK vs UNIQUE eligibility', () => {
    const f = fixture('mysql');
    f.table.physical.options = { database: 'mysql', engine: 'InnoDB', charset: 'latin1' };
    f.column.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 1000 },
    };
    expect(
      nativeKeyColumnPolicies(f.document, f.table, 'primary')[0]!.eligibility.estimatedBytes,
    ).toBe(1000);
    f.column.physical.options = { database: 'mysql', charset: 'utf8mb4' };
    expect(nativeKeyColumnPolicies(f.document, f.table, 'primary')[0]).toMatchObject({
      engineAllowed: false,
      code: 'key.length-exceeded',
    });
    f.column.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 500 },
    };
    const peer = { ...f.column, id: 'peer' };
    f.document.columns!.push(peer);
    expect(() => nativeKeyInput(f.document, f.table, 'unique', ['c', 'peer'])).toThrow(
      'key.length-exceeded',
    );
    const sq = fixture('sqlite');
    sq.column.physical.generation = {
      kind: 'computed',
      database: 'sqlite',
      storage: 'stored',
      expression: { kind: 'literal', literalType: 'number', value: '1' },
    };
    expect(nativeKeyColumnPolicies(sq.document, sq.table, 'primary')[0]!.engineAllowed).toBe(false);
    expect(nativeKeyColumnPolicies(sq.document, sq.table, 'unique')[0]!.engineAllowed).toBe(true);
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'filters builtin function union by current %s and rejects missing arguments',
    (kind) => {
      const f = fixture(kind);
      const choices = nativeBuiltinFunctionChoices(f.document);
      expect(choices.every((item) => item.id.startsWith(`${kind}:`))).toBe(true);
      expect(nativeBuiltinDefaultInput(f.document, `${kind}:current_timestamp`)).toEqual({
        kind: 'expression',
        expression: { kind: 'call', functionId: `${kind}:current_timestamp`, args: [] },
      });
      expect(() => nativeBuiltinDefaultInput(f.document, `${kind}:lower`)).toThrow(
        'expression.function-arguments-required',
      );
      expect(() =>
        nativeBuiltinDefaultInput(
          f.document,
          kind === 'mysql' ? 'postgresql:current_timestamp' : 'mysql:current_timestamp',
        ),
      ).toThrow('expression.function-not-supported');
      if (kind === 'postgresql')
        f.column.physical.type = {
          kind: 'builtin',
          database: 'postgresql',
          typeId: 'postgresql:timestamp',
          parameters: {},
        };
      if (kind === 'mysql')
        f.column.physical.type = {
          kind: 'builtin',
          database: 'mysql',
          typeId: 'mysql:datetime',
          parameters: {},
        };
      expect(
        nativeBuiltinDefaultPolicy(f.document, f.table, f.column, {
          kind: 'call',
          functionId: `${kind}:current_timestamp`,
          args: [],
        }),
      ).toMatchObject({
        engineAllowed: true,
        productUsable: false,
      });
    },
  );
  it('prepares bounded identity fields without normalizing existing strings or authorizing unchecked engine semantics', () => {
    const original: NativeGeneration = {
      kind: 'identity',
      database: 'postgresql',
      mode: 'always',
      sequence: {
        start: '+0009007199254740993',
        increment: '-0002',
        min: '-9999999999999999',
        max: '9999999999999999',
        cache: 20,
        cycle: false,
      },
    };
    const initial = { ...nativeIdentityInitial(original), identityMode: 'always' };
    expect(
      nativeIdentityInput(
        { ...initial, identityMode: 'byDefault', 'identity:cache': '30' },
        initial,
        original,
      ),
    ).toEqual({ ...original, mode: 'byDefault', sequence: { ...original.sequence, cache: 30 } });
    for (const token of ['', '-', '20e', 'NaN', '2147483648', '0']) {
      if (!token) continue; // Empty explicitly removes an optional setting, never becomes zero.
      expect(() =>
        nativeIdentityInput({ ...initial, 'identity:cache': token }, initial, original),
      ).toThrow();
    }
    expect(() =>
      nativeIdentityInput({ ...initial, 'identity:start': '-' }, initial, original),
    ).toThrow('native.integer-token-incomplete');
    expect(
      nativeIdentityInput({ ...initial, 'identity:cache': '' }, initial, original),
    ).toMatchObject({ sequence: { start: original.sequence!.start } });
    const f = fixture();
    f.column.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:bigint',
      parameters: {},
    };
    f.column.physical.generation = original;
    expect(nativeGenerationPolicy(f.document, f.table, f.column, original)).toMatchObject({
      engineAllowed: true,
      productUsable: false,
    });
    const before = nativeFormatInitial(f.table, f.column);
    expect(nativeFormatCommands(f.document, f.table, f.column, before, before)).toEqual([]);
    expect(() =>
      nativeFormatCommands(f.document, f.table, f.column, { ...before, nullable: 'true' }, before),
    ).toThrow('generation.nullability-mismatch');
    const html = renderToStaticMarkup(createElement(NativeFormatEditor, f));
    expect(html).toContain('Identity start');
    expect(html).toContain('+0009007199254740993');
    expect(f.column.physical.generation).toEqual(original);
  });
  it('preserves existing MySQL ON UPDATE arguments and removes the option only by explicit recovery', () => {
    const f = fixture('mysql');
    f.column.physical.options = {
      database: 'mysql',
      charset: 'latin1',
      onUpdate: { kind: 'call', functionId: 'mysql:current_timestamp', args: [] },
    };
    const before = nativeFormatInitial(f.table, f.column);
    expect(
      nativeFormatCommands(
        f.document,
        f.table,
        f.column,
        { ...before, onUpdateMode: 'none' },
        before,
      ),
    ).toMatchObject([
      { patch: { physical: { options: { database: 'mysql', charset: 'latin1' } } } },
    ]);
    expect(f.column.physical.options.onUpdate).toBeDefined();
    f.column.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:datetime',
      parameters: {},
    };
    expect(
      nativeOnUpdatePolicy(
        f.document,
        f.column,
        nativeOnUpdateInput(f.document, 'mysql:current_timestamp'),
      ),
    ).toMatchObject({
      engineAllowed: true,
      productUsable: false,
    });
    expect(nativeOnUpdateInput(f.document, 'mysql:current_timestamp')).toEqual({
      kind: 'call',
      functionId: 'mysql:current_timestamp',
      args: [],
    });
    expect(() => nativeOnUpdateInput(fixture().document, 'postgresql:current_timestamp')).toThrow(
      'column.on-update-not-supported',
    );
  });
  it('keeps safe strings as data and exposes malformed stored labels as diagnostics instead of failing render', () => {
    const f = fixture();
    const token = "x'); DROP TABLE records; --";
    expect(
      nativeDefaultInput(f.document, f.table, f.column, 'literal:string', token, false).value,
    ).toMatchObject({ value: token });
    expect(() => nativeLiteralFromToken('string', 'bad\0value')).toThrow('literal.string-invalid');
    f.column.physical.type = { kind: 'projectEnum', database: 'postgresql', enumId: 'e' };
    f.document.enums = [{ id: 'e', name: 'state', schema: 'public', values: ['bad\0value'] }];
    expect(
      nativeDefaultChoices(f.document, f.table, f.column).find(
        (item) => item.choice === 'literal:string',
      ),
    ).toMatchObject({ engineAllowed: false, code: 'literal.string-invalid' });
  });
  it('uses actual model default type/generation/argument and STRICT decisions without enabling writes', () => {
    const f = fixture();
    const clock = { kind: 'call', functionId: 'postgresql:current_timestamp', args: [] } as const;
    expect(
      nativeBuiltinDefaultPolicy(f.document, f.table, f.column, { ...clock, args: [] }),
    ).toMatchObject({ engineAllowed: false, code: 'default.type-mismatch' });
    f.column.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:timestamp',
      parameters: {},
    };
    expect(
      nativeFunctionOptionPolicies(f.document, f.table, f.column, 'default').find(
        (item) => item.id === clock.functionId,
      ),
    ).toMatchObject({ engineAllowed: true, productUsable: false });
    const initial = nativeFormatInitial(f.table, f.column);
    expect(() =>
      nativeFormatCommands(
        f.document,
        f.table,
        f.column,
        {
          ...initial,
          defaultChoice: 'expression',
          defaultFunction: clock.functionId,
          defaultExpressionMode: 'replace',
        },
        initial,
      ),
    ).toThrow('default.not-ready');
    expect(
      nativeBuiltinDefaultPolicy(f.document, f.table, f.column, {
        kind: 'binary',
        operator: '+',
        left: { kind: 'literal', literalType: 'number', value: '1' },
        right: { kind: 'literal', literalType: 'number', value: '2' },
      }),
    ).toMatchObject({ engineAllowed: false, code: 'expression.target-type-mismatch' });
    f.column.physical.generation = { kind: 'serial', database: 'postgresql' };
    expect(
      nativeBuiltinDefaultPolicy(f.document, f.table, f.column, { ...clock, args: [] }).code,
    ).toBe('generation.default-not-supported');
    const sq = fixture('sqlite');
    sq.table.physical.options = { database: 'sqlite', strict: true, withoutRowid: false };
    sq.column.physical.type = {
      kind: 'builtin',
      database: 'sqlite',
      typeId: 'sqlite:integer',
      parameters: {},
    };
    expect(
      nativeBuiltinDefaultPolicy(sq.document, sq.table, sq.column, {
        kind: 'call',
        functionId: 'sqlite:current_timestamp',
        args: [],
      }).code,
    ).toBe('default.type-mismatch');
  });
  it('consumes exact identity bounds/descending defaults and preserves the raw draft on policy rejection', () => {
    const f = fixture();
    f.column.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:smallint',
      parameters: {},
    };
    const good: NativeGeneration = {
      kind: 'identity',
      database: 'postgresql',
      mode: 'always',
      sequence: { increment: '-1', start: '-0001', cache: 20 },
    };
    expect(nativeGenerationPolicy(f.document, f.table, f.column, good)).toMatchObject({
      engineAllowed: true,
      productUsable: false,
    });
    expect(
      nativeGenerationPolicy(f.document, f.table, f.column, {
        ...good,
        sequence: { start: '32768' },
      }),
    ).toMatchObject({ engineAllowed: false, code: 'generation.sequence-range-invalid' });
    expect(
      nativeGenerationPolicy(f.document, f.table, f.column, {
        ...good,
        sequence: { increment: '0' },
      }).code,
    ).toBe('generation.sequence-increment-invalid');
    const before = nativeFormatInitial(f.table, f.column);
    const values = { ...before, generationChoice: 'identity', 'identity:start': '32768' };
    expect(() => nativeFormatCommands(f.document, f.table, f.column, values, before)).toThrow(
      'generation.sequence-range-invalid',
    );
    expect(values['identity:start']).toBe('32768');
    expect(before.generationJSON).toBe('{"kind":"none"}');
  });
  it('uses index order/competing autoincrement facts and computed-expression policy instead of inventing generation eligibility', () => {
    const f = fixture('mysql');
    f.column.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:int',
      parameters: {},
    };
    const generation: NativeGeneration = { kind: 'autoIncrement', database: 'mysql' };
    expect(nativeGenerationPolicy(f.document, f.table, f.column, generation).engineAllowed).toBe(
      false,
    );
    f.document.keys = [
      { id: 'k', tableId: 't', scope: 'physical', name: 'pk', kind: 'primary', columnIds: ['c'] },
    ];
    expect(nativeGenerationPolicy(f.document, f.table, f.column, generation)).toMatchObject({
      engineAllowed: true,
      productUsable: false,
    });
    f.document.columns!.push({
      ...f.column,
      id: 'other',
      physical: { ...f.column.physical, generation },
    });
    expect(nativeGenerationPolicy(f.document, f.table, f.column, generation).code).toBe(
      'generation.multiple-columns',
    );
    expect(
      nativeGenerationPolicy(f.document, f.table, f.column, {
        kind: 'computed',
        database: 'mysql',
        storage: 'stored',
        expression: { kind: 'literal', literalType: 'number', value: '1' },
      }).code,
    ).toBe('generation.not-ready');
  });
  it('uses actual ON UPDATE type/generation rules and keeps a supported candidate blocked by readiness', () => {
    const f = fixture('mysql');
    const expression = nativeOnUpdateInput(f.document, 'mysql:current_timestamp');
    expect(nativeOnUpdatePolicy(f.document, f.column, expression).code).toBe(
      'column.on-update-not-supported',
    );
    f.column.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:timestamp',
      parameters: {},
    };
    expect(nativeOnUpdatePolicy(f.document, f.column, expression)).toMatchObject({
      engineAllowed: true,
      productUsable: false,
    });
    const before = nativeFormatInitial(f.table, f.column);
    expect(() =>
      nativeFormatCommands(
        f.document,
        f.table,
        f.column,
        { ...before, onUpdateMode: 'function', onUpdateFunction: 'mysql:current_timestamp' },
        before,
      ),
    ).toThrow('column.on-update.not-ready');
    expect(
      nativeOnUpdatePolicy(f.document, f.column, expression, {
        kind: 'autoIncrement',
        database: 'mysql',
      }).code,
    ).toBe('generation.on-update-not-supported');
  });
  it('checks a preserved NULL default before changing nullable and keeps explicit none recovery available', () => {
    const f = fixture();
    f.column.physical.nullable = true;
    f.column.physical.defaultValue = { kind: 'null' };
    const before = nativeFormatInitial(f.table, f.column);
    expect(() =>
      nativeFormatCommands(f.document, f.table, f.column, { ...before, nullable: 'false' }, before),
    ).toThrow('default.null-not-supported');
    expect(
      nativeFormatCommands(
        f.document,
        f.table,
        f.column,
        { ...before, nullable: 'false', defaultChoice: 'none' },
        before,
      ),
    ).toMatchObject([{ patch: { physical: { nullable: false, defaultValue: { kind: 'none' } } } }]);
  });
  it('keeps a stale DB-context draft unchanged and disables submission and rebase', () => {
    setLocale('ko');
    const f = fixture();
    const before = nativeFormatInitial(f.table, f.column);
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    });
    const draft = {
      userId: f.context.userId,
      projectId: f.context.snapshot.project.id,
      key: 'format:column:c',
      revision: uuid,
      expected: { version: 7, sequence: 11, databaseRevision: 2 },
      before,
      values: { ...before, defaultValue: '20e-' },
    };
    storeNativeEditorDraft(draft);
    const html = renderToStaticMarkup(createElement(NativeFormatEditor, f));
    expect(html).toContain('DB 설정이 변경되었습니다. 입력을 확인하고 초기화해 주세요.');
    expect(html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0]).toContain('disabled=""');
    expect(loadNativeEditorDraft(draft.userId, draft.projectId, draft.key)).toEqual(draft);
    expect(f.context.onSave).not.toHaveBeenCalled();
  });
  it('disables all interactive fields while an ACK is pending without altering default/generation originals', () => {
    const f = fixture('mysql');
    f.context.busy = true;
    const before = structuredClone(f.document);
    const html = renderToStaticMarkup(createElement(NativeFormatEditor, f));
    expect(html).toContain('<fieldset disabled="">');
    expect(f.document).toEqual(before);
    expect(f.context.onSave).not.toHaveBeenCalled();
  });
});
