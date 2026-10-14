import 'reflect-metadata';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import pg from 'pg';
import { requestFingerprint } from '@ezerd/model';
import { projectDocumentStateSchema } from '@ezerd/contracts';
import { readNativeProjectDocument } from '../src/shared/native-document-reader.js';
const url = parse(readFileSync('D:/ChatGPT/ERD/.env')).DATABASE_URL!;
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw Error('Local only');
const pool = new pg.Pool({ connectionString: url });
try {
  const rows = (
    await pool.query(
      "SELECT id,workspace_id,name,document,version,sync_sequence,database_kind,database_profile_id,database_revision,status,created_at,updated_at FROM projects WHERE name=$1 AND status='active'",
      ['klassboard-backend'],
    )
  ).rows;
  if (rows.length !== 1) throw Error('Expected exactly one named project, found ' + rows.length);
  const row = rows[0];
  const read = readNativeProjectDocument(row.document, {
    kind: row.database_kind,
    profileId: row.database_profile_id,
    revision: row.database_revision,
  });
  if (read.status !== 'available') throw Error('Preview unavailable');
  const snapshot = projectDocumentStateSchema.parse({
    protocolVersion: 2,
    project: {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      databaseKind: row.database_kind,
      databaseProfileId: row.database_profile_id,
      databaseRevision: row.database_revision,
      version: row.version,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    },
    sequence: row.sync_sequence,
    sourceDocument: read.rawSource,
    native: {
      status: 'available',
      document: read.preview,
      issues: read.issues,
      migrationIssues: read.migrationIssues,
    },
  });
  const folder = '../../artifacts/performance/2026-10-14-actual-document';
  mkdirSync(folder, { recursive: true });
  if (process.argv.includes('--verify')) {
    const before = JSON.parse(readFileSync(folder + '/snapshot.json', 'utf8'));
    const unchanged =
      requestFingerprint(before.sourceDocument) === requestFingerprint(snapshot.sourceDocument) &&
      before.sequence === snapshot.sequence;
    console.log(JSON.stringify({ originalUnchanged: unchanged }));
    if (!unchanged) throw Error('Original changed during measurement; inspect concurrent edits');
  } else writeFileSync(folder + '/snapshot.json', JSON.stringify(snapshot));
  console.log(
    JSON.stringify({
      id: row.id,
      version: row.version,
      sequence: row.sync_sequence,
      tables: row.document.tables.length,
      columns: row.document.columns.length,
      relations: row.document.tableRelations.length,
    }),
  );
} finally {
  await pool.end();
}
