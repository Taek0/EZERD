import {
  specifiedDatabaseCoverage,
  hasDatabaseCoverage,
  type DatabaseContext,
  type DatabaseCoverage,
  type DatabaseKind,
  type DatabaseTypeId,
} from './definitions.js';
import { getDatabaseType } from './catalog.js';
import { getDatabaseProfile } from './profiles.js';
import { nativeFeatureCoverage } from './readiness.js';

export const databaseFeatureIds = [
  'table',
  'column',
  'primaryKey',
  'unique',
  'foreignKey',
  'array',
  'serial',
  'identity',
  'autoIncrement',
  'rowid',
  'enumType',
  'enumColumn',
  'setColumn',
  'schema',
  'tableComment',
  'columnComment',
  'index',
  'partialIndex',
  'expressionIndex',
  'includedIndexColumns',
  'nullsNotDistinct',
  'fullTextIndex',
  'spatialIndex',
  'indexMethod',
  'check',
  'generatedStored',
  'generatedVirtual',
  'collation',
  'charset',
  'srid',
  'deferrableForeignKey',
  'strictTable',
  'withoutRowid',
] as const;
export type DatabaseFeatureId = (typeof databaseFeatureIds)[number];
export interface DatabaseFeatureDefinition {
  id: DatabaseFeatureId;
  databases: readonly DatabaseKind[];
  coverage: DatabaseCoverage;
}
export interface DatabaseFeatureFacts {
  typeId?: DatabaseTypeId;
  array?: boolean;
  projectEnum?: boolean;
  nullable?: boolean;
  primaryKeyColumns?: number;
  isPrimaryKeyColumn?: boolean;
  indexed?: boolean;
  firstIndexColumn?: boolean;
  /** Count excludes the candidate column being checked. */
  otherAutoIncrementColumns?: number;
  hasDefault?: boolean;
  generation?: 'none' | 'serial' | 'identity' | 'autoIncrement' | 'computed';
  strict?: boolean;
  withoutRowid?: boolean;
  foreignKeyAction?: 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';
}
export interface DatabaseFeatureDecision {
  supported: boolean;
  usable: boolean;
  code?: string;
}
const all: readonly DatabaseKind[] = Object.freeze(['postgresql', 'mysql', 'sqlite']);
const only: Partial<Record<DatabaseFeatureId, readonly DatabaseKind[]>> = {
  array: ['postgresql'],
  serial: ['postgresql'],
  identity: ['postgresql'],
  autoIncrement: ['mysql', 'sqlite'],
  rowid: ['sqlite'],
  enumType: ['postgresql'],
  enumColumn: ['mysql'],
  setColumn: ['mysql'],
  schema: ['postgresql'],
  tableComment: ['postgresql', 'mysql'],
  columnComment: ['postgresql', 'mysql'],
  partialIndex: ['postgresql', 'sqlite'],
  includedIndexColumns: ['postgresql'],
  nullsNotDistinct: ['postgresql'],
  fullTextIndex: ['mysql'],
  spatialIndex: ['mysql'],
  indexMethod: ['postgresql', 'mysql'],
  charset: ['mysql'],
  srid: ['mysql'],
  deferrableForeignKey: ['postgresql', 'sqlite'],
  strictTable: ['sqlite'],
  withoutRowid: ['sqlite'],
};
export const databaseFeatureCatalog: readonly DatabaseFeatureDefinition[] = Object.freeze(
  databaseFeatureIds.map((id) =>
    Object.freeze({
      id,
      databases: Object.freeze([...(only[id] ?? all)]),
      coverage: nativeFeatureCoverage(id),
    }),
  ),
);

/** Native engine support and product readiness are deliberately different results. */
export function checkDatabaseFeature(
  context: DatabaseContext,
  featureId: DatabaseFeatureId,
  facts: DatabaseFeatureFacts = {},
): DatabaseFeatureDecision {
  getDatabaseProfile(context);
  const feature = databaseFeatureCatalog.find((item) => item.id === featureId);
  const reject = (code: string): DatabaseFeatureDecision => ({
    supported: false,
    usable: false,
    code,
  });
  if (!feature || !feature.databases.includes(context.kind)) return reject('feature.not-supported');
  const type = facts.typeId && getDatabaseType(facts.typeId);
  if (facts.typeId && (!type || type.databaseKind !== context.kind))
    return reject('type.not-supported');
  if (facts.strict && context.kind !== 'sqlite') return reject('table.mode-not-supported');
  if (facts.strict && type && !type.sqliteStrict) return reject('type.not-supported');

  if (featureId === 'array') {
    if (
      (!type && !facts.projectEnum) ||
      (type && !type.array) ||
      facts.generation === 'serial' ||
      facts.generation === 'identity'
    )
      return reject('type.option-not-supported');
  }
  if (['serial', 'identity', 'autoIncrement'].includes(featureId)) {
    if (facts.array || facts.generation === 'computed')
      return reject('generation.type-not-supported');
    if (context.kind !== 'sqlite' && (!type || type.category !== 'integer'))
      return reject('generation.type-not-supported');
    if (facts.hasDefault) return reject('generation.default-not-supported');
    if (context.kind === 'mysql') {
      if (!facts.indexed || !facts.firstIndexColumn) return reject('generation.key-required');
      if ((facts.otherAutoIncrementColumns ?? 0) >= 1) return reject('generation.multiple-columns');
    }
    if (
      context.kind === 'sqlite' &&
      (type?.id !== 'sqlite:integer' ||
        !facts.isPrimaryKeyColumn ||
        facts.primaryKeyColumns !== 1 ||
        facts.withoutRowid)
    )
      return reject('generation.key-required');
  }
  if (featureId === 'rowid' && facts.withoutRowid) return reject('generation.rowid-not-supported');
  if (featureId === 'foreignKey') {
    if (context.kind === 'mysql' && facts.foreignKeyAction === 'SET DEFAULT')
      return reject('foreign-key.action-not-supported');
    if (
      facts.foreignKeyAction === 'SET NULL' &&
      (facts.nullable === false || facts.isPrimaryKeyColumn)
    )
      return reject('foreign-key.nullability-mismatch');
  }
  if (featureId === 'srid' && type?.category !== 'geometry')
    return reject('type.option-not-supported');

  const usable =
    hasDatabaseCoverage(feature.coverage) && (!type || hasDatabaseCoverage(type.coverage));
  return { supported: true, usable, ...(!usable && { code: 'feature.not-implemented' }) };
}
