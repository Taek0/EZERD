import { describe, it, expect } from 'vitest';
import { changeProjectDatabaseSchema, projectDatabaseStateSchema } from './database-state.js';
import { syncBaselineSchema } from './sync.js';

describe('database settings contracts', () => {
  it('rejects a mismatched engine/profile and invalid revision', () => {
    expect(
      projectDatabaseStateSchema.safeParse({
        kind: 'mysql',
        profileId: 'postgresql-18-v1',
        revision: 0,
      }).success,
    ).toBe(false);
    expect(
      projectDatabaseStateSchema.safeParse({
        kind: 'sqlite',
        profileId: 'sqlite-3.45-v1',
        revision: -1,
      }).success,
    ).toBe(false);
    const input = {
      operationId: '00000000-0000-4000-8000-000000000001',
      expectedVersion: 1,
      expectedDatabaseRevision: 0,
      targetKind: 'sqlite',
    };
    expect(changeProjectDatabaseSchema.safeParse(input).success).toBe(true);
    expect(
      changeProjectDatabaseSchema.safeParse({ ...input, targetProfileId: 'postgresql-18-v1' })
        .success,
    ).toBe(false);
    expect(
      changeProjectDatabaseSchema.safeParse({ ...input, expectedDatabaseRevision: undefined })
        .success,
    ).toBe(false);
  });
  it('does not change old serialized baselines by injecting defaults', () => {
    const baseline = {
      baselineId: '00000000-0000-4000-8000-000000000001',
      baseSequence: 0,
      baselineIssuedAt: '2026-10-01T00:00:00.000Z',
    };
    expect(syncBaselineSchema.parse(baseline)).toEqual(baseline);
    expect(syncBaselineSchema.parse({ ...baseline, databaseRevision: 2 }).databaseRevision).toBe(2);
  });
});
