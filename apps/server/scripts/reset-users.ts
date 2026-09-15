import assert from 'node:assert/strict';
import pg from 'pg';
import { readConfig } from '../src/config.js';

if (!process.argv.includes('--confirm-delete-all-users')) {
  throw new Error('Explicit --confirm-delete-all-users is required. Projects are preserved.');
}
const config = readConfig();
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.DATABASE_URL).hostname)) {
  throw new Error('This reset script is restricted to a local development database.');
}
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 3000 });
const client = await pool.connect();
const counts = async () =>
  (
    await client.query(`SELECT
  (SELECT count(*)::int FROM users) AS users,
  (SELECT count(*)::int FROM sessions) AS sessions,
  (SELECT count(*)::int FROM review_threads) AS pins,
  (SELECT count(*)::int FROM review_messages) AS messages,
  (SELECT count(*)::int FROM review_notifications) AS notifications,
  (SELECT count(*)::int FROM sync_operations) AS history,
  (SELECT count(*)::int FROM sync_client_baselines) AS baselines`)
  ).rows[0];
try {
  await client.query('BEGIN');
  await client.query('LOCK TABLE projects, users IN ACCESS EXCLUSIVE MODE');
  const before = await counts();
  const documents = await client.query(
    'SELECT id, md5(document::text) AS digest, version, sync_sequence FROM projects ORDER BY id',
  );
  await client.query('DELETE FROM review_threads');
  await client.query('DELETE FROM sync_operations');
  await client.query('DELETE FROM users');
  const after = await counts();
  assert(Object.values(after).every((value) => value === 0));
  const preserved = await client.query(
    'SELECT id, md5(document::text) AS digest, version, sync_sequence FROM projects ORDER BY id',
  );
  assert.deepEqual(preserved.rows, documents.rows);
  await client.query('COMMIT');
  console.log(
    JSON.stringify({
      before,
      after,
      preservedProjects: documents.rows.length,
      documentsUnchanged: true,
    }),
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
