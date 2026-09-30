import { createHash } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  projectDatabasePreviewSchema,
  projectDatabaseChangeResultSchema,
  type previewProjectDatabaseSchema,
  type changeProjectDatabaseSchema,
} from '@ezerd/contracts';
import {
  defaultDatabaseContext,
  hasPhysicalDatabaseDesign,
  nextDatabaseRevision,
  requestFingerprint,
  resolveProjectDatabaseState,
  type DatabaseContext,
} from '@ezerd/model';
import { SyncGateway } from '../sync/sync.gateway.js';
import {
  projects,
  projectDatabaseOperations,
  syncClientBaselines,
  workspaceAuditEvents,
} from '../db/schema.js';
import type { ProjectRow } from '../db/schema.js';
import { WorkspaceAccessService } from './workspace-access.service.js';

type PreviewInput = z.infer<typeof previewProjectDatabaseSchema>;
type ChangeInput = z.infer<typeof changeProjectDatabaseSchema>;
const targetContext = (input: PreviewInput): DatabaseContext =>
  input.targetProfileId
    ? { kind: input.targetKind, profileId: input.targetProfileId }
    : defaultDatabaseContext(input.targetKind);
async function databaseOperation<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      'DB 설정을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    );
  }
}
function verifyVersion(row: ProjectRow, input: PreviewInput) {
  if (
    row.version !== input.expectedVersion ||
    (input.expectedSequence !== undefined && row.syncSequence !== input.expectedSequence)
  )
    throw new ConflictException({
      code: 'database.snapshot-changed',
      message: '프로젝트가 변경되었습니다. 최신 상태를 다시 확인해 주세요.',
    });
}

@Injectable()
export class ProjectDatabaseService {
  constructor(
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Optional() @Inject(SyncGateway) private readonly gateway?: SyncGateway,
  ) {}

  preview(actorId: string, projectId: string, input: PreviewInput) {
    return databaseOperation(() =>
      this.access.runProject(actorId, projectId, 'read', async (tx) => {
        const [row] = await tx.select().from(projects).where(eq(projects.id, projectId));
        if (!row) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
        verifyVersion(row, input);
        const current = resolveProjectDatabaseState(row);
        const target = targetContext(input);
        const different = current.kind !== target.kind || current.profileId !== target.profileId;
        const reasonCode =
          row.status !== 'active'
            ? 'database.project-archived'
            : different && hasPhysicalDatabaseDesign(row.document)
              ? 'database.conversion-required'
              : undefined;
        return projectDatabasePreviewSchema.parse({
          projectId,
          version: row.version,
          sequence: row.syncSequence,
          current,
          target,
          canChange: !reasonCode,
          ...(reasonCode && { reasonCode }),
        });
      }),
    );
  }

  async change(actorId: string, projectId: string, input: ChangeInput) {
    const fingerprint = createHash('sha256')
      .update(requestFingerprint({ command: 'database_change', projectId, input }))
      .digest('hex');
    const result = await databaseOperation(() =>
      this.access.runProject(actorId, projectId, 'manageProject', async (tx) => {
        const [row] = await tx
          .select()
          .from(projects)
          .where(eq(projects.id, projectId))
          .for('update');
        if (!row) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
        const [replay] = await tx
          .select()
          .from(projectDatabaseOperations)
          .where(
            and(
              eq(projectDatabaseOperations.projectId, projectId),
              eq(projectDatabaseOperations.operationId, input.operationId),
            ),
          );
        if (replay) {
          if (replay.actorId !== actorId || replay.fingerprint !== fingerprint)
            throw new ConflictException({
              code: 'operation.identity-conflict',
              message: '같은 작업 ID에 다른 요청을 사용할 수 없습니다.',
            });
          return projectDatabaseChangeResultSchema.parse(replay.result);
        }
        if (row.status !== 'active')
          throw new ConflictException({
            code: 'database.project-archived',
            message: '보관된 프로젝트의 DB 설정은 변경할 수 없습니다.',
          });
        verifyVersion(row, input);
        const current = resolveProjectDatabaseState(row);
        const target = targetContext(input);
        if (current.revision !== input.expectedDatabaseRevision)
          throw new ConflictException({
            code: 'database.context-changed',
            message: 'DB 설정이 변경되었습니다. 최신 상태를 다시 확인해 주세요.',
          });
        const changed = current.kind !== target.kind || current.profileId !== target.profileId;
        let revision = current.revision;
        if (changed) {
          if (hasPhysicalDatabaseDesign(row.document))
            throw new ConflictException({
              code: 'database.conversion-required',
              message: '물리 설계가 있는 프로젝트는 DB 종류 변경 전에 변환이 필요합니다.',
            });
          try {
            revision = nextDatabaseRevision(current);
          } catch {
            throw new ConflictException({
              code: 'database.revision-limit',
              message: 'DB 설정 변경 한도를 초과했습니다.',
            });
          }
          await tx
            .update(projects)
            .set({
              databaseKind: target.kind,
              databaseProfileId: target.profileId,
              databaseRevision: revision,
              version: sql`${projects.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(projects.id, projectId));
          await tx.delete(syncClientBaselines).where(eq(syncClientBaselines.projectId, projectId));
          await tx.insert(workspaceAuditEvents).values({
            workspaceId: row.workspaceId,
            actorId,
            action: 'project.database_changed',
            details: {
              projectId,
              operationId: input.operationId,
              from: current,
              to: { ...target, revision },
            },
          });
        }
        const result = projectDatabaseChangeResultSchema.parse({
          projectId,
          operationId: input.operationId,
          version: row.version + (changed ? 1 : 0),
          sequence: row.syncSequence,
          database: { ...target, revision },
          changed,
        });
        await tx
          .insert(projectDatabaseOperations)
          .values({ projectId, operationId: input.operationId, actorId, fingerprint, result });
        return result;
      }),
    );
    if (result.changed)
      this.gateway?.publishDatabaseContext(projectId, result.sequence, result.database.revision);
    return result;
  }
}
