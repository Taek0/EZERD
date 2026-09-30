/** Native database rules are independent of transport schemas and UI components. */
export const databaseKinds = ['postgresql', 'mysql', 'sqlite'] as const;
export type DatabaseKind = (typeof databaseKinds)[number];
export type DatabaseTypeId = `${DatabaseKind}:${string}`;
export type DatabaseProfileId = 'postgresql-18-v1' | 'mysql-8.4-innodb-v1' | 'sqlite-3.45-v1';
export interface DatabaseContext {
  kind: DatabaseKind;
  profileId: DatabaseProfileId;
}
export type DatabaseAvailability = 'specified' | 'implemented' | 'verified';
export const databaseImplementationPaths = [
  'editor',
  'contracts',
  'server',
  'mcp',
  'ddl',
  'integration',
] as const;
export type DatabaseImplementationPath = (typeof databaseImplementationPaths)[number];
export interface DatabaseCoverage {
  availability: DatabaseAvailability;
  /** Evidence must name actual, completed fixtures rather than intended tests. */
  evidence: Readonly<Partial<Record<DatabaseImplementationPath, readonly string[]>>>;
}
export const specifiedDatabaseCoverage: DatabaseCoverage = Object.freeze({
  availability: 'specified',
  evidence: Object.freeze({}),
});
export type DatabaseTypeCategory =
  | 'integer'
  | 'decimal'
  | 'floating'
  | 'string'
  | 'binary'
  | 'boolean'
  | 'temporal'
  | 'interval'
  | 'uuid'
  | 'json'
  | 'bit'
  | 'money'
  | 'geometry'
  | 'network'
  | 'search'
  | 'range'
  | 'multirange'
  | 'object-reference'
  | 'snapshot'
  | 'xml'
  | 'value-list'
  | 'dynamic';
export type TypeParameterName =
  'length' | 'precision' | 'scale' | 'bitLength' | 'unsigned' | 'fields' | 'srid';
export type TypeParameterRule =
  | { kind: 'integer'; min: number; max: number; required?: boolean }
  | { kind: 'boolean' }
  | { kind: 'choice'; values: readonly string[] };
/** An input boundary, not the persisted v2 discriminated type model. */
export type DatabaseTypeParameterInput = Readonly<
  Partial<Record<TypeParameterName, string | number | boolean>>
>;
export type SqliteAffinity = 'integer' | 'text' | 'blob' | 'real' | 'numeric';
export interface DatabaseTypeDefinition {
  id: DatabaseTypeId;
  databaseKind: DatabaseKind;
  sqlName: string;
  aliases: readonly string[];
  category: DatabaseTypeCategory;
  parameters: Readonly<Partial<Record<TypeParameterName, TypeParameterRule>>>;
  array: boolean;
  deprecated: boolean;
  sqliteStrict: boolean;
  sqliteAffinity?: SqliteAffinity;
  coverage: DatabaseCoverage;
  sources: readonly string[];
}
export interface DatabaseTypeResolution {
  definition: DatabaseTypeDefinition;
  parameters: DatabaseTypeParameterInput;
  impliedGeneration?: 'serial' | 'autoIncrement';
  impliedColumnOptions?: { nullable: false; unique: true };
  declarationAlias?: 'boolean';
}
export interface DatabaseParameterIssue {
  code: 'type.option-not-supported' | 'type.parameter-out-of-range' | 'type.parameter-required';
  parameter: string;
  params: Readonly<Record<string, string | number | boolean>>;
}
export interface DatabaseProfile {
  id: DatabaseProfileId;
  kind: DatabaseKind;
  targetVersion: string;
  defaultTypeId: DatabaseTypeId;
  defaultTypeParameters: DatabaseTypeParameterInput;
  assumptions: readonly string[];
}
export function hasDatabaseCoverage(coverage: DatabaseCoverage): boolean {
  return (
    coverage.availability === 'verified' &&
    databaseImplementationPaths.every((path) => {
      if (!Object.hasOwn(coverage.evidence, path)) return false;
      const fixtures = coverage.evidence[path];
      return !!fixtures?.length && fixtures.every((fixture) => fixture.trim().length > 0);
    })
  );
}
