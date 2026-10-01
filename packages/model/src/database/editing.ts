import { TABLES_VIEW_ID, type CustomProperties, type ModelScope } from '../document.js';
import type { DatabaseContext, DatabaseKind } from './definitions.js';
import { getDatabaseType } from './catalog.js';
import { getDatabaseProfile } from './profiles.js';
import { inspectNativeDatabaseDocument, inspectNativeLegacyChanges } from './validation.js';
import type {
  NativeColumn,
  NativeColumnType,
  NativeDesignDocument,
  NativeTable,
} from './native-document.js';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const emptyProperties = (): CustomProperties => ({ common: {}, logical: {}, physical: {} });
function identity(id: string) {
  if (
    !id.trim() ||
    id !== id.trim() ||
    id.length > 160 ||
    id === 'overview' ||
    id === TABLES_VIEW_ID
  )
    throw new Error('document.invalid-identity');
}
function context(document: NativeDesignDocument): DatabaseContext {
  if (document.schemaVersion !== 2) throw new Error('document.version-not-supported');
  getDatabaseProfile(document.database);
  return document.database;
}
function newIds(document: NativeDesignDocument, ids: readonly string[]) {
  const objects = [
    ...document.domains,
    ...document.domainRelations,
    ...document.notes,
    ...(document.views ?? []),
    ...(document.tables ?? []),
    ...(document.columns ?? []),
    ...(document.keys ?? []),
    ...(document.tableRelations ?? []),
    ...(document.enums ?? []),
    ...(document.indexes ?? []),
    ...(document.checks ?? []),
    ...document.layout.nodes,
  ];
  const occupied = new Set(objects.map((item) => item.id));
  if (new Set(ids).size !== ids.length) throw new Error('document.duplicate-identities');
  for (const id of ids) {
    identity(id);
    if (occupied.has(id)) throw new Error('document.duplicate-identities');
  }
}
function tableContext(table: NativeTable, database: DatabaseContext) {
  if (table.physical.options.database !== database.kind)
    throw new Error('database.context-changed');
}
function columnContext(column: NativeColumn, database: DatabaseContext) {
  if (
    column.physical.options.database !== database.kind ||
    (column.physical.type.kind !== 'legacy' && column.physical.type.database !== database.kind)
  )
    throw new Error('database.context-changed');
}
function noNewLegacy(candidate: NativeDesignDocument, previous: NativeDesignDocument) {
  const issue = inspectNativeLegacyChanges(candidate, previous)[0];
  if (issue) throw new Error(issue.code);
}

/** An editor draft, not a write authorization; callers must validate the complete candidate. */
export function createNativeTable(
  database: DatabaseContext,
  id: string,
  domainId: string | null = null,
  scope: ModelScope = 'both',
): NativeTable {
  getDatabaseProfile(database);
  identity(id);
  if (domainId !== null) identity(domainId);
  return {
    id,
    domainId,
    scope,
    logical: { name: '', definition: '' },
    physical: {
      name: '',
      comment: '',
      namespace:
        database.kind === 'postgresql'
          ? { kind: 'postgresSchema', name: 'public' }
          : database.kind === 'mysql'
            ? { kind: 'mysqlCurrentDatabase' }
            : { kind: 'sqliteMain' },
      options:
        database.kind === 'postgresql'
          ? { database: 'postgresql' }
          : database.kind === 'mysql'
            ? { database: 'mysql', engine: 'InnoDB', charset: 'utf8mb4' }
            : { database: 'sqlite', strict: false, withoutRowid: false },
    },
    customProperties: emptyProperties(),
  };
}

export function createNativeColumn(
  database: DatabaseContext,
  table: NativeTable,
  id: string,
): NativeColumn {
  const profile = getDatabaseProfile(database);
  tableContext(table, database);
  identity(id);
  let type: NativeColumnType;
  // Profiles choose native defaults; no global alias or legacy reinterpretation is involved.
  if (database.kind === 'postgresql' && profile.defaultTypeId === 'postgresql:text')
    type = { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:text', parameters: {} };
  else if (
    database.kind === 'mysql' &&
    profile.defaultTypeId === 'mysql:varchar' &&
    typeof profile.defaultTypeParameters.length === 'number'
  )
    type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: profile.defaultTypeParameters.length },
    };
  else if (database.kind === 'sqlite' && profile.defaultTypeId === 'sqlite:text')
    type = { kind: 'builtin', database: 'sqlite', typeId: 'sqlite:text', parameters: {} };
  else throw new Error('database.profile-unsupported');
  return {
    id,
    tableId: table.id,
    scope: table.scope,
    logical: { name: '', definition: '', semanticType: '', required: false },
    physical: {
      name: '',
      type,
      nullable: false,
      comment: '',
      generation: { kind: 'none' },
      defaultValue: { kind: 'none' },
      options: { database: database.kind },
    },
    customProperties: emptyProperties(),
  };
}

export function addNativeColumn(
  document: NativeDesignDocument,
  column: NativeColumn,
): NativeDesignDocument {
  const database = context(document);
  newIds(document, [column.id]);
  const table = document.tables?.find((item) => item.id === column.tableId);
  if (!table) throw new Error('document.owner-table-not-found');
  tableContext(table, database);
  if (
    column.physical.options.database !== database.kind ||
    (column.physical.type.kind !== 'legacy' && column.physical.type.database !== database.kind)
  )
    throw new Error('database.context-changed');
  if (table.scope !== 'both' && column.scope !== table.scope)
    throw new Error('document.scope-mismatch');
  const candidate = { ...document, columns: [...(document.columns ?? []), clone(column)] };
  noNewLegacy(candidate, document);
  return candidate;
}

export interface NativeColumnPatch {
  scope?: ModelScope;
  logical?: Partial<NativeColumn['logical']>;
  physical?: Partial<NativeColumn['physical']>;
  customProperties?: CustomProperties;
}
/** Only supplied fields change. Type changes never silently erase defaults, generation or options. */
export function updateNativeColumn(
  document: NativeDesignDocument,
  id: string,
  patch: NativeColumnPatch,
): NativeDesignDocument {
  const database = context(document);
  const current = document.columns?.find((item) => item.id === id);
  if (!current) throw new Error('document.column-not-found');
  const next: NativeColumn = {
    ...current,
    ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
    logical: { ...current.logical, ...clone(patch.logical ?? {}) },
    physical: { ...current.physical, ...clone(patch.physical ?? {}) },
    customProperties: clone(patch.customProperties ?? current.customProperties),
  };
  const candidate = {
    ...document,
    columns: document.columns!.map((item) => (item.id === id ? next : item)),
  };
  columnContext(next, database);
  const table = document.tables?.find((item) => item.id === current.tableId);
  if (!table) throw new Error('document.owner-table-not-found');
  if (table.scope !== 'both' && next.scope !== table.scope)
    throw new Error('document.scope-mismatch');
  noNewLegacy(candidate, document);
  return candidate;
}
export interface NativeTablePatch {
  scope?: ModelScope;
  color?: string | undefined;
  logical?: Partial<NativeTable['logical']>;
  physical?: Partial<NativeTable['physical']>;
  customProperties?: CustomProperties;
  canvasDisplay?: NativeTable['canvasDisplay'];
}
/** Ownership/placements are changed by canvas commands, never by a physical-property patch. */
export function updateNativeTable(
  document: NativeDesignDocument,
  id: string,
  patch: NativeTablePatch,
): NativeDesignDocument {
  const database = context(document);
  const current = document.tables?.find((item) => item.id === id);
  if (!current) throw new Error('document.table-not-found');
  const next: NativeTable = {
    ...current,
    ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
    logical: { ...current.logical, ...clone(patch.logical ?? {}) },
    physical: { ...current.physical, ...clone(patch.physical ?? {}) },
    customProperties: clone(patch.customProperties ?? current.customProperties),
  };
  if (Object.hasOwn(patch, 'color')) {
    if (patch.color === undefined) delete next.color;
    else next.color = patch.color;
  }
  if (Object.hasOwn(patch, 'canvasDisplay')) {
    if (patch.canvasDisplay === undefined) delete next.canvasDisplay;
    else next.canvasDisplay = clone(patch.canvasDisplay);
  }
  const candidate = {
    ...document,
    tables: document.tables!.map((item) => (item.id === id ? next : item)),
  };
  tableContext(next, database);
  noNewLegacy(candidate, document);
  return candidate;
}

function uniqueName(name: string, used: Set<string>, database: DatabaseKind): string {
  const limit = database === 'postgresql' ? 63 : database === 'mysql' ? 64 : 120;
  const size = (s: string) =>
    database === 'postgresql'
      ? [...s].reduce((sum, c) => {
          const cp = c.codePointAt(0)!;
          return sum + (cp <= 127 ? 1 : cp <= 2047 ? 2 : cp <= 65535 ? 3 : 4);
        }, 0)
      : s.length;
  const prefix = (s: string, budget: number) => {
    let value = '';
    for (const c of s) {
      if (size(value + c) > budget) break;
      value += c;
    }
    return value;
  };
  const base = name || 'id';
  let value = prefix(base, limit),
    counter = 2;
  while (used.has(value.toLowerCase())) {
    const suffix = `_${counter++}`;
    value = prefix(base, limit - suffix.length) + suffix;
  }
  used.add(value.toLowerCase());
  return value;
}

/** Atomically prepares child columns and their FK. Full server write validation is still required. */
export function createNativeForeignKeyFromPrimaryKey(
  document: NativeDesignDocument,
  input: {
    primaryTableId: string;
    foreignTableId: string;
    primaryKeyId: string;
    relationId: string;
    columnIds: readonly string[];
  },
): NativeDesignDocument {
  const database = context(document);
  const parent = document.tables?.find((item) => item.id === input.primaryTableId);
  const child = document.tables?.find((item) => item.id === input.foreignTableId);
  const key = document.keys?.find(
    (item) =>
      item.id === input.primaryKeyId && item.tableId === parent?.id && item.kind === 'primary',
  );
  if (!parent || !child || !key) throw new Error('foreign-key.primary-key-not-found');
  tableContext(parent, database);
  tableContext(child, database);
  if ([parent.scope, child.scope, key.scope].includes('logical'))
    throw new Error('foreign-key.physical-key-required');
  if (key.deferrable) throw new Error('foreign-key.referenced-key-required');
  if (
    !key.columnIds.length ||
    key.columnIds.length > 32 ||
    new Set(key.columnIds).size !== key.columnIds.length ||
    input.columnIds.length !== key.columnIds.length
  )
    throw new Error('foreign-key.columns-invalid');
  newIds(document, [input.relationId, ...input.columnIds]);
  const sources = key.columnIds.map((id) => {
    const column = document.columns?.find(
      (item) => item.id === id && item.tableId === parent.id && item.scope !== 'logical',
    );
    if (!column) throw new Error('foreign-key.columns-invalid');
    if (column.physical.type.kind === 'legacy') throw new Error('legacy.source-not-trusted');
    if (
      column.physical.type.database !== database.kind ||
      column.physical.options.database !== database.kind
    )
      throw new Error('database.context-changed');
    const sourceType = column.physical.type;
    if (
      sourceType.kind === 'projectEnum' &&
      !document.enums?.some((item) => item.id === sourceType.enumId)
    )
      throw new Error('column.enum-not-found');
    return column;
  });
  const scope: ModelScope = [
    parent.scope,
    child.scope,
    key.scope,
    ...sources.map((item) => item.scope),
  ].includes('physical')
    ? 'physical'
    : 'both';
  const existing = (document.columns ?? []).filter((item) => item.tableId === child.id);
  const names = new Set(existing.map((item) => item.physical.name.toLowerCase()));
  const logicalNames = new Set(existing.map((item) => item.logical.name.toLowerCase()));
  const columns = sources.map((source, index): NativeColumn => {
    const copy = clone(source);
    const options = copy.physical.options;
    if (options.database === 'mysql') {
      delete options.onUpdate;
      const type = copy.physical.type;
      const text =
        type.kind === 'valueList' ||
        (type.kind === 'builtin' && getDatabaseType(type.typeId)?.category === 'string');
      if (text && parent.physical.options.database === 'mysql') {
        const charset = options.charset ?? parent.physical.options.charset ?? 'utf8mb4';
        const collation = options.collation ?? parent.physical.options.collation;
        options.charset = charset;
        // If the parent has implicit collation and the child differs, an exact environment mapping is needed.
        if (collation !== undefined) options.collation = collation;
        else if (
          child.physical.options.database === 'mysql' &&
          child.physical.options.collation !== undefined
        )
          throw new Error('foreign-key.collation-unresolved');
      }
    }
    return {
      ...copy,
      id: input.columnIds[index]!,
      tableId: child.id,
      scope,
      logical: {
        ...copy.logical,
        name: uniqueName(copy.logical.name, logicalNames, 'sqlite'),
        required: false,
      },
      physical: {
        ...copy.physical,
        name: uniqueName(copy.physical.name, names, database.kind),
        nullable: false,
        defaultValue: { kind: 'none' },
        generation: { kind: 'none' },
      },
    };
  });
  const constraintNames = new Set([
    ...(document.keys ?? []).map((item) => item.name.toLowerCase()),
    ...(document.checks ?? []).map((item) => item.name.toLowerCase()),
    ...(document.tableRelations ?? []).map((item) => item.physical?.name.toLowerCase() ?? ''),
  ]);
  const candidate: NativeDesignDocument = {
    ...document,
    columns: [...(document.columns ?? []), ...columns],
    tableRelations: [
      ...(document.tableRelations ?? []),
      {
        id: input.relationId,
        sourceTableId: child.id,
        targetTableId: parent.id,
        scope,
        logical: {
          name: '',
          cardinality: 'one-to-many',
          required: false,
          sourceCardinality: { min: 0, max: 'many' },
          targetCardinality: { min: 1, max: 1 },
        },
        physical: {
          name: uniqueName(
            `fk_${child.physical.name}_${parent.physical.name}`,
            constraintNames,
            database.kind,
          ),
          sourceColumnIds: [...input.columnIds],
          targetColumnIds: [...key.columnIds],
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
        },
      },
    ],
  };
  const involved = new Set([key.id, ...input.columnIds, input.relationId]);
  const issue = inspectNativeDatabaseDocument(candidate, database).find(
    (item) =>
      item.severity === 'error' &&
      item.category !== 'incomplete' &&
      item.objectId !== null &&
      involved.has(item.objectId),
  );
  if (issue) throw new Error(issue.code);
  noNewLegacy(candidate, document);
  return candidate;
}
