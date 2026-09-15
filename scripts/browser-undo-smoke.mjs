import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { createEmptyDocument, addDomain } from '../packages/model/dist/index.js';
const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { readConfig } = await import('../apps/server/dist/config.js');
const config = readConfig();
assert(['localhost', '127.0.0.1'].includes(new URL(config.DATABASE_URL).hostname));
const pool = new (require('pg').Pool)({ connectionString: config.DATABASE_URL });
const base = process.env.EZERD_WEB_URL || 'http://127.0.0.1:5173';
const apiBase = process.env.EZERD_API_URL || 'http://127.0.0.1:3001';
async function api(path, method = 'GET', body) {
  const response = await fetch(apiBase + '/api' + path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}
async function ready() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await api('/projects');
      return;
    } catch (error) {
      if (attempt === 39) throw error;
      await delay(500);
    }
  }
}

let seed = addDomain(
  createEmptyDocument(),
  { id: 'alpha', name: 'Alpha', description: '' },
  { x: 100, y: 100 },
);
const browser = await chromium.launch({
  channel: process.env.EZERD_BROWSER_CHANNEL || 'chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let projectId, userId;
const stamp = Date.now(),
  name = `실행 취소 QA ${stamp}`;
const button = (label) => page.getByRole('button', { name: label, exact: true });
async function countNodes(expected) {
  await page.waitForFunction(
    (n) => document.querySelectorAll('.domain-node').length === n,
    expected,
  );
}
async function save() {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/document') && r.request().method() === 'PUT',
  );
  await button('저장').click();
  assert.equal((await response).status(), 200);
  await page.getByText('✓ 저장 완료', { exact: true }).waitFor();
  return api(`/projects/${projectId}`);
}
async function openProject() {
  await page.getByRole('textbox', { name: '프로젝트 검색', exact: true }).fill(name);
  await button(name).click();
  await page.locator('.domain-node').first().waitFor();
}
try {
  await mkdir('.cache/verification', { recursive: true });
  await ready();
  const project = await api('/projects', 'POST', { name });
  projectId = project.id;
  await api(`/projects/${projectId}/document`, 'PUT', {
    expectedVersion: project.version,
    document: seed,
  });
  await page.goto(base);
  await page.getByRole('textbox', { name: /^함께 사용할 이름/ }).fill(`취소검증${stamp}`);
  const identity = page.waitForResponse(
    (r) => r.url().endsWith('/api/users') && r.request().method() === 'POST',
  );
  await button('워크스페이스 시작하기 →').click();
  userId = (await (await identity).json()).id;
  await openProject();
  assert(await button('실행 취소').isDisabled());
  await button('＋ 도메인').click();
  await countNodes(2);
  await page.keyboard.press('Control+z');
  await countNodes(1);
  await page.keyboard.press('Control+Shift+z');
  await countNodes(2);
  await button('실행 취소').click();
  await countNodes(1);
  await page.keyboard.press('Control+y');
  await countNodes(2);
  await save();
  // Save is a boundary, but never clears editing history.
  await button('실행 취소').click();
  await countNodes(1);
  await page.getByText('● 저장하지 않은 변경', { exact: true }).waitFor();
  await button('다시 실행').click();
  await countNodes(2);
  // A delayed acknowledgement must not overwrite a subsequent undo.
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let seen;
  const intercepted = new Promise((resolve) => {
    seen = resolve;
  });
  await page.route('**/api/projects/*/document', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch();
    seen();
    await held;
    await route.fulfill({ response });
  });
  await button('저장').click();
  await intercepted;
  await button('실행 취소').click();
  await countNodes(1);
  release();
  await page.getByText('● 저장하지 않은 변경', { exact: true }).waitFor();
  await countNodes(1);
  await page.unroute('**/api/projects/*/document');
  await save();
  // Continuous pointer movement is one undoable change.
  const node = page.locator('.domain-node').first();
  const before = await node.boundingBox();
  await page.mouse.move(before.x + 100, before.y + 35);
  await page.mouse.down();
  await page.mouse.move(before.x + 220, before.y + 105, { steps: 12 });
  await page.mouse.up();
  const moved = await node.boundingBox();
  assert(moved.x > before.x + 90);
  await button('실행 취소').click();
  const restored = await node.boundingBox();
  assert(Math.abs(restored.x - before.x) < 1 && Math.abs(restored.y - before.y) < 1);
  await button('다시 실행').click();
  const dragged = await save();
  assert.notEqual(dragged.document.layout.nodes[0].x, seed.layout.nodes[0].x);
  // Text fields keep native undo; focus leaving commits a grouped document edit.
  await node.click({ position: { x: 100, y: 35 } });
  const input = page.getByRole('textbox', { name: '도메인 이름', exact: true });
  await input.fill('Alpha');
  await input.press('End');
  await input.pressSequentially(' updated');
  await input.press('Control+z');
  assert.equal(await input.inputValue(), 'Alpha');
  assert.equal(await page.locator('.domain-node').count(), 1);
  await input.fill('Alpha renamed');
  await input.press('Tab');
  await button('실행 취소').click();
  assert.equal(await input.inputValue(), 'Alpha');
  await button('다시 실행').click();
  assert.equal(await input.inputValue(), 'Alpha renamed');
  const persisted = await save();
  await page.reload();
  await openProject();
  assert(await button('실행 취소').isDisabled());
  assert(await button('다시 실행').isDisabled());
  assert.deepEqual((await api(`/projects/${projectId}`)).document, persisted.document);
  await page.screenshot({ path: '.cache/verification/undo-desktop.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: create undo/redo shortcuts, save history, delayed save versus undo, grouped pointer drag, native text input undo isolation, grouped text undo/redo, persisted reload and history reset.',
  );
} catch (error) {
  console.log('PAGE ERRORS', errors);
  console.log(await page.locator('body').innerText());
  await page.screenshot({ path: '.cache/verification/undo-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
  if (projectId) await pool.query('DELETE FROM projects WHERE id=$1', [projectId]);
  if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  await pool.end();
}
