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
  threadSchema,
  updateProjectSchema,
  updateThreadSchema,
} from '@ezerd/contracts';
import type { AuthenticatedUser } from '../session.js';
import { ReviewService } from '../review.service.js';
import { WorkspaceService } from '../workspace.service.js';
import { McpLogger } from './logging.js';

const idSchema = z.uuid();
const TIMEOUT_MS = 60_000;

@Injectable()
export class McpServerFactory {
  constructor(
    @Inject(WorkspaceService) private readonly workspace: WorkspaceService,
    @Inject(ReviewService) private readonly reviews: ReviewService,
    @Inject(McpLogger) private readonly logger: McpLogger,
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
        outputSchema: projectDocumentSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ projectId }) =>
        invoke('get_project', async () =>
          projectDocumentSchema.parse(await this.workspace.getProject(projectId)),
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
