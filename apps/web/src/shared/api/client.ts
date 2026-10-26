import { registerTranslations, translate as t } from '../i18n/index.js';
import { TABLES_VIEW_ID } from '@ezerd/model';

registerTranslations({
  '다른 저장 내용이 있습니다. 최신 내용을 다시 열어 주세요.':
    'There are other saved changes. Reopen the latest version.',
  '요청을 완료하지 못했습니다 ({status}). 다시 시도해 주세요.':
    'The request failed ({status}). Please try again.',
  '연결을 확인하고 다시 시도해 주세요.': 'Check your connection and try again.',
});

export interface ApiDiagnostic {
  code?: string | undefined;
  requestId?: string;
  issues?: Array<{ code?: string | undefined; path?: string }>;
}
const diagnosticToken = (value: unknown) =>
  typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,120}$/.test(value) ? value : undefined;
/** Retain identifiers only, never server messages, submitted values or nested errors. */
export function apiDiagnostic(value: unknown): ApiDiagnostic {
  if (!value || typeof value !== 'object') return {};
  const data = value as Record<string, unknown>;
  const code = diagnosticToken(data.code);
  const requestId = diagnosticToken(data.requestId);
  const issues = Array.isArray(data.issues)
    ? data.issues.slice(0, 3).flatMap((issue: unknown) => {
        if (!issue || typeof issue !== 'object') return [];
        const item = issue as Record<string, unknown>;
        const issueCode = diagnosticToken(item.code);
        // Zod custom issue messages sometimes carry a stable application reason code.
        const custom =
          item.code === 'custom' &&
          typeof item.message === 'string' &&
          /^[a-z][a-z-]*\.[a-z][a-z.-]*$/.test(item.message)
            ? diagnosticToken(item.message)
            : undefined;
        const path = Array.isArray(item.path)
          ? item.path
              .slice(0, 8)
              .map((part) =>
                typeof part === 'number' && Number.isSafeInteger(part)
                  ? String(part)
                  : (diagnosticToken(part) ?? '?'),
              )
              .join('.')
              .slice(0, 180)
          : typeof item.path === 'string' && /^[a-zA-Z0-9_./:~\[\]-]{1,180}$/.test(item.path)
            ? item.path
            : undefined;
        return [
          {
            ...(custom || issueCode ? { code: custom ?? issueCode } : {}),
            ...(path ? { path } : {}),
          },
        ];
      })
    : [];
  return {
    ...(code ? { code } : {}),
    ...(requestId ? { requestId } : {}),
    ...(issues.length ? { issues } : {}),
  };
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public diagnostic: ApiDiagnostic = {},
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
  if (!response.ok) {
    let diagnostic: ApiDiagnostic = {};
    try {
      const payload: unknown = await response.json();
      diagnostic = apiDiagnostic(payload);
    } catch {
      // Proxies can return empty or non-JSON failures; keep the HTTP status usable.
    }
    throw new ApiError(
      response.status,
      response.status === 409
        ? t('다른 저장 내용이 있습니다. 최신 내용을 다시 열어 주세요.')
        : t('요청을 완료하지 못했습니다 ({status}). 다시 시도해 주세요.', {
            status: response.status,
          }),
      diagnostic.code,
      diagnostic,
    );
  }
  return (await response.json()) as T;
}
export const savedRevision = (current: number, snapshot: number) => current === snapshot;
export const body = (method: string, value: unknown): RequestInit => ({
  method,
  body: JSON.stringify(value),
});
export const message = (error: unknown) =>
  error instanceof Error ? error.message : t('연결을 확인하고 다시 시도해 주세요.');
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
export function validViewId(viewId: string, domainIds: readonly string[], fallback = 'overview') {
  return viewId === 'overview' || viewId === TABLES_VIEW_ID || domainIds.includes(viewId)
    ? viewId
    : fallback;
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
