import { requestFingerprint } from '../sync.js';
import type { DatabaseContext } from './definitions.js';
import type { NativeDesignDocument } from './native-document.js';
import { getDatabaseProfile } from './profiles.js';
import { nativeReferenceProblems } from './reference-graph.js';
import { hasPhysicalDatabaseDesign } from './state.js';
import {
  inspectNativeDatabaseDocument,
  validateDatabaseDocument,
  type DatabaseIssue,
} from './validation.js';

export interface NativeDatabaseConversionPlan {
  source: DatabaseContext;
  target: DatabaseContext;
  hasPhysicalDesign: boolean;
  canApply: boolean;
  issues: DatabaseIssue[];
  /** A raw, lossless candidate exists only when every conversion rule is established. */
  document?: NativeDesignDocument;
  changedPaths: string[];
}
const segment = (id: string) => id.replaceAll('~', '~0').replaceAll('/', '~1');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sameContext = (a: DatabaseContext, b: DatabaseContext) =>
  a.kind === b.kind && a.profileId === b.profileId;

/**
 * No cross-engine physical mappings have completed product/execution evidence yet.
 * Similar SQL names, integer widths and varchar lengths are not such evidence.
 * Callers cannot supply mappings, coverage overrides or a trusted previous document.
 * The server owns full transport shape and byte-budget validation.
 */
export function planNativeDatabaseConversion(
  document: NativeDesignDocument,
  source: DatabaseContext,
  target: DatabaseContext,
): NativeDatabaseConversionPlan {
  const issues: DatabaseIssue[] = [];
  const add = (
    code: string,
    objectId: string | null,
    path: string,
    category: DatabaseIssue['category'] = 'unsupported',
    params: DatabaseIssue['params'] = {},
  ) => issues.push({ code, objectId, path, category, severity: 'error', params });
  const hasPhysicalDesign = hasPhysicalDatabaseDesign(document);
  // Empty physical designs are valid settings changes even though they cannot export DDL.
  const engineIssues = (candidate: NativeDesignDocument, context: DatabaseContext) =>
    inspectNativeDatabaseDocument(candidate, context).filter(
      (issue) =>
        hasPhysicalDesign || issue.code !== 'ddl.incomplete-model' || issue.objectId !== null,
    );
  const finish = (candidate?: NativeDesignDocument): NativeDatabaseConversionPlan => {
    const unique = [...new Map(issues.map((issue) => [requestFingerprint(issue), issue])).values()];
    const canApply = !!candidate && !unique.some((issue) => issue.severity === 'error');
    return {
      source: { kind: source.kind, profileId: source.profileId },
      target: { kind: target.kind, profileId: target.profileId },
      hasPhysicalDesign,
      canApply,
      issues: unique,
      ...(canApply && candidate ? { document: candidate } : {}),
      changedPaths: canApply && !sameContext(source, target) ? ['/database'] : [],
    };
  };
  for (const [context, path] of [
    [source, '/database'],
    [target, '/target'],
  ] as const) {
    try {
      getDatabaseProfile(context);
    } catch {
      add('database.profile-unsupported', null, path);
    }
  }
  if (!sameContext(document.database, source))
    add('database.context-changed', null, '/database', 'invalid');
  if (issues.length) return finish();
  issues.push(...engineIssues(document, source));
  issues.push(
    ...nativeReferenceProblems(document).map(({ cause: _cause, ...issue }) => ({
      ...issue,
      category: 'invalid' as const,
      severity: 'error' as const,
      params: {},
    })),
  );
  // A same-context request introduces no new physical declarations or recovery authority.
  if (sameContext(source, target)) return finish(clone(document));

  for (const table of document.tables ?? []) {
    const path = `/tables/${segment(table.id)}/physical`;
    if (table.physical.namespace.kind === 'legacyNamespace')
      add('database.conversion-legacy-unresolved', table.id, `${path}/namespace`);
    if (table.scope === 'logical') continue;
    add('database.conversion-mapping-unverified', table.id, path);
    const options = table.physical.options;
    if ('collation' in options || 'charset' in options)
      add('database.conversion-environment-unverified', table.id, `${path}/options`, 'environment');
    if (options.database === 'sqlite' && (options.strict || options.withoutRowid))
      add('database.conversion-table-mode-unverified', table.id, `${path}/options`);
    add('database.conversion-namespace-unverified', table.id, `${path}/namespace`);
  }
  for (const column of document.columns ?? []) {
    const path = `/columns/${segment(column.id)}/physical`;
    const { type, generation, defaultValue, options } = column.physical;
    // Dormant logical legacy is still provenance-bearing and cannot cross a DB boundary.
    if (type.kind === 'legacy')
      add('database.conversion-legacy-unresolved', column.id, `${path}/type`);
    if (defaultValue.kind === 'legacyExpression')
      add('database.conversion-legacy-unresolved', column.id, `${path}/defaultValue`);
    if (column.scope === 'logical') continue;
    add('database.conversion-mapping-unverified', column.id, `${path}/type`);
    if (source.kind === 'sqlite' || target.kind === 'sqlite')
      add('database.conversion-dynamic-semantics-unverified', column.id, `${path}/type`);
    if ('array' in type && type.array)
      add('database.conversion-array-unverified', column.id, `${path}/type/array`);
    if (type.kind === 'projectEnum' || type.kind === 'valueList')
      add('database.conversion-enum-unverified', column.id, `${path}/type`);
    if (generation.kind !== 'none')
      add('database.conversion-generation-unverified', column.id, `${path}/generation`);
    if (defaultValue.kind !== 'none')
      add('database.conversion-default-unverified', column.id, `${path}/defaultValue`);
    if ('collation' in options || 'charset' in options)
      add(
        'database.conversion-environment-unverified',
        column.id,
        `${path}/options`,
        'environment',
      );
    if ('onUpdate' in options && options.onUpdate)
      add('database.conversion-expression-unverified', column.id, `${path}/options/onUpdate`);
  }
  for (const item of document.enums ?? [])
    add('database.conversion-enum-unverified', item.id, `/enums/${segment(item.id)}`);
  for (const collection of ['keys', 'tableRelations', 'indexes', 'checks'] as const)
    for (const item of document[collection] ?? []) {
      if (item.scope === 'logical') continue;
      add(
        collection === 'indexes' || collection === 'checks'
          ? 'database.conversion-expression-unverified'
          : 'database.conversion-constraint-unverified',
        item.id,
        `/${collection}/${segment(item.id)}`,
      );
    }
  if (hasPhysicalDesign) {
    add('database.conversion-target-not-ready', null, '/target', 'unsupported', {
      targetKind: target.kind,
      targetProfileId: target.profileId,
    });
    return finish();
  }
  const candidate = clone(document);
  candidate.database = { kind: target.kind, profileId: target.profileId };
  issues.push(...engineIssues(candidate, target));
  // A DB conversion is a new target write. Never grandfather it using candidate as previous.
  issues.push(...validateDatabaseDocument(candidate, target, { mode: 'write' }));
  return finish(candidate);
}
