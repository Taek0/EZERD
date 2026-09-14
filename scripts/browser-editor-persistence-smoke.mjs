import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { createEmptyDocument, addDomain, addTable, addColumn, addTableReference, upsertEnum, upsertTableRelation, upsertKey } from '../packages/model/dist/index.js';
const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { readConfig } = await import('../apps/server/dist/config.js');
const config = readConfig();
assert(['localhost', '127.0.0.1'].includes(new URL(config.DATABASE_URL).hostname));
const pool = new (require('pg').Pool)({ connectionString: config.DATABASE_URL });
const base = process.env.EZERD_WEB_URL || 'http://127.0.0.1:5173';
const apiBase = process.env.EZERD_API_URL || 'http://127.0.0.1:3001';
async function api(path, method = 'GET', body) {
  const response = await fetch(apiBase + '/api' + path, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}
async function ready() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await api('/projects'); return; } catch (error) { if (attempt === 39) throw error; await delay(500); }
  }
}
const meta = () => ({ common: {}, logical: {}, physical: {} });
let seed = createEmptyDocument();
seed = addDomain(seed, { id: 'alpha', name: 'Alpha', description: '' }, { x: 40, y: 40 });
seed = addDomain(seed, { id: 'beta', name: 'Beta', description: '' }, { x: 440, y: 40 });
seed = upsertEnum(seed, { id: 'status-enum', schema: 'public', name: 'order_status', values: ['draft', 'ready'] });
for (const [id, domainId, logical, physical] of [['orders', 'alpha', '주문', 'orders'], ['customers', 'beta', '고객', 'customers']]) {
  seed = addTable(seed, { id, domainId, scope: 'both', logical: { name: logical, definition: '' }, physical: { name: physical, schema: 'public', comment: '' }, customProperties: meta() }, { x: 40, y: 70 });
  seed = addColumn(seed, { id: `${id}-id`, tableId: id, scope: 'both', logical: { name: '식별자', definition: '', semanticType: '', required: true }, physical: { name: 'id', type: { name: 'integer', isArray: false }, nullable: false, defaultExpression: null, comment: '' }, customProperties: meta() });
  seed = upsertKey(seed, { id: `${id}-pk`, tableId: id, scope: 'both', kind: 'primary', name: `${id}_pk`, columnIds: [`${id}-id`] });
}
seed = addColumn(seed, { id: 'status', tableId: 'orders', scope: 'both', logical: { name: '상태', definition: '', semanticType: '', required: true }, physical: { name: 'status', type: { name: 'order_status', enumId: 'status-enum', isArray: false }, nullable: false, defaultExpression: "'draft'", comment: '주문 상태' }, customProperties: meta() });
seed = addTableReference(seed, 'customers', 'alpha', { x: 580, y: 400 });
seed = upsertTableRelation(seed, { id: 'order-customer', sourceTableId: 'orders', targetTableId: 'customers', scope: 'both', logical: { name: '고객별 주문', cardinality: 'one-to-many', required: true, description: '지속성 확인', sourceCardinality: { min: 0, max: 'many' }, targetCardinality: { min: 1, max: 1 } }, physical: { name: 'orders_customer_fk', sourceColumnIds: ['orders-id'], targetColumnIds: ['customers-id'], onDelete: 'NO ACTION', onUpdate: 'NO ACTION' } });
seed.layout.nodes = seed.layout.nodes.map(n => n.objectId === 'orders' || n.objectId === 'customers' ? { ...n, width: 480, height: 270 } : n);
const browser = await chromium.launch({ channel: process.env.EZERD_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let projectId, userId;
const stamp = Date.now(), name = `편집 통합 QA ${stamp}`;
const button = label => page.getByRole('button', { name: label, exact: true });
async function save() {
  const pending = page.waitForResponse(r => r.url().endsWith('/document') && r.request().method() === 'PUT');
  pending.catch(() => {});
  await button('저장').click();
  const response = await pending;
  assert.equal(response.status(), 200);
  await page.getByText('✓ 저장 완료', { exact: true }).waitFor();
  return response.json();
}
async function openProject() {
  await page.getByRole('textbox', { name: '프로젝트 검색', exact: true }).fill(name);
  await button(name).click();
  await button('Alpha 도메인 열기').click();
}
try {
  await mkdir('.cache/verification', { recursive: true });
  await ready();
  const project = await api('/projects', 'POST', { name }); projectId = project.id;
  await api(`/projects/${projectId}/document`, 'PUT', { expectedVersion: project.version, document: seed });
  await page.goto(base);
  await page.getByRole('textbox', { name: /^함께 사용할 이름/ }).fill(`편집검증${stamp}`);
  const identity = page.waitForResponse(r => r.url().endsWith('/api/users') && r.request().method() === 'POST'); identity.catch(() => {});
  await button('워크스페이스 시작하기 →').click(); userId = (await (await identity).json()).id;
  await openProject();
  const orders = page.getByRole('group', { name: '주문', exact: true });
  await orders.locator('.table-inline[title^="물리 테이블명:"]').dblclick();
  await orders.getByRole('textbox', { name: '물리 테이블명', exact: true }).fill('orders_updated');
  await page.keyboard.press('Enter');
  await orders.locator('.table-inline[title^="컬럼 주석: 주문 상태"]').dblclick();
  await orders.getByRole('textbox', { name: '컬럼 주석', exact: true }).fill('저장 후에도 유지되는 상태');
  await page.keyboard.press('Tab');
  const inline = await save();
  assert.equal(inline.document.tables.find(t => t.id === 'orders').physical.name, 'orders_updated');
  assert.equal(inline.document.columns.find(c => c.id === 'status').physical.comment, '저장 후에도 유지되는 상태');
  assert.equal(inline.document.columns.find(c => c.id === 'status').physical.type.enumId, 'status-enum');
  assert.deepEqual(inline.document.tableRelations[0].logical, seed.tableRelations[0].logical);
  const canvas = page.getByLabel('Alpha 내부 캔버스', { exact: true });
  await canvas.click({ position: { x: 12, y: 12 }, button: 'right' });
  await page.getByRole('menuitem', { name: '자동 배치', exact: true }).click();
  const arranged = await save();
  assert.notDeepEqual(arranged.document.layout.nodes.filter(n => n.viewId === 'alpha'), inline.document.layout.nodes.filter(n => n.viewId === 'alpha'));
  assert.deepEqual(arranged.document.layout.nodes.filter(n => n.viewId !== 'alpha'), inline.document.layout.nodes.filter(n => n.viewId !== 'alpha'));
  assert.equal(arranged.document.tables.find(t => t.id === 'customers').domainId, 'beta');
  assert.deepEqual(arranged.document.enums, seed.enums);
  await page.reload(); await openProject();
  await orders.locator('.table-inline[title^="물리 테이블명: orders_updated"]').waitFor();
  await orders.locator('.table-inline[title^="컬럼 주석: 저장 후에도 유지되는 상태"]').waitFor();
  const persisted = await api(`/projects/${projectId}`);
  assert.deepEqual(persisted.document, arranged.document);
  await page.screenshot({ path: '.cache/verification/editor-persistence-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.cache/verification/editor-persistence-mobile.png', fullPage: true });
  const mobile = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }));
  assert(mobile.documentWidth <= mobile.width && mobile.bodyWidth <= mobile.width, `mobile page overflow: ${JSON.stringify(mobile)}`);
  assert.deepEqual(errors, []);
  console.log('PASS: actual app identity/project, inline Enter/Tab save, ENUM/endpoints persistence, current-view-only external-reference auto layout, browser reload, 390px page overflow.');
} catch (error) {
  console.log('PAGE ERRORS', errors);
  console.log(await page.locator('body').innerText());
  await page.screenshot({ path: '.cache/verification/editor-persistence-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
  if (projectId) await pool.query('DELETE FROM projects WHERE id=$1', [projectId]);
  if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  await pool.end();
}
