import { HttpException, Inject, Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  createMessageSchema,
  createProjectSchema,
  createThreadSchema,
  deleteProjectSchema,
  deleteThreadSchema,
  projectDocumentSchema,
  projectQuerySchema,
  projectSchema,
  syncHistoryEntrySchema,
  syncOperationResultSchema,
  threadSchema,
  updateProjectSchema,
  updateThreadSchema,
} from '@ezerd/contracts';
import { diagnoseDocument } from '@ezerd/model';
import type { AuthenticatedUser } from '../session.js';
import { ReviewService } from '../review.service.js';
import { WorkspaceService } from '../workspace.service.js';
import { SyncService } from '../sync.service.js';
import { McpLogger } from './logging.js';
import { applyProjectChangesSchema, McpDocumentService } from './mcp-document.service.js';

const idSchema = z.uuid();
const TIMEOUT_MS = 60_000;
const sequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const projectStateSchema = projectDocumentSchema.extend({ syncSequence: sequenceSchema });
const commandRequestSchema = z.strictObject({
  operationId: idSchema,
  groupId: idSchema,
  clientId: idSchema,
});
const diagnosticSchema = z.strictObject({
  code: z.string(),
  objectId: z.string(),
  message: z.string(),
});

@Injectable()
export class McpServerFactory {
  constructor(
    @Inject(WorkspaceService) private readonly workspace: WorkspaceService,
    @Inject(ReviewService) private readonly reviews: ReviewService,
    @Inject(McpLogger) private readonly logger: McpLogger,
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(McpDocumentService) private readonly documents: McpDocumentService,
  ) {}

  create(user: AuthenticatedUser, tokenId: string, requestId: string): McpServer {
    const server = new McpServer(
      { name: 'ezerd', version: '0.1.0' },
      {
        capabilities: { tools: {} },
        instructions:
          'EZERD 프로젝트와 리뷰를 조회하고 변경합니다. 쓰기 도구에는 최신 동시성 기준을 사용하세요.',
      },
    );
    const invoke = <T>(tool: string, callback: () => Promise<T>) =>
      this.invoke(tool, user, tokenId, requestId, callback);
    const requireAccepted = <
      T extends { status: 'accepted' | 'rejected'; reason?: string | undefined },
    >(
      result: T,
    ) => {
      if (result.status === 'rejected')
        throw new HttpException(result.reason ?? '작업이 동시성 규칙에 따라 거부되었습니다.', 409);
      return result;
    };

    server.registerTool(
      'list_projects',
      {
        description: '상태와 이름 검색어로 EZERD 프로젝트를 조회합니다.',
        inputSchema: projectQuerySchema,
        outputSchema: z.strictObject({ projects: z.array(projectSchema) }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      (input) =>
        invoke('list_projects', async () => {
          const projects = z.array(projectSchema).parse(await this.workspace.listProjects(input));
          return { projects };
        }),
    );
    server.registerTool(
      'get_project',
      {
        description: '프로젝트 메타데이터와 현재 설계 문서를 조회합니다.',
        inputSchema: z.strictObject({ projectId: idSchema }),
        outputSchema: projectStateSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId }) =>
        invoke('get_project', async () =>
          projectStateSchema.parse(await this.workspace.getProjectState(projectId)),
        ),
    );
    server.registerTool(
      'list_review_threads',
      {
        description: '프로젝트의 리뷰 핀과 모든 답글을 조회합니다.',
        inputSchema: z.strictObject({ projectId: idSchema }),
        outputSchema: z.strictObject({ threads: z.array(threadSchema) }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId }) =>
        invoke('list_review_threads', async () => ({
          threads: z.array(threadSchema).parse(await this.reviews.list(projectId)),
        })),
    );
    server.registerTool(
      'create_project',
      {
        description: '새 EZERD 프로젝트를 생성합니다.',
        inputSchema: createProjectSchema,
        outputSchema: projectSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      (input) =>
        invoke('create_project', async () =>
          projectSchema.parse(await this.workspace.createProject(input)),
        ),
    );
    server.registerTool(
      'update_project',
      {
        description: '최신 expectedVersion을 기준으로 프로젝트 이름 또는 보관 상태를 변경합니다.',
        inputSchema: z.strictObject({ projectId: idSchema, update: updateProjectSchema }),
        outputSchema: projectSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId, update }) =>
        invoke('update_project', async () =>
          projectSchema.parse(await this.workspace.updateProject(projectId, update)),
        ),
    );
    server.registerTool(
      'delete_project',
      {
        description: '보관된 프로젝트의 최신 버전을 영구 삭제합니다.',
        inputSchema: z.strictObject({ projectId: idSchema, delete: deleteProjectSchema }),
        outputSchema: z.strictObject({ id: idSchema, deleted: z.literal(true) }),
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      ({ projectId, delete: input }) =>
        invoke('delete_project', () => this.workspace.deleteProject(projectId, input)),
    );
    server.registerTool(
      'create_review_thread',
      {
        description: '프로젝트 화면에 리뷰 핀과 첫 메시지를 생성합니다.',
        inputSchema: z.strictObject({ projectId: idSchema, thread: createThreadSchema }),
        outputSchema: threadSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId, thread }) =>
        invoke('create_review_thread', async () =>
          threadSchema.parse(await this.reviews.create(projectId, thread, user)),
        ),
    );
    server.registerTool(
      'reply_review_thread',
      {
        description: '기존 리뷰 핀에 인증된 사용자 명의로 답글을 추가합니다.',
        inputSchema: z.strictObject({ threadId: idSchema, message: createMessageSchema }),
        outputSchema: threadSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ threadId, message }) =>
        invoke('reply_review_thread', async () =>
          threadSchema.parse(await this.reviews.reply(threadId, message, user)),
        ),
    );
    server.registerTool(
      'update_review_thread',
      {
        description: '리뷰 핀의 해결 상태를 변경합니다.',
        inputSchema: z.strictObject({ threadId: idSchema, update: updateThreadSchema }),
        outputSchema: threadSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ threadId, update }) =>
        invoke('update_review_thread', async () =>
          threadSchema.parse(await this.reviews.update(threadId, update, user)),
        ),
    );
    server.registerTool(
      'delete_review_thread',
      {
        description: '최신 expectedUpdatedAt을 기준으로 리뷰 핀과 답글을 삭제합니다.',
        inputSchema: z.strictObject({ threadId: idSchema, delete: deleteThreadSchema }),
        outputSchema: z.strictObject({ id: idSchema, deleted: z.literal(true) }),
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      ({ threadId, delete: input }) =>
        invoke('delete_review_thread', () => this.reviews.remove(threadId, input, user)),
    );
    server.registerTool(
      'diagnose_project',
      {
        description: '현재 설계 문서의 구조적 문제를 진단합니다.',
        inputSchema: z.strictObject({ projectId: idSchema }),
        outputSchema: z.strictObject({ diagnostics: z.array(diagnosticSchema) }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId }) =>
        invoke('diagnose_project', async () => {
          const { document } = await this.workspace.getProject(projectId);
          return { diagnostics: z.array(diagnosticSchema).parse(diagnoseDocument(document)) };
        }),
    );
    server.registerTool(
      'apply_project_changes',
      {
        description:
          '명시적인 도메인·테이블·컬럼·키·관계·노트 변경을 최신 기준에 원자적으로 적용합니다.',
        inputSchema: applyProjectChangesSchema,
        outputSchema: syncOperationResultSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      (input) =>
        invoke('apply_project_changes', async () =>
          syncOperationResultSchema.parse(await this.documents.apply(input, user)),
        ),
    );
    server.registerTool(
      'get_project_history',
      {
        description: '지정한 동기화 순서 이후의 프로젝트 변경 이력을 조회합니다.',
        inputSchema: z.strictObject({ projectId: idSchema, since: sequenceSchema.default(0) }),
        outputSchema: z.strictObject({ history: z.array(syncHistoryEntrySchema) }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId, since }) =>
        invoke('get_project_history', async () => ({
          history: z.array(syncHistoryEntrySchema).parse(await this.sync.history(projectId, since)),
        })),
    );
    server.registerTool(
      'undo_project_operation',
      {
        description: '인증된 사용자가 승인받은 기존 작업을 현재 충돌 규칙에 따라 실행 취소합니다.',
        inputSchema: z.strictObject({
          projectId: idSchema,
          sourceOperationId: idSchema,
          request: commandRequestSchema,
        }),
        outputSchema: syncOperationResultSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      ({ projectId, sourceOperationId, request }) =>
        invoke('undo_project_operation', async () =>
          requireAccepted(
            syncOperationResultSchema.parse(
              await this.sync.undo(projectId, sourceOperationId, request, user),
            ),
          ),
        ),
    );
    server.registerTool(
      'restore_project_deletion',
      {
        description: '삭제 작업의 보존 스냅샷을 새 객체 ID로 복원합니다.',
        inputSchema: z.strictObject({
          projectId: idSchema,
          deletedOperationId: idSchema,
          request: commandRequestSchema,
        }),
        outputSchema: z.strictObject({
          result: syncOperationResultSchema,
          omittedRelations: z.array(z.string()),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId, deletedOperationId, request }) =>
        invoke('restore_project_deletion', async () => {
          const outcome = await this.sync.restore(projectId, deletedOperationId, request, user);
          return {
            result: requireAccepted(syncOperationResultSchema.parse(outcome.result)),
            omittedRelations: z.array(z.string()).parse(outcome.omittedRelations),
          };
        }),
    );
    return server;
  }

  private async invoke<T>(
    tool: string,
    user: AuthenticatedUser,
    tokenId: string,
    requestId: string,
    callback: () => Promise<T>,
  ) {
    const started = Date.now();
    try {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new HttpException(
                '도구 처리 시간이 초과되어 결과가 불명확합니다. 쓰기 작업은 이력에서 확인하세요.',
                504,
              ),
            ),
          TIMEOUT_MS,
        );
        timer.unref();
      });
      const value = await Promise.race([callback(), timeout]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      const structuredContent = value as Record<string, unknown>;
      const count = Array.isArray(value)
        ? value.length
        : value && typeof value === 'object'
          ? Object.values(value).find(Array.isArray)?.length
          : undefined;
      await this.logger.write({
        level: 'info',
        event: 'tool-finished',
        requestId,
        userId: user.id,
        tokenId,
        tool,
        durationMs: Date.now() - started,
        status: 'success',
        ...(count !== undefined ? { resultCount: count } : {}),
      });
      return { content: [{ type: 'text' as const, text: `${tool} 완료` }], structuredContent };
    } catch (error) {
      const expected = error instanceof HttpException;
      const errorCode = expected ? `HTTP_${error.getStatus()}` : 'INTERNAL';
      await this.logger.write({
        level: expected ? 'warn' : 'error',
        event: 'tool-finished',
        requestId,
        userId: user.id,
        tokenId,
        tool,
        durationMs: Date.now() - started,
        status: 'error',
        errorCode,
      });
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: expected ? error.message : `도구 실행에 실패했습니다. 요청 ID: ${requestId}`,
          },
        ],
        structuredContent: { error: { code: errorCode, requestId } },
      };
    }
  }
}
