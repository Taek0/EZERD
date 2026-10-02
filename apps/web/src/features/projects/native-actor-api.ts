import { request } from '../../shared/api/client.js';

type SessionStorage = Pick<Storage, 'getItem'>;
export interface NativeActorApiOptions {
  sessionStorage?: SessionStorage;
  fetcher?: typeof fetch;
}
interface ActorSession {
  userId: string;
  token: string;
  expiresAt: string;
}
function readActorSession(userId: string, storage?: SessionStorage): ActorSession {
  let value: unknown;
  try {
    const target = storage ?? globalThis.sessionStorage;
    const raw = target?.getItem('ezerd.sync.session');
    if (!raw) throw Error();
    value = JSON.parse(raw);
  } catch {
    throw Error('native.actor-session-unavailable');
  }
  if (!value || typeof value !== 'object') throw Error('native.actor-session-unavailable');
  const session = value as Partial<ActorSession> & { user?: { id?: unknown } };
  if (
    typeof session.userId !== 'string' ||
    typeof session.token !== 'string' ||
    !session.token ||
    typeof session.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(session.expiresAt)) ||
    Date.parse(session.expiresAt) <= Date.now()
  )
    throw Error('native.actor-session-unavailable');
  if (session.userId !== userId || (session.user?.id !== undefined && session.user.id !== userId))
    throw Error('native.actor-mismatch');
  return { userId: session.userId, token: session.token, expiresAt: session.expiresAt };
}

/** Capture before the first await. Credentials stay in this closure, never in durable payloads. */
export function captureNativeActorApi(
  userId: string,
  api: typeof request = request,
  options: NativeActorApiOptions = {},
): typeof request {
  // Explicit injected transports are the caller's actor-bound authority (also used by unit tests).
  if (api !== request) return api;
  const captured = readActorSession(userId, options.sessionStorage);
  const authorization = `Bearer ${captured.token}`;
  const fetcher = options.fetcher ?? globalThis.fetch;
  function current() {
    const session = readActorSession(userId, options.sessionStorage);
    if (session.token !== captured.token || session.expiresAt !== captured.expiresAt)
      throw Error('native.actor-session-changed');
  }
  return async function actorRequest<T>(url: string, init?: RequestInit): Promise<T> {
    current();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      if (key !== 'authorization') headers[key] = value;
    });
    // client.request spreads object headers; use exactly the same key to override its live auth.
    headers.Authorization = authorization;
    return request<T>(url, { ...init, headers }, async (input, outgoing) => {
      current(); // No await between the final account/session check and the real fetch invocation.
      const pinned = new Headers(outgoing?.headers);
      pinned.set('Authorization', authorization);
      return fetcher(input, { ...outgoing, headers: pinned });
    });
  };
}
