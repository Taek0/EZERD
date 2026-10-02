import {
  nativeEditorCommandSchema,
  nativeStoredDesignDocumentSchema,
  MAX_DOCUMENT_BYTES,
} from '@ezerd/contracts';
import {
  inspectNativeDatabaseDocument,
  validateDatabaseDocument,
  nativeReferenceProblems,
  nativePostgresIndexMethodDecision,
  nativeExpressionDecision,
  nativeExpressionDisplay,
  requestFingerprint,
  checkDatabaseFeature,
  type NativeDesignDocument,
  type NativeTable,
  type NativeIndex,
  type NativeColumn,
  type NativeExpression,
  type NativeExpressionPolicyFacts,
  type NativeGeneration,
  type DatabaseIssue,
} from '@ezerd/model';
import type { NativeWebCommand } from './native-save.js';
import { nativeEditorErrorCode } from './native-editor-diagnostic.js';
import {
  nativeGenerationPolicy,
  nativeBuiltinDefaultPolicy,
} from './native-editor-option-policy.js';
import {
  nativeAstDraft,
  nativeAstExpression,
  nativeAstSeed,
  readNativeAstDraft,
  assertNativeAstDraft,
  type NativeAstDraft,
} from './native-expression-tree-policy.js';

export interface NativeIndexPartDraft {
  expression: NativeAstDraft;
  direction: 'asc' | 'desc';
  prefix: string;
}
export interface NativeIndexDraft {
  name: string;
  unique: string;
  parts: NativeIndexPartDraft[];
  options:
    | {
        database: 'postgresql';
        method: 'btree' | 'hash' | 'gist' | 'spgist' | 'gin' | 'brin';
        includeColumnIds: string[];
        nullsNotDistinct: string;
        predicate: NativeAstDraft | null;
      }
    | { database: 'mysql'; kind: 'btree' | 'fulltext' | 'spatial'; invisible: string }
    | { database: 'sqlite'; predicate: NativeAstDraft | null };
}
export interface NativeAdvancedCandidate {
  allowed: boolean;
  usable: boolean;
  preserved: boolean;
  code?: string;
  issues: DatabaseIssue[];
  candidate?: NativeDesignDocument;
  command?: NativeWebCommand;
}
export type NativeExpressionTarget =
  | { kind: 'default' | 'computed'; columnId: string }
  | { kind: 'check'; id: string; create: boolean };
const json = (value: unknown) => JSON.stringify(value);
const same = (a: unknown, b: unknown) => requestFingerprint(a) === requestFingerprint(b);
const errorCode = (cause: unknown) => nativeEditorErrorCode(cause, 'native.advanced-input-invalid');
const clone = <T>(value: T): T => structuredClone(value);
function boolean(value: string) {
  if (value !== 'true' && value !== 'false') throw Error('native.boolean-invalid');
  return value === 'true';
}
function prefix(value: string) {
  if (value === '') return undefined;
  if (!/^[1-9]\d*$/.test(value) || value.length > 10 || BigInt(value) > 2147483647n)
    throw Error('index.prefix-input-incomplete');
  return Number(value);
}
function owner(document: NativeDesignDocument, table: NativeTable) {
  if (table.scope === 'logical' || !document.tables?.some((t) => t.id === table.id))
    throw Error('native.advanced-physical-table-required');
  if (table.physical.options.database !== document.database.kind)
    throw Error('database.context-changed');
}
export function nativeAdvancedExpressionFacts(
  document: NativeDesignDocument,
  table: NativeTable,
  purpose: NativeExpressionPolicyFacts['purpose'],
  column?: NativeColumn,
): NativeExpressionPolicyFacts {
  return {
    columns: document.columns ?? [],
    tableId: table.id,
    purpose,
    strict: table.physical.options.database === 'sqlite' && table.physical.options.strict,
    ...(column
      ? {
          targetType: column.physical.type,
          nullable: column.physical.nullable,
          primary: !!document.keys?.some(
            (k) =>
              k.tableId === table.id &&
              k.scope !== 'logical' &&
              k.kind === 'primary' &&
              k.columnIds.includes(column.id),
          ),
        }
      : {}),
  };
}
function inspect(
  candidate: NativeDesignDocument,
  command: NativeWebCommand,
  readiness: boolean,
): NativeAdvancedCandidate {
  if (new TextEncoder().encode(json(candidate)).byteLength > MAX_DOCUMENT_BYTES)
    throw Error('document.size-limit');
  nativeStoredDesignDocumentSchema.parse(candidate);
  nativeEditorCommandSchema.parse(command);
  const graph: DatabaseIssue[] = nativeReferenceProblems(candidate).map(
    ({ cause: _cause, ...issue }) => ({
      ...issue,
      category: 'invalid',
      severity: 'error',
      params: {},
    }),
  );
  const issues = [...graph, ...inspectNativeDatabaseDocument(candidate, candidate.database)];
  const allowed = !issues.some((issue) => issue.severity === 'error');
  const write = validateDatabaseDocument(candidate, candidate.database, { mode: 'write' });
  return {
    allowed,
    usable: allowed && readiness && !write.some((issue) => issue.severity === 'error'),
    preserved: false,
    issues: [...issues, ...write],
    candidate,
    command,
    ...(!allowed
      ? {
          code: issues.find((i) => i.severity === 'error')?.code ?? 'native.advanced-not-supported',
        }
      : !readiness || write.some((i) => i.severity === 'error')
        ? { code: 'feature.not-implemented' }
        : {}),
  };
}
export function nativeIndexDraft(
  document: NativeDesignDocument,
  table: NativeTable,
  current?: NativeIndex,
): NativeIndexDraft {
  const columns = (document.columns ?? []).filter(
    (c) => c.tableId === table.id && c.scope !== 'logical',
  );
  const options = current?.options;
  return {
    name: current?.name ?? '',
    unique: String(current?.unique ?? false),
    parts:
      current?.parts.map((p) => ({
        expression: nativeAstDraft(p.expression),
        direction: p.direction,
        prefix: p.prefixLength === undefined ? '' : String(p.prefixLength),
      })) ??
      (columns[0]
        ? [
            {
              expression: { kind: 'column', columnId: columns[0].id },
              direction: 'asc',
              prefix: '',
            },
          ]
        : []),
    options:
      options?.database === 'postgresql'
        ? {
            database: 'postgresql',
            method: options.method,
            includeColumnIds: [...(options.includeColumnIds ?? [])],
            nullsNotDistinct: String(options.nullsNotDistinct ?? false),
            predicate: options.predicate ? nativeAstDraft(options.predicate) : null,
          }
        : options?.database === 'mysql'
          ? { database: 'mysql', kind: options.kind, invisible: String(options.invisible ?? false) }
          : options?.database === 'sqlite'
            ? {
                database: 'sqlite',
                predicate: options.predicate ? nativeAstDraft(options.predicate) : null,
              }
            : document.database.kind === 'postgresql'
              ? {
                  database: 'postgresql',
                  method: 'btree',
                  includeColumnIds: [],
                  nullsNotDistinct: 'false',
                  predicate: null,
                }
              : document.database.kind === 'mysql'
                ? { database: 'mysql', kind: 'btree', invisible: 'false' }
                : { database: 'sqlite', predicate: null },
  };
}
export function readNativeIndexDraft(text: string): NativeIndexDraft {
  if (new TextEncoder().encode(text).byteLength > 1_000_000) throw Error('index.draft-too-large');
  const draft = JSON.parse(text) as NativeIndexDraft;
  if (
    !draft ||
    typeof draft.name !== 'string' ||
    typeof draft.unique !== 'string' ||
    !Array.isArray(draft.parts) ||
    draft.parts.length > 32
  )
    throw Error('index.draft-invalid');
  boolean(draft.unique);
  for (const part of draft.parts) {
    if (!part || !['asc', 'desc'].includes(part.direction) || typeof part.prefix !== 'string')
      throw Error('index.draft-invalid');
    assertNativeAstDraft(part.expression);
  }
  const options = draft.options;
  if (!options || typeof options !== 'object') throw Error('index.draft-invalid');
  if (options.database === 'postgresql') {
    if (
      !['btree', 'hash', 'gist', 'spgist', 'gin', 'brin'].includes(options.method) ||
      !Array.isArray(options.includeColumnIds) ||
      options.includeColumnIds.length > 32 ||
      options.includeColumnIds.some((id) => typeof id !== 'string')
    )
      throw Error('index.draft-invalid');
    boolean(options.nullsNotDistinct);
    if (options.predicate !== null) assertNativeAstDraft(options.predicate);
  } else if (options.database === 'mysql') {
    if (!['btree', 'fulltext', 'spatial'].includes(options.kind))
      throw Error('index.draft-invalid');
    boolean(options.invisible);
  } else if (options.database === 'sqlite') {
    if (options.predicate !== null) assertNativeAstDraft(options.predicate);
  } else throw Error('index.draft-invalid');
  const optionKeys =
    options.database === 'postgresql'
      ? ['database', 'method', 'includeColumnIds', 'nullsNotDistinct', 'predicate']
      : options.database === 'mysql'
        ? ['database', 'kind', 'invisible']
        : ['database', 'predicate'];
  if (
    Object.keys(draft).some((k) => !['name', 'unique', 'parts', 'options'].includes(k)) ||
    Object.keys(options).some((k) => !optionKeys.includes(k)) ||
    draft.parts.some((p) =>
      Object.keys(p).some((k) => !['expression', 'direction', 'prefix'].includes(k)),
    )
  )
    throw Error('index.draft-invalid');
  return draft;
}
export function nativeIndexCandidate(
  document: NativeDesignDocument,
  table: NativeTable,
  id: string,
  draft: NativeIndexDraft,
  existing = false,
): NativeAdvancedCandidate {
  try {
    owner(document, table);
    readNativeIndexDraft(json(draft));
    const before = existing
      ? document.indexes?.find((i) => i.id === id && i.tableId === table.id)
      : undefined;
    if (existing && !before) throw Error('index.not-found');
    if (draft.options.database !== document.database.kind) throw Error('index.context-mismatch');
    if (before && same(nativeIndexDraft(document, table, before), draft))
      return { allowed: true, usable: false, preserved: true, issues: [] };
    if (before?.scope === 'logical') throw Error('native.advanced-physical-object-required');
    const originalDraft = before ? nativeIndexDraft(document, table, before) : undefined;
    if (!draft.parts.length)
      throw Error(
        (document.columns ?? []).some((c) => c.tableId === table.id && c.scope !== 'logical')
          ? 'index.key-parts-required'
          : 'index.key-columns-required',
      );
    const parts =
      before && originalDraft && same(originalDraft.parts, draft.parts)
        ? clone(before.parts)
        : draft.parts.map((p) => {
            const length = prefix(p.prefix);
            return {
              expression: nativeAstExpression(p.expression),
              direction: p.direction,
              ...(length === undefined ? {} : { prefixLength: length }),
            };
          });
    const o = draft.options;
    const options: NativeIndex['options'] =
      before && originalDraft && same(originalDraft.options, draft.options)
        ? clone(before.options)
        : o.database === 'mysql'
          ? {
              database: 'mysql',
              kind: o.kind,
              ...(boolean(o.invisible) ? { invisible: true } : {}),
            }
          : o.database === 'postgresql'
            ? {
                database: 'postgresql',
                method: o.method,
                ...(o.includeColumnIds.length ? { includeColumnIds: [...o.includeColumnIds] } : {}),
                ...(boolean(o.nullsNotDistinct) ? { nullsNotDistinct: true } : {}),
                ...(o.predicate ? { predicate: nativeAstExpression(o.predicate) } : {}),
              }
            : {
                database: 'sqlite',
                ...(o.predicate ? { predicate: nativeAstExpression(o.predicate) } : {}),
              };
    if (
      o.database === 'postgresql' &&
      new Set(o.includeColumnIds).size !== o.includeColumnIds.length
    )
      throw Error('index.include-columns-duplicate');
    const value: NativeIndex = {
      id,
      tableId: table.id,
      scope: before?.scope ?? 'physical',
      name: draft.name,
      unique: boolean(draft.unique),
      parts,
      options,
    };
    let ready = checkDatabaseFeature(document.database, 'index').usable;
    for (const part of parts) {
      const facts = nativeAdvancedExpressionFacts(document, table, 'index');
      const expression = nativeExpressionDecision(document.database, part.expression, facts);
      if (!expression.allowed) throw Error(expression.code ?? 'expression.not-supported');
      // Direct column indexes use their real type (including PG array/enum), not inferred scalar family.
      if (part.expression.kind !== 'column')
        ready =
          ready &&
          expression.usable &&
          checkDatabaseFeature(document.database, 'expressionIndex').usable;
      if (options.database === 'postgresql') {
        const columnId = part.expression.kind === 'column' ? part.expression.columnId : undefined;
        const column = columnId ? document.columns?.find((c) => c.id === columnId) : undefined;
        const method = nativePostgresIndexMethodDecision(
          document.database,
          options.method,
          column?.physical.type,
          expression.result,
        );
        if (!method.allowed) throw Error(method.code ?? 'index.method-not-supported');
        ready = ready && method.usable;
      }
    }
    if (options.database === 'mysql' && options.kind !== 'btree')
      ready =
        ready &&
        checkDatabaseFeature(
          document.database,
          options.kind === 'fulltext' ? 'fullTextIndex' : 'spatialIndex',
        ).usable;
    if ('predicate' in options && options.predicate) {
      const policy = nativeExpressionDecision(
        document.database,
        options.predicate,
        nativeAdvancedExpressionFacts(document, table, 'predicate'),
      );
      if (!policy.allowed) throw Error(policy.code ?? 'expression.not-supported');
      ready =
        ready && policy.usable && checkDatabaseFeature(document.database, 'partialIndex').usable;
    }
    if (options.database === 'postgresql' && options.includeColumnIds?.length)
      ready = ready && checkDatabaseFeature(document.database, 'includedIndexColumns').usable;
    if (options.database === 'postgresql' && options.nullsNotDistinct)
      ready = ready && checkDatabaseFeature(document.database, 'nullsNotDistinct').usable;
    if (value.unique) ready = ready && checkDatabaseFeature(document.database, 'unique').usable;
    const candidate = clone(document);
    candidate.indexes = existing
      ? (candidate.indexes ?? []).map((i) => (i.id === id ? value : i))
      : [...(candidate.indexes ?? []), value];
    const command: NativeWebCommand =
      existing && before
        ? {
            type: 'patch_index',
            id,
            patch: {
              ...(value.name !== before.name ? { name: value.name } : {}),
              ...(value.unique !== before.unique ? { unique: value.unique } : {}),
              ...(!same(parts, before.parts) ? { parts } : {}),
              ...(!same(options, before.options) ? { options } : {}),
            },
          }
        : { type: 'add_index', value };
    return inspect(candidate, command, ready);
  } catch (error) {
    return { allowed: false, usable: false, preserved: false, issues: [], code: errorCode(error) };
  }
}
export function nativeIndexMethodChoices(
  document: NativeDesignDocument,
  table: NativeTable,
  draft: NativeIndexDraft,
  indexId?: string,
) {
  if (document.database.kind === 'sqlite') return [];
  const methods =
    document.database.kind === 'postgresql'
      ? ['btree', 'hash', 'gist', 'spgist', 'gin', 'brin']
      : ['btree', 'fulltext', 'spatial'];
  return methods.map((method) => {
    const probe = clone(draft);
    probe.name = probe.name || 'index_preview';
    if (probe.options.database === 'postgresql')
      probe.options.method = method as typeof probe.options.method;
    else if (probe.options.database === 'mysql')
      probe.options.kind = method as typeof probe.options.kind;
    const policy = nativeIndexOptionProbe(document, table, probe, indexId);
    return { method, ...policy };
  });
}
export function nativeIndexOptionProbe(
  document: NativeDesignDocument,
  table: NativeTable,
  draft: NativeIndexDraft,
  indexId?: string,
) {
  const value = clone(draft);
  if (
    indexId &&
    document.indexes?.some((index) => index.id === indexId && index.tableId === table.id)
  )
    return nativeIndexCandidate(document, table, indexId, value, true);
  const objects = [
    ...document.domains,
    ...document.notes,
    ...(document.tables ?? []),
    ...(document.columns ?? []),
    ...(document.keys ?? []),
    ...(document.indexes ?? []),
    ...(document.checks ?? []),
    ...(document.enums ?? []),
    ...(document.tableRelations ?? []),
    ...document.domainRelations,
    ...(document.views ?? []),
  ];
  let i = 0;
  while (
    objects.some((object) => object.id === `native-index-policy-preview-${i}`) ||
    (document.indexes ?? []).some((index) => index.name === `native_index_preview_${i}`)
  )
    i++;
  value.name = `native_index_preview_${i}`;
  return nativeIndexCandidate(document, table, `native-index-policy-preview-${i}`, value);
}
export function nativeExpressionInitial(
  document: NativeDesignDocument,
  table: NativeTable,
  target: NativeExpressionTarget,
) {
  const column =
    target.kind === 'check'
      ? undefined
      : document.columns?.find((c) => c.id === target.columnId && c.tableId === table.id);
  const check =
    target.kind === 'check' && !target.create
      ? document.checks?.find((c) => c.id === target.id && c.tableId === table.id)
      : undefined;
  const original =
    target.kind === 'default'
      ? column?.physical.defaultValue
      : target.kind === 'computed'
        ? column?.physical.generation
        : check?.expression;
  const expression: NativeExpression | undefined =
    target.kind === 'default' && column?.physical.defaultValue.kind === 'expression'
      ? column.physical.defaultValue.expression
      : target.kind === 'computed' && column?.physical.generation.kind === 'computed'
        ? column.physical.generation.expression
        : check?.expression;
  const col = (document.columns ?? []).find((c) => c.tableId === table.id && c.scope !== 'logical');
  const seed: NativeAstDraft =
    target.kind === 'check'
      ? {
          kind: 'binary',
          operator: 'AND',
          left: {
            kind: 'binary',
            operator: '>',
            left: { kind: 'column', columnId: col?.id ?? '' },
            right: { kind: 'literal', literalType: 'number', value: '0' },
          },
          right: {
            kind: 'isNull',
            operand: { kind: 'column', columnId: col?.id ?? '' },
            negate: true,
          },
        }
      : nativeAstSeed('literal', document.database);
  return {
    expressionDraftJSON: json(expression ? nativeAstDraft(expression) : seed),
    id: target.kind === 'check' ? target.id : target.columnId,
    originalJSON: json(original ?? null),
    originalTypeJSON: json(column?.physical.type ?? null),
    mode: target.kind === 'check' && target.create ? 'replace' : 'preserve',
    name: check?.name ?? '',
    storage:
      column?.physical.generation.kind === 'computed'
        ? column.physical.generation.storage
        : 'stored',
  };
}
export function nativeExpressionCandidate(
  document: NativeDesignDocument,
  table: NativeTable,
  target: NativeExpressionTarget,
  values: Record<string, string>,
  before: Record<string, string>,
): NativeAdvancedCandidate {
  try {
    owner(document, table);
    const current = nativeExpressionInitial(document, table, target);
    if (
      current.originalJSON !== before.originalJSON ||
      current.originalTypeJSON !== before.originalTypeJSON ||
      values.originalTypeJSON !== before.originalTypeJSON ||
      values.originalJSON !== before.originalJSON
    )
      throw Error('native.advanced-source-changed');
    if (
      values.id !== before.id ||
      (target.kind !== 'check' && values.id !== target.columnId) ||
      (target.kind === 'check' && !target.create && values.id !== target.id)
    )
      throw Error('native.advanced-source-changed');
    if (values.mode === 'preserve')
      return { allowed: true, usable: false, preserved: true, issues: [] };
    if (values.mode !== 'replace' && values.mode !== 'clear')
      throw Error('native.advanced-mode-invalid');
    const candidate = clone(document);
    let command: NativeWebCommand;
    let ready = true;
    const column =
      target.kind === 'check'
        ? undefined
        : document.columns?.find(
            (c) => c.id === target.columnId && c.tableId === table.id && c.scope !== 'logical',
          );
    if (target.kind !== 'check' && !column) throw Error('expression.column-not-found');
    const expression =
      values.mode === 'clear'
        ? undefined
        : nativeAstExpression(readNativeAstDraft(values.expressionDraftJSON ?? ''));
    if (expression) {
      const policy = nativeExpressionDecision(
        document.database,
        expression,
        nativeAdvancedExpressionFacts(
          document,
          table,
          target.kind === 'computed' ? 'computed' : target.kind,
          column,
        ),
      );
      if (!policy.allowed) throw Error(policy.code ?? 'expression.not-supported');
      ready = policy.usable;
    }
    if (target.kind === 'default' && column) {
      const defaultValue = expression
        ? { kind: 'expression' as const, expression }
        : { kind: 'none' as const };
      if (expression?.kind === 'call') {
        const decision = nativeBuiltinDefaultPolicy(document, table, column, expression);
        if (!decision.engineAllowed) throw Error(decision.code ?? 'default.not-supported');
        ready = ready && decision.productUsable;
      }
      candidate.columns = candidate.columns!.map((c) =>
        c.id === column.id ? { ...c, physical: { ...c.physical, defaultValue } } : c,
      );
      command = { type: 'patch_column', id: column.id, patch: { physical: { defaultValue } } };
    } else if (target.kind === 'computed' && column) {
      if (values.storage !== 'stored' && values.storage !== 'virtual')
        throw Error('generation.storage-not-supported');
      const generation: NativeGeneration = expression
        ? {
            kind: 'computed',
            database: document.database.kind,
            storage: values.storage,
            expression,
          }
        : { kind: 'none' };
      const policy = nativeGenerationPolicy(document, table, column, generation);
      if (!policy.engineAllowed) throw Error(policy.code ?? 'generation.not-supported');
      ready = ready && policy.productUsable;
      candidate.columns = candidate.columns!.map((c) =>
        c.id === column.id ? { ...c, physical: { ...c.physical, generation } } : c,
      );
      command = { type: 'patch_column', id: column.id, patch: { physical: { generation } } };
    } else if (target.kind === 'check') {
      if (!expression) throw Error('check.expression-required');
      const original = document.checks?.find((c) => c.id === target.id && c.tableId === table.id);
      if (!target.create && !original) throw Error('check.not-found');
      if (original?.scope === 'logical') throw Error('native.advanced-physical-object-required');
      const value = {
        id: target.create ? values.id! : target.id,
        tableId: table.id,
        name: values.name ?? '',
        scope: original?.scope ?? ('physical' as const),
        expression,
      };
      candidate.checks = target.create
        ? [...(candidate.checks ?? []), value]
        : (candidate.checks ?? []).map((c) => (c.id === target.id ? value : c));
      command = target.create
        ? { type: 'add_check', value }
        : { type: 'patch_check', id: target.id, patch: { name: value.name, expression } };
      ready = ready && checkDatabaseFeature(document.database, 'check').usable;
    } else throw Error('native.advanced-target-invalid');
    if (same(candidate, document))
      return { allowed: true, usable: false, preserved: true, issues: [] };
    return inspect(candidate, command, ready);
  } catch (error) {
    return { allowed: false, usable: false, preserved: false, issues: [], code: errorCode(error) };
  }
}
export function nativeAdvancedCommands(
  status: NativeAdvancedCandidate,
  readOnly = false,
): NativeWebCommand[] {
  if (readOnly) throw Error('project.read-only');
  if (status.preserved) return [];
  if (!status.allowed || !status.usable || !status.command)
    throw Error(status.code ?? 'feature.not-implemented');
  return [status.command];
}
export function nativeAdvancedOriginalLabel(
  document: NativeDesignDocument,
  target: NativeExpressionTarget,
) {
  if (target.kind === 'check') {
    const value = document.checks?.find((c) => c.id === target.id);
    return value ? nativeExpressionDisplay(value.expression, document) : '';
  }
  const column = document.columns?.find((c) => c.id === target.columnId);
  const value =
    target.kind === 'default' ? column?.physical.defaultValue : column?.physical.generation;
  return value && 'expression' in value
    ? nativeExpressionDisplay(value.expression, document)
    : value && 'original' in value
      ? value.original
      : (value?.kind ?? '');
}
/** A recovery hint selects only an existing owner-scoped form, never creates a missing object. */
export function nativeAdvancedSelectionValid(
  document: NativeDesignDocument,
  table: NativeTable,
  selection: string,
): boolean {
  if (!document.tables?.some((t) => t.id === table.id)) return false;
  if (selection === 'index:new' || selection === 'check:new') return true;
  try {
    const value: unknown = JSON.parse(selection);
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== 'string' ||
      typeof value[1] !== 'string'
    )
      return false;
    const [kind, id] = value;
    if (kind === 'index')
      return !!document.indexes?.some((i) => i.id === id && i.tableId === table.id);
    if (kind === 'check')
      return !!document.checks?.some((i) => i.id === id && i.tableId === table.id);
    return (
      (kind === 'default' || kind === 'computed') &&
      !!document.columns?.some(
        (c) => c.id === id && c.tableId === table.id && c.scope !== 'logical',
      )
    );
  } catch {
    return false;
  }
}
