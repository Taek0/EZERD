import { createHash } from 'node:crypto';
import {
  createEmptyDocument,
  migrateDesignDocumentV1,
  requestFingerprint,
  validateDatabaseDocument,
  type DatabaseContext,
  type DatabaseIssue,
  type NativeDesignDocument,
} from '@ezerd/model';

const same = (left: unknown, right: unknown) =>
  requestFingerprint(left) === requestFingerprint(right);
const segment = (id: string) => id.replaceAll('~', '~0').replaceAll('/', '~1');
export const importJsonSha256 = (value: unknown) =>
  createHash('sha256').update(requestFingerprint(value), 'utf8').digest('hex');

/** Server-local proof. Never accepted from a transfer's source/diagnostics/previous fields. */
export function nativeImportLegacyProvenance(
  document: NativeDesignDocument,
  context: DatabaseContext,
) {
  const old = createEmptyDocument();
  const ownerIds = new Set(
    (document.columns ?? [])
      .filter(
        (column) =>
          column.physical.type.kind === 'legacy' ||
          column.physical.defaultValue.kind === 'legacyExpression',
      )
      .map((column) => column.tableId),
  );
  const tables = (document.tables ?? []).filter(
    (table) => ownerIds.has(table.id) || table.physical.namespace.kind === 'legacyNamespace',
  );
  old.tables = tables.map((table) => ({
    id: table.id,
    domainId: null,
    scope: table.scope,
    logical: structuredClone(table.logical),
    physical: {
      name: table.physical.name,
      comment: table.physical.comment,
      schema:
        table.physical.namespace.kind === 'legacyNamespace'
          ? table.physical.namespace.original
          : table.physical.namespace.kind === 'postgresSchema'
            ? table.physical.namespace.name
            : '',
    },
    customProperties: structuredClone(table.customProperties),
  }));
  old.columns = (document.columns ?? [])
    .filter(
      (column) =>
        ownerIds.has(column.tableId) &&
        (column.physical.type.kind === 'legacy' ||
          column.physical.defaultValue.kind === 'legacyExpression'),
    )
    .map((column) => ({
      id: column.id,
      tableId: column.tableId,
      scope: column.scope,
      logical: structuredClone(column.logical),
      customProperties: structuredClone(column.customProperties),
      physical: {
        name: column.physical.name,
        comment: column.physical.comment,
        nullable: column.physical.nullable,
        type:
          column.physical.type.kind === 'legacy'
            ? structuredClone(column.physical.type.original)
            : { name: '__import_mask_no_native_type_authority__', isArray: false },
        defaultExpression:
          column.physical.defaultValue.kind === 'legacyExpression'
            ? column.physical.defaultValue.original
            : null,
      },
    }));
  const referencedEnums = new Set(
    (document.columns ?? []).flatMap((column) =>
      column.physical.type.kind === 'legacy' && column.physical.type.original.enumId
        ? [column.physical.type.original.enumId]
        : [],
    ),
  );
  old.enums = structuredClone(
    (document.enums ?? []).filter((definition) => referencedEnums.has(definition.id)),
  );
  const mask = migrateDesignDocumentV1(old, context).document;
  const columns = new Map((mask.columns ?? []).map((column) => [column.id, column]));
  const owners = new Map((mask.tables ?? []).map((table) => [table.id, table]));
  const fieldPaths = new Set<string>();
  const problems: DatabaseIssue[] = [];
  const prove = (objectId: string, path: string, value: unknown, derived: unknown) => {
    if (same(value, derived)) fieldPaths.add(path);
    else
      problems.push({
        code: 'legacy.source-not-trusted',
        category: 'unsupported',
        severity: 'error',
        objectId,
        path,
        params: {},
      });
  };
  for (const column of document.columns ?? []) {
    const before = columns.get(column.id),
      path = `/columns/${segment(column.id)}/physical`;
    if (column.physical.type.kind === 'legacy')
      prove(column.id, `${path}/type`, column.physical.type, before?.physical.type);
    if (column.physical.defaultValue.kind === 'legacyExpression')
      prove(
        column.id,
        `${path}/defaultValue`,
        column.physical.defaultValue,
        before?.physical.defaultValue,
      );
  }
  for (const table of tables)
    if (table.physical.namespace.kind === 'legacyNamespace')
      prove(
        table.id,
        `/tables/${segment(table.id)}/physical/namespace`,
        table.physical.namespace,
        owners.get(table.id)?.physical.namespace,
      );
  return { mask, fieldPaths, referencedEnums, problems };
}
export type NativeImportLegacyProvenance = ReturnType<typeof nativeImportLegacyProvenance>;

/** Full fresh validation is always authoritative for non-legacy causes, including readiness. */
export function validateNativeImportWithProvenance(
  document: NativeDesignDocument,
  context: DatabaseContext,
  proof: NativeImportLegacyProvenance,
): DatabaseIssue[] {
  const fresh = validateDatabaseDocument(document, context, { mode: 'write' });
  const recovered = validateDatabaseDocument(document, context, {
    mode: 'write',
    previous: proof.mask,
  });
  const allowed = (issue: DatabaseIssue) => {
    const id = issue.objectId;
    if (
      issue.code === 'mysql.column-byte-budget-unverified' &&
      context.kind === 'mysql' &&
      id !== null &&
      issue.path === `/columns/${segment(id)}/physical/type` &&
      proof.fieldPaths.has(issue.path)
    ) {
      const column = document.columns?.find((item) => item.id === id),
        before = proof.mask.columns?.find((item) => item.id === id),
        table = document.tables?.find((item) => item.id === column?.tableId),
        owner = proof.mask.tables?.find((item) => item.id === before?.tableId);
      return (
        !!column &&
        !!before &&
        !!table &&
        !!owner &&
        column.tableId === before.tableId &&
        column.physical.type.kind === 'legacy' &&
        before.physical.type.kind === 'legacy' &&
        same(column.physical.type, before.physical.type) &&
        same(column.physical.generation, before.physical.generation) &&
        same(column.physical.options, before.physical.options) &&
        same(table.physical.options, owner.physical.options)
      );
    }
    if (
      [
        'legacy.source-not-trusted',
        'legacy.type-unresolved',
        'legacy.default-unresolved',
        'legacy.namespace-unresolved',
      ].includes(issue.code)
    )
      return proof.fieldPaths.has(issue.path);
    if (issue.code === 'legacy.enum-context-mismatch')
      return id !== null && proof.referencedEnums.has(id) && issue.path === `/enums/${segment(id)}`;
    if (issue.code !== 'feature.not-implemented' || id === null) return false;
    if (issue.params.feature === 'table' && issue.path === `/tables/${segment(id)}/physical`) {
      const before = proof.mask.tables?.find((table) => table.id === id),
        table = document.tables?.find((table) => table.id === id);
      return (
        !!before &&
        !!table &&
        same(table.physical.namespace, before.physical.namespace) &&
        same(table.physical.options, before.physical.options)
      );
    }
    if (issue.params.feature === 'column' && issue.path === `/columns/${segment(id)}/physical`) {
      const before = proof.mask.columns?.find((column) => column.id === id),
        column = document.columns?.find((column) => column.id === id);
      return (
        !!before &&
        !!column &&
        column.tableId === before.tableId &&
        same(
          {
            type: column.physical.type,
            generation: column.physical.generation,
            defaultValue: column.physical.defaultValue,
            options: column.physical.options,
            nullable: column.physical.nullable,
          },
          {
            type: before.physical.type,
            generation: before.physical.generation,
            defaultValue: before.physical.defaultValue,
            options: before.physical.options,
            nullable: before.physical.nullable,
          },
        )
      );
    }
    return (
      issue.params.feature === 'enumType' &&
      issue.path === `/enums/${segment(id)}` &&
      proof.referencedEnums.has(id)
    );
  };
  // Resurrect all other failures even if a masked v1 field happens to reproduce the same error.
  const kept = [...proof.problems, ...recovered, ...fresh.filter((issue) => !allowed(issue))];
  return [...new Map(kept.map((issue) => [requestFingerprint(issue), issue])).values()];
}
