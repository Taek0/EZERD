import { createHash } from 'node:crypto';
import {
  ConflictException,
  BadRequestException,
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
  nativeStoredDesignDocumentSchema,
  MAX_DOCUMENT_BYTES,
  projectDatabasePreviewSchema,
  projectDatabaseChangeResultSchema,
  type previewProjectDatabaseSchema,
  type changeProjectDatabaseSchema,
} from '@ezerd/contracts';
import {
  defaultDatabaseContext,
  hasPhysicalDatabaseDesign,
  nextDatabaseRevision,
  planNativeDatabaseConversion,
  requestFingerprint,
  resolveProjectDatabaseState,
  type DatabaseContext,
  type DatabaseIssue,
  type NativeDesignDocument,
} from '@ezerd/model';
import { SyncGateway } from '../sync/sync.gateway.js';
import { DatabaseService } from '../db/database.service.js';
import {
  projects,
  projectDatabaseOperations,
  syncClientBaselines,
  syncFieldVersions,
  workspaceAuditEvents,
} from '../db/schema.js';
import type { ProjectRow } from '../db/schema.js';
import { WorkspaceAccessService } from './workspace-access.service.js';
import { requireLegacyServerDocument } from '../shared/normalize-document.js';

type PreviewInput = z.infer<typeof previewProjectDatabaseSchema>;
type ChangeInput = z.infer<typeof changeProjectDatabaseSchema>;
const targetContext = (input: PreviewInput): DatabaseContext =>
  input.targetProfileId
    ? { kind: input.targetKind, profileId: input.targetProfileId }
    : defaultDatabaseContext(input.targetKind);
const MAX_COUNTER = 2147483647;
const isNative = (row: ProjectRow) =>
  (row.document as { schemaVersion: number }).schemaVersion === 2;
function verifyNativeContext(row: ProjectRow, source: DatabaseContext) {
  if (!isNative(row)) return;
  const stored = (row.document as unknown as { database?: DatabaseContext }).database;
  if (stored?.kind !== source.kind || stored.profileId !== source.profileId)
    throw new ConflictException({ code: 'database.context-changed' });
}
function nativePlan(row: ProjectRow, source: DatabaseContext, target: DatabaseContext) {
  const raw: unknown = row.document;
  const shape = nativeStoredDesignDocumentSchema.safeParse(raw);
  if (!shape.success)
    throw new BadRequestException({
      code: 'database.document-invalid',
      issues: shape.error.issues,
    });
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_DOCUMENT_BYTES)
    throw new BadRequestException({ code: 'database.document-size-limit' });
  // Validate shape without persisting parser normalization of raw names, comments or metadata.
  const plan = planNativeDatabaseConversion(raw as NativeDesignDocument, source, target);
  const candidate = plan.candidate ?? plan.document;
  if (candidate) {
    const targetShape = nativeStoredDesignDocumentSchema.safeParse(candidate);
    if (!targetShape.success)
      throw new BadRequestException({
        code: 'database.document-invalid',
        issues: targetShape.error.issues,
      });
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_DOCUMENT_BYTES)
      throw new BadRequestException({ code: 'database.document-size-limit' });
  }
  return plan;
}
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
    @Inject(DatabaseService) private readonly database: DatabaseService,
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
        verifyNativeContext(row, current);
        const target = targetContext(input);
        const different = current.kind !== target.kind || current.profileId !== target.profileId;
        let issues: DatabaseIssue[] | undefined;
        let reasonCode: string | undefined;
        if (row.status !== 'active') reasonCode = 'database.project-archived';
        else if (different && isNative(row)) {
          const plan = nativePlan(row, current, target);
          issues = plan.issues;
          if (!plan.canApply) reasonCode = 'database.conversion-required';
        } else if (different) {
          requireLegacyServerDocument(row.document);
          if (hasPhysicalDatabaseDesign(row.document)) reasonCode = 'database.conversion-required';
        }
        return projectDatabasePreviewSchema.parse({
          projectId,
          version: row.version,
          sequence: row.syncSequence,
          current,
          target,
          canChange: !reasonCode,
          ...(reasonCode && { reasonCode }),
          ...(issues && { issues }),
        });
      }),
    );
  }

  async change(actorId: string, projectId: string, input: ChangeInput) {
    const fingerprint = createHash('sha256')
      .update(requestFingerprint({ command: 'database_change', projectId, input }))
      .digest('hex');
    const result = await databaseOperation(() =>
      this.database.db.transaction(async (tx) => {
        // Read access is enough to replay an existing ACK after role/status changes.
        // Use a writable transaction: runProject(read) cannot take the project row lock.
        await this.access.requireProject(actorId, projectId, 'read', tx);
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
          return { result: projectDatabaseChangeResultSchema.parse(replay.result), notify: false };
        }
        await this.access.requireProject(actorId, projectId, 'manageProject', tx);
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
        if (isNative(row) && input.expectedSequence === undefined)
          throw new BadRequestException({ code: 'database.sequence-required' });
        verifyNativeContext(row, current);
        const changed = current.kind !== target.kind || current.profileId !== target.profileId;
        let revision = current.revision;
        let sequence = row.syncSequence;
        if (changed) {
          let document: NativeDesignDocument | undefined;
          let paths: string[] = [];
          let conversion: ReturnType<typeof nativePlan> | undefined;
          if (isNative(row)) {
            const plan = nativePlan(row, current, target);
            conversion = plan;
            if (plan.hasPhysicalDesign || plan.sourceMap.length)
              await this.access.requireProject(actorId, projectId, 'design', tx);
            if (!plan.canApply || !plan.document)
              throw new ConflictException({
                code: 'database.conversion-required',
                issues: plan.issues,
              });
            document = plan.document;
            paths = plan.changedPaths;
          } else {
            requireLegacyServerDocument(row.document);
            if (hasPhysicalDatabaseDesign(row.document))
              throw new ConflictException({
                code: 'database.conversion-required',
                message: '물리 설계가 있는 프로젝트는 DB 종류 변경 전에 변환이 필요합니다.',
              });
          }
          if (row.version >= MAX_COUNTER || (document && row.syncSequence >= MAX_COUNTER))
            throw new ConflictException({ code: 'database.sequence-limit' });
          try {
            revision = nextDatabaseRevision(current);
          } catch {
            throw new ConflictException({
              code: 'database.revision-limit',
              message: 'DB 설정 변경 한도를 초과했습니다.',
            });
          }
          const now = new Date();
          if (document) sequence += 1;
          await tx
            .update(projects)
            .set({
              databaseKind: target.kind,
              databaseProfileId: target.profileId,
              databaseRevision: revision,
              version: sql`${projects.version} + 1`,
              ...(document && {
                document: sql`${JSON.stringify(document)}::jsonb`,
                syncSequence: sequence,
              }),
              updatedAt: now,
            })
            .where(eq(projects.id, projectId));
          await tx.delete(syncClientBaselines).where(eq(syncClientBaselines.projectId, projectId));
          // Preserve existing field versions and retired identities; add only changed boundaries.
          for (const path of paths)
            await tx
              .insert(syncFieldVersions)
              .values({ projectId, path, sequence, operationId: input.operationId, updatedAt: now })
              .onConflictDoUpdate({
                target: [syncFieldVersions.projectId, syncFieldVersions.path],
                set: { sequence, operationId: input.operationId, updatedAt: now },
              });
          await tx.insert(workspaceAuditEvents).values({
            workspaceId: row.workspaceId,
            actorId,
            action: 'project.database_changed',
            details: {
              projectId,
              operationId: input.operationId,
              from: current,
              to: { ...target, revision },
              ...(document && {
                sourceDocument: structuredClone(row.document),
                changedPaths: paths,
                sourceVersion: row.version,
                sourceSequence: row.syncSequence,
                sequence,
                conversion: conversion?.sourceMap.length
                  ? 'verified-signed-integer-v1'
                  : 'empty-native-context',
                ...(conversion?.sourceMap.length && {
                  sourceMap: conversion.sourceMap,
                  engineVerified: conversion.engineVerified,
                }),
              }),
            },
          });
        }
        const result = projectDatabaseChangeResultSchema.parse({
          projectId,
          operationId: input.operationId,
          version: row.version + (changed ? 1 : 0),
          sequence,
          database: { ...target, revision },
          changed,
        });
        await tx
          .insert(projectDatabaseOperations)
          .values({ projectId, operationId: input.operationId, actorId, fingerprint, result });
        return { result, notify: changed };
      }),
    );
    if (result.notify)
      this.gateway?.publishDatabaseContext(
        projectId,
        result.result.sequence,
        result.result.database.revision,
      );
    return result.result;
  }
}
