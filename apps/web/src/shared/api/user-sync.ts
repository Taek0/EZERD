import {
  nativeSyncSocketUrl,
  browserEnvironment,
  type NativeSyncEnvironment,
  type NativeSyncSocket,
} from '../../features/projects/native-sync-subscription.js';

export type UserResource = 'workspaces' | 'invitations' | 'notifications' | 'projects';
/** Owns the authenticated tab connection. Project adapters only own subscriptions. */
export function startUserSync(options: {
  token: string;
  baseUrl?: string;
  environment?: NativeSyncEnvironment;
  recheckAccess(): void;
  invalidate(resource?: UserResource, workspaceId?: string): void;
}) {
  const env = options.environment ?? browserEnvironment();
  let stopped = false;
  let socket: NativeSyncSocket | undefined;
  let ready = false;
  let attempt = 0;
  let lastMessage = env.now();
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const adapters = new Map<NativeSyncSocket, string | undefined>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (callback: () => void, delay: number) => {
    const timer = env.setTimeout(() => {
      timers.delete(timer);
      if (!stopped) callback();
    }, delay);
    timers.add(timer);
    return timer;
  };
  const reconnect = () => {
    if (stopped || reconnectTimer !== undefined) return;
    reconnectTimer = later(
      () => {
        reconnectTimer = undefined;
        connect();
      },
      Math.min(1000 * 2 ** Math.min(attempt++, 5), 30000),
    );
  };
  const connect = () => {
    if (stopped || socket) return;
    let next: NativeSyncSocket;
    try {
      next = env.createSocket(
        nativeSyncSocketUrl(options.baseUrl ?? window.location.origin, options.token),
      );
    } catch {
      reconnect();
      return;
    }
    socket = next;
    lastMessage = env.now();
    const active = () => !stopped && socket === next;
    const disconnected = (code: number) => {
      if (!active()) return;
      socket = undefined;
      ready = false;
      const disconnectedAdapters = [...adapters.keys()];
      adapters.clear();
      for (const adapter of disconnectedAdapters) adapter.onclose?.({ code });
      if (code === 1008) options.recheckAccess();
      reconnect();
    };
    next.onopen = () => {
      if (!active()) return;
      ready = true;
      next.send(JSON.stringify({ type: 'subscribe-user' }));
      for (const adapter of adapters.keys()) adapter.onopen?.();
    };
    next.onmessage = (event) => {
      if (!active() || typeof event.data !== 'string') return;
      let value;
      try {
        value = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!value || typeof value !== 'object') return;
      lastMessage = env.now();
      if (value.type === 'user-subscribed') {
        attempt = 0;
        options.invalidate();
      }
      if (
        value.type === 'user-change' &&
        ['workspaces', 'invitations', 'notifications', 'projects'].includes(value.resource)
      ) {
        options.invalidate(
          value.resource,
          typeof value.workspaceId === 'string' ? value.workspaceId : undefined,
        );
      }
      for (const adapter of [...adapters.keys()]) adapter.onmessage?.(event);
    };
    next.onclose = ({ code }) => disconnected(code);
    next.onerror = () => {
      disconnected(1006);
      next.close();
    };
  };
  const unlisten = env.listen(() => {
    options.invalidate();
    if (!socket) connect();
  });
  const watchdog = () => {
    if (socket && env.now() - lastMessage >= 45000) {
      const old = socket;
      old.onclose?.({ code: 1006 });
      old.close();
    }
    later(watchdog, 15000);
  };
  connect();
  later(watchdog, 15000);
  return {
    environment: {
      ...env,
      createSocket: () => {
        const adapter: NativeSyncSocket = {
          onopen: null,
          onmessage: null,
          onclose: null,
          onerror: null,
          send: (data) => {
            if (!adapters.has(adapter) || !ready || !socket) return;
            const value = JSON.parse(data);
            if (value.type === 'subscribe') adapters.set(adapter, value.projectId);
            socket.send(data);
          },
          close: () => {
            const projectId = adapters.get(adapter);
            adapters.delete(adapter);
            if (projectId && ready && socket)
              socket.send(JSON.stringify({ type: 'unsubscribe', projectId }));
          },
        };
        adapters.set(adapter, undefined);
        if (ready)
          later(() => {
            if (adapters.has(adapter)) adapter.onopen?.();
          }, 0);
        return adapter;
      },
    } satisfies NativeSyncEnvironment,
    stop() {
      stopped = true;
      unlisten();
      for (const timer of timers) env.clearTimeout(timer);
      timers.clear();
      adapters.clear();
      socket?.close();
      socket = undefined;
    },
  };
}
