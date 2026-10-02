import { requestFingerprint } from '../sync.js';
import type { DatabaseContext } from './definitions.js';
import type { NativeDesignDocument } from './native-document.js';
import { getDatabaseProfile } from './profiles.js';
import { nativeReferenceProblems } from './reference-graph.js';
import { hasPhysicalDatabaseDesign } from './state.js';
import { nativeIntegerConversionDecision } from './conversion-rules.js';
import { inspectMysqlPhysicalDocument, mysqlStringMetrics } from './mysql-physical-policy.js';
import { checkDatabaseFeature, type DatabaseFeatureId } from './features.js';
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
  /** Informational transformed candidate, never new-write approval. */
  candidate?: NativeDesignDocument;
  engineVerified: boolean;
  sourceMap: NativeDatabaseConversionMapping[];
  changedPaths: string[];
}
export interface NativeDatabaseConversionMapping {
  objectId: string;
  path: string;
  ruleId: string;
  fixtureId: string;
  source: unknown;
  target: unknown;
}
const segment = (id: string) => id.replaceAll('~', '~0').replaceAll('/', '~1');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sameContext = (a: DatabaseContext, b: DatabaseContext) =>
  a.kind === b.kind && a.profileId === b.profileId;

/**
 * Cross-engine mappings must come from the bounded execution-verified registry.
 * Callers cannot supply mappings, coverage overrides or a trusted previous document.
 * The server owns full transport shape and byte-budget validation.
 */
export function planNativeDatabaseConversion(
  document: NativeDesignDocument,
  source: DatabaseContext,
  target: DatabaseContext,
): NativeDatabaseConversionPlan {
  const issues: DatabaseIssue[] = [];
  const sourceMap: NativeDatabaseConversionMapping[] = [];
  const paths: string[] = [];
  let engineVerified = false;
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
      engineVerified,
      sourceMap: candidate ? sourceMap : [],
      issues: unique,
      ...(candidate ? { candidate: clone(candidate) } : {}),
      ...(canApply && candidate ? { document: candidate } : {}),
      changedPaths: candidate && !sameContext(source, target) ? ['/database', ...paths] : [],
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
  if (sameContext(source, target)) {
    engineVerified = !issues.length;
    return finish(clone(document));
  }
  const candidate = clone(document);
  candidate.database = { kind: target.kind, profileId: target.profileId };
  const map = (
    objectId: string,
    path: string,
    from: unknown,
    to: unknown,
    ruleId: string,
    fixtureId: string,
  ) => {
    if (requestFingerprint(from) === requestFingerprint(to)) return;
    sourceMap.push({ objectId, path, source: clone(from), target: clone(to), ruleId, fixtureId });
    paths.push(path);
  };
  const comments = (text: string, objectId: string, path: string, limit: number) => {
    // Required dormant physical payloads must obey target limits too; no truncation or erasure.
    if (source.kind !== 'mysql' && target.kind !== 'mysql') return;
    const metrics = mysqlStringMetrics(text, 'utf8mb3');
    if (metrics.characters > limit)
      add('mysql.comment-length-exceeded', objectId, path, 'invalid', { max: limit });
    // Empty metadata is representable even though mysqlStringMetrics inspects SQL literal tokens.
    if (text && !metrics.engineSupported) add('mysql.comment-unrepresentable', objectId, path);
  };

  for (const table of document.tables ?? []) {
    const path = `/tables/${segment(table.id)}/physical`;
    if (table.physical.namespace.kind === 'legacyNamespace')
      add('database.conversion-legacy-unresolved', table.id, `${path}/namespace`);
    const options = table.physical.options;
    if ('collation' in options || 'charset' in options)
      add('database.conversion-environment-unverified', table.id, `${path}/options`, 'environment');
    if (options.database === 'sqlite' && (options.strict || options.withoutRowid))
      add('database.conversion-table-mode-unverified', table.id, `${path}/options`);
    const namespace = table.physical.namespace;
    const pair =
      (source.kind === 'postgresql' && target.kind === 'mysql') ||
      (source.kind === 'mysql' && target.kind === 'postgresql');
    const validNamespace =
      source.kind === 'postgresql'
        ? namespace.kind === 'postgresSchema' && ['', 'public'].includes(namespace.name)
        : source.kind === 'mysql' && namespace.kind === 'mysqlCurrentDatabase';
    if (!pair || !validNamespace)
      add('database.conversion-namespace-unverified', table.id, `${path}/namespace`);
    const validOptions =
      source.kind === 'postgresql'
        ? options.database === 'postgresql' && Object.keys(options).length === 1
        : options.database === 'mysql' &&
          options.engine === 'InnoDB' &&
          Object.keys(options).every((key) => ['database', 'engine'].includes(key));
    if (!pair || !validOptions)
      add('database.conversion-table-mode-unverified', table.id, `${path}/options`);
    comments(table.physical.comment, table.id, `${path}/comment`, 2048);
    if (pair && validNamespace && validOptions) {
      const destination = candidate.tables!.find((item) => item.id === table.id)!;
      destination.physical.namespace =
        target.kind === 'mysql'
          ? { kind: 'mysqlCurrentDatabase' }
          : { kind: 'postgresSchema', name: 'public' };
      destination.physical.options =
        target.kind === 'mysql'
          ? { database: 'mysql', engine: 'InnoDB' }
          : { database: 'postgresql' };
      map(
        table.id,
        `${path}/namespace`,
        namespace,
        destination.physical.namespace,
        'pg-mysql-default-namespace-v1',
        'native-integer-int16-pg18.6-mysql8.4.11',
      );
      map(
        table.id,
        `${path}/options`,
        options,
        destination.physical.options,
        'pg-mysql-innodb-v1',
        'native-integer-int16-pg18.6-mysql8.4.11',
      );
    }
  }
  for (const column of document.columns ?? []) {
    const path = `/columns/${segment(column.id)}/physical`;
    const { type, generation, defaultValue, options } = column.physical;
    // Dormant logical legacy is still provenance-bearing and cannot cross a DB boundary.
    if (type.kind === 'legacy')
      add('database.conversion-legacy-unresolved', column.id, `${path}/type`);
    if (defaultValue.kind === 'legacyExpression')
      add('database.conversion-legacy-unresolved', column.id, `${path}/defaultValue`);
    const decision = nativeIntegerConversionDecision(type, source, target);
    if (!decision.engineVerified)
      add(decision.code ?? 'database.conversion-mapping-unverified', column.id, `${path}/type`);
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
    if (options.database !== source.kind || Object.keys(options).some((key) => key !== 'database'))
      add('database.conversion-column-options-unverified', column.id, `${path}/options`);
    comments(column.physical.comment, column.id, `${path}/comment`, 1024);
    if (decision.engineVerified && decision.targetType && decision.rule) {
      const destination = candidate.columns!.find((item) => item.id === column.id)!;
      destination.physical.type = decision.targetType;
      destination.physical.options =
        target.kind === 'mysql' ? { database: 'mysql' } : { database: 'postgresql' };
      map(
        column.id,
        `${path}/type`,
        type,
        destination.physical.type,
        decision.rule.id,
        decision.rule.fixtureId,
      );
      map(
        column.id,
        `${path}/options`,
        options,
        destination.physical.options,
        decision.rule.id,
        decision.rule.fixtureId,
      );
    }
  }
  for (const item of document.enums ?? [])
    add('database.conversion-enum-unverified', item.id, `/enums/${segment(item.id)}`);
  for (const collection of ['keys', 'tableRelations', 'indexes', 'checks'] as const)
    for (const item of document[collection] ?? []) {
      if (
        collection === 'keys' &&
        item.scope === 'logical' &&
        !('deferrable' in item) &&
        !('nullsNotDistinct' in item)
      )
        continue;
      add(
        collection === 'indexes' || collection === 'checks'
          ? 'database.conversion-expression-unverified'
          : 'database.conversion-constraint-unverified',
        item.id,
        `/${collection}/${segment(item.id)}`,
      );
    }
  if (issues.some((issue) => issue.severity === 'error')) {
    add('database.conversion-target-not-ready', null, '/target', 'unsupported', {
      targetKind: target.kind,
      targetProfileId: target.profileId,
    });
    return finish();
  }
  issues.push(...engineIssues(candidate, target));
  if (
    target.kind === 'mysql' &&
    ((candidate.tables?.length ?? 0) || (candidate.columns?.length ?? 0))
  )
    issues.push(
      ...inspectMysqlPhysicalDocument(candidate).issues.map(({ cause: _cause, ...issue }) => issue),
    );
  engineVerified = !issues.some((issue) => issue.severity === 'error');
  // A DB conversion is a new target write. Never grandfather it using candidate as previous.
  issues.push(...validateDatabaseDocument(candidate, target, { mode: 'write' }));
  const featureReady = (feature: DatabaseFeatureId, objectId: string, path: string) => {
    if (!checkDatabaseFeature(target, feature).usable)
      add('database.conversion-target-not-ready', objectId, path, 'unsupported', {
        feature,
        targetKind: target.kind,
        targetProfileId: target.profileId,
      });
  };
  // Dormant required physical payloads are also new target declarations; scope cannot bypass gates.
  for (const table of candidate.tables ?? []) {
    const path = `/tables/${segment(table.id)}/physical`;
    featureReady('table', table.id, path);
    if (target.kind === 'postgresql') featureReady('schema', table.id, `${path}/namespace`);
    if (table.physical.comment) featureReady('tableComment', table.id, `${path}/comment`);
  }
  for (const column of document.columns ?? []) {
    featureReady('column', column.id, `/columns/${segment(column.id)}/physical`);
    if (column.physical.comment)
      featureReady('columnComment', column.id, `/columns/${segment(column.id)}/physical/comment`);
    const decision = nativeIntegerConversionDecision(column.physical.type, source, target);
    if (decision.engineVerified && !decision.usable)
      add(
        'database.conversion-target-not-ready',
        column.id,
        `/columns/${segment(column.id)}/physical/type`,
        'unsupported',
        { targetKind: target.kind, targetProfileId: target.profileId },
      );
  }
  if (hasPhysicalDesign && issues.some((issue) => issue.severity === 'error'))
    add('database.conversion-target-not-ready', null, '/target', 'unsupported', {
      targetKind: target.kind,
      targetProfileId: target.profileId,
    });
  return finish(candidate);
}
