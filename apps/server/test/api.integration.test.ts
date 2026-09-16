import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  deriveOperationChanges,
  createEmptyDocument,
  addDomain,
  addNote,
  addTable,
  addColumn,
  upsertKey,
  upsertTableRelation,
} from '@ezerd/model';
import type { DesignDocument } from '@ezerd/model';

// Deliberately opt in: this suite creates records in the configured development DB.
describe.runIf(process.env.EZERD_DB_TEST === '1')('PostgreSQL HTTP application', () => {
  let app: NestExpressApplication;
  let pool: pg.Pool;
  let base: string;
  let defaultToken: string;
  const projectIds: string[] = [];
  const userIds: string[] = [];
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    authorization?: string | null,
  ) {
    const token = authorization === null ? undefined : (authorization ?? defaultToken);
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      data: response.headers.get('content-type')?.includes('application/json')
        ? JSON.parse(text)
        : text,
    };
  }
  async function login(userId: string, pin = '0012'): Promise<string> {
    const response = await request('/sessions', 'POST', { userId, pin }, null);
    expect(response.status).toBe(201);
    return response.data.token;
  }
  async function syncDocument(
    projectId: string,
    document: DesignDocument,
    clientId = randomUUID(),
  ) {
    const baseline = await request(`/projects/${projectId}/sync-baseline`, 'POST', { clientId });
    if (baseline.status !== 201) return baseline;
    const operation = {
      operationId: randomUUID(),
      groupId: randomUUID(),
      clientId,
      baselineId: baseline.data.baselineId,
      baseSequence: baseline.data.sequence,
      baselineIssuedAt: baseline.data.baselineIssuedAt,
      kind: 'online',
      dependencyPaths: [],
      changes: deriveOperationChanges(baseline.data.document, document),
      baselineDocument: baseline.data.document,
      document,
    };
    const result = await request(`/projects/${projectId}/operations`, 'POST', operation);
    if (result.status !== 201 || result.data.status !== 'accepted') return result;
    const opened = await request(`/projects/${projectId}`);
    return {
      status: result.status,
      data: { project: opened.data.project, document: result.data.document },
    };
  }
  beforeAll(async () => {
    // Import compiled Nest decorators, avoiding test-transformer decorator differences.
    const { AppModule } = await import('../dist/app.module.js');
    const { readConfig } = await import('../dist/config.js');
    const config = readConfig();
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(config.DATABASE_URL).hostname)) {
      throw new Error('Integration tests require a local development database.');
    }
    pool = new pg.Pool({ connectionString: config.DATABASE_URL });
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
      bodyParser: false,
    });
    const { configureApplication } = await import('../dist/application.js');
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    const fixture = await request(
      '/users',
      'POST',
      { username: `integration-auth-${randomUUID().slice(0, 12)}`, pin: '0012' },
      null,
    );
    expect(fixture.status).toBe(201);
    userIds.push(fixture.data.id);
    defaultToken = await login(fixture.data.id);
  });
  afterAll(async () => {
    if (pool) {
      if (projectIds.length)
        await pool.query('DELETE FROM projects WHERE id = ANY($1::uuid[])', [projectIds]);
      if (userIds.length)
        await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
      await pool.end();
    }
    if (app) await app.close();
  });

  it('roundtrips a design into independent projects and supports fresh sync after import', async () => {
    let document = addDomain(
      createEmptyDocument(),
      { id: 'transfer-domain', name: '판매', description: '설명', color: '#112233' },
      { x: 12, y: 34 },
    );
    document = addNote(
      document,
      { id: 'transfer-note', viewId: 'transfer-domain', text: '메모', color: '#ffeeaa' },
      { x: 60, y: 70 },
    );
    for (const id of ['parent', 'child']) {
      document = addTable(
        document,
        {
          id,
          domainId: 'transfer-domain',
          scope: 'both',
          logical: { name: id, definition: '정의' },
          physical: { name: id, schema: 'public', comment: '설명' },
          customProperties: { common: {}, logical: {}, physical: {} },
          canvasDisplay: { showComment: true, showNullable: false },
        },
        { x: id === 'parent' ? 100 : 500, y: 200 },
      );
      document = addColumn(document, {
        id: `${id}-id`,
        tableId: id,
        scope: 'both',
        logical: { name: '번호', definition: '', semanticType: '', required: true },
        physical: {
          name: 'id',
          type: { name: 'integer', isArray: false },
          nullable: false,
          defaultExpression: null,
          comment: '',
        },
        customProperties: { common: {}, logical: {}, physical: {} },
      });
      document = upsertKey(document, {
        id: `${id}-pk`,
        tableId: id,
        scope: 'both',
        kind: 'primary',
        name: `${id}_pk`,
        columnIds: [`${id}-id`],
      });
    }
    document = upsertTableRelation(document, {
      id: 'fk',
      sourceTableId: 'child',
      targetTableId: 'parent',
      scope: 'both',
      logical: { name: '참조', cardinality: 'one-to-many', required: true },
      physical: {
        name: 'child_fk',
        sourceColumnIds: ['child-id'],
        targetColumnIds: ['parent-id'],
        onDelete: 'CASCADE',
        onUpdate: 'RESTRICT',
      },
    });
    document = {
      ...document,
      enums: [{ id: 'status', name: 'status', schema: 'public', values: ['ready', 'done'] }],
      views: [{ id: 'saved-view', name: '저장된 뷰', domainIds: ['transfer-domain'] }],
      layout: {
        ...document.layout,
        relations: [
          { relationId: 'fk', viewId: 'transfer-domain', offset: 24, bend: { x: 360, y: 220 } },
        ],
      },
    };
    const file = {
      format: 'ezerd-project',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      project: { name: 'transfer-integration' },
      document,
    };
    expect((await request('/projects/import', 'POST', file, null)).status).toBe(401);
    const countBefore = Number(
      (await pool.query("SELECT count(*) FROM projects WHERE name = 'transfer-integration'"))
        .rows[0].count,
    );
    expect(
      (
        await request('/projects/import', 'POST', {
          ...file,
          document: { ...document, domains: [] },
        })
      ).status,
    ).toBe(400);
    expect(
      Number(
        (await pool.query("SELECT count(*) FROM projects WHERE name = 'transfer-integration'"))
          .rows[0].count,
      ),
    ).toBe(countBefore);
    const first = await request('/projects/import', 'POST', file);
    const second = await request('/projects/import', 'POST', file);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    projectIds.push(first.data.id, second.data.id);
    expect(first.data.id).not.toBe(second.data.id);
    expect(first.data.version).toBe(0);
    const exported = await request(`/projects/${first.data.id}/export`);
    expect(exported.status).toBe(200);
    expect(exported.data.document).toEqual(document);
    expect(exported.data.project).toEqual(file.project);
    expect(Object.keys(exported.data).sort()).toEqual([
      'document',
      'exportedAt',
      'format',
      'formatVersion',
      'project',
    ]);
    const changed = {
      ...document,
      domains: document.domains.map((domain) => ({ ...domain, name: '가져온 후 수정' })),
    };
    const saved = await syncDocument(first.data.id, changed);
    expect(saved.status).toBe(201);
    expect(saved.data.document).toEqual(changed);
    expect((await request(`/projects/${second.data.id}`)).data.document).toEqual(document);
  });
  it('normalizes case across registration, login, rename and concurrent creation', async () => {
    const name = 'CaseUser-' + randomUUID().slice(0, 8);
    const first = await request('/users', 'POST', { username: name, pin: '0012' });
    userIds.push(first.data.id);
    expect(first.status).toBe(201);
    expect(first.data.username).toBe(name.toLowerCase());
    const duplicate = await request('/users', 'POST', {
      username: name.toUpperCase(),
      pin: '0012',
    });
    expect(duplicate.data.id).toBe(first.data.id);
    expect(
      (await request('/users', 'POST', { username: name.toUpperCase(), pin: '9999' })).status,
    ).toBe(409);
    const session = await request(
      '/sessions',
      'POST',
      { username: name.toUpperCase(), pin: '0012' },
      null,
    );
    expect(session.status).toBe(201);
    expect((await request('/sessions', 'POST', { username: name, pin: '9999' }, null)).status).toBe(
      401,
    );
    const renamed = await request(
      '/users/' + first.data.id,
      'PATCH',
      { username: name.toUpperCase() + '-NEW' },
      session.data.token,
    );
    expect(renamed.data.username).toBe(name.toLowerCase() + '-new');
    const other = await request('/users', 'POST', { username: name + '-other', pin: '9999' });
    userIds.push(other.data.id);
    const token = await login(other.data.id, '9999');
    expect(
      (
        await request(
          '/users/' + other.data.id,
          'PATCH',
          { username: renamed.data.username.toUpperCase() },
          token,
        )
      ).status,
    ).toBe(409);
    const raceName = name + '-race';
    const raced = await Promise.all([
      request('/users', 'POST', { username: raceName.toUpperCase(), pin: '1234' }),
      request('/users', 'POST', { username: raceName.toLowerCase(), pin: '5678' }),
    ]);
    raced.forEach((result) => {
      if (result.data.id) userIds.push(result.data.id);
    });
    expect(raced.map((result) => result.status).sort()).toEqual([201, 409]);
    const rows = await pool.query('select username from users where id = $1', [first.data.id]);
    expect(rows.rows[0].username).toBe(renamed.data.username);
    await expect(
      pool.query('update users set username = $1 where id = $2', [
        name.toUpperCase(),
        first.data.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('reconnects existing username and PIN identities while preserving profiles and uniqueness', async () => {
    const name = '사용자' + randomUUID().slice(0, 8);
    const first = await request('/users', 'POST', { pin: '0012', username: '  ' + name + '  ' });
    if (first.data.id) userIds.push(first.data.id);
    const firstToken = await login(first.data.id);
    expect(first.status).toBe(201);
    expect(first.data.username).toBe(name);
    const duplicate = await request('/users', 'POST', { pin: '0012', username: name });
    if (duplicate.data.id) userIds.push(duplicate.data.id);
    expect(duplicate.status).toBe(201);
    expect(duplicate.data).toEqual(first.data);
    const sameName = await request('/users', 'POST', { username: name, pin: '9876' });
    if (sameName.data.id) userIds.push(sameName.data.id);
    expect(sameName.status).toBe(409);
    expect(first.data.color).toBe('#4169e1');
    expect(first.data).not.toHaveProperty('pin');
    expect(first.data).not.toHaveProperty('pinHash');
    expect((await request('/users', 'POST', { username: name + '-missing' })).status).toBe(400);
    for (const pin of ['123', '12345', 'abcd'])
      expect((await request('/users', 'POST', { username: name + '-invalid', pin })).status).toBe(
        400,
      );
    expect(
      (await request('/users/' + first.data.id, 'PATCH', { color: '#000000' }, null)).status,
    ).toBe(401);
    const recolored = await request(
      '/users/' + first.data.id,
      'PATCH',
      { color: '#12ABEF' },
      firstToken,
    );
    expect(recolored.status).toBe(200);
    expect(recolored.data.color).toBe('#12abef');
    expect(
      (await request('/users/' + first.data.id, 'PATCH', { color: 'red' }, firstToken)).status,
    ).toBe(400);
    expect((await request('/users/' + first.data.id)).data.color).toBe('#12abef');
    const returning = await request('/users', 'POST', {
      username: '  ' + name + '  ',
      pin: '0012',
    });
    expect(returning.status).toBe(201);
    expect(returning.data).toEqual(recolored.data);
    const other = await request('/users', 'POST', { pin: '0012', username: name + '-other' });
    if (other.data.id) userIds.push(other.data.id);
    const otherToken = await login(other.data.id);
    expect(
      (await request('/users/' + other.data.id, 'PATCH', { username: name }, otherToken)).status,
    ).toBe(409);
    expect((await request('/users/' + other.data.id)).data.username).toBe(name + '-other');
    expect(
      (await request('/users/' + first.data.id, 'PATCH', { username: name }, firstToken)).status,
    ).toBe(200);
    const renamed = await request(
      '/users/' + first.data.id,
      'PATCH',
      { username: name + '-new' },
      firstToken,
    );
    expect(renamed.data.username).toBe(name + '-new');
    expect(renamed.data.color).toBe('#12abef');
    const listed = await request('/users');
    expect(
      listed.data.every((u: Record<string, unknown>) => !('pin' in u) && !('pinHash' in u)),
    ).toBe(true);
    const raceName = '동시' + randomUUID().slice(0, 8);
    const raced = await Promise.all([
      request('/users', 'POST', { pin: '0012', username: raceName }),
      request('/users', 'POST', { pin: '0012', username: raceName }),
    ]);
    raced.forEach((value) => {
      if (value.data.id) userIds.push(value.data.id);
    });
    expect(raced.map((value) => value.status).sort()).toEqual([201, 201]);
    expect(new Set(raced.map((value) => value.data.id)).size).toBe(1);
    expect((await request('/users', 'POST', { pin: '0012', username: ' ' })).status).toBe(400);
    expect((await request('/users/invalid')).status).toBe(400);
    expect((await request('/users/' + randomUUID())).status).toBe(404);
  });
  it('persists operation edits, retires full-document writes, and protects archived projects', async () => {
    const name = `integration-${randomUUID()}_%`;
    expect(
      (await request('/projects', 'POST', { name: 'unauthenticated project' }, null)).status,
    ).toBe(401);
    const created = await request('/projects', 'POST', { name });
    if (created.data.id) projectIds.push(created.data.id);
    expect(created.status).toBe(201);
    expect(created.data.version).toBe(0);
    const id = created.data.id;
    const opened = await request(`/projects/${id}`);
    expect(opened.data.document).toEqual({
      schemaVersion: 1,
      domains: [],
      domainRelations: [],
      notes: [],
      layout: { nodes: [], viewports: [{ viewId: 'overview', x: 0, y: 0, zoom: 1 }] },
    });
    const document = {
      ...opened.data.document,
      domains: [{ id: 'domain-one', name: '주문', description: '' }],
    };
    const writes = await Promise.all([syncDocument(id, document), syncDocument(id, document)]);
    expect(writes.map((result) => result.status)).toEqual([201, 201]);
    expect((await request(`/projects/${id}`)).data.document).toEqual(document);
    expect(
      (await request(`/projects/${id}/document`, 'PUT', { expectedVersion: 0, document })).status,
    ).toBe(410);
    expect(
      (await request(`/projects?search=${encodeURIComponent(name)}`)).data.map(
        (p: { id: string }) => p.id,
      ),
    ).toEqual([id]);
    expect(
      (await request(`/projects/${id}`, 'PATCH', { expectedVersion: 0, name: 'stale' })).status,
    ).toBe(409);
    const beforeArchive = (await request(`/projects/${id}`)).data.project.version;
    const archived = await request(`/projects/${id}`, 'PATCH', {
      expectedVersion: beforeArchive,
      name: '보관 프로젝트',
      status: 'archived',
    });
    expect(archived.data.version).toBe(beforeArchive + 1);
    const archivedWrite = await syncDocument(id, document);
    expect(archivedWrite.status).toBe(400);
    expect(
      (await request('/projects?status=archived')).data.some((p: { id: string }) => p.id === id),
    ).toBe(true);
    expect((await request('/projects?status=unknown')).status).toBe(400);
    expect((await request(`/projects/${randomUUID()}`)).status).toBe(404);
  });

  it('round-trips project enums, stable references and independent crow-foot endpoints', async () => {
    const created = await request('/projects', 'POST', { name: 'integration editor workflow' });
    projectIds.push(created.data.id);
    const id = created.data.id;
    const opened = await request('/projects/' + id);
    const properties = { common: {}, logical: {}, physical: {} };
    const document = {
      ...opened.data.document,
      domains: [{ id: 'd', name: 'domain', description: '' }],
      enums: [{ id: 'enum', schema: 'public', name: 'status', values: ['new', 'done'] }],
      tables: [
        {
          id: 't',
          domainId: 'd',
          scope: 'both',
          logical: { name: '상태', definition: '' },
          physical: { name: 'state', schema: 'public', comment: '' },
          customProperties: properties,
        },
      ],
      columns: [
        {
          id: 'c',
          tableId: 't',
          scope: 'both',
          logical: { name: '상태', definition: '', semanticType: '', required: false },
          physical: {
            name: 'status',
            type: { name: 'status', enumId: 'enum', isArray: false },
            nullable: false,
            defaultExpression: null,
            comment: '',
          },
          customProperties: properties,
        },
      ],
      tableRelations: [
        {
          id: 'r',
          sourceTableId: 't',
          targetTableId: 't',
          scope: 'logical',
          logical: {
            name: 'state.status:state',
            cardinality: 'one-to-many',
            required: false,
            description: '설명',
            sourceCardinality: { min: 0, max: 'many' },
            targetCardinality: { min: 1, max: 1 },
          },
          physical: null,
        },
      ],
      layout: {
        ...opened.data.document.layout,
        relations: [{ relationId: 'r', viewId: 'd', offset: 0, bend: { x: -215.5, y: 345 } }],
      },
    };
    expect((await syncDocument(id, document)).status).toBe(201);
    expect((await request('/projects/' + id)).data.document).toEqual(document);
    document.enums[0]!.name = 'workflow_status';
    expect((await syncDocument(id, document)).status).toBe(201);
    expect((await request('/projects/' + id)).data.document.columns[0].physical.type.enumId).toBe(
      'enum',
    );
    expect((await request('/projects/' + id)).data.document).toEqual(document);
  });

  it('deletes only version-matched archived projects and cascades pins without deleting people', async () => {
    const author = await request('/users', 'POST', {
      pin: '0012',
      username: 'delete fixture author',
    });
    const recipient = await request('/users', 'POST', {
      pin: '0012',
      username: 'delete fixture recipient',
    });
    const authorToken = await login(author.data.id);
    userIds.push(author.data.id, recipient.data.id);
    const created = await request('/projects', 'POST', { name: 'delete fixture project' });
    const other = await request('/projects', 'POST', { name: 'retained fixture project' });
    projectIds.push(created.data.id, other.data.id);
    const id = created.data.id;
    const pin = await request(
      '/projects/' + id + '/threads',
      'POST',
      {
        viewId: 'overview',
        objectId: null,
        x: 15,
        y: 25,
        body: 'pin to cascade',
        mentionIds: [recipient.data.id],
      },
      authorToken,
    );
    expect(pin.status).toBe(201);
    expect((await request('/projects/' + id, 'DELETE', { expectedVersion: 0 })).status).toBe(409);
    expect((await request('/projects/' + id, 'DELETE', { expectedVersion: -1 })).status).toBe(400);
    expect(
      (await request('/projects/' + id, 'PATCH', { expectedVersion: 0, status: 'archived' }))
        .status,
    ).toBe(200);
    expect((await request('/projects/' + id, 'DELETE', { expectedVersion: 0 })).status).toBe(409);
    expect((await request('/projects/' + id)).status).toBe(200);
    const deleted = await request('/projects/' + id, 'DELETE', { expectedVersion: 1 });
    expect(deleted.status).toBe(200);
    expect(deleted.data).toEqual({ id, deleted: true });
    expect((await request('/projects/' + id)).status).toBe(404);
    expect((await request('/projects/' + id, 'DELETE', { expectedVersion: 1 })).status).toBe(404);
    expect(
      (
        await request(
          '/threads/' + pin.data.id + '/messages',
          'POST',
          { body: 'gone', mentionIds: [] },
          authorToken,
        )
      ).status,
    ).toBe(404);
    expect((await request('/users/' + recipient.data.id + '/notifications')).data).toEqual([]);
    expect((await request('/users/' + author.data.id)).status).toBe(200);
    expect((await request('/projects/' + other.data.id)).status).toBe(200);
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM review_messages WHERE thread_id=$1', [
          pin.data.id,
        ])
      ).rows[0].count,
    ).toBe(0);
  });

  it('stores blank pins in design views and retains their threads after view removal', async () => {
    const person = await request('/users', 'POST', {
      pin: '0012',
      username: 'combined pin author',
    });
    userIds.push(person.data.id);
    const personToken = await login(person.data.id);
    const created = await request('/projects', 'POST', { name: 'combined pin fixture' });
    const id = created.data.id;
    projectIds.push(id);
    const opened = await request('/projects/' + id);
    const document = {
      ...opened.data.document,
      domains: [{ id: 'd', name: 'D', description: '' }],
    };
    expect((await syncDocument(id, document)).status).toBe(201);
    const pin = await request(
      '/projects/' + id + '/threads',
      'POST',
      { viewId: 'd', objectId: null, x: 31, y: 42, body: 'domain pin', mentionIds: [] },
      personToken,
    );
    expect(pin.status).toBe(201);
    expect(pin.data.x).toBe(31);
    expect(pin.data.objectId).toBe(null);
    expect((await syncDocument(id, { ...document, domains: [] })).status).toBe(201);
    const list = await request('/projects/' + id + '/threads');
    expect(list.data[0].messages[0].body).toBe('domain pin');
    expect(
      (
        await request(
          '/projects/' + id + '/threads',
          'POST',
          { viewId: 'd', objectId: null, x: 0, y: 0, body: 'missing view', mentionIds: [] },
          personToken,
        )
      ).status,
    ).toBe(400);
  });

  it('deletes a pin and replies atomically but rejects deletion after a new reply', async () => {
    const author = await request('/users', 'POST', { pin: '0012', username: 'pin delete author' });
    userIds.push(author.data.id);
    const authorToken = await login(author.data.id);
    const recipient = await request('/users', 'POST', {
      pin: '0012',
      username: 'pin delete recipient',
    });
    userIds.push(recipient.data.id);
    const created = await request('/projects', 'POST', { name: 'pin delete fixture' });
    const id = created.data.id;
    projectIds.push(id);
    const payload = {
      viewId: 'overview',
      objectId: null,
      x: 10,
      y: 20,
      body: 'delete me',
      mentionIds: [recipient.data.id],
    };
    const first = await request('/projects/' + id + '/threads', 'POST', payload, authorToken);
    const retained = await request(
      '/projects/' + id + '/threads',
      'POST',
      { ...payload, body: 'keep me' },
      authorToken,
    );
    const reply = await request(
      '/threads/' + first.data.id + '/messages',
      'POST',
      { body: 'new reply', mentionIds: [] },
      authorToken,
    );
    expect(reply.status).toBe(201);
    expect(
      (
        await request('/threads/' + first.data.id, 'DELETE', {
          expectedUpdatedAt: first.data.updatedAt,
        })
      ).status,
    ).toBe(409);
    expect((await request('/threads/' + first.data.id, 'DELETE', {})).status).toBe(400);
    const removed = await request('/threads/' + first.data.id, 'DELETE', {
      expectedUpdatedAt: reply.data.updatedAt,
    });
    expect(removed.status).toBe(200);
    expect(removed.data).toEqual({ id: first.data.id, deleted: true });
    const pins = await request('/projects/' + id + '/threads');
    expect(pins.data.map((p: { id: string }) => p.id)).toEqual([retained.data.id]);
    const alerts = await request('/users/' + recipient.data.id + '/notifications');
    expect(alerts.data.map((n: { threadId: string }) => n.threadId)).toEqual([retained.data.id]);
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM review_messages WHERE thread_id=$1', [
          first.data.id,
        ])
      ).rows[0].count,
    ).toBe(0);
    expect((await request('/users/' + author.data.id)).status).toBe(200);
    expect(
      (
        await request('/threads/' + first.data.id, 'DELETE', {
          expectedUpdatedAt: reply.data.updatedAt,
        })
      ).status,
    ).toBe(404);
  });

  it('accepts operation documents over 100 KB and keeps project validation intact', async () => {
    const created = await request('/projects', 'POST', { name: 'integration large document' });
    if (created.data.id) projectIds.push(created.data.id);
    expect(created.status).toBe(201);
    const id = created.data.id;
    const opened = await request(`/projects/${id}`);
    const document = {
      ...opened.data.document,
      notes: Array.from({ length: 20 }, (_, index) => ({
        id: `note-${index}`,
        viewId: 'overview',
        text: 'x'.repeat(10000),
      })),
    };
    expect((await syncDocument(id, document)).status).toBe(201);
    expect((await request(`/projects/${id}`)).data.document).toEqual(document);
    expect((await request(`/projects/${id}`, 'PATCH', { expectedVersion: 1 })).status).toBe(400);
    expect(
      (await request(`/projects/${id}`, 'PATCH', { expectedVersion: -1, name: 'invalid' })).status,
    ).toBe(400);
    expect(
      (await request(`/projects/${id}`, 'PATCH', { expectedVersion: 1, name: ' ' })).status,
    ).toBe(400);
    expect((await request(`/projects/${id}`)).data.project.version).toBe(1);
    expect((await request('/projects/not-a-uuid')).status).toBe(400);
    expect(
      (await request(`/projects/${randomUUID()}/sync-baseline`, 'POST', { clientId: randomUUID() }))
        .status,
    ).toBe(404);
    expect((await request('/health')).status).toBe(200);
    expect((await request('/health/ready')).status).toBe(200);
  });

  it('does not expose database error details', async () => {
    const { WorkspaceController } = await import('../dist/workspace.controller.js');
    const brokenDatabase = {
      db: {
        insert: () => {
          throw new Error('postgresql://user:secret@private-host/database');
        },
      },
    };
    const controller = new WorkspaceController(
      brokenDatabase as never,
      {} as never,
      {} as never,
      { consume: () => undefined } as never,
    );
    try {
      await controller.createUser({ username: 'test', pin: '0012' }, { ip: '127.0.0.1' });
      throw new Error('Expected a storage failure');
    } catch (error) {
      const failure = error as { getStatus(): number; getResponse(): unknown };
      expect(failure.getStatus()).toBe(503);
      expect(JSON.stringify(failure.getResponse())).not.toContain('secret');
      expect(JSON.stringify(failure.getResponse())).not.toContain('private-host');
    }
  });

  it('rejects multibyte operation documents above 1.5 MB without replacing saved data', async () => {
    const created = await request('/projects', 'POST', { name: 'integration UTF-8 limits' });
    if (created.data.id) projectIds.push(created.data.id);
    expect(created.status).toBe(201);
    const id = created.data.id;
    const opened = await request(`/projects/${id}`);
    const savedDocument = {
      ...opened.data.document,
      domains: [{ id: 'keep-domain', name: '보존할 도메인', description: '저장된 내용' }],
    };
    const saved = await syncDocument(id, savedDocument);
    expect(saved.status).toBe(201);

    // All individual fields and collections are valid; only total UTF-8 bytes exceed the cap.
    const multibyteDocument = {
      ...savedDocument,
      notes: Array.from({ length: 30 }, (_, index) => ({
        id: `large-note-${index}`,
        viewId: 'overview',
        text: '한'.repeat(20000),
      })),
    };
    const canonical = JSON.stringify(multibyteDocument);
    expect(canonical.length).toBeLessThan(1_500_000);
    expect(Buffer.byteLength(canonical, 'utf8')).toBeGreaterThan(1_500_000);
    expect(Buffer.byteLength(JSON.stringify(multibyteDocument), 'utf8')).toBeLessThan(
      2 * 1024 * 1024,
    );
    expect((await syncDocument(id, multibyteDocument)).status).toBe(400);
    expect((await request(`/projects/${id}`)).data).toEqual(saved.data);
  });

  it('reopens shared map content while leaving personal viewports out of persistence', async () => {
    const created = await request('/projects', 'POST', { name: 'integration complete domain map' });
    if (created.data.id) projectIds.push(created.data.id);
    expect(created.status).toBe(201);
    const id = created.data.id;
    const document = {
      schemaVersion: 1,
      domains: [
        { id: 'orders', name: '주문', description: '주문 접수와 상태 관리' },
        { id: 'payments', name: '결제', description: '결제 승인과 취소' },
      ],
      domainRelations: [
        {
          id: 'orders-to-payments',
          sourceDomainId: 'orders',
          targetDomainId: 'payments',
          name: '결제 요청',
          direction: 'forward',
          description: '접수된 주문의 결제를 요청한다.',
        },
      ],
      notes: [
        {
          id: 'order-note',
          viewId: 'orders',
          text: '주문 상태 전이를 검토하세요.\n취소와 환불을 구분합니다.',
        },
      ],
      layout: {
        nodes: [
          {
            id: 'node-orders',
            objectId: 'orders',
            viewId: 'overview',
            x: -160.5,
            y: 80,
            width: 240,
            height: 140,
          },
          {
            id: 'node-payments',
            objectId: 'payments',
            viewId: 'overview',
            x: 320,
            y: 120.25,
            width: 260,
            height: 150,
          },
          {
            id: 'node-order-note',
            objectId: 'order-note',
            viewId: 'orders',
            x: 48.5,
            y: -32,
            width: 280,
            height: 180,
          },
        ],
        viewports: [
          { viewId: 'overview', x: 125.5, y: -44, zoom: 0.8 },
          { viewId: 'orders', x: -72.25, y: 96, zoom: 1.4 },
          { viewId: 'payments', x: 0, y: 0, zoom: 1 },
        ],
      },
    };
    const saved = await syncDocument(id, document);
    expect(saved.status).toBe(201);
    expect(saved.data.project.version).toBe(1);
    expect(saved.data.document).toEqual({
      ...document,
      layout: { ...document.layout, viewports: [{ viewId: 'overview', x: 0, y: 0, zoom: 1 }] },
    });
    const reopened = await request(`/projects/${id}`);
    expect(reopened.status).toBe(200);
    expect(reopened.data).toEqual(saved.data);
    expect(reopened.data.document).toEqual(saved.data.document);
  });
  it('keeps review threads independent from design saves and atomically validates mentions', async () => {
    const author = (await request('/users', 'POST', { pin: '0012', username: 'review author' }))
      .data;
    const mentioned = (
      await request('/users', 'POST', { pin: '0012', username: 'review teammate' })
    ).data;
    const authorToken = await login(author.id);
    const mentionedToken = await login(mentioned.id);
    userIds.push(author.id, mentioned.id);
    const project = (await request('/projects', 'POST', { name: 'review integration' })).data;
    projectIds.push(project.id);
    const original = (await request(`/projects/${project.id}`)).data.document;
    const document = {
      ...original,
      domains: [{ id: 'orders', name: 'Orders', description: '' }],
      layout: {
        ...original.layout,
        nodes: [
          {
            id: 'node-orders',
            objectId: 'orders',
            viewId: 'overview',
            x: 10,
            y: 20,
            width: 240,
            height: 160,
          },
        ],
      },
    };
    expect((await syncDocument(project.id, document)).status).toBe(201);
    const input = {
      viewId: 'overview',
      objectId: 'orders',
      x: 12,
      y: 16,
      body: 'Please review',
      mentionIds: [mentioned.id, mentioned.id, author.id],
    };
    expect((await request(`/projects/${project.id}/threads`, 'POST', input, null)).status).toBe(
      401,
    );
    const created = await request(`/projects/${project.id}/threads`, 'POST', input, authorToken);
    expect(created.status).toBe(201);
    const thread = created.data;
    expect(thread.messages[0].mentionIds).toEqual([mentioned.id, author.id]);
    const alerts = (await request(`/users/${mentioned.id}/notifications`)).data;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ projectId: project.id, threadId: thread.id, read: false });
    expect((await request(`/users/${author.id}/notifications`)).data).toEqual([]);
    expect(
      (await request(`/notifications/${alerts[0].id}`, 'PATCH', { read: true }, authorToken))
        .status,
    ).toBe(404);
    expect(
      (await request(`/notifications/${alerts[0].id}`, 'PATCH', { read: true }, mentionedToken))
        .data.read,
    ).toBe(true);
    expect(
      (
        await request(
          `/projects/${project.id}/threads`,
          'POST',
          { ...input, mentionIds: [randomUUID()] },
          authorToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `/projects/${project.id}/threads`,
          'POST',
          { ...input, authorId: randomUUID() },
          authorToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `/projects/${project.id}/threads`,
          'POST',
          { ...input, viewId: 'missing' },
          authorToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `/projects/${project.id}/threads`,
          'POST',
          { ...input, objectId: 'missing' },
          authorToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `/threads/${thread.id}/messages`,
          'POST',
          { body: 'Invalid', mentionIds: [randomUUID()] },
          authorToken,
        )
      ).status,
    ).toBe(400);
    expect((await request(`/projects/${project.id}/threads`)).data).toHaveLength(1);
    expect((await syncDocument(project.id, original)).status).toBe(201);
    const reply = await request(
      `/threads/${thread.id}/messages`,
      'POST',
      { body: 'Reply after target deletion', mentionIds: [author.id] },
      mentionedToken,
    );
    expect(reply.status).toBe(201);
    expect(reply.data.messages).toHaveLength(2);
    expect(reply.data.objectId).toBe('orders');
    expect(
      (await request(`/threads/${thread.id}`, 'PATCH', { resolved: true })).data.resolved,
    ).toBe(true);
    expect(
      (await request(`/threads/${thread.id}`, 'PATCH', { resolved: false })).data.resolved,
    ).toBe(false);
    expect((await request(`/projects/${project.id}/threads`)).data[0].messages).toHaveLength(2);
    expect((await request(`/users/${author.id}/notifications`)).data).toHaveLength(1);
    expect((await request(`/threads/${randomUUID()}`, 'PATCH', { resolved: true })).status).toBe(
      404,
    );
    expect((await request(`/projects/${randomUUID()}/threads`)).status).toBe(404);
  });

  it('serves the production SPA and keeps unknown API routes as JSON 404', async () => {
    const response = await fetch(base);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<div id="root"></div>');
    expect((await request('/does-not-exist')).status).toBe(404);
  });
});
