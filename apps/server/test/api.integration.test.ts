import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import type { NestExpressApplication } from '@nestjs/platform-express';

// Deliberately opt in: this suite creates records in the configured development DB.
describe.runIf(process.env.EZERD_DB_TEST === '1')('PostgreSQL HTTP application', () => {
  let app: NestExpressApplication;
  let pool: pg.Pool;
  let base: string;
  const projectIds: string[] = [];
  const userIds: string[] = [];
  async function request(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${base}/api${path}`, {
      method, headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text };
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
    app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
    const { configureApplication } = await import('../dist/application.js');
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => {
    if (pool) {
      if (projectIds.length) await pool.query('DELETE FROM projects WHERE id = ANY($1::uuid[])', [projectIds]);
      if (userIds.length) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
      await pool.end();
    }
    if (app) await app.close();
  });
  it('reconnects existing username and PIN identities while preserving profiles and uniqueness', async () => {
    const name='사용자'+randomUUID().slice(0,8);
    const first=await request('/users','POST',{pin:'0012',username:'  '+name+'  '});if(first.data.id)userIds.push(first.data.id);
    expect(first.status).toBe(201);expect(first.data.username).toBe(name);
    const duplicate=await request('/users','POST',{pin:'0012',username:name});if(duplicate.data.id)userIds.push(duplicate.data.id);
    expect(duplicate.status).toBe(201);
    expect(duplicate.data).toEqual(first.data);
    const sameName=await request('/users','POST',{username:name,pin:'9876'});if(sameName.data.id)userIds.push(sameName.data.id);expect(sameName.status).toBe(201);
    expect(first.data.color).toBe('#4169e1');expect(first.data).not.toHaveProperty('pin');expect(first.data).not.toHaveProperty('pinHash');
    expect((await request('/users','POST',{username:name+'-missing'})).status).toBe(400);
    for(const pin of ['123','12345','abcd'])expect((await request('/users','POST',{username:name+'-invalid',pin})).status).toBe(400);
    const recolored=await request('/users/'+first.data.id,'PATCH',{color:'#12ABEF'});expect(recolored.status).toBe(200);expect(recolored.data.color).toBe('#12abef');
    expect((await request('/users/'+first.data.id,'PATCH',{color:'red'})).status).toBe(400);
    expect((await request('/users/'+first.data.id)).data.color).toBe('#12abef');
    const returning=await request('/users','POST',{username:'  '+name+'  ',pin:'0012'});
    expect(returning.status).toBe(201);
    expect(returning.data).toEqual(recolored.data);
    const other=await request('/users','POST',{pin:'0012',username:name+'-other'});if(other.data.id)userIds.push(other.data.id);
    expect((await request('/users/'+other.data.id,'PATCH',{username:name})).status).toBe(409);
    expect((await request('/users/'+other.data.id)).data.username).toBe(name+'-other');
    expect((await request('/users/'+first.data.id,'PATCH',{username:name})).status).toBe(200);
    const renamed=await request('/users/'+first.data.id,'PATCH',{username:name+'-new'});expect(renamed.data.username).toBe(name+'-new');expect(renamed.data.color).toBe('#12abef');
    const listed=await request('/users');expect(listed.data.every((u:Record<string,unknown>)=>!('pin' in u)&&!('pinHash' in u))).toBe(true);
    const raceName='동시'+randomUUID().slice(0,8);
    const raced=await Promise.all([request('/users','POST',{pin:'0012',username:raceName}),request('/users','POST',{pin:'0012',username:raceName})]);
    raced.forEach(value=>{if(value.data.id)userIds.push(value.data.id);});expect(raced.map(value=>value.status).sort()).toEqual([201,201]);
    expect(new Set(raced.map(value=>value.data.id)).size).toBe(1);
    expect((await request('/users','POST',{pin:'0012',username:' '})).status).toBe(400);
    expect((await request('/users/invalid')).status).toBe(400);
    expect((await request('/users/'+randomUUID())).status).toBe(404);
  });
  it('persists documents, atomically rejects stale writes, and protects archived projects', async () => {
    const name = `integration-${randomUUID()}_%`;
    const created = await request('/projects', 'POST', { name });
    if (created.data.id) projectIds.push(created.data.id);
    expect(created.status).toBe(201);
    expect(created.data.version).toBe(0);
    const id = created.data.id;
    const opened = await request(`/projects/${id}`);
    expect(opened.data.document).toEqual({ schemaVersion: 1, domains: [], domainRelations: [], notes: [], layout: { nodes: [], viewports: [{ viewId: 'overview', x: 0, y: 0, zoom: 1 }] } });
    const document = { ...opened.data.document, domains: [{ id: 'domain-one', name: '주문', description: '' }] };
    const writes = await Promise.all([
      request(`/projects/${id}/document`, 'PUT', { expectedVersion: 0, document }),
      request(`/projects/${id}/document`, 'PUT', { expectedVersion: 0, document }),
    ]);
    expect(writes.map(result => result.status).sort()).toEqual([200, 409]);
    expect((await request(`/projects/${id}`)).data.document).toEqual(document);
    expect((await request(`/projects?search=${encodeURIComponent(name)}`)).data.map((p: { id: string }) => p.id)).toEqual([id]);
    expect((await request(`/projects/${id}`, 'PATCH', { expectedVersion: 0, name: 'stale' })).status).toBe(409);
    const archived = await request(`/projects/${id}`, 'PATCH', { expectedVersion: 1, name: '보관 프로젝트', status: 'archived' });
    expect(archived.data.version).toBe(2);
    expect((await request(`/projects/${id}/document`, 'PUT', { expectedVersion: 2, document })).status).toBe(409);
    expect((await request('/projects?status=archived')).data.some((p: { id: string }) => p.id === id)).toBe(true);
    expect((await request('/projects?status=unknown')).status).toBe(400);
    expect((await request(`/projects/${id}/document`, 'PUT', { expectedVersion: 2, document: {} })).status).toBe(400);
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
      tables: [{ id: 't', domainId: 'd', scope: 'both', logical: { name: '상태', definition: '' }, physical: { name: 'state', schema: 'public', comment: '' }, customProperties: properties }],
      columns: [{ id: 'c', tableId: 't', scope: 'both', logical: { name: '상태', definition: '', semanticType: '', required: false }, physical: { name: 'status', type: { name: 'status', enumId: 'enum', isArray: false }, nullable: false, defaultExpression: null, comment: '' }, customProperties: properties }],
      tableRelations: [{ id: 'r', sourceTableId: 't', targetTableId: 't', scope: 'logical', logical: { name: 'state.status:state', cardinality: 'one-to-many', required: false, description: '설명', sourceCardinality: { min: 0, max: 'many' }, targetCardinality: { min: 1, max: 1 } }, physical: null }],
      layout: { ...opened.data.document.layout, relations: [{ relationId: 'r', viewId: 'd', offset: 0, bend: { x: -215.5, y: 345 } }] },
    };
    expect((await request('/projects/' + id + '/document', 'PUT', { expectedVersion: 0, document })).status).toBe(200);
    expect((await request('/projects/' + id)).data.document).toEqual(document);
    document.enums[0]!.name = 'workflow_status';
    expect((await request('/projects/' + id + '/document', 'PUT', { expectedVersion: 1, document })).status).toBe(200);
    expect((await request('/projects/' + id)).data.document.columns[0].physical.type.enumId).toBe('enum');
    expect((await request('/projects/' + id + '/document', 'PUT', { expectedVersion: 2, document: { ...document, enums: [{ ...document.enums[0], values: ['same', 'same'] }] } })).status).toBe(400);
    expect((await request('/projects/' + id)).data.document).toEqual(document);
  });

  it('deletes only version-matched archived projects and cascades pins without deleting people', async () => {
    const author = await request('/users','POST',{pin:'0012',username: 'delete fixture author' });
    const recipient = await request('/users','POST',{pin:'0012',username: 'delete fixture recipient' });
    userIds.push(author.data.id, recipient.data.id);
    const created = await request('/projects', 'POST', { name: 'delete fixture project' });
    const other = await request('/projects', 'POST', { name: 'retained fixture project' });
    projectIds.push(created.data.id, other.data.id);
    const id = created.data.id;
    const pin = await request('/projects/' + id + '/threads', 'POST', { authorId: author.data.id, viewId: 'overview', objectId: null, x: 15, y: 25, body: 'pin to cascade', mentionIds: [recipient.data.id] });
    expect(pin.status).toBe(201);
    expect((await request('/projects/' + id, 'DELETE', { expectedVersion: 0 })).status).toBe(409);
    expect((await request('/projects/' + id, 'DELETE', { expectedVersion: -1 })).status).toBe(400);
    expect((await request('/projects/' + id, 'PATCH', { expectedVersion: 0, status: 'archived' })).status).toBe(200);
    expect((await request('/projects/' + id, 'DELETE', { expectedVersion: 0 })).status).toBe(409);
    expect((await request('/projects/' + id)).status).toBe(200);
    const deleted = await request('/projects/' + id, 'DELETE', { expectedVersion: 1 });
    expect(deleted.status).toBe(200);
    expect(deleted.data).toEqual({ id, deleted: true });
    expect((await request('/projects/' + id)).status).toBe(404);
    expect((await request('/projects/' + id, 'DELETE', { expectedVersion: 1 })).status).toBe(404);
    expect((await request('/threads/' + pin.data.id + '/messages', 'POST', { authorId: author.data.id, body: 'gone', mentionIds: [] })).status).toBe(404);
    expect((await request('/users/' + recipient.data.id + '/notifications')).data).toEqual([]);
    expect((await request('/users/' + author.data.id)).status).toBe(200);
    expect((await request('/projects/' + other.data.id)).status).toBe(200);
    expect((await pool.query('SELECT count(*)::int AS count FROM review_messages WHERE thread_id=$1', [pin.data.id])).rows[0].count).toBe(0);
  });

  it('stores blank pins in combined views and retains their threads after view removal', async () => {
    const person = await request('/users','POST',{pin:'0012',username: 'combined pin author' }); userIds.push(person.data.id);
    const created = await request('/projects', 'POST', { name: 'combined pin fixture' }); const id = created.data.id; projectIds.push(id);
    const opened = await request('/projects/' + id);
    const document = { ...opened.data.document, domains: [{id:'d',name:'D',description:''}], views: [{id:'combined',name:'함께 보기',domainIds:['d']}] };
    expect((await request('/projects/' + id + '/document', 'PUT', {expectedVersion:0, document})).status).toBe(200);
    const pin = await request('/projects/' + id + '/threads', 'POST', {authorId:person.data.id,viewId:'combined',objectId:null,x:31,y:42,body:'combined pin',mentionIds:[]});
    expect(pin.status).toBe(201); expect(pin.data.x).toBe(31); expect(pin.data.objectId).toBe(null);
    expect((await request('/projects/' + id + '/document', 'PUT', {expectedVersion:1,document:{...document,views:[]}})).status).toBe(200);
    const list = await request('/projects/' + id + '/threads'); expect(list.data[0].messages[0].body).toBe('combined pin');
    expect((await request('/projects/' + id + '/threads', 'POST', {authorId:person.data.id,viewId:'combined',objectId:null,x:0,y:0,body:'missing view',mentionIds:[]})).status).toBe(400);
  });

  it('deletes a pin and replies atomically but rejects deletion after a new reply', async () => {
    const author=await request('/users','POST',{pin:'0012',username:'pin delete author'});userIds.push(author.data.id);
    const recipient=await request('/users','POST',{pin:'0012',username:'pin delete recipient'});userIds.push(recipient.data.id);
    const created=await request('/projects','POST',{name:'pin delete fixture'});const id=created.data.id;projectIds.push(id);
    const payload={authorId:author.data.id,viewId:'overview',objectId:null,x:10,y:20,body:'delete me',mentionIds:[recipient.data.id]};
    const first=await request('/projects/'+id+'/threads','POST',payload);
    const retained=await request('/projects/'+id+'/threads','POST',{...payload,body:'keep me'});
    const reply=await request('/threads/'+first.data.id+'/messages','POST',{authorId:author.data.id,body:'new reply',mentionIds:[]});
    expect(reply.status).toBe(201);
    expect((await request('/threads/'+first.data.id,'DELETE',{expectedUpdatedAt:first.data.updatedAt})).status).toBe(409);
    expect((await request('/threads/'+first.data.id,'DELETE',{})).status).toBe(400);
    const removed=await request('/threads/'+first.data.id,'DELETE',{expectedUpdatedAt:reply.data.updatedAt});
    expect(removed.status).toBe(200);expect(removed.data).toEqual({id:first.data.id,deleted:true});
    const pins=await request('/projects/'+id+'/threads');expect(pins.data.map((p:{id:string})=>p.id)).toEqual([retained.data.id]);
    const alerts=await request('/users/'+recipient.data.id+'/notifications');expect(alerts.data.map((n:{threadId:string})=>n.threadId)).toEqual([retained.data.id]);
    expect((await pool.query('SELECT count(*)::int AS count FROM review_messages WHERE thread_id=$1',[first.data.id])).rows[0].count).toBe(0);
    expect((await request('/users/'+author.data.id)).status).toBe(200);
    expect((await request('/threads/'+first.data.id,'DELETE',{expectedUpdatedAt:reply.data.updatedAt})).status).toBe(404);
  });

  it('accepts documents over 100 KB and rejects malformed edits without changing data', async () => {
    const created = await request('/projects', 'POST', { name: 'integration large document' });
    if (created.data.id) projectIds.push(created.data.id);
    expect(created.status).toBe(201);
    const id = created.data.id;
    const opened = await request(`/projects/${id}`);
    const document = { ...opened.data.document, notes: Array.from({ length: 20 }, (_, index) => ({ id: `note-${index}`, viewId: 'overview', text: 'x'.repeat(10000) })) };
    expect((await request(`/projects/${id}/document`, 'PUT', { expectedVersion: 0, document })).status).toBe(200);
    expect((await request(`/projects/${id}`)).data.document).toEqual(document);
    expect((await request(`/projects/${id}`, 'PATCH', { expectedVersion: 1 })).status).toBe(400);
    expect((await request(`/projects/${id}`, 'PATCH', { expectedVersion: -1, name: 'invalid' })).status).toBe(400);
    expect((await request(`/projects/${id}`, 'PATCH', { expectedVersion: 1, name: ' ' })).status).toBe(400);
    expect((await request(`/projects/${id}/document`, 'PUT', { expectedVersion: 1, document: { ...document, schemaVersion: 2 } })).status).toBe(400);
    expect((await request(`/projects/${id}`)).data.project.version).toBe(1);
    expect((await request('/projects/not-a-uuid')).status).toBe(400);
    expect((await request(`/projects/${randomUUID()}/document`, 'PUT', { expectedVersion: 0, document })).status).toBe(404);
    expect((await request('/health')).status).toBe(200);
    expect((await request('/health/ready')).status).toBe(200);
  });

  it('does not expose database error details', async () => {
    const { WorkspaceController } = await import('../dist/workspace.controller.js');
    const brokenDatabase = { db: { insert: () => { throw new Error('postgresql://user:secret@private-host/database'); } } };
    const controller = new WorkspaceController(brokenDatabase as never);
    try {
      await controller.createUser({ username: 'test', pin: '0012' });
      throw new Error('Expected a storage failure');
    } catch (error) {
      const failure = error as { getStatus(): number; getResponse(): unknown };
      expect(failure.getStatus()).toBe(503);
      expect(JSON.stringify(failure.getResponse())).not.toContain('secret');
      expect(JSON.stringify(failure.getResponse())).not.toContain('private-host');
    }
  });

  it('rejects multibyte documents above 1.5 MB and raw bodies above 2 MB without replacing saved data', async () => {
    const created = await request('/projects', 'POST', { name: 'integration UTF-8 limits' });
    if (created.data.id) projectIds.push(created.data.id);
    expect(created.status).toBe(201);
    const id = created.data.id;
    const opened = await request(`/projects/${id}`);
    const savedDocument = { ...opened.data.document, domains: [{ id: 'keep-domain', name: '보존할 도메인', description: '저장된 내용' }] };
    const saved = await request(`/projects/${id}/document`, 'PUT', { expectedVersion: 0, document: savedDocument });
    expect(saved.status).toBe(200);

    // All individual fields and collections are valid; only total UTF-8 bytes exceed the cap.
    const multibyteDocument = { ...savedDocument, notes: Array.from({ length: 30 }, (_, index) => ({ id: `large-note-${index}`, viewId: 'overview', text: '한'.repeat(20000) })) };
    const canonical = JSON.stringify(multibyteDocument);
    expect(canonical.length).toBeLessThan(1_500_000);
    expect(Buffer.byteLength(canonical, 'utf8')).toBeGreaterThan(1_500_000);
    expect(Buffer.byteLength(JSON.stringify({ expectedVersion: 1, document: multibyteDocument }), 'utf8')).toBeLessThan(2 * 1024 * 1024);
    expect((await request(`/projects/${id}/document`, 'PUT', { expectedVersion: 1, document: multibyteDocument })).status).toBe(400);
    expect((await request(`/projects/${id}`)).data).toEqual(saved.data);

    const oversizedDocument = { ...savedDocument, notes: Array.from({ length: 40 }, (_, index) => ({ id: `oversized-note-${index}`, viewId: 'overview', text: '한'.repeat(20000) })) };
    const rawBody = JSON.stringify({ expectedVersion: 1, document: oversizedDocument });
    expect(Buffer.byteLength(rawBody, 'utf8')).toBeGreaterThan(2 * 1024 * 1024);
    const oversizedResponse = await fetch(`${base}/api/projects/${id}/document`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: rawBody,
    });
    await oversizedResponse.text();
    expect(oversizedResponse.status).toBe(413);
    expect((await request(`/projects/${id}`)).data).toEqual(saved.data);
  });

  it('reopens a complete domain map with a directional relation, internal note and per-view layouts unchanged', async () => {
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
        { id: 'orders-to-payments', sourceDomainId: 'orders', targetDomainId: 'payments', name: '결제 요청', direction: 'forward', description: '접수된 주문의 결제를 요청한다.' },
      ],
      notes: [{ id: 'order-note', viewId: 'orders', text: '주문 상태 전이를 검토하세요.\n취소와 환불을 구분합니다.' }],
      layout: {
        nodes: [
          { id: 'node-orders', objectId: 'orders', viewId: 'overview', x: -160.5, y: 80, width: 240, height: 140 },
          { id: 'node-payments', objectId: 'payments', viewId: 'overview', x: 320, y: 120.25, width: 260, height: 150 },
          { id: 'node-order-note', objectId: 'order-note', viewId: 'orders', x: 48.5, y: -32, width: 280, height: 180 },
        ],
        viewports: [
          { viewId: 'overview', x: 125.5, y: -44, zoom: 0.8 },
          { viewId: 'orders', x: -72.25, y: 96, zoom: 1.4 },
          { viewId: 'payments', x: 0, y: 0, zoom: 1 },
        ],
      },
    };
    const saved = await request(`/projects/${id}/document`, 'PUT', { expectedVersion: 0, document });
    expect(saved.status).toBe(200);
    expect(saved.data.project.version).toBe(1);
    expect(saved.data.document).toEqual(document);
    const reopened = await request(`/projects/${id}`);
    expect(reopened.status).toBe(200);
    expect(reopened.data).toEqual(saved.data);
    expect(reopened.data.document).toEqual(document);
  });
  it('keeps review threads independent from design saves and atomically validates mentions', async () => {
    const author = (await request('/users','POST',{pin:'0012',username: 'review author' })).data;
    const mentioned = (await request('/users','POST',{pin:'0012',username: 'review teammate' })).data;
    userIds.push(author.id, mentioned.id);
    const project = (await request('/projects', 'POST', { name: 'review integration' })).data;
    projectIds.push(project.id);
    const original = (await request(`/projects/${project.id}`)).data.document;
    const document = { ...original, domains: [{ id: 'orders', name: 'Orders', description: '' }], layout: { ...original.layout, nodes: [{ id: 'node-orders', objectId: 'orders', viewId: 'overview', x: 10, y: 20, width: 240, height: 160 }] } };
    expect((await request(`/projects/${project.id}/document`, 'PUT', { expectedVersion: 0, document })).status).toBe(200);
    const input = { authorId: author.id, viewId: 'overview', objectId: 'orders', x: 12, y: 16, body: 'Please review', mentionIds: [mentioned.id, mentioned.id, author.id] };
    const created = await request(`/projects/${project.id}/threads`, 'POST', input);
    expect(created.status).toBe(201);
    const thread = created.data;
    expect(thread.messages[0].mentionIds).toEqual([mentioned.id, author.id]);
    const alerts = (await request(`/users/${mentioned.id}/notifications`)).data;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ projectId: project.id, threadId: thread.id, read: false });
    expect((await request(`/users/${author.id}/notifications`)).data).toEqual([]);
    expect((await request(`/notifications/${alerts[0].id}`, 'PATCH', { read: true })).data.read).toBe(true);
    expect((await request(`/projects/${project.id}/threads`, 'POST', { ...input, mentionIds: [randomUUID()] })).status).toBe(400);
    expect((await request(`/projects/${project.id}/threads`, 'POST', { ...input, authorId: randomUUID() })).status).toBe(400);
    expect((await request(`/projects/${project.id}/threads`, 'POST', { ...input, viewId: 'missing' })).status).toBe(400);
    expect((await request(`/projects/${project.id}/threads`, 'POST', { ...input, objectId: 'missing' })).status).toBe(400);
    expect((await request(`/threads/${thread.id}/messages`, 'POST', { authorId: author.id, body: 'Invalid', mentionIds: [randomUUID()] })).status).toBe(400);
    expect((await request(`/projects/${project.id}/threads`)).data).toHaveLength(1);
    expect((await request(`/projects/${project.id}/document`, 'PUT', { expectedVersion: 1, document: original })).status).toBe(200);
    const reply = await request(`/threads/${thread.id}/messages`, 'POST', { authorId: mentioned.id, body: 'Reply after target deletion', mentionIds: [author.id] });
    expect(reply.status).toBe(201);
    expect(reply.data.messages).toHaveLength(2);
    expect(reply.data.objectId).toBe('orders');
    expect((await request(`/threads/${thread.id}`, 'PATCH', { resolved: true })).data.resolved).toBe(true);
    expect((await request(`/threads/${thread.id}`, 'PATCH', { resolved: false })).data.resolved).toBe(false);
    expect((await request(`/projects/${project.id}/threads`)).data[0].messages).toHaveLength(2);
    expect((await request(`/users/${author.id}/notifications`)).data).toHaveLength(1);
    expect((await request(`/threads/${randomUUID()}`, 'PATCH', { resolved: true })).status).toBe(404);
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








