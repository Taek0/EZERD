import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createEmptyDocument,
  createEmptyNativeDocument,
  defaultDatabaseContext,
  sharedDocument,
} from '@ezerd/model';
import { WorkspaceService } from '../src/workspace/workspace.service.js';
import type { DatabaseService } from '../src/db/database.service.js';
import type { WorkspaceAccessService } from '../src/workspace/workspace-access.service.js';
import { projects } from '../src/db/schema.js';
function harness() {
  let stored: Record<string, unknown> | undefined;
  const values = vi.fn((input: Record<string, unknown>) => {
    stored = input;
    return {
      returning: async () => [
        {
          id: randomUUID(),
          status: 'active',
          version: 0,
          syncSequence: 0,
          databaseRevision: 0,
          databaseKind: 'postgresql',
          document: createEmptyDocument(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...input,
        },
      ],
    };
  });
  const audit = vi.fn(async () => undefined),
    tx = { insert: vi.fn((table) => ({ values: table === projects ? values : audit })) };
  const access = {
    runWorkspace: vi.fn(
      async (
        _actor: string,
        _workspace: string,
        _permission: string,
        callback: (tx: unknown) => unknown,
      ) => callback(tx),
    ),
  };
  return {
    service: new WorkspaceService(
      {} as DatabaseService,
      access as unknown as WorkspaceAccessService,
    ),
    access,
    values,
    audit,
    stored: () => stored,
  };
}
describe('fresh native project storage selection', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'stores a native %s factory shared document in the existing transaction',
    async (databaseKind) => {
      const h = harness(),
        workspaceId = randomUUID(),
        actor = randomUUID();
      const project = await h.service.createProject(actor, {
        workspaceId,
        name: 'Native',
        databaseKind,
      });
      const context = defaultDatabaseContext(databaseKind);
      expect(h.stored()).toMatchObject({
        workspaceId,
        name: 'Native',
        databaseKind,
        databaseProfileId: context.profileId,
        databaseRevision: 0,
        document: sharedDocument(createEmptyNativeDocument(context)),
      });
      expect(h.stored()).not.toHaveProperty('formatVersion');
      expect(h.stored()).not.toHaveProperty('ownerId');
      expect(
        (h.stored()!.document as ReturnType<typeof createEmptyNativeDocument>).domains,
      ).toEqual([]);
      expect(
        (h.stored()!.document as ReturnType<typeof createEmptyNativeDocument>).layout.viewports,
      ).toEqual([]);
      expect(h.access.runWorkspace).toHaveBeenCalledWith(
        actor,
        workspaceId,
        'createProject',
        expect.any(Function),
      );
      expect(h.audit).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId, actorId: actor, action: 'project.created' }),
      );
      expect(project).toMatchObject({
        databaseKind,
        databaseProfileId: context.profileId,
        databaseRevision: 0,
        version: 0,
      });
    },
  );
  it('rejects legacy creation before writing a project', async () => {
    const h = harness();
    await expect(
      h.service.createProject(randomUUID(), {
        workspaceId: randomUUID(),
        name: 'Legacy',
        // @ts-expect-error Check runtime callers that bypass the request schema.
        formatVersion: 1,
      }),
    ).rejects.toThrow();
    expect(h.access.runWorkspace).not.toHaveBeenCalled();
    expect(h.values).not.toHaveBeenCalled();
  });
});
