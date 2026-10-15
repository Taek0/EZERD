import type { IncomingMessage, Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { WebSocket, WebSocketServer } from 'ws';
import { DatabaseService } from '../db/database.service.js';
import { projects, userWorkspaces } from '../db/schema.js';
import { SessionService, type AuthenticatedUser } from '../identity/session.js';
import { LanAccessService } from '../network/network-access.js';
import { WorkspaceAccessService } from '../workspace/workspace-access.service.js';
import { WorkspaceEventsService, type UserChange } from '../workspace/workspace-events.service.js';

/** Opt-in invalidation clients need ordering metadata, not a second full document/changes copy. */
export function nativeNotification(message: unknown): unknown {
  if (!message || typeof message !== 'object') return message;
  const envelope = message as { type?: unknown; projectId?: unknown; event?: unknown };
  if (envelope.type !== 'operation' || !envelope.event || typeof envelope.event !== 'object')
    return message;
  const event = envelope.event as Record<string, unknown>;
  if (event.protocolVersion !== 2) return message;
  return {
    type: envelope.type,
    projectId: envelope.projectId,
    event: {
      protocolVersion: 2,
      operationId: event.operationId,
      sequence: event.sequence,
      databaseRevision: event.databaseRevision,
      status: event.status,
    },
  };
}

type Client = {
  socket: WebSocket;
  actor: AuthenticatedUser;
  token: string;
  projects: Map<string, string>;
  notificationsOnly: Set<string>;
  authenticatedAt: number;
  subscriptionEpoch: Map<string, number>;
  nextSubscriptionEpoch: number;
};
@Injectable()
export class SyncGateway implements OnApplicationShutdown {
  private readonly clients = new Set<Client>();
  private readonly userClients = new Map<string, Set<Client>>();
  private readonly projectClients = new Map<string, Set<Client>>();
  private readonly pendingUserChanges = new Map<string, UserChange>();
  private userChangeTimer: NodeJS.Timeout | undefined;
  private flushingUserChanges = false;
  private readonly stopUserListener: () => void;
  private readonly webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  private headTimer?: NodeJS.Timeout;
  private server?: Server;
  private readonly stopAccessListener: () => void;
  private readonly stopSessionListener: () => void;
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(LanAccessService) private readonly network: LanAccessService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(WorkspaceEventsService) events: WorkspaceEventsService,
  ) {
    this.stopUserListener = events.onUserChanged((event) => {
      const key = JSON.stringify([
        event.resource,
        event.workspaceId,
        event.userIds?.slice().sort(),
      ]);
      if (this.pendingUserChanges.size >= 1024 && !this.pendingUserChanges.has(key)) {
        // Reconnecting clients reload their initial lists; never grow an unbounded event queue.
        for (const clients of this.userClients.values())
          for (const client of [...clients]) this.close(client);
        this.pendingUserChanges.clear();
        return;
      }
      this.pendingUserChanges.set(key, event);
      this.scheduleUserChanges();
    });
    this.stopSessionListener = sessions.onSessionRevoked((tokenHash) => {
      for (const client of [...this.clients])
        if (createHash('sha256').update(client.token).digest('hex') === tokenHash)
          this.close(client);
    });
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
      notificationsOnly: new Set(),
      authenticatedAt: Date.now(),
      subscriptionEpoch: new Map(),
      nextSubscriptionEpoch: 0,
    };
    this.clients.add(client);
    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as {
          type?: unknown;
          projectId?: unknown;
          notificationsOnly?: unknown;
        };
        if (message.type === 'subscribe' && typeof message.projectId === 'string')
          void this.subscribe(client, message.projectId, message.notificationsOnly === true).catch(
            () => this.close(client),
          );
        else if (message.type === 'subscribe-user') {
          const clients = this.userClients.get(actor.id) ?? new Set<Client>();
          clients.add(client);
          this.userClients.set(actor.id, clients);
          this.send(client, { type: 'user-subscribed' });
        } else if (message.type === 'unsubscribe' && typeof message.projectId === 'string') {
          this.unsubscribe(client, message.projectId);
          this.send(client, { type: 'unsubscribed', projectId: message.projectId });
        } else this.send(client, { type: 'error', message: '지원하지 않는 실시간 메시지입니다.' });
      } catch {
        this.send(client, { type: 'error', message: '실시간 메시지 형식을 확인해주세요.' });
      }
    });
    socket.on('close', () => this.remove(client));
    socket.on('error', () => this.remove(client));
  }
  private async subscribe(
    client: Client,
    projectId: string,
    notificationsOnly = false,
  ): Promise<void> {
    if (client.subscriptionEpoch.size >= 256 && !client.subscriptionEpoch.has(projectId)) {
      this.close(client);
      return;
    }
    const epoch = ++client.nextSubscriptionEpoch;
    client.subscriptionEpoch.set(projectId, epoch);
    const access = await this.access.requireProject(client.actor.id, projectId, 'read');
    const [project] = await this.database.db
      .select({
        status: projects.status,
        sequence: projects.syncSequence,
        databaseRevision: projects.databaseRevision,
      })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project || project.status !== 'active')
      return this.send(client, {
        type: 'error',
        projectId,
        message: '활성 프로젝트를 찾을 수 없습니다.',
      });
    if (!this.clients.has(client) || client.subscriptionEpoch.get(projectId) !== epoch) return;
    client.projects.set(projectId, access.workspaceId);
    const subscribers = this.projectClients.get(projectId) ?? new Set<Client>();
    subscribers.add(client);
    this.projectClients.set(projectId, subscribers);
    if (notificationsOnly) client.notificationsOnly.add(projectId);
    else client.notificationsOnly.delete(projectId);
    // A membership change can have committed while the first check was in flight.
    await this.access.requireProject(client.actor.id, projectId, 'read');
    if (!this.clients.has(client) || client.subscriptionEpoch.get(projectId) !== epoch) return;
    this.send(client, {
      type: 'subscribed',
      projectId,
      sequence: project.sequence,
      databaseRevision: project.databaseRevision ?? 0,
    });
  }
  publish(projectId: string, event: unknown): void {
    void this.deliver(projectId, { type: 'operation', projectId, event });
  }
  publishReview(projectId: string, event: unknown): void {
    void this.deliver(projectId, { type: 'review', projectId, event });
  }
  publishDatabaseContext(projectId: string, sequence: number, databaseRevision: number): void {
    void this.deliver(projectId, { type: 'head', projectId, sequence, databaseRevision });
  }
  private async deliver(projectId: string, message: unknown): Promise<void> {
    for (const client of [...(this.projectClients.get(projectId) ?? [])]) {
      if (!client.projects.has(projectId)) continue;
      try {
        await this.access.requireProject(client.actor.id, projectId, 'read');
        if (!client.projects.has(projectId)) continue;
        this.send(
          client,
          client.notificationsOnly.has(projectId) ? nativeNotification(message) : message,
        );
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
      for (const clients of this.userClients.values())
        for (const client of clients) this.send(client, { type: 'heartbeat' });
      const ids = [...this.projectClients.keys()];
      for (const projectId of ids) {
        const [project] = await this.database.db
          .select({
            sequence: projects.syncSequence,
            status: projects.status,
            databaseRevision: projects.databaseRevision,
          })
          .from(projects)
          .where(eq(projects.id, projectId));
        if (!project || project.status !== 'active') {
          for (const client of this.clients) if (client.projects.has(projectId)) this.close(client);
          continue;
        }
        await this.deliver(projectId, {
          type: 'head',
          projectId,
          sequence: project.sequence,
          databaseRevision: project.databaseRevision ?? 0,
        });
      }
    } catch {
      /* The next interval retries; socket event handlers stay alive. */
    }
  }
  private scheduleUserChanges(): void {
    if (this.userChangeTimer || this.flushingUserChanges || !this.pendingUserChanges.size) return;
    this.userChangeTimer = setTimeout(() => {
      this.userChangeTimer = undefined;
      void this.flushUserChanges();
    }, 25);
    this.userChangeTimer.unref();
  }
  private async flushUserChanges(): Promise<void> {
    this.flushingUserChanges = true;
    const events = [...this.pendingUserChanges.values()];
    this.pendingUserChanges.clear();
    try {
      for (const event of events) {
        const userIds =
          event.userIds ??
          (event.workspaceId
            ? (
                await this.database.db
                  .select({ userId: userWorkspaces.userId })
                  .from(userWorkspaces)
                  .where(eq(userWorkspaces.workspaceId, event.workspaceId))
              ).map((row) => row.userId)
            : []);
        for (const userId of new Set(userIds))
          for (const client of [...(this.userClients.get(userId) ?? [])]) {
            this.send(client, {
              type: 'user-change',
              resource: event.resource,
              ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
            });
          }
      }
    } catch {
      // Force a fresh snapshot after a failed audience lookup.
      for (const clients of this.userClients.values())
        for (const client of [...clients]) this.close(client);
    } finally {
      this.flushingUserChanges = false;
      this.scheduleUserChanges();
    }
  }
  private unsubscribe(client: Client, projectId: string): void {
    client.subscriptionEpoch.delete(projectId);
    client.projects.delete(projectId);
    client.notificationsOnly.delete(projectId);
    const clients = this.projectClients.get(projectId);
    clients?.delete(client);
    if (!clients?.size) this.projectClients.delete(projectId);
  }
  private remove(client: Client): void {
    this.clients.delete(client);
    for (const projectId of client.projects.keys()) this.unsubscribe(client, projectId);
    const clients = this.userClients.get(client.actor.id);
    clients?.delete(client);
    if (!clients?.size) this.userClients.delete(client.actor.id);
  }
  private send(client: Client, message: unknown): void {
    if (client.socket.bufferedAmount > 1024 * 1024) {
      this.close(client);
      return;
    }
    if (this.clients.has(client) && client.socket.readyState === WebSocket.OPEN)
      client.socket.send(JSON.stringify(message));
  }
  private close(client: Client): void {
    this.remove(client);
    if (
      client.socket.readyState === WebSocket.OPEN ||
      client.socket.readyState === WebSocket.CONNECTING
    )
      client.socket.close(1008);
  }
  onApplicationShutdown(): void {
    this.stopSessionListener();
    this.stopUserListener();
    if (this.userChangeTimer) clearTimeout(this.userChangeTimer);
    this.pendingUserChanges.clear();
    this.stopAccessListener();
    if (this.headTimer) clearInterval(this.headTimer);
    if (this.server) this.server.off('upgrade', this.upgrade);
    for (const client of this.clients) this.close(client);
    this.webSocketServer.close();
  }
}
