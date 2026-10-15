import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readConfig } from '../src/config.js';

describe.runIf(process.env.EZERD_WORKSPACE_DB_TEST === '1')(
  'workspace order incremental migration repair',
  () => {
    it.each([17, 18])(
      'upgrades an existing database at journal index %i without losing membership data',
      async (cutoff) => {
        const name = `ezerd_order_upgrade_${randomUUID().replaceAll('-', '')}`;
        const url = new URL(readConfig().DATABASE_URL);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
          throw Error('Local test database required');
        const admin = new pg.Pool({ connectionString: url.toString() });
        const scratchRoot = resolve('.data/migration-upgrade-tests');
        const folder = resolve(scratchRoot, name);
        const source = resolve('apps/server/drizzle');
        let created = false;
        let pool: pg.Pool | undefined;
        try {
          await mkdir(resolve(folder, 'meta'), { recursive: true });
          const journal = JSON.parse(await readFile(resolve(source, 'meta/_journal.json'), 'utf8'));
          journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= cutoff);
          await writeFile(resolve(folder, 'meta/_journal.json'), JSON.stringify(journal));
          for (const entry of journal.entries)
            await copyFile(
              resolve(source, entry.tag + '.sql'),
              resolve(folder, entry.tag + '.sql'),
            );
          await admin.query(`CREATE DATABASE "${name}"`);
          created = true;
          url.pathname = `/${name}`;
          pool = new pg.Pool({ connectionString: url.toString() });
          const db = drizzle(pool);
          await migrate(db, { migrationsFolder: folder });
          const [user] = (
            await pool.query(
              "insert into users(username,pin_hash) values ('upgrade-qa',$1) returning id",
              ['0'.repeat(64)],
            )
          ).rows;
          const [workspace] = (
            await pool.query(
              "insert into workspace(workspace_name) values ('Preserve me') returning workspace_id",
            )
          ).rows;
          await pool.query(
            'insert into user_workspaces(user_id,workspace_id,role) values($1,$2,$3)',
            [user.id, workspace.workspace_id, 'viewer'],
          );
          if (cutoff === 18) await pool.query('update user_workspaces set sort_order=7');
          await migrate(db, { migrationsFolder: source });
          expect((await pool.query('select sort_order,role from user_workspaces')).rows).toEqual([
            { sort_order: cutoff === 18 ? 7 : null, role: 'viewer' },
          ]);
          const repair = await readFile(resolve(source, '0019_repair_workspace_order.sql'), 'utf8');
          await pool.query(repair);
          await pool.query(repair);
          await migrate(db, { migrationsFolder: source });
          expect((await pool.query('select count(*)::int as n from users')).rows[0].n).toBe(1);
          await expect(
            pool.query('update user_workspaces set sort_order=-1'),
          ).rejects.toMatchObject({ code: '23514' });
        } finally {
          await pool?.end();
          if (created && /^ezerd_order_upgrade_[a-f0-9]{32}$/.test(name))
            await admin.query(`DROP DATABASE "${name}"`);
          await admin.end();
          if (!folder.startsWith(scratchRoot + sep)) throw Error('Unexpected test path');
          await rm(folder, { recursive: true, force: true });
        }
      },
      30000,
    );
  },
);
