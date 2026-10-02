import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import pg from 'pg';

export const approvedTransfer = {
  key: '2026-09-30-approved-workspace-transfer-v1',
  ownerId: 'cebce815-6ff4-42fe-a55f-997d1b6aabc0',
  tokenId: '6fe865da-fe73-4729-a31e-c36bd5038ac1',
  spaces: [
    {
      id: '611dca01-381d-4d45-9b6e-a2a47b2177d9',
      name: 'Edusync',
      projects: [{ id: '56a7ccd0-ffb8-462c-a253-6ae6f266c4a8', name: 'klassboard-backend' }],
    },
    {
      id: '3c57cfc8-e6e6-4ec5-8cbd-8c5538a67182',
      name: 'TY',
      projects: [
        { id: '903ec4ff-2ca4-4724-8d8a-3ec98765a68b', name: 'ezerd' },
        { id: 'bbae7fcb-72ba-4395-add3-a9e4ff13a546', name: 'monya' },
      ],
    },
  ],
};

const preservedTables = [
  'project_personal_states',
  'project_personal_operations',
  'review_threads',
  'review_notifications',
  'sync_operations',
  'sync_field_versions',
  'sync_client_baselines',
  'sync_tombstones',
];
function hash(rows) {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

export async function preservationSnapshot(client, projectIds) {
  const snapshot = {};
  const projectRows = await client.query(
    `SELECT to_jsonb(p) - 'workspace_id' AS value FROM projects p WHERE id = ANY($1::uuid[]) ORDER BY id`,
    [projectIds],
  );
  snapshot.projects = { count: projectRows.rowCount, sha256: hash(projectRows.rows) };
  for (const table of preservedTables) {
    const rows = await client.query(
      `SELECT to_jsonb(t) AS value FROM ${table} t WHERE project_id = ANY($1::uuid[]) ORDER BY to_jsonb(t)::text`,
      [projectIds],
    );
    snapshot[table] = { count: rows.rowCount, sha256: hash(rows.rows) };
  }
  const messages = await client.query(
    `SELECT to_jsonb(m) AS value FROM review_messages m JOIN review_threads t ON t.id=m.thread_id WHERE t.project_id=ANY($1::uuid[]) ORDER BY m.id`,
    [projectIds],
  );
  snapshot.review_messages = { count: messages.rowCount, sha256: hash(messages.rows) };
  return snapshot;
}

// The caller supplies explicit identities. This function never infers owners from names.
export async function transferProjects(client, transfer, { apply = false, finalize = true } = {}) {
  const projectIds = transfer.spaces.flatMap((space) =>
    space.projects.map((project) => project.id),
  );
  if (!projectIds.length || new Set(projectIds).size !== projectIds.length)
    throw new Error('Transfer requires unique, explicit project IDs.');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [transfer.key]);
    // Block old server writes as well as new workspace-aware writes during verification.
    // Acquire the strongest projects lock first, including the final schema change.
    // Child tables are only read in this snapshot; locking them can deadlock with
    // unrelated cleanup jobs or child inserts waiting for the projects FK lock.
    await client.query('LOCK TABLE projects IN ACCESS EXCLUSIVE MODE');
    const owner = await client.query('SELECT id FROM users WHERE id=$1 FOR KEY SHARE', [
      transfer.ownerId,
    ]);
    if (owner.rowCount !== 1) throw new Error('Verified owner account is missing.');
    if (transfer.tokenId) {
      const token = await client.query(
        'SELECT user_id FROM mcp_tokens WHERE id=$1 AND revoked_at IS NULL AND expires_at>now()',
        [transfer.tokenId],
      );
      if (token.rows[0]?.user_id !== transfer.ownerId)
        throw new Error('Current MCP token ownership no longer matches verified account.');
    }
    const rows = await client.query(
      'SELECT id,name,workspace_id FROM projects WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [projectIds],
    );
    if (rows.rowCount !== projectIds.length) throw new Error('An approved project is missing.');
    for (const space of transfer.spaces) {
      for (const expected of space.projects) {
        const actual = rows.rows.find((row) => row.id === expected.id);
        if (actual.name !== expected.name)
          throw new Error(`Project identity mismatch: ${expected.id}`);
        if (actual.workspace_id && actual.workspace_id !== space.id)
          throw new Error(`Project already belongs to a different workspace: ${expected.id}`);
      }
      const existing = await client.query(
        'SELECT workspace_name FROM workspace WHERE workspace_id=$1 FOR UPDATE',
        [space.id],
      );
      if (existing.rowCount && existing.rows[0].workspace_name !== space.name)
        throw new Error(`Workspace identity mismatch: ${space.id}`);
      const membership = await client.query(
        'SELECT role FROM user_workspaces WHERE workspace_id=$1 AND user_id=$2',
        [space.id, transfer.ownerId],
      );
      if (membership.rowCount && membership.rows[0].role !== 'owner')
        throw new Error('Existing membership conflicts with approved owner role.');
    }
    const before = await preservationSnapshot(client, projectIds);
    const orphaned = await client.query(
      'SELECT id,name FROM projects WHERE workspace_id IS NULL AND NOT(id=ANY($1::uuid[])) ORDER BY id',
      [projectIds],
    );
    if (finalize && orphaned.rowCount)
      throw new Error(
        'Additional unassigned projects require explicit assignment before finalization.',
      );
    if (apply) {
      for (const space of transfer.spaces) {
        await client.query(
          'INSERT INTO workspace(workspace_id,workspace_name) VALUES($1,$2) ON CONFLICT(workspace_id) DO NOTHING',
          [space.id, space.name],
        );
        await client.query(
          "INSERT INTO user_workspaces(workspace_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING",
          [space.id, transfer.ownerId],
        );
        const ids = space.projects.map((project) => project.id);
        await client.query(
          'UPDATE projects SET workspace_id=$1 WHERE id=ANY($2::uuid[]) AND workspace_id IS NULL',
          [space.id, ids],
        );
        // A stable migration key stored in audit details makes reruns no-ops.
        await client.query(
          `INSERT INTO workspace_audit_events(workspace_id,actor_id,action,details)
           SELECT $1,$2,'projects.transferred',$3::jsonb
           WHERE NOT EXISTS(SELECT 1 FROM workspace_audit_events WHERE workspace_id=$1 AND action='projects.transferred' AND details->>'migrationKey'=$4)`,
          [
            space.id,
            transfer.ownerId,
            JSON.stringify({ migrationKey: transfer.key, projectIds: ids, preservation: before }),
            transfer.key,
          ],
        );
      }
      if (finalize)
        await client.query('ALTER TABLE projects ALTER COLUMN workspace_id SET NOT NULL');
    }
    const after = await preservationSnapshot(client, projectIds);
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error('Preservation verification failed; rolling back.');
    const assignments = await client.query(
      'SELECT id,name,workspace_id FROM projects WHERE id=ANY($1::uuid[]) ORDER BY id',
      [projectIds],
    );
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return {
      applied: apply,
      ownerId: transfer.ownerId,
      assignments: assignments.rows,
      preservation: after,
      finalized: apply && finalize,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const result = await transferProjects(client, approvedTransfer, {
      apply: process.argv.includes('--apply'),
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      'Workspace transfer failed; no transfer changes committed. Verify identities and schema with a dry run.',
    );
    process.exitCode = 1;
  });
