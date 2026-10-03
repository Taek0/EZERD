import {
  nativeEditorCommandSchema,
  nativeStoredDesignDocumentSchema,
  nativeColumnTypeSchema,
  MAX_DOCUMENT_BYTES,
} from '@ezerd/contracts';
import {
  checkDatabaseFeature,
  getDatabaseType,
  inspectNativeDatabaseDocument,
  validateDatabaseDocument,
  type NativeDesignDocument,
  type NativeTableKey,
  type NativeTableRelation,
  type NativeColumn,
  type NativeTable,
} from '@ezerd/model';
import { nativeEditorErrorCode } from './native-editor-diagnostic.js';
import { nativeBoundedInteger } from './native-editor-option-policy.js';
import { parseNativeLabels } from './native-label-draft.js';

type StoredOptions = { deferrable?: NativeTableKey['deferrable']; nullsNotDistinct?: boolean };
type Options = {
  deferrable?: NonNullable<NativeTableKey['deferrable']> | null;
  nullsNotDistinct?: boolean;
};
export function nativeConstraintOptionsInitial(
  current: StoredOptions = {},
): Record<string, string> {
  return {
    deferrability: current.deferrable?.initially ?? 'none',
    nullsNotDistinct: String(current.nullsNotDistinct ?? false),
  };
}
/** Pure partial payload preparation. Callers separately enforce real readiness before emitting commands. */
export function nativeConstraintOptionsPatch(
  kind: 'key' | 'foreignKey',
  values: Record<string, string>,
  before: Record<string, string> = {},
  current: StoredOptions = {},
): Options {
  const original = { ...nativeConstraintOptionsInitial(current), ...before },
    patch: Options = {};
  const mode = values.deferrability;
  if (mode !== undefined && mode !== original.deferrability) {
    if (!['none', 'immediate', 'deferred'].includes(mode))
      throw Error('native.deferrability-input-invalid');
    if (mode === 'none') {
      if (current.deferrable) patch.deferrable = null;
    } else patch.deferrable = { initially: mode as 'immediate' | 'deferred' };
  }
  if (
    kind === 'key' &&
    values.nullsNotDistinct !== undefined &&
    values.nullsNotDistinct !== original.nullsNotDistinct
  ) {
    if (!['true', 'false'].includes(values.nullsNotDistinct)) throw Error('native.boolean-invalid');
    patch.nullsNotDistinct = values.nullsNotDistinct === 'true';
  }
  return patch;
}
export function nativeConstraintOptionsDecision(
  document: NativeDesignDocument,
  kind: 'key' | 'foreignKey',
  item: NativeTableKey | NativeTableRelation,
  patch: Options,
) {
  try {
    if (
      item.scope === 'logical' ||
      (kind === 'foreignKey' && !('physical' in item && item.physical))
    )
      throw Error('native.advanced-physical-object-required');
    const candidate = structuredClone(document);
    const value = { ...item, ...patch };
    if (patch.deferrable === null) delete value.deferrable;
    if (kind === 'key')
      candidate.keys = candidate.keys?.some((k) => k.id === item.id)
        ? candidate.keys.map((k) => (k.id === item.id ? (value as NativeTableKey) : k))
        : [...(candidate.keys ?? []), value as NativeTableKey];
    else
      candidate.tableRelations = candidate.tableRelations?.some((r) => r.id === item.id)
        ? candidate.tableRelations.map((r) =>
            r.id === item.id ? (value as NativeTableRelation) : r,
          )
        : [...(candidate.tableRelations ?? []), value as NativeTableRelation];
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > MAX_DOCUMENT_BYTES)
      throw Error('document.size-limit');
    nativeStoredDesignDocumentSchema.parse(candidate);
    nativeEditorCommandSchema.parse({
      type: kind === 'key' ? 'patch_key' : 'patch_foreign_key',
      id: item.id,
      patch,
    });
    const issues = inspectNativeDatabaseDocument(candidate, candidate.database);
    const errors = issues.filter((i) => i.severity === 'error');
    const write = validateDatabaseDocument(candidate, candidate.database, { mode: 'write' });
    return {
      allowed: !errors.length,
      usable: !errors.length && !write.some((i) => i.severity === 'error'),
      issues: [...issues, ...write],
      code: errors[0]?.code ?? write.find((i) => i.severity === 'error')?.code,
      candidate,
    };
  } catch (error) {
    return { allowed: false, usable: false, issues: [], code: nativeEditorErrorCode(error) };
  }
}
export function nativeEnumOptionsDecision(
  document: NativeDesignDocument,
  id: string,
  name: string,
  schema: string,
  text: string,
) {
  let byteCounts: number[] = [];
  try {
    const values = parseNativeLabels(text);
    byteCounts = values.map((value) => new TextEncoder().encode(value).byteLength);
    const candidate = structuredClone(document);
    candidate.enums = [
      ...(candidate.enums ?? []).filter((e) => e.id !== id),
      { id, name, schema, values },
    ];
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > MAX_DOCUMENT_BYTES)
      throw Error('document.size-limit');
    nativeStoredDesignDocumentSchema.parse(candidate);
    const issues = inspectNativeDatabaseDocument(candidate, candidate.database).filter(
      (i) => i.severity === 'error' && i.objectId === id,
    );
    const policy = checkDatabaseFeature(document.database, 'enumType');
    return {
      allowed: policy.supported && !issues.length,
      usable:
        policy.usable &&
        !validateDatabaseDocument(candidate, candidate.database, { mode: 'write' }).some(
          (i) => i.severity === 'error',
        ),
      byteCounts,
      code: issues[0]?.code ?? policy.code,
    };
  } catch (error) {
    return { allowed: false, usable: false, byteCounts, code: nativeEditorErrorCode(error) };
  }
}
export function nativeSelectedArrayPolicy(
  document: NativeDesignDocument,
  table: NativeTable,
  column: NativeColumn,
  selection: string,
  resetGeneration = false,
) {
  return checkDatabaseFeature(document.database, 'array', {
    ...(selection.startsWith('enum:')
      ? { projectEnum: true }
      : { typeId: selection as `${'postgresql' | 'mysql' | 'sqlite'}:${string}` }),
    strict: table.physical.options.database === 'sqlite' && table.physical.options.strict,
    generation: resetGeneration ? 'none' : column.physical.generation.kind,
  });
}

/** SRID constraints, including installation verification, come from the common inspector. */
export function nativeSridParameterDecision(
  document: NativeDesignDocument,
  column: NativeColumn,
  typeId: string,
  token: string,
) {
  try {
    const definition = getDatabaseType(typeId as `${'postgresql' | 'mysql' | 'sqlite'}:${string}`),
      rule = definition?.parameters.srid;
    if (
      !definition ||
      definition.databaseKind !== document.database.kind ||
      rule?.kind !== 'integer'
    )
      throw Error('type.option-not-supported');
    const type = nativeColumnTypeSchema.parse({
      kind: 'builtin',
      database: document.database.kind,
      typeId,
      parameters: token === '' ? {} : { srid: nativeBoundedInteger(token, rule.min, rule.max) },
    }) as NativeColumn['physical']['type'];
    const candidate = structuredClone(document);
    // Probe the mandatory physical payload as well when its owner currently has logical scope.
    candidate.tables = candidate.tables?.map((t) =>
      t.id === column.tableId && t.scope === 'logical' ? { ...t, scope: 'physical' } : t,
    );
    candidate.columns = candidate.columns?.map((c) =>
      c.id === column.id
        ? {
            ...c,
            scope: c.scope === 'logical' ? 'physical' : c.scope,
            physical: { ...c.physical, type },
          }
        : c,
    );
    const issue = inspectNativeDatabaseDocument(candidate, candidate.database).find(
      (i) =>
        i.severity === 'error' &&
        i.objectId === column.id &&
        i.path.endsWith('/type/parameters/srid'),
    );
    const policy =
      token === ''
        ? checkDatabaseFeature(document.database, 'column')
        : checkDatabaseFeature(document.database, 'srid', { typeId: definition.id });
    return {
      allowed: !issue && policy.supported,
      usable: !issue && policy.usable,
      code: issue?.code ?? policy.code,
    };
  } catch (error) {
    return { allowed: false, usable: false, code: nativeEditorErrorCode(error) };
  }
}
