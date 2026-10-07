import type pg from 'pg';

/** Seed an existing pre-native project for legacy API/upgrade regression tests.
 * Production creation always writes native documents; only untouched test rows qualify.
 */
export async function seedLegacyProject(pool: pg.Pool, projectId: string): Promise<void> {
  const result = await pool.query(
    'UPDATE projects SET document=DEFAULT WHERE id=$1 AND version=0 AND sync_sequence=0 RETURNING id',
    [projectId],
  );
  if (result.rowCount !== 1) throw new Error('Legacy fixtures require an untouched project');
}
