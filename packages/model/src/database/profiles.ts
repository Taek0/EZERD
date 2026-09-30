import type { DatabaseContext, DatabaseKind, DatabaseProfile } from './definitions.js';

export const databaseProfiles: readonly DatabaseProfile[] = Object.freeze([
  Object.freeze({
    id: 'postgresql-18-v1',
    kind: 'postgresql',
    targetVersion: '18',
    defaultTypeId: 'postgresql:text',
    defaultTypeParameters: Object.freeze({}),
    assumptions: Object.freeze(['Native PostgreSQL 18; extensions require explicit registration.']),
  }),
  Object.freeze({
    id: 'mysql-8.4-innodb-v1',
    kind: 'mysql',
    targetVersion: '8.4',
    defaultTypeId: 'mysql:varchar',
    defaultTypeParameters: Object.freeze({ length: 255 }),
    assumptions: Object.freeze([
      'InnoDB',
      'utf8mb4',
      'Strict SQL mode; REAL_AS_FLOAT disabled.',
      'Tables are created in the selected execution database.',
    ]),
  }),
  Object.freeze({
    id: 'sqlite-3.45-v1',
    kind: 'sqlite',
    targetVersion: '3.45',
    defaultTypeId: 'sqlite:text',
    defaultTypeParameters: Object.freeze({}),
    assumptions: Object.freeze([
      'Foreign keys enabled on every execution connection before transactions.',
      'STRICT and WITHOUT ROWID are table options.',
      'The main database; ATTACH requires a separate workflow.',
    ]),
  }),
] satisfies DatabaseProfile[]);

export function defaultDatabaseContext(kind: DatabaseKind): DatabaseContext {
  const profile = databaseProfiles.find((item) => item.kind === kind);
  if (!profile) throw new Error('database.profile-unsupported');
  return { kind, profileId: profile.id };
}

export function getDatabaseProfile(context: DatabaseContext): DatabaseProfile {
  const profile = databaseProfiles.find((item) => item.id === context.profileId);
  if (!profile || profile.kind !== context.kind) throw new Error('database.profile-unsupported');
  return profile;
}
