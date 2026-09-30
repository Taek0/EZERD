import { describe, it, expect } from 'vitest';
import { createEmptyDocument } from '../document.js';
import {
  MAX_DATABASE_REVISION,
  hasPhysicalDatabaseDesign,
  nextDatabaseRevision,
  resolveProjectDatabaseState,
} from './state.js';

describe('project database state', () => {
  it('derives profiles for old rows without rewriting their documents', () => {
    expect(resolveProjectDatabaseState({ databaseKind: 'mysql' })).toEqual({
      kind: 'mysql',
      profileId: 'mysql-8.4-innodb-v1',
      revision: 0,
    });
    expect(() =>
      resolveProjectDatabaseState({ databaseKind: 'mysql', databaseProfileId: 'postgresql-18-v1' }),
    ).toThrow();
    for (const databaseRevision of [-1, 0.5, MAX_DATABASE_REVISION + 1])
      expect(() =>
        resolveProjectDatabaseState({ databaseKind: 'sqlite', databaseRevision }),
      ).toThrow('database.revision-invalid');
  });
  it('increments revision without overflow', () => {
    const state = resolveProjectDatabaseState({ databaseKind: 'postgresql' });
    expect(nextDatabaseRevision(state)).toBe(1);
    expect(() => nextDatabaseRevision({ ...state, revision: MAX_DATABASE_REVISION })).toThrow(
      'database.revision-limit',
    );
  });
  it('counts orphan physical objects and preserves logical-only projects as empty physical designs', () => {
    const document = createEmptyDocument();
    expect(hasPhysicalDatabaseDesign(document)).toBe(false);
    // A broken/orphan column must not evade the metadata-only change guard.
    document.columns = [{ id: 'orphan', tableId: 'missing', scope: 'physical' } as never];
    expect(hasPhysicalDatabaseDesign(document)).toBe(true);
    document.columns[0]!.scope = 'logical';
    expect(hasPhysicalDatabaseDesign(document)).toBe(false);
  });
});
