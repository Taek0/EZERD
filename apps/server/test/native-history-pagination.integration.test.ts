import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { describe, expect, it } from 'vitest';
import { createEmptyNativeDocument, defaultDatabaseContext } from '@ezerd/model';
import { readConfig } from '../src/config.js';
import * as schema from '../src/db/schema.js';
import { WorkspaceAccessService } from '../src/workspace/workspace-access.service.js';
import { NativeHistoryService } from '../src/sync/native-history.service.js';

describe.runIf(process.env.EZERD_HISTORY_PAGE_DB_TEST === '1')(
  'native history compact newest pages',
  () => {
    it('returns the latest page first and retains immutable audit data and ascending compatibility', async () => {
      const url = new URL(readConfig().DATABASE_URL);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        throw Error('Local test DB required');
      const name = `ezerd_history_page_${randomUUID().replaceAll('-', '')}`;
      const admin = new pg.Pool({ connectionString: url.toString() });
      let pool: pg.Pool | undefined;
      let created = false;
      try {
        await admin.query(`CREATE DATABASE "${name}"`);
        created = true;
        url.pathname = `/${name}`;
        pool = new pg.Pool({ connectionString: url.toString() });
        const db = drizzle(pool, { schema });
        await migrate(db, { migrationsFolder: resolve('apps/server/drizzle') });
        const [user] = await db
          .insert(schema.users)
          .values({ username: 'history-page-qa', pinHash: '0'.repeat(64) })
          .returning();
        const [workspace] = await db
          .insert(schema.workspaces)
          .values({ name: 'History QA' })
          .returning();
        await db
          .insert(schema.userWorkspaces)
          .values({ userId: user!.id, workspaceId: workspace!.id, role: 'viewer' });
        const context = defaultDatabaseContext('postgresql'),
          doc = createEmptyNativeDocument(context);
        doc.notes = [{ id: 'n', viewId: 'overview', text: 'x'.repeat(5000) }];
        const [project] = await db
          .insert(schema.projects)
          .values({
            workspaceId: workspace!.id,
            name: 'History',
            document: doc,
            version: 55,
            syncSequence: 55,
          })
          .returning();
        const now = new Date(),
          actor = { id: user!.id, username: user!.username, color: user!.color };
        const source = randomUUID();
        await db.insert(schema.syncOperations).values(
          Array.from({ length: 55 }, (_, i) => {
            const sequence = i + 1,
              operationId = randomUUID(),
              groupId = randomUUID(),
              baselineId = randomUUID();
            return {
              projectId: project!.id,
              operationId,
              groupId,
              clientId: randomUUID(),
              actorId: user!.id,
              sequence,
              baseSequence: i,
              baselineId,
              baselineIssuedAt: now,
              kind: 'online',
              fingerprint: '0'.repeat(64),
              changes: [],
              dependencyPaths: [],
              result: {
                protocolVersion: 2,
                operationId,
                groupId,
                sequence,
                status: 'accepted',
                actor,
                changedPaths: [],
                createdAt: now.toISOString(),
                database: context,
                databaseRevision: 0,
                document: doc,
                delta: { baseSequence: i, projectVersion: sequence, changes: [] },
                nextBaseline: {
                  baselineId,
                  baseSequence: sequence,
                  baselineIssuedAt: now.toISOString(),
                  databaseRevision: 0,
                },
              },
              deletionSnapshot: {
                nativeHistory: { sourceOperationId: source },
                largeUnusedSnapshot: 'x'.repeat(5000),
              },
            };
          }),
        );
        const database = { db } as never,
          service = new NativeHistoryService(
            database,
            new WorkspaceAccessService(database),
            {} as never,
          );
        const first = await service.history(project!.id, 0, 25, actor, {
          order: 'desc',
          compact: true,
        });
        expect(first.history.map((e) => e.sequence)).toEqual(
          Array.from({ length: 25 }, (_, i) => 55 - i),
        );
        expect(first.nextBefore).toBe(31);
        expect(first.nextSince).toBeNull();
        expect(
          first.history.every((e) => !('document' in e.result) && !('delta' in e.result)),
        ).toBe(true);
        expect(first.history[0]!.deletionSnapshot).toEqual({
          nativeHistory: { sourceOperationId: source },
        });
        const second = await service.history(project!.id, 0, 25, actor, {
          order: 'desc',
          before: first.nextBefore!,
          compact: true,
        });
        const third = await service.history(project!.id, 0, 25, actor, {
          order: 'desc',
          before: second.nextBefore!,
          compact: true,
        });
        expect(
          [...first.history, ...second.history, ...third.history].map((e) => e.sequence),
        ).toEqual(Array.from({ length: 55 }, (_, i) => 55 - i));
        expect(third.nextBefore).toBeNull();
        const original = await service.history(project!.id, 0, 25, actor);
        expect(original.history[0]!.sequence).toBe(1);
        expect(original.nextSince).toBe(25);
        expect(original.history[0]!.result).toHaveProperty('document');
        expect(JSON.stringify(first).length).toBeLessThan(JSON.stringify(original).length / 5);
        await expect(
          service.history(
            project!.id,
            0,
            25,
            { ...actor, id: randomUUID() },
            { order: 'desc', compact: true },
          ),
        ).rejects.toThrow();
      } finally {
        await pool?.end();
        if (created && /^ezerd_history_page_[a-f0-9]{32}$/.test(name))
          await admin.query(`DROP DATABASE "${name}"`);
        await admin.end();
      }
    }, 30000);
  },
);
