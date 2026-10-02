import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  designDocumentReadSchema,
  nativeStoredDesignDocumentSchema,
  nativeSyncOperationResultSchema,
  upgradeProjectDocumentSchema,
} from '@ezerd/contracts';
import {
  migrateDesignDocumentV1,
  nextDatabaseRevision,
  requestFingerprint,
  resolveProjectDatabaseState,
  sharedDocument,
  validateDatabaseDocument,
} from '@ezerd/model';
import { DatabaseService } from '../db/database.service.js';
import { projects, syncOperations, syncFieldVersions, syncClientBaselines } from '../db/schema.js';
import { WorkspaceAccessService } from './workspace-access.service.js';
import { SyncGateway } from '../sync/sync.gateway.js';
import type { AuthenticatedUser } from '../identity/session.js';
import { z } from 'zod';

@Injectable()
export class NativeUpgradeService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(SyncGateway) private readonly gateway: SyncGateway,
  ) {}
  async upgrade(projectId: string, raw: unknown, user: AuthenticatedUser) {
    const identity = z.object({ operationId: z.uuid() }).passthrough().safeParse(raw);
    if (!identity.success)
      throw new BadRequestException({ code: 'document.upgrade-input-invalid' });
    const fingerprint = createHash('sha256')
      .update(requestFingerprint({ command: 'upgrade_project_document', projectId, input: raw }))
      .digest('hex');
    const outcome = await this.database.db.transaction(async (tx) => {
      await this.access.requireProject(user.id, projectId, 'read', tx);
      const replay = async () => {
        const [row] = await tx
          .select()
          .from(syncOperations)
          .where(
            and(
              eq(syncOperations.projectId, projectId),
              eq(syncOperations.operationId, identity.data.operationId),
            ),
          );
        if (!row) return undefined;
        if (row.actorId !== user.id || row.fingerprint !== fingerprint)
          throw new ConflictException({ code: 'sync.replay-mismatch' });
        const checked = nativeSyncOperationResultSchema.safeParse(row.result);
        if (!checked.success) throw new ConflictException({ code: 'sync.protocol-mismatch' });
        // Validate the historical ACK without applying current trim/default transformations.
        return structuredClone(row.result) as typeof checked.data;
      };
      const old = await replay();
      if (old) return { result: old, changed: false };
      const [project] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .for('update');
      if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      const lockedReplay = await replay();
      if (lockedReplay) return { result: lockedReplay, changed: false };
      await this.access.requireProject(user.id, projectId, 'design', tx);
      const parsed = upgradeProjectDocumentSchema.safeParse(raw);
      if (!parsed.success)
        throw new BadRequestException({ code: 'document.upgrade-input-invalid' });
      const input = parsed.data,
        database = resolveProjectDatabaseState(project);
      if (project.status !== 'active') throw new ConflictException({ code: 'project.archived' });
      if (
        input.expectedVersion !== project.version ||
        input.expectedSequence !== project.syncSequence ||
        input.expectedDatabaseRevision !== database.revision
      )
        throw new ConflictException({ code: 'database.context-changed' });
      if (project.syncSequence >= 2147483647 || project.version >= 2147483647)
        throw new ConflictException({ code: 'sync.sequence-limit' });
      const source = designDocumentReadSchema.safeParse(project.document);
      if (!source.success) throw new BadRequestException({ code: 'document.source-invalid' });
      if (source.data.schemaVersion !== 1)
        throw new ConflictException({ code: 'document.already-native' });
      // Migration authority is the locked server source, not a client-supplied converted document.
      const migration = migrateDesignDocumentV1(source.data, {
        kind: database.kind,
        profileId: database.profileId,
      });
      const native = nativeStoredDesignDocumentSchema.safeParse(migration.document);
      if (!native.success)
        throw new BadRequestException({ code: 'document.native-preview-invalid' });
      const document = native.data;
      const issues = validateDatabaseDocument(document, database, {
        mode: 'write',
        previous: document,
      });
      if (issues.some((issue) => issue.severity === 'error'))
        throw new BadRequestException({ code: 'document.upgrade-invalid', issues });
      const sequence = project.syncSequence + 1,
        revision = nextDatabaseRevision(database),
        now = new Date(),
        baselineId = randomUUID();
      const paths = [
        '/schemaVersion',
        '/database',
        '/tables',
        '/columns',
        '/keys',
        '/tableRelations',
        '/enums',
        '/indexes',
        '/checks',
      ];
      const result = nativeSyncOperationResultSchema.parse({
        protocolVersion: 2,
        operationId: input.operationId,
        groupId: input.operationId,
        sequence,
        status: 'accepted',
        reasonCode: 'document.upgraded',
        database: { kind: database.kind, profileId: database.profileId },
        databaseRevision: revision,
        actor: { id: user.id, username: user.username, color: user.color },
        changedPaths: paths,
        createdAt: now.toISOString(),
        document,
        nextBaseline: {
          baselineId,
          baseSequence: sequence,
          baselineIssuedAt: now.toISOString(),
          databaseRevision: revision,
        },
      });
      await tx
        .update(projects)
        .set({
          document: sql`${JSON.stringify(document)}::jsonb`,
          version: sql`${projects.version} + 1`,
          syncSequence: sequence,
          databaseProfileId: database.profileId,
          databaseRevision: revision,
          updatedAt: now,
        })
        .where(eq(projects.id, projectId));
      await tx.delete(syncClientBaselines).where(eq(syncClientBaselines.projectId, projectId));
      await tx.insert(syncClientBaselines).values({
        projectId,
        clientId: input.clientId,
        userId: user.id,
        baselineId,
        lastSequence: sequence,
        databaseRevision: revision,
        lastSuccessfulSyncAt: now,
        document: sql`${JSON.stringify(sharedDocument(document))}::jsonb`,
      });
      // Preserve per-entity versions/tombstones, including retired v1 identities; only add boundary guards.
      for (const path of paths)
        await tx
          .insert(syncFieldVersions)
          .values({ projectId, path, sequence, operationId: input.operationId, updatedAt: now })
          .onConflictDoUpdate({
            target: [syncFieldVersions.projectId, syncFieldVersions.path],
            set: { sequence, operationId: input.operationId, updatedAt: now },
          });
      await tx.insert(syncOperations).values({
        projectId,
        operationId: input.operationId,
        groupId: input.operationId,
        clientId: input.clientId,
        actorId: user.id,
        sequence,
        baseSequence: project.syncSequence,
        baselineId,
        baselineIssuedAt: now,
        kind: 'online',
        fingerprint,
        changes: [],
        result: result as unknown as Record<string, unknown>,
        deletionSnapshot: {
          command: 'upgrade',
          sourceDocument: structuredClone(project.document),
          sourceDatabase: database,
          migrationIssues: migration.issues,
        },
        createdAt: now,
      });
      return { result, changed: true };
    });
    if (outcome.changed)
      this.gateway.publishDatabaseContext(
        projectId,
        outcome.result.sequence,
        outcome.result.databaseRevision,
      );
    return outcome.result;
  }
}
