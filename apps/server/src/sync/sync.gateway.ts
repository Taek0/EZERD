import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { WebSocket, WebSocketServer } from 'ws';
import { DatabaseService } from '../db/database.service.js';
import { projects } from '../db/schema.js';
import { SessionService, type AuthenticatedUser } from '../identity/session.js';
import { LanAccessService } from '../network/network-access.js';
import { WorkspaceAccessService } from '../workspace/workspace-access.service.js';
import { WorkspaceEventsService } from '../workspace/workspace-events.service.js';

type Client = {
  socket: WebSocket;
  actor: AuthenticatedUser;
  token: string;
  projects: Map<string, string>;
  authenticatedAt: number;
};
@Injectable()
export class SyncGateway implements OnApplicationShutdown {
  private readonly clients = new Set<Client>();
  private readonly webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  private headTimer?: NodeJS.Timeout;
  private server?: Server;
  private readonly stopAccessListener: () => void;
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(LanAccessService) private readonly network: LanAccessService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(WorkspaceEventsService) events: WorkspaceEventsService,
  ) {
    this.stopAccessListener = events.onAccessChanged(({ workspaceId, userId }) => {
      for (const client of [...this.clients])
        if (
          (!userId || client.actor.id === userId) &&
          [...client.projects.values()].includes(workspaceId)
        ) {
          this.send(client, { type: 'workspace-access-changed', workspaceId });
          this.close(client);
        }
    });
  }
  attach(server: Server): void {
    if (this.server) return;
    this.server = server;
    server.on('upgrade', this.upgrade);
    this.headTimer = setInterval(() => void this.sendHeads(), 15_000);
    this.headTimer.unref();
  }
  private readonly upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!this.network.isAllowed(request.socket.remoteAddress)) return socket.destroy();
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/sync') return socket.destroy();
    const token = url.searchParams.get('token') ?? '';
    void this.sessions
      .authenticateToken(token)
      .then((actor) =>
        this.webSocketServer.handleUpgrade(request, socket, head, (ws) =>
          this.connect(ws, actor, token),
        ),
      )
      .catch(() => socket.destroy());
  };
  private connect(socket: WebSocket, actor: AuthenticatedUser, token: string): void {
    const client: Client = {
      socket,
      actor,
      token,
      projects: new Map(),
      authenticatedAt: Date.now(),
    };
    this.clients.add(client);
    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as { type?: unknown; projectId?: unknown };
        if (message.type === 'subscribe' && typeof message.projectId === 'string')
          void this.subscribe(client, message.projectId).catch(() => this.close(client));
        else this.send(client, { type: 'error', message: '지원하지 않는 실시간 메시지입니다.' });
      } catch {
        this.send(client, { type: 'error', message: '실시간 메시지 형식을 확인해주세요.' });
      }
    });
    socket.on('close', () => this.clients.delete(client));
    socket.on('error', () => this.clients.delete(client));
  }
  private async subscribe(client: Client, projectId: string): Promise<void> {
    const access = await this.access.requireProject(client.actor.id, projectId, 'read');
    const [project] = await this.database.db
      .select({ status: projects.status, sequence: projects.syncSequence })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project || project.status !== 'active')
      return this.send(client, {
        type: 'error',
        projectId,
        message: '활성 프로젝트를 찾을 수 없습니다.',
      });
    if (!this.clients.has(client)) return;
    client.projects.set(projectId, access.workspaceId);
    // A membership change can have committed while the first check was in flight.
    await this.access.requireProject(client.actor.id, projectId, 'read');
    this.send(client, { type: 'subscribed', projectId, sequence: project.sequence });
  }
  publish(projectId: string, event: unknown): void {
    void this.deliver(projectId, { type: 'operation', projectId, event });
  }
  publishReview(projectId: string, event: unknown): void {
    void this.deliver(projectId, { type: 'review', projectId, event });
  }
  private async deliver(projectId: string, message: unknown): Promise<void> {
    for (const client of [...this.clients]) {
      if (!client.projects.has(projectId)) continue;
      try {
        await this.access.requireProject(client.actor.id, projectId, 'read');
        this.send(client, message);
      } catch {
        this.close(client);
      }
    }
  }
  private async sendHeads(): Promise<void> {
    try {
      const now = Date.now();
      for (const client of [...this.clients]) {
        if (now - client.authenticatedAt > 60_000) {
          try {
            client.actor = await this.sessions.authenticateToken(client.token);
            client.authenticatedAt = now;
          } catch {
            this.close(client);
            continue;
          }
        }
      }
      const ids = new Set([...this.clients].flatMap((client) => [...client.projects.keys()]));
      for (const projectId of ids) {
        const [project] = await this.database.db
          .select({ sequence: projects.syncSequence, status: projects.status })
          .from(projects)
          .where(eq(projects.id, projectId));
        if (!project || project.status !== 'active') {
          for (const client of this.clients) if (client.projects.has(projectId)) this.close(client);
          continue;
        }
        await this.deliver(projectId, { type: 'head', projectId, sequence: project.sequence });
      }
    } catch {
      /* The next interval retries; socket event handlers stay alive. */
    }
  }
  private send(client: Client, message: unknown): void {
    if (this.clients.has(client) && client.socket.readyState === WebSocket.OPEN)
      client.socket.send(JSON.stringify(message));
  }
  private close(client: Client): void {
    this.clients.delete(client);
    if (
      client.socket.readyState === WebSocket.OPEN ||
      client.socket.readyState === WebSocket.CONNECTING
    )
      client.socket.close(1008);
  }
  onApplicationShutdown(): void {
    this.stopAccessListener();
    if (this.headTimer) clearInterval(this.headTimer);
    if (this.server) this.server.off('upgrade', this.upgrade);
    for (const client of this.clients) this.close(client);
    this.webSocketServer.close();
  }
}
