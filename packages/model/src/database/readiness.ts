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
/** Defaults and ON UPDATE have separate parser/expression paths; declaration coverage is insufficient. */
export const nativeDefaultCoverage = specifiedDatabaseCoverage;
export function nativeBuiltinCoverage(kind: DatabaseKind, name: string): DatabaseCoverage {
  return kind === 'postgresql' && name === 'txid_snapshot'
    ? specifiedDatabaseCoverage
    : catalogCoverage;
}
export function nativeFeatureCoverage(id: string): DatabaseCoverage {
  return coreFeatures.has(id) ? catalogCoverage : specifiedDatabaseCoverage;
}
