import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createEmptyDocument } from '@ezerd/model';
import { WorkspaceService } from '../src/workspace/workspace.service.js';
import { encodeUpdatedCursor } from '../src/shared/updated-cursor.js';

function fixture(count = 1) {
  const calls: { text: string; values: unknown[] }[] = [];
  let allowed = true;
  const heads = Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    workspaceId: '00000000-0000-4000-8000-000000000099',
    name: `Project ${index}`,
    databaseKind: 'postgresql',
    databaseProfileId: 'postgresql-18-v1',
    databaseRevision: 0,
    status: 'active',
    version: 0,
    syncSequence: 0,
    createdAt: '2026-10-16T00:00:00.000Z',
    updatedAt: '2026-10-16T00:00:00.123Z',
  }));
  const document = createEmptyDocument();
  document.tables = [{ id: 't', scope: 'physical', physical: { name: 'saved' } }] as never;
  const query = vi.fn(async (config: string | { text: string }, values: unknown[] = []) => {
    const text = typeof config === 'string' ? config : config.text;
    calls.push({ text, values });
    if (!text.startsWith('select ')) return { rows: [] };
    if (text.includes('"document"')) {
      return {
        rows: heads
          .filter((head) => values.includes(head.id))
          .map((head) => [head.id, structuredClone(document)]),
      };
    }
    const limit = / limit \$\d+$/.test(text) ? (values.at(-1) as number) : heads.length;
    return { rows: allowed ? heads.slice(0, limit).map((head) => Object.values(head)) : [] };
  });
  const db = drizzle({ client: { query } as never });
  return {
    calls,
    heads,
    document,
    revoke: () => {
      allowed = false;
    },
    service: new WorkspaceService({ db } as never, {} as never),
    documents: () =>
      calls.filter((call) => call.text.startsWith('select ') && call.text.includes('"document"')),
    metadata: () => calls.filter((call) => call.text.includes('inner join')),
  };
}

describe('gallery metadata and preview cache', () => {
  it('reads metadata on every request and fetches cold documents once in the same snapshot', async () => {
    const f = fixture();
    const cold = await f.service.listProjects('actor', {
      search: 'a%_\\b',
      workspaceId: 'workspace',
    });
    expect(cold[0]!.preview!.tables[0]!.name).toBe('saved');
    cold[0]!.preview!.tables[0]!.name = 'response mutation';
    const warm = await f.service.listProjects('actor', {});
    expect(warm[0]!.preview!.tables[0]!.name).toBe('saved');
    expect(f.documents()).toHaveLength(1);
    expect(f.metadata()).toHaveLength(2);
    expect(f.metadata()[0]!.values).toEqual(['actor', 'active', 'workspace', '%a\\%\\_\\\\b%']);
    expect(f.metadata()[0]!.text).toMatch(
      /order by "projects"\."updated_at" desc, "projects"\."id" asc$/,
    );
    expect(f.metadata()[0]!.text).not.toContain('"document"');
    expect(f.calls[0]!.text).toBe('begin isolation level repeatable read read only');
    expect(f.calls[3]!.text).toBe('commit');
  });

  it('checks membership again even for cached heads and preserves filters/paging', async () => {
    const f = fixture(3);
    const page = await f.service.listProjectsPage('actor', { status: 'archived', limit: 2 });
    expect(page.projects).toHaveLength(2);
    expect(page.nextCursor).toBe(
      encodeUpdatedCursor({ updatedAt: f.heads[1]!.updatedAt, id: f.heads[1]!.id }),
    );
    expect(f.documents()[0]!.values).toEqual(f.heads.slice(0, 2).map((head) => head.id));
    const cursor = page.nextCursor!;
    await f.service.listProjectsPage('actor', { status: 'archived', limit: 2, cursor });
    expect(f.documents()).toHaveLength(1);
    expect(f.metadata()[1]!.text).toContain('"user_workspaces"."user_id" =');
    expect(f.metadata()[1]!.text).toContain('"projects"."id" >');
    expect(f.metadata()[1]!.values).toEqual([
      'actor',
      'archived',
      new Date(f.heads[1]!.updatedAt),
      new Date(f.heads[1]!.updatedAt),
      f.heads[1]!.id,
      3,
    ]);
    f.revoke();
    expect(await f.service.listProjects('actor', {})).toEqual([]);
    expect(f.documents()).toHaveLength(1);
  });

  it('invalidates on changed heads and keeps REST results complete while batching document misses', async () => {
    const f = fixture(33);
    expect(await f.service.listProjects('actor', {})).toHaveLength(33);
    expect(f.documents().map((call) => call.values.length)).toEqual([16, 16, 1]);
    await f.service.listProjects('actor', {});
    expect(f.documents()).toHaveLength(3);
    f.heads[0]!.syncSequence++;
    f.document.tables![0]!.physical.name = 'changed';
    expect((await f.service.listProjects('actor', {}))[0]!.preview!.tables[0]!.name).toBe(
      'changed',
    );
    expect(f.documents()).toHaveLength(4);
    expect(f.documents()[3]!.values).toEqual([f.heads[0]!.id]);
  });
});
