import { describe, expect, it } from 'vitest';
import { ApiError, request, savedRevision, storedAuthorization } from './client.js';
describe('document save acknowledgements', () => {
  it('keeps changes made while a snapshot is saving dirty', () => {
    expect(savedRevision(4, 3)).toBe(false);
    expect(savedRevision(3, 3)).toBe(true);
  });
});
describe('API failures', () => {
  it('preserves the conflict status without requiring a JSON body', async () => {
    const fetcher = async () => new Response('Conflict', { status: 409 });
    await expect(
      request('/api/projects/a', undefined, fetcher as typeof fetch),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('returns successful responses and handles empty proxy errors', async () => {
    expect(
      await request('/api/users', undefined, (async () =>
        Response.json([{ id: 'a' }])) as typeof fetch),
    ).toEqual([{ id: 'a' }]);
    await expect(
      request(
        '/api/users',
        undefined,
        (async () => new Response('', { status: 502 })) as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
describe('authenticated API requests', () => {
  it('uses only a current stored session token', () => {
    const storage = (value: unknown) => ({
      getItem: () => (value === undefined ? null : JSON.stringify(value)),
    });
    expect(
      storedAuthorization(
        storage({ token: 'session-token', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
      ),
    ).toBe('Bearer session-token');
    expect(
      storedAuthorization(
        storage({ token: 'expired', expiresAt: new Date(Date.now() - 1).toISOString() }),
      ),
    ).toBeUndefined();
    expect(storedAuthorization(storage(undefined))).toBeUndefined();
    expect(storedAuthorization({ getItem: () => '{' })).toBeUndefined();
  });
});
import { acknowledgeSave, validViewId, viewportDestination } from './client.js';
describe('save response reconciliation', () => {
  it('acknowledges a deferred save without replacing edits and uses the new server version', async () => {
    let resolve!: (value: {
      document: {
        name: string;
      };
      project: {
        version: number;
      };
    }) => void;
    const pending = new Promise<{
      document: {
        name: string;
      };
      project: {
        version: number;
      };
    }>((done) => {
      resolve = done;
    });
    const current = { revision: 2, document: { name: 'edited during save' } };
    resolve({ document: { name: 'snapshot' }, project: { version: 8 } });
    expect(acknowledgeSave(current, 1, await pending)).toEqual({
      document: current.document,
      project: { version: 8 },
      saved: 1,
      dirty: true,
    });
  });
  it('marks an unchanged snapshot saved and accepts the server document', () => {
    expect(
      acknowledgeSave({ revision: 1, document: 'local' }, 1, {
        document: 'server',
        project: { version: 2 },
      }),
    ).toEqual({ document: 'server', project: { version: 2 }, saved: 1, dirty: false });
  });
});
it('returns from a deleted domain on reload and keeps archived navigation local', () => {
  expect(validViewId('deleted', ['surviving'])).toBe('overview');
  expect(validViewId('surviving', ['surviving'])).toBe('surviving');
  expect(viewportDestination(true)).toBe('local');
  expect(viewportDestination(false)).toBe('document');
});
import { newId } from './client.js';
it('generates UUID v4 on HTTP contexts without randomUUID', () => {
  const cryptoLike = {
    getRandomValues: (bytes: Uint8Array) => {
      bytes.fill(255);
      return bytes;
    },
  };
  expect(newId(cryptoLike)).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
});
import { SaveGate } from './client.js';
it('rejects overlapping saves and releases the gate after a failed request', async () => {
  const gate = new SaveGate();
  expect(gate.begin()).toBe(true);
  expect(gate.begin()).toBe(false);
  const document = { name: 'unsaved edits' };
  try {
    await request(
      '/save',
      undefined,
      (async () => new Response('', { status: 503 })) as typeof fetch,
    );
  } catch {
    /* keep local document */
  } finally {
    gate.finish();
  }
  expect(document).toEqual({ name: 'unsaved edits' });
  expect(gate.begin()).toBe(true);
});
import { clampLayoutPatch } from './client.js';
it('clamps typed and dragged dimensions and coordinates to valid model bounds', () => {
  expect(clampLayoutPatch({ x: -10000001, y: 10000001, width: 10001, height: -20 })).toEqual({
    x: -10000000,
    y: 10000000,
    width: 10000,
    height: 40,
  });
  expect(clampLayoutPatch({ x: 1.5, width: 240 })).toEqual({ x: 1.5, width: 240 });
});
