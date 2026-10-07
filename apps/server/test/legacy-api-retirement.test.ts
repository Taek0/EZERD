import 'reflect-metadata';
import { Module, UnauthorizedException, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { SyncController } from '../src/sync/sync.controller.js';
import { NativeSyncController } from '../src/sync/native-sync.controller.js';
import { NativeSyncService } from '../src/sync/native-sync.service.js';
import { SessionService } from '../src/identity/session.js';
import { WorkspaceController } from '../src/workspace/workspace.controller.js';
import { WorkspaceService } from '../src/workspace/workspace.service.js';
import { ProjectDatabaseService } from '../src/workspace/project-database.service.js';
import { DatabaseService } from '../src/db/database.service.js';
import { RateLimitService } from '../src/shared/rate-limit.service.js';
import { PersonalStateService } from '../src/workspace/personal-state.service.js';
import { createEmptyDocument } from '@ezerd/model';

const actor = { id: crypto.randomUUID(), username: 'owner', color: '#4169e1' };
const projectId = crypto.randomUUID(),
  operationId = crypto.randomUUID();
const workspace = { getProject: vi.fn() };
const native = { lookup: vi.fn(async () => ({ native: true })) };
class TestModule {}
Module({
  controllers: [SyncController, NativeSyncController, WorkspaceController],
  providers: [
    { provide: DatabaseService, useValue: {} },
    { provide: WorkspaceService, useValue: workspace },
    { provide: RateLimitService, useValue: {} },
    { provide: ProjectDatabaseService, useValue: {} },
    { provide: NativeSyncService, useValue: native },
    {
      provide: SessionService,
      useValue: {
        authenticateHeader: async (value: string) => {
          if (value !== 'Bearer test-session') throw new UnauthorizedException();
          return actor;
        },
      },
    },
  ],
})(TestModule);
let app: INestApplication, base: string;
beforeAll(async () => {
  app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
});

it('returns authenticated 410 tombstones for every retired REST path without legacy services', async () => {
  for (const [method, suffix] of [
    ['GET', ''],
    ['PUT', '/document'],
    ['POST', '/operations'],
    ['GET', `/operations/${operationId}`],
    ['GET', '/events'],
    ['GET', '/history'],
    ['POST', '/sync-baseline'],
    ['POST', `/operations/${operationId}/undo`],
    ['POST', `/deletions/${operationId}/restore`],
  ]) {
    const url = `${base}/api/projects/${projectId}${suffix}`;
    expect((await fetch(url, { method })).status).toBe(401);
    const response = await fetch(url, {
      method,
      headers: { Authorization: 'Bearer test-session' },
    });
    expect(response.status, `${method} ${suffix}`).toBe(410);
    expect(await response.json()).toMatchObject({ code: 'document.legacy-api-retired' });
  }
  expect(workspace.getProject).not.toHaveBeenCalled();
});

it('keeps the native operation lookup route separate and bound to the actor', async () => {
  const response = await fetch(
    `${base}/api/projects/${projectId}/native-sync/operations/${operationId}`,
    {
      headers: { Authorization: 'Bearer test-session' },
    },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ native: true });
  expect(native.lookup).toHaveBeenCalledWith(projectId, operationId, actor);
});

it('rejects new v1 personal-state writes before invoking a change callback or storage mutation', async () => {
  const project = {
    id: projectId,
    document: createEmptyDocument(),
    status: 'active',
    databaseKind: 'postgresql',
  };
  const results = [[project], []];
  const chain: any = {};
  chain.from = chain.where = () => chain;
  chain.for = async () => results.shift();
  const tx = { select: () => chain, insert: vi.fn(), update: vi.fn() };
  const service = new PersonalStateService(
    { db: { transaction: (fn: (tx: unknown) => unknown) => fn(tx) } } as never,
    { requireProject: vi.fn() } as never,
  );
  const change = vi.fn();
  await expect(service.mutate(projectId, actor, 0, change)).rejects.toMatchObject({ status: 410 });
  expect(change).not.toHaveBeenCalled();
  expect(tx.insert).not.toHaveBeenCalled();
  expect(tx.update).not.toHaveBeenCalled();
});
