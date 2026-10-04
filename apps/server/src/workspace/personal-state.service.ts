import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  designDocumentSchema,
  personalStateSchema,
  personalStateSnapshotSchema,
  nativeStoredDesignDocumentSchema,
  type PersonalState,
} from '@ezerd/contracts';
import {
  diffSharedDocument,
  extractPersonalState,
  mergeStoredPersonalState,
  reconcilePersonalState,
  TABLES_VIEW_ID,
  type DesignDocument,
  type NativeDesignDocument,
  type PersonalCanvasDocument,
  resolveProjectDatabaseState,
  validateDatabaseDocument,
} from '@ezerd/model';
import { DatabaseService } from '../db/database.service.js';
import { normalizeCurrentServerDocument } from '../shared/native-document-reader.js';
import { projectPersonalOperations, projectPersonalStates, projects } from '../db/schema.js';
import type { AuthenticatedUser } from '../identity/session.js';
import { WorkspaceAccessService } from './workspace-access.service.js';

function defaultState(document: PersonalCanvasDocument): PersonalState {
  const extracted = extractPersonalState(document);
  return {
    ...extracted,
    viewports: extracted.viewports.length
      ? extracted.viewports
      : [{ viewId: document.domains.length ? 'overview' : TABLES_VIEW_ID, x: 0, y: 0, zoom: 1 }],
  };
}

@Injectable()
export class PersonalStateService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
  ) {}

  async get(projectId: string, user: AuthenticatedUser) {
    return this.access.runProject(user.id, projectId, 'read', async (tx) => {
      const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
      if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      const document = normalizeCurrentServerDocument(
        project.document,
        resolveProjectDatabaseState({
          ...project,
          databaseKind: project.databaseKind ?? 'postgresql',
        }),
      );
      const [row] = await tx
        .select()
        .from(projectPersonalStates)
        .where(
          and(
            eq(projectPersonalStates.projectId, projectId),
            eq(projectPersonalStates.userId, user.id),
          ),
        );
      return personalStateSnapshotSchema.parse({
        ...(document.schemaVersion === 2 && {
          databaseRevision: resolveProjectDatabaseState({
            ...project,
            databaseKind: project.databaseKind ?? 'postgresql',
          }).revision,
        }),
        version: row?.version ?? 0,
        projectVersion: project.version,
        syncSequence: project.syncSequence,
        state: reconcilePersonalState(document, row?.state ?? defaultState(document)),
      });
    });
  }

  save(
    projectId: string,
    user: AuthenticatedUser,
    expectedVersion: number,
    state: PersonalState,
    context?: {
      expectedDatabaseRevision?: number | undefined;
      expectedProjectVersion?: number | undefined;
      expectedSyncSequence?: number | undefined;
    },
  ) {
    const parsed = personalStateSchema.parse(state);
    return this.mutate(projectId, user, expectedVersion, () => parsed, undefined, context);
  }

  async mutate(
    projectId: string,
    user: AuthenticatedUser,
    expectedVersion: number,
    change: (
      document: DesignDocument | NativeDesignDocument,
    ) => DesignDocument | NativeDesignDocument | PersonalState,
    operation?: { id: string; fingerprint: string },
    context?: {
      expectedDatabaseRevision?: number | undefined;
      expectedProjectVersion?: number | undefined;
      expectedSyncSequence?: number | undefined;
    },
  ) {
    return this.database.db.transaction(async (tx) => {
      await this.access.requireProject(user.id, projectId, 'read', tx);
      if (operation) {
        const [replay] = await tx
          .select()
          .from(projectPersonalOperations)
          .where(eq(projectPersonalOperations.operationId, operation.id));
        if (replay) {
          if (
            replay.projectId !== projectId ||
            replay.userId !== user.id ||
            replay.fingerprint !== operation.fingerprint
          )
            throw new ConflictException('같은 작업 ID에 다른 요청을 사용할 수 없습니다.');
          return personalStateSnapshotSchema.parse(replay.result);
        }
      }
      const [project] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .for('update');
      if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      if (operation) {
        const [lockedReplay] = await tx
          .select()
          .from(projectPersonalOperations)
          .where(eq(projectPersonalOperations.operationId, operation.id));
        if (lockedReplay) {
          if (
            lockedReplay.projectId !== projectId ||
            lockedReplay.userId !== user.id ||
            lockedReplay.fingerprint !== operation.fingerprint
          )
            throw new ConflictException('같은 작업 ID에 다른 요청을 사용할 수 없습니다.');
          return personalStateSnapshotSchema.parse(lockedReplay.result);
        }
      }
      await this.access.requireProject(user.id, projectId, 'personal', tx);
      if (project.status !== 'active')
        throw new ConflictException('보관된 프로젝트는 편집할 수 없습니다.');
      const [row] = await tx
        .select()
        .from(projectPersonalStates)
        .where(
          and(
            eq(projectPersonalStates.projectId, projectId),
            eq(projectPersonalStates.userId, user.id),
          ),
        )
        .for('update');
      const version = row?.version ?? 0;
      if (version !== expectedVersion)
        throw new ConflictException('개인 화면이 변경되었습니다. 최신 상태를 다시 조회해주세요.');
      const document = normalizeCurrentServerDocument(
        project.document,
        resolveProjectDatabaseState({
          ...project,
          databaseKind: project.databaseKind ?? 'postgresql',
        }),
      );
      const database = resolveProjectDatabaseState({
        ...project,
        databaseKind: project.databaseKind ?? 'postgresql',
      });
      if (
        document.schemaVersion === 2 &&
        (context?.expectedDatabaseRevision === undefined ||
          context.expectedProjectVersion === undefined ||
          context.expectedSyncSequence === undefined)
      )
        throw new ConflictException({ code: 'personal-state.native-context-required' });
      if (
        context &&
        (context.expectedDatabaseRevision !== undefined ||
          context.expectedProjectVersion !== undefined ||
          context.expectedSyncSequence !== undefined) &&
        (context.expectedDatabaseRevision !== database.revision ||
          context.expectedProjectVersion !== project.version ||
          context.expectedSyncSequence !== project.syncSequence)
      )
        throw new ConflictException({ code: 'personal-state.context-changed' });
      const current = reconcilePersonalState(document, row?.state ?? defaultState(document));
      const merged = mergeStoredPersonalState(document, current);
      const changed = change(structuredClone(merged));
      const nextState = personalStateSchema.safeParse(
        'schemaVersion' in changed ? extractPersonalState(changed) : changed,
      );
      if (!nextState.success)
        throw new BadRequestException('개인 화면 데이터가 올바르지 않습니다.');
      const reconciled = reconcilePersonalState(document, nextState.data);
      if (JSON.stringify(reconciled) !== JSON.stringify(nextState.data))
        throw new BadRequestException('개인 화면의 도메인·테이블 참조가 올바르지 않습니다.');
      if (JSON.stringify(current) === JSON.stringify(nextState.data))
        throw new BadRequestException('실제 개인 화면 변경이 없습니다.');
      const candidate = mergeStoredPersonalState(document, nextState.data);
      if (diffSharedDocument(document, candidate).length)
        throw new BadRequestException('개인 화면 요청에서 공유 문서를 변경할 수 없습니다.');
      const valid =
        candidate.schemaVersion === 1
          ? designDocumentSchema.safeParse(candidate)
          : nativeStoredDesignDocumentSchema.safeParse(candidate);
      if (!valid.success)
        throw new BadRequestException('개인 화면의 문서 구조나 크기가 올바르지 않습니다.');
      if (
        candidate.schemaVersion === 2 &&
        document.schemaVersion === 2 &&
        validateDatabaseDocument(candidate, candidate.database, {
          mode: 'write',
          previous: document,
        }).some((issue) => issue.severity === 'error')
      )
        throw new BadRequestException('개인 화면의 객체 참조가 올바르지 않습니다.');
      const result = personalStateSnapshotSchema.parse({
        ...(document.schemaVersion === 2 && { databaseRevision: database.revision }),
        version: version + 1,
        projectVersion: project.version,
        syncSequence: project.syncSequence,
        state: nextState.data,
      });
      if (row)
        await tx
          .update(projectPersonalStates)
          .set({ version: result.version, state: result.state, updatedAt: new Date() })
          .where(
            and(
              eq(projectPersonalStates.projectId, projectId),
              eq(projectPersonalStates.userId, user.id),
            ),
          );
      else
        await tx.insert(projectPersonalStates).values({
          projectId,
          userId: user.id,
          version: result.version,
          state: result.state,
        });
      if (operation)
        await tx.insert(projectPersonalOperations).values({
          operationId: operation.id,
          projectId,
          userId: user.id,
          fingerprint: operation.fingerprint,
          result,
        });
      return result;
    });
  }
}
