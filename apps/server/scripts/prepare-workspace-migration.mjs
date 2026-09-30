import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from 'dotenv';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

// Older installations with projects must prepare through 0011, assign explicitly,
// then apply the normal complete migration chain (0012 validates NOT NULL).
export async function prepareWorkspaceMigration(database) {
  const source = fileURLToPath(new URL('../drizzle/', import.meta.url));
  const journal = JSON.parse(await readFile(join(source, 'meta', '_journal.json'), 'utf8'));
  const entries = journal.entries.filter((entry) => entry.idx <= 11);
  if (entries.at(-1)?.tag !== '0011_large_gamma_corps')
    throw new Error('Workspace preparation migration is missing.');
  const temporaryRoot = resolve(tmpdir());
  const temporary = await mkdtemp(join(temporaryRoot, 'ezerd-workspace-migrate-'));
  try {
    await mkdir(join(temporary, 'meta'));
    await writeFile(
      join(temporary, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries }),
    );
    await Promise.all(
      entries.map((entry) =>
        copyFile(join(source, `${entry.tag}.sql`), join(temporary, `${entry.tag}.sql`)),
      ),
    );
    await migrate(database, { migrationsFolder: temporary });
  } finally {
    const target = resolve(temporary);
    if (!target.startsWith(`${temporaryRoot}${sep}ezerd-workspace-migrate-`))
      throw new Error('Invalid temporary migration path.');
    await rm(target, { recursive: true, force: true });
  }
}

async function main() {
  config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await prepareWorkspaceMigration(drizzle(pool));
    console.log(
      'Workspace migration prepared through 0011. Assign verified project owners before pnpm db:migrate finalization.',
    );
  } finally {
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error('Workspace preparation failed; no credentials logged.');
    process.exitCode = 1;
  });
