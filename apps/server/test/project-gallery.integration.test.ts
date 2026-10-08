import { seedLegacyProject } from './legacy-project-fixture.js';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkspaceService } from '../src/workspace/workspace.service.js';
import { NativeTransferService } from '../src/workspace/native-transfer.service.js';
import { WorkspaceAccessService } from '../src/workspace/workspace-access.service.js';
import { readConfig } from '../src/config.js';
import type { DatabaseService } from '../src/db/database.service.js';

describe.runIf(process.env.EZERD_WORKSPACE_DB_TEST === '1')(
  'project gallery metadata in PostgreSQL',
  () => {
    let pool: pg.Pool;
    let service: WorkspaceService;
    let transferService: NativeTransferService;
    const actorId = randomUUID();
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    beforeAll(async () => {
      const url = readConfig().DATABASE_URL;
      if (!new URL(url).pathname.startsWith('/ezerd_workspace_test_'))
        throw new Error('Use the isolated workspace test runner.');
      pool = new pg.Pool({ connectionString: url });
      const database = { db: drizzle(pool) } as unknown as DatabaseService;
      service = new WorkspaceService(database, new WorkspaceAccessService(database));
      transferService = new NativeTransferService(database, new WorkspaceAccessService(database));
      await pool.query('INSERT INTO users(id, username, pin_hash) VALUES ($1,$2,$3)', [
        actorId,
        `gallery_${actorId.slice(0, 16)}`,
        'test',
      ]);
      for (const id of [workspaceId, otherWorkspaceId]) {
        await pool.query('INSERT INTO workspace(workspace_id, workspace_name) VALUES ($1,$2)', [
          id,
          'Gallery test',
        ]);
        await pool.query(
          'INSERT INTO user_workspaces(workspace_id,user_id,role) VALUES ($1,$2,$3)',
          [id, actorId, 'owner'],
        );
      }
    });
    afterAll(async () => {
      if (!pool) return;
      for (const id of [workspaceId, otherWorkspaceId]) {
        await pool.query('DELETE FROM projects WHERE workspace_id=$1', [id]);
        await pool.query('DELETE FROM workspace_audit_events WHERE workspace_id=$1', [id]);
        await pool.query('DELETE FROM user_workspaces WHERE workspace_id=$1', [id]);
        await pool.query('DELETE FROM workspace WHERE workspace_id=$1', [id]);
      }
      await pool.query('DELETE FROM users WHERE id=$1', [actorId]);
      await pool.end();
    });
    it('serializes simultaneous unnamed creation and includes archived/manual names in numbering', async () => {
      const first = await service.createProject(actorId, { workspaceId });
      expect(first).toMatchObject({ name: '새 프로젝트', databaseKind: 'postgresql' });
      const manual = await service.createProject(actorId, { workspaceId, name: '새 프로젝트 7' });
      await service.updateProject(actorId, manual.id, { expectedVersion: 0, status: 'archived' });
      const created = await Promise.all(
        Array.from({ length: 4 }, () =>
          service.createProject(actorId, { workspaceId, name: '   ' }),
        ),
      );
      expect(created.map((p) => p.name).sort()).toEqual([
        '새 프로젝트 10',
        '새 프로젝트 11',
        '새 프로젝트 8',
        '새 프로젝트 9',
      ]);
      expect((await service.createProject(actorId, { workspaceId: otherWorkspaceId })).name).toBe(
        '새 프로젝트',
      );
      expect(
        (await service.createProject(actorId, { workspaceId, name: '새 프로젝트 7' })).name,
      ).toBe('새 프로젝트 7');
    });
    it('persists database selection through update and file roundtrip, keeping archive restrictions', async () => {
      const created = await service.createProject(actorId, {
        workspaceId,
        name: 'Engine test',
        databaseKind: 'mysql',
      });
      await seedLegacyProject(pool, created.id);
      const updated = await service.updateProject(actorId, created.id, {
        expectedVersion: 0,
        databaseKind: 'sqlite',
      });
      expect(updated.databaseKind).toBe('sqlite');
      const transfer = await service.exportProject(actorId, created.id);
      const imported = await transferService.importProject(actorId, { workspaceId, transfer });
      expect(imported.project.databaseKind).toBe('sqlite');
      expect(
        (await pool.query('SELECT document FROM projects WHERE id=$1', [imported.project.id]))
          .rows[0].document.schemaVersion,
      ).toBe(2);
      const legacy = { ...transfer, project: { name: 'Legacy' } };
      expect(
        (await transferService.importProject(actorId, { workspaceId, transfer: legacy })).project
          .databaseKind,
      ).toBe('postgresql');
      await service.updateProject(actorId, created.id, { expectedVersion: 1, status: 'archived' });
      await expect(
        service.updateProject(actorId, created.id, {
          expectedVersion: 2,
          status: 'active',
          databaseKind: 'mysql',
        }),
      ).rejects.toThrow();
    });
  },
);
