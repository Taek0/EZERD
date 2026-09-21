export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function storedAuthorization(storage?: Pick<Storage, 'getItem'>): string | undefined {
  const source = storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
  if (!source) return undefined;
  try {
    const raw = source.getItem('ezerd.sync.session');
    if (!raw) return undefined;
    const session = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown };
    if (
      typeof session.token !== 'string' ||
      typeof session.expiresAt !== 'string' ||
      Date.parse(session.expiresAt) <= Date.now()
    )
      return undefined;
    return `Bearer ${session.token}`;
  } catch {
    return undefined;
  }
}
export async function request<T>(
  url: string,
  init?: RequestInit,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const authorization = storedAuthorization();
  const response = await fetcher(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok)
    throw new ApiError(
      response.status,
      response.status === 409
        ? '다른 저장 내용이 있습니다. 최신 내용을 다시 열어 주세요.'
        : `요청을 완료하지 못했습니다 (${response.status}). 다시 시도해 주세요.`,
    );
  return (await response.json()) as T;
}
export const savedRevision = (current: number, snapshot: number) => current === snapshot;
export const body = (method: string, value: unknown): RequestInit => ({
  method,
  body: JSON.stringify(value),
});
export const message = (error: unknown) =>
  error instanceof Error ? error.message : '연결을 확인하고 다시 시도해 주세요.';
export type SaveSnapshot<T> = {
  document: T;
  revision: number;
};
export function acknowledgeSave<T, P>(
  current: SaveSnapshot<T>,
  snapshotRevision: number,
  response: {
    document: T;
    project: P;
  },
) {
  return {
    project: response.project,
    document: current.revision === snapshotRevision ? response.document : current.document,
    saved: snapshotRevision,
    dirty: current.revision !== snapshotRevision,
  };
}
export function validViewId(viewId: string, domainIds: readonly string[]) {
  return viewId === 'overview' || domainIds.includes(viewId) ? viewId : 'overview';
}
export function viewportDestination(readOnly: boolean) {
  return readOnly ? 'local' : 'document';
}
export function newId(
  cryptoLike: {
    getRandomValues: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array;
    randomUUID?: () => string;
  } = crypto,
): string {
  if (cryptoLike.randomUUID) return cryptoLike.randomUUID();
  const bytes = cryptoLike.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export class SaveGate {
  private active = false;
  begin() {
    if (this.active) return false;
    this.active = true;
    return true;
  }
  finish() {
    this.active = false;
  }
}
export function clampLayoutPatch<T extends Partial<Record<'x' | 'y' | 'width' | 'height', number>>>(
  patch: T,
): T {
  const result = { ...patch };
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = result[key];
    if (value === undefined) continue;
    const coordinate = key === 'x' || key === 'y';
    result[key] = Math.max(
      coordinate ? -10000000 : 40,
      Math.min(coordinate ? 10000000 : 10000, Number.isFinite(value) ? value : coordinate ? 0 : 40),
    );
  }
  return result;
}
