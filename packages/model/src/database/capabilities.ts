import { databaseTypeCatalog } from './catalog.js';
import { databaseFeatureCatalog } from './features.js';
import { hasDatabaseCoverage } from './definitions.js';
import { getDatabaseProfile } from './profiles.js';
import type { ProjectDatabaseState } from './state.js';

/** This native catalog never implies that the legacy-v1 editor accepts native-v2 input. */
export function projectDatabaseCapabilities(
  database: ProjectDatabaseState,
  documentSchemaVersion: 1 | 2,
) {
  const profile = getDatabaseProfile(database);
  return {
    database,
    documentSchemaVersion,
    capabilityScope: 'native-v2' as const,
    targetVersion: profile.targetVersion,
    assumptions: profile.assumptions,
    defaultTypeId: profile.defaultTypeId,
    defaultTypeParameters: profile.defaultTypeParameters,
    types: databaseTypeCatalog
      .filter((type) => type.databaseKind === database.kind)
      .map((type) => ({
        id: type.id,
        sqlName: type.sqlName,
        aliases: type.aliases,
        category: type.category,
        parameters: type.parameters,
        array: type.array,
        deprecated: type.deprecated,
        sqliteStrict: type.sqliteStrict,
        ...(type.sqliteAffinity && { sqliteAffinity: type.sqliteAffinity }),
        availability: type.coverage.availability,
        usable:
          documentSchemaVersion === 2 && !type.deprecated && hasDatabaseCoverage(type.coverage),
      })),
    features: databaseFeatureCatalog.map((feature) => ({
      id: feature.id,
      supportedByEngine: feature.databases.includes(database.kind),
      availability: feature.coverage.availability,
      usable:
        documentSchemaVersion === 2 &&
        feature.databases.includes(database.kind) &&
        hasDatabaseCoverage(feature.coverage),
      requiresObjectValidation: true as const,
    })),
  };
}
