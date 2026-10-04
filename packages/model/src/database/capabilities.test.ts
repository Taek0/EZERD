import { describe, it, expect } from 'vitest';
import { databaseKinds } from './definitions.js';
import { projectDatabaseCapabilities } from './capabilities.js';
import { resolveProjectDatabaseState } from './state.js';
describe('native project capabilities', () => {
  it.each(databaseKinds)(
    'reports only %s native types without promoting specified capabilities to usable',
    (databaseKind) => {
      const database = resolveProjectDatabaseState({ databaseKind, databaseRevision: 2 });
      const legacy = projectDatabaseCapabilities(database, 1);
      expect(legacy.database.revision).toBe(2);
      expect(legacy.types.length).toBeGreaterThan(0);
      expect(
        legacy.types.every((type) => type.id.startsWith(`${databaseKind}:`) && !type.usable),
      ).toBe(true);
      expect(legacy.features.every((feature) => !feature.usable)).toBe(true);
      const native = projectDatabaseCapabilities(database, 2);
      expect(native.types.filter((type) => type.usable)).toHaveLength(
        databaseKind === 'postgresql' ? 64 : databaseKind === 'mysql' ? 37 : 23,
      );
      expect(native.features.find((feature) => feature.id === 'table')?.usable).toBe(true);
      expect(native.features.find((feature) => feature.id === 'array')?.supportedByEngine).toBe(
        databaseKind === 'postgresql',
      );
    },
  );
});
