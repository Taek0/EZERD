import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import {
  createEmptyDocument,
  addDomain,
  upsertDomainRelation,
} from '../packages/model/dist/index.js';
import { readConfig } from '../apps/server/dist/config.js';

const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const pg = require('pg');
const config = readConfig();
assert(['127.0.0.1', 'localhost'].includes(new URL(config.DATABASE_URL).hostname));
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const baseUrl = process.env.EZERD_WEB_URL || 'http://127.0.0.1:3001';
const api = async (path, method = 'GET', data) => {
  const response = await fetch('http://127.0.0.1:3001/api' + path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  assert(response.ok, `${method} ${path}: ${response.status}`);
  return response.json();
};
let projectId, userId;
const projectName = `패널 검증 ${Date.now()}`;
const button = (name) => page.getByRole('button', { name, exact: true });
const panel = page.locator('#canvas-inspector');
const settle = () =>
  page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'),
  );
const width = async () => (await panel.boundingBox()).width;
async function dragSeparator(delta) {
  const separator = page.getByRole('separator', { name: /속성 패널/ });
  const box = await separator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(160, box.height / 2));
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + Math.min(160, box.height / 2), {
    steps: 8,
  });
  await page.mouse.up();
  await settle();
}
try {
  await mkdir('.cache/verification', { recursive: true });
  const user = await api('/users', 'POST', { username: '패널 UI 검증' });
  userId = user.id;
  const created = await api('/projects', 'POST', { name: projectName });
  projectId = created.id;
  let document = addDomain(
    addDomain(
      createEmptyDocument(),
      {
        id: 'orders',
        name: '주문',
        description: '주문과 결제의 흐름을 설계합니다.',
        color: '#d98350',
      },
      { x: 80, y: 100 },
    ),
    { id: 'payments', name: '결제', description: '결제 승인과 정산', color: '#698aae' },
    { x: 470, y: 100 },
  );
  document = upsertDomainRelation(document, {
    id: 'r',
    sourceDomainId: 'orders',
    targetDomainId: 'payments',
    name: '결제 요청',
    direction: 'forward',
    description: '',
  });
  const snapshot = await api(`/projects/${projectId}/document`, 'PUT', {
    expectedVersion: 0,
    document,
  });
  await context.addInitScript((id) => {
    localStorage.setItem('ezerd.userId', id);
  }, userId);
  await page.goto(baseUrl);
  await page.getByRole('button', { name: new RegExp(projectName) }).waitFor();
  await page.screenshot({ path: '.cache/verification/compact-gallery.png', fullPage: true });
  await page.getByRole('button', { name: new RegExp(projectName) }).click();
  await button('도메인 관계').waitFor();
  await settle();
  assert.equal(
    (await button('속성 패널 숨기기').innerText()).trim(),
    '',
    'panel toggle should be icon only',
  );
  assert.equal(await button('속성 패널 숨기기').locator('svg').count(), 1);
  const initialWidth = await width();
  await dragSeparator(-100);
  assert((await width()) > initialWidth + 60, 'drag left should widen right sidebar');
  const resizedWidth = await width();
  await button('속성 패널 숨기기').click();
  await settle();
  assert.equal(
    await page.getByRole('combobox', { name: '출발 도메인', exact: true }).count(),
    0,
    'hidden panel fields should leave accessibility tree',
  );
  await button('속성 패널 열기').click();
  await settle();
  assert(Math.abs((await width()) - resizedWidth) < 2, 'show restores resized width');
  await button('도메인 관계').click();
  assert.equal(await button('도메인 관계').getAttribute('aria-expanded'), 'false');
  await settle();
  assert.equal(await page.getByRole('combobox', { name: '출발 도메인', exact: true }).count(), 0);
  await button('도메인 관계').press('Enter');
  await settle();
  await page.getByRole('textbox', { name: '관계 이름', exact: true }).fill('임시 입력 유지');
  await button('도메인 관계').click();
  await button('도메인 관계').click();
  assert.equal(
    await page.getByRole('textbox', { name: '관계 이름', exact: true }).inputValue(),
    '임시 입력 유지',
  );
  const separator = page.getByRole('separator', { name: /속성 패널/ });
  await separator.focus();
  const beforeKey = await width();
  await separator.press('ArrowLeft');
  await settle();
  assert((await width()) > beforeKey, 'keyboard left grows sidebar');
  await separator.press('Home');
  await settle();
  assert((await width()) >= 279 && (await width()) <= 321);
  await separator.press('End');
  await settle();
  assert((await width()) <= 521);
  await dragSeparator(110);
  const remembered = await width();
  await page.getByText('✓ 저장 완료', { exact: true }).waitFor();
  assert.equal(await button('저장').isDisabled(), true, 'panel preferences must not dirty design');
  assert.deepEqual(await api(`/projects/${projectId}`), snapshot);
  await page.screenshot({ path: '.cache/verification/compact-sidebar.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: new RegExp(projectName) }).click();
  await button('도메인 관계').waitFor();
  await settle();
  assert(Math.abs((await width()) - remembered) < 2, 'width remembered after reload');
  await button('도메인 관계').click();
  await page.getByRole('group', { name: '주문', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '→ 결제', exact: true }).click();
  assert.equal(await button('도메인 관계').getAttribute('aria-expanded'), 'true');
  assert.equal(
    await page.getByRole('combobox', { name: '출발 도메인', exact: true }).inputValue(),
    'orders',
  );
  assert.equal(
    await page.getByRole('combobox', { name: '도착 도메인', exact: true }).inputValue(),
    'payments',
  );
  await button('검토 대화').click();
  await settle();
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'comments plus sidebar overflow',
  );
  await dragSeparator(-150);
  const canvasBox = await page.locator('.canvas-column').boundingBox();
  assert(canvasBox.width >= 300, 'resizing must preserve usable canvas beside comments');
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  assert.equal(
    await page.getByRole('separator', { name: /속성 패널/ }).count(),
    0,
    'mobile has no horizontal drag handle',
  );
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'mobile editor overflow',
  );
  await button('검토 대화 닫기').click();
  await page.screenshot({ path: '.cache/verification/compact-sidebar-mobile.png', fullPage: true });
  await button('← 갤러리').click();
  await page.screenshot({ path: '.cache/verification/compact-gallery-mobile.png', fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: new RegExp(projectName) }).click();
  await button('도메인 관계').waitFor();
  await button('속성 패널 숨기기').click();
  assert.equal(await page.getByRole('combobox', { name: '출발 도메인', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: icon toggle, animated disclosure, pointer/keyboard resize, width persistence, unchanged design, context menu reveal, comments/mobile layouts and reduced motion.',
  );
} catch (error) {
  console.log('PAGE ERRORS', errors);
  console.log(await page.locator('body').innerText());
  await page.screenshot({
    path: '.cache/verification/compact-sidebar-failure.png',
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  if (projectId) await pool.query('DELETE FROM projects WHERE id=$1', [projectId]);
  if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  await pool.end();
}
