import {
  specifiedDatabaseCoverage,
  type DatabaseCoverage,
  type DatabaseKind,
} from './definitions.js';

/** Staged release evidence is verified by the named full-path fixtures before a release commit. */
const catalogCoverage: DatabaseCoverage = Object.freeze({
  availability: 'verified',
  evidence: Object.freeze({
    editor: Object.freeze(['native-editor-ui:type-parameters-and-native-format-command']),
    contracts: Object.freeze(['native-document:strict-discriminated-native-types']),
    server: Object.freeze(['native-catalog-path:persist-every-builtin-unchanged']),
    mcp: Object.freeze(['native-catalog-path:authenticated-native-read-patch-roundtrip']),
    ddl: Object.freeze([
      'native-ddl:postgresql-65',
      'verify-native-mysql-ddl:37',
      'verify-native-sqlite-floor:23',
    ]),
    integration: Object.freeze(['native-catalog-path:whole-project-physical-export']),
  }),
});
const coreFeatures = new Set([
  'table',
  'column',
  'schema',
  'tableComment',
  'columnComment',
  'enumColumn',
  'setColumn',
  'charset',
  'collation',
  'strictTable',
]);
const advancedCoverage: DatabaseCoverage = Object.freeze({
  availability: 'verified',
  evidence: Object.freeze({
    editor: Object.freeze([
      'native-advanced-editor-ui',
      'native-constraint-options',
      'native-editor-option-policy',
    ]),
    contracts: Object.freeze(['native-editor-command:strict-native-feature-payloads']),
    server: Object.freeze(['native-feature-path:issued-baseline-persist-and-replay']),
    mcp: Object.freeze(['native-feature-path:authenticated-commands-read-export']),
    ddl: Object.freeze(['verify-native-feature-path-ddl:postgresql-18-mysql-8.4-sqlite-3.45']),
    integration: Object.freeze(['native-feature-path:whole-physical-77-feature-combinations']),
  }),
});
const advancedFeatures = new Set([
  'primaryKey',
  'unique',
  'foreignKey',
  'array',
  'serial',
  'identity',
  'autoIncrement',
  'rowid',
  'enumType',
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
  'srid',
  'deferrableForeignKey',
  'withoutRowid',
]);
/** Constrained defaults have independent AST/parser evidence; this never grants arbitrary SQL. */
export const nativeDefaultCoverage = advancedCoverage;
export function nativeBuiltinCoverage(kind: DatabaseKind, name: string): DatabaseCoverage {
  return kind === 'postgresql' && name === 'txid_snapshot'
    ? specifiedDatabaseCoverage
    : catalogCoverage;
}
export function nativeFeatureCoverage(id: string): DatabaseCoverage {
  return coreFeatures.has(id)
    ? catalogCoverage
    : advancedFeatures.has(id)
      ? advancedCoverage
      : specifiedDatabaseCoverage;
}
