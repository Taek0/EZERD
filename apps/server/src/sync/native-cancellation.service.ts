import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  nativeCancellationInputSchema,
  nativeCancellationResultSchema,
  NATIVE_CANCELLATION_REASON,
  nativeSyncOperationResultSchema,
  type NativeCancellationInput,
  type NativeCancellationResult,
} from '@ezerd/contracts';
import { requestFingerprint, resolveProjectDatabaseState } from '@ezerd/model';
import { DatabaseService } from '../db/database.service.js';
import { projects, syncOperations, nativeRequestCancellations } from '../db/schema.js';
import type { AuthenticatedUser } from '../identity/session.js';
import { WorkspaceAccessService } from '../workspace/workspace-access.service.js';
import { readNativeCancellation } from './native-cancellation-record.js';

function fingerprint(projectId: string, input: NativeCancellationInput) {
  let original: unknown = input.request;
  if (input.kind === 'native-command') {
    if (Object.hasOwn(input.request, 'projectId') && input.request.projectId !== projectId)
      throw new BadRequestException({ code: 'native.cancellation-input-invalid' });
    const { includeDocument: _includeDocument, ...semantic } = input.request;
    original = { command: 'apply_native_project_changes', ...semantic, projectId };
  } else if (input.kind === 'native-upgrade') {
    original = { command: 'upgrade_project_document', projectId, input: input.request };
  } else if (input.kind === 'history-undo' || input.kind === 'history-restore') {
    original = {
      command: `native-history.${input.kind === 'history-undo' ? 'undo' : 'restore'}`,
      projectId,
      sourceOperationId: input.sourceOperationId,
      input: input.request,
    };
  }
  return createHash('sha256').update(requestFingerprint(original)).digest('hex');
}

@Injectable()
export class NativeCancellationService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
  ) {}

  async cancel(
    projectId: string,
    raw: unknown,
    user: AuthenticatedUser,
  ): Promise<NativeCancellationResult> {
    const parsed = nativeCancellationInputSchema.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException({
        code: 'native.cancellation-input-invalid',
        issues: parsed.error.issues,
      });
    const input = parsed.data,
      hash = fingerprint(projectId, input);
    return this.database.db.transaction(async (tx) => {
      await this.access.requireProject(user.id, projectId, 'read', tx);
      const replay = async (): Promise<NativeCancellationResult | undefined> => {
        // Immutable ledger wins even when a marker also exists.
        const [row] = await tx
          .select()
          .from(syncOperations)
          .where(
            and(
              eq(syncOperations.projectId, projectId),
              eq(syncOperations.operationId, input.request.operationId),
            ),
          );
        if (row) {
          if (row.actorId !== user.id)
            throw new ForbiddenException({ code: 'native.cancellation-actor-mismatch' });
          if (row.fingerprint !== hash)
            throw new ConflictException({ code: 'sync.replay-mismatch' });
          const checked = nativeCancellationResultSchema.safeParse({
            outcome: 'recorded',
            result: row.result,
          });
          if (!checked.success) throw new ConflictException({ code: 'sync.protocol-mismatch' });
          return structuredClone(checked.data);
        }
        const marker = await readNativeCancellation(
          tx,
          projectId,
          input.request.operationId,
          {
            actorId: user.id,
            fingerprint: hash,
            actorMismatchCode: 'native.cancellation-actor-mismatch',
          },
          [input.kind],
        );
        return marker ? { outcome: 'cancelled', result: marker.result } : undefined;
      };
      const old = await replay();
      if (old) return old;
      const [project] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .for('update');
      if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      await this.access.requireProject(user.id, projectId, 'read', tx);
      const locked = await replay();
      if (locked) return locked;
      // Only current server metadata is used. Neither v1/v2 source nor client claims authorize writes.
      const database = resolveProjectDatabaseState(project),
        now = new Date();
      const groupId =
        input.kind === 'native-upgrade' ? input.request.operationId : input.request.groupId;
      const result = nativeSyncOperationResultSchema.parse({
        protocolVersion: 2,
        operationId: input.request.operationId,
        groupId,
        sequence: project.syncSequence,
        status: 'rejected',
        reason: NATIVE_CANCELLATION_REASON,
        reasonCode: NATIVE_CANCELLATION_REASON,
        database: { kind: database.kind, profileId: database.profileId },
        databaseRevision: database.revision,
        actor: { id: user.id, username: user.username, color: user.color },
        changedPaths: [],
        createdAt: now.toISOString(),
        nextBaseline: {
          baselineId: randomUUID(),
          baseSequence: project.syncSequence,
          baselineIssuedAt: now.toISOString(),
          databaseRevision: database.revision,
        },
      });
      const metadata: Record<string, unknown> = {};
      const sourceOperationId =
        input.kind === 'history-undo' || input.kind === 'history-restore'
          ? input.sourceOperationId
          : null;
      if (sourceOperationId)
        metadata.nativeHistory = {
          command: input.kind === 'history-undo' ? 'undo' : 'restore',
          sourceOperationId,
          identityMap: [],
        };
      const inserted = await tx
        .insert(nativeRequestCancellations)
        .values({
          projectId,
          operationId: input.request.operationId,
          actorId: user.id,
          fingerprint: hash,
          kind: input.kind,
          clientId: input.request.clientId,
          groupId,
          sourceOperationId,
          metadata,
          result: result as unknown as Record<string, unknown>,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning({ operationId: nativeRequestCancellations.operationId });
      // A globally unique operation ID already fenced in another project cannot be reused here.
      if (!inserted.length) throw new ConflictException({ code: 'sync.replay-mismatch' });
      return nativeCancellationResultSchema.parse({ outcome: 'cancelled', result });
    });
  }
}
