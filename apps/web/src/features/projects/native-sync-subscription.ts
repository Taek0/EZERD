export interface NativeSyncHead {
  sequence: number;
  databaseRevision: number;
}

export interface NativeSyncSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface NativeSyncEnvironment {
  createSocket(url: string): NativeSyncSocket;
  now(): number;
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
  listen(callback: () => void): () => void;
}

export interface NativeSyncSubscriptionOptions {
  projectId: string;
  workspaceId?: string;
  token: string;
  /** Origin or app base directory, including a reverse proxy path if applicable. */
  baseUrl?: string;
  getCurrentHead(): NativeSyncHead;
  refresh(): Promise<void>;
  accessChanged(): void;
  isOwnOperation(operationId: string): boolean;
  environment?: NativeSyncEnvironment;
}

export function nativeSyncSocketUrl(baseUrl: string, token: string): string {
  const base = new URL(baseUrl);
  base.pathname = `${base.pathname.replace(/\/$/, '')}/api/sync`;
  base.protocol = base.protocol === 'https:' || base.protocol === 'wss:' ? 'wss:' : 'ws:';
  base.search = '';
  base.hash = '';
  base.searchParams.set('token', token);
  return base.href;
}

const browserEnvironment = (): NativeSyncEnvironment => ({
  createSocket: (url) => {
    const socket = new WebSocket(url);
    const adapter: NativeSyncSocket = {
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: (data) => socket.send(data),
      close: () => socket.close(),
    };
    socket.addEventListener('open', () => adapter.onopen?.());
    socket.addEventListener('message', (event) => adapter.onmessage?.({ data: event.data }));
    socket.addEventListener('close', (event) => adapter.onclose?.({ code: event.code }));
    socket.addEventListener('error', () => adapter.onerror?.());
    return adapter;
  },
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer),
  listen: (callback) => {
    window.addEventListener('online', callback);
    window.addEventListener('focus', callback);
    return () => {
      window.removeEventListener('online', callback);
      window.removeEventListener('focus', callback);
    };
  },
});

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const counter = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const operationId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Native notifications invalidate HTTP snapshots; they never apply document payloads. */
export function startNativeSyncSubscription(options: NativeSyncSubscriptionOptions): () => void {
  const env = options.environment ?? browserEnvironment();
  const url = nativeSyncSocketUrl(options.baseUrl ?? window.location.origin, options.token);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const seen = new Set<string>();
  let stopped = false;
  let socket: NativeSyncSocket | undefined;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshing = false;
  let requested = false;
  let fallbackRequested = false;
  let foreignPending = false;
  let ownUntil = 0;
  let target = options.getCurrentHead();
  let lastMessage = env.now();

  const later = (callback: () => void, delay: number) => {
    const timer = env.setTimeout(() => {
      timers.delete(timer);
      if (!stopped) callback();
    }, delay);
    timers.add(timer);
    return timer;
  };
  const cancel = (timer: ReturnType<typeof setTimeout> | undefined) => {
    if (timer === undefined) return;
    env.clearTimeout(timer);
    timers.delete(timer);
  };
  const ahead = (head: NativeSyncHead) => {
    const current = options.getCurrentHead();
    return head.sequence > current.sequence || head.databaseRevision > current.databaseRevision;
  };
  const scheduleRefresh = (fallback = false) => {
    requested = true;
    fallbackRequested ||= fallback;
    if (refreshTimer !== undefined || refreshing || stopped) return;
    refreshTimer = later(() => {
      refreshTimer = undefined;
      if (!foreignPending && ownUntil > env.now()) {
        refreshTimer = later(() => {
          refreshTimer = undefined;
          scheduleRefresh();
        }, ownUntil - env.now());
        return;
      }
      const needed = ahead(target) || fallbackRequested;
      requested = false;
      fallbackRequested = false;
      foreignPending = false;
      if (!needed) return;
      refreshing = true;
      void Promise.resolve()
        .then(() => {
          if (!stopped) return options.refresh();
        })
        .catch(() => {
          // HTTP refresh owns error reporting; periodic checks retry transport failures.
        })
        .finally(() => {
          refreshing = false;
          if (!stopped && requested) scheduleRefresh();
        });
    }, 50);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const timer of timers) env.clearTimeout(timer);
    timers.clear();
    unlisten();
    const old = socket;
    socket = undefined;
    old?.close();
  };
  const authorityChanged = () => {
    stop();
    options.accessChanged();
  };
  const reconnect = () => {
    if (stopped || reconnectTimer !== undefined) return;
    reconnectTimer = later(
      () => {
        reconnectTimer = undefined;
        connect();
      },
      Math.min(1000 * 2 ** Math.min(reconnectAttempt++, 5), 30_000),
    );
  };
  const connect = () => {
    if (stopped || socket) return;
    let next: NativeSyncSocket;
    try {
      next = env.createSocket(url);
    } catch {
      reconnect();
      return;
    }
    socket = next;
    lastMessage = env.now();
    const active = () => !stopped && socket === next;
    next.onopen = () => {
      if (!active()) return;
      try {
        next.send(
          JSON.stringify({
            type: 'subscribe',
            projectId: options.projectId,
            notificationsOnly: true,
          }),
        );
      } catch {
        socket = undefined;
        next.close();
        reconnect();
      }
    };
    next.onmessage = ({ data }) => {
      if (!active() || typeof data !== 'string') return;
      let message: unknown;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      if (!record(message)) return;
      if (message.type === 'workspace-access-changed') {
        if (
          typeof message.workspaceId === 'string' &&
          (!options.workspaceId || message.workspaceId === options.workspaceId)
        )
          authorityChanged();
        return;
      }
      if (message.projectId !== options.projectId) return;
      let head: NativeSyncHead;
      let own = false;
      if (message.type === 'head' || message.type === 'subscribed') {
        if (!counter(message.sequence) || !counter(message.databaseRevision)) return;
        head = { sequence: message.sequence, databaseRevision: message.databaseRevision };
      } else if (message.type === 'operation') {
        const event = message.event;
        if (
          !record(event) ||
          event.protocolVersion !== 2 ||
          event.status !== 'accepted' ||
          !operationId(event.operationId) ||
          !counter(event.sequence) ||
          !counter(event.databaseRevision)
        )
          return;
        if (seen.has(event.operationId)) return;
        seen.add(event.operationId);
        if (seen.size > 512) seen.delete(seen.values().next().value!);
        head = { sequence: event.sequence, databaseRevision: event.databaseRevision };
        own = options.isOwnOperation(event.operationId);
        if (ahead(head)) {
          if (own) ownUntil = Math.max(ownUntil, env.now() + 2000);
          else foreignPending = true;
        }
      } else return;
      lastMessage = env.now();
      reconnectAttempt = 0;
      target = {
        sequence: Math.max(target.sequence, head.sequence),
        databaseRevision: Math.max(target.databaseRevision, head.databaseRevision),
      };
      if (ahead(head)) {
        // A foreign change must not wait behind an own-echo grace timer.
        if (!own && foreignPending && refreshTimer !== undefined) {
          cancel(refreshTimer);
          refreshTimer = undefined;
        }
        scheduleRefresh();
      }
    };
    next.onclose = ({ code }) => {
      if (!active()) return;
      socket = undefined;
      if (code === 1008) authorityChanged();
      else reconnect();
    };
    next.onerror = () => {
      if (!active()) return;
      socket = undefined;
      next.close();
      reconnect();
    };
  };
  const unlisten = env.listen(() => {
    if (stopped) return;
    if (!socket) {
      cancel(reconnectTimer);
      reconnectTimer = undefined;
      connect();
    }
    scheduleRefresh(true);
  });
  const fallback = () => {
    if (socket && env.now() - lastMessage >= 45_000) {
      const old = socket;
      socket = undefined;
      old.close();
      reconnect();
    }
    if (!socket || env.now() - lastMessage >= 30_000 || ahead(target)) scheduleRefresh(true);
    later(fallback, 30_000);
  };
  connect();
  later(fallback, 30_000);
  return stop;
}
