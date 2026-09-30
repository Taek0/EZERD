import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { readConfig } from '../src/config.js';
import { projects, workspaces } from '../src/db/schema.js';

const pool = new pg.Pool({
  connectionString: readConfig().DATABASE_URL,
  connectionTimeoutMillis: 3000,
});
const db = drizzle(pool);
const id = randomUUID();
const rollback = new Error('intentional smoke-test rollback');
try {
  await db
    .transaction(async (tx) => {
      const [workspace] = await tx
        .insert(workspaces)
        .values({ name: '연결 검증 공간' })
        .returning();
      await tx
        .insert(projects)
        .values({ id, workspaceId: workspace!.id, name: '개발 환경 연결 검증' });
      const [project] = await tx.select().from(projects).where(eq(projects.id, id));
      if (!project || project.status !== 'active')
        throw new Error('Drizzle insert/select verification failed.');
      throw rollback;
    })
    .catch((error) => {
      if (error !== rollback) throw error;
    });
  const rows = await db.select().from(projects).where(eq(projects.id, id));
  if (rows.length !== 0) throw new Error('Transaction rollback verification failed.');
  console.log(
    'PASS: PostgreSQL connection, migration, Drizzle INSERT/SELECT, and transaction rollback.',
  );
} finally {
  await pool.end();
}
