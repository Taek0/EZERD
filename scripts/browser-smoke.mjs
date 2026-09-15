// Keep the response promise observed while a UI action is awaiting, so cleanup still runs on timeout.
function responseWait(target, predicate) {
  const pending = target.waitForResponse(predicate);
  pending.catch(() => {});
  return pending;
}
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
// Supply an existing Playwright module when it is not installed in the workspace.
const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const pg = require('pg');
const { readConfig } = await import('../apps/server/dist/config.js');
const config = readConfig();
const dbUrl = new URL(config.DATABASE_URL);
assert(
  ['127.0.0.1', 'localhost'].includes(dbUrl.hostname) &&
    dbUrl.port === '55432' &&
    dbUrl.pathname === '/ezerd',
);
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const browser = await chromium.launch({
  channel: process.env.EZERD_BROWSER_CHANNEL || 'chrome',
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let projectId, userId;
const username = `검증${Date.now()}`;
const projectName = `브라우저 검증 ${Date.now()}`;
const api = async (path, method = 'GET', data) => {
  const response = await fetch(`http://127.0.0.1:3001/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  assert(response.ok, `${method} ${path} ${response.status}`);
  return response.json();
};
const click = (name) => page.getByRole('button', { name, exact: true }).click();
const fill = (name, value) =>
  page
    .getByRole(['X', 'Y', '너비', '높이'].includes(name) ? 'spinbutton' : 'textbox', {
      name: new RegExp('^' + name),
    })
    .fill(value);
const save = async () => {
  const response = responseWait(
    page,
    (r) => r.url().endsWith('/document') && r.request().method() === 'PUT',
  );
  await click('저장');
  const result = await response;
  assert.equal(result.status(), 200);
  return result.json();
};
try {
  await mkdir('.cache/verification', { recursive: true });
  await page.goto('http://127.0.0.1:5173');
  await fill('함께 사용할 이름', username);
  const userResponse = responseWait(
    page,
    (r) => r.url().endsWith('/api/users') && r.request().method() === 'POST',
  );
  await click('워크스페이스 시작하기 →');
  userId = (await (await userResponse).json()).id;
  await fill('새 프로젝트 이름', projectName);
  const createResponse = responseWait(
    page,
    (r) => r.url().endsWith('/api/projects') && r.request().method() === 'POST',
  );
  await click('프로젝트 만들기');
  projectId = (await (await createResponse).json()).id;
  await click('＋ 도메인');
  await fill('도메인 이름', '주문');
  await fill('너비', '10001');
  assert.equal(
    await page.getByRole('spinbutton', { name: '너비', exact: true }).inputValue(),
    '10000',
  );
  await fill('너비', '240');
  await fill('업무 설명', '주문 업무');
  await fill('X', '80');
  await fill('Y', '100');
  await click('＋ 도메인');
  await fill('도메인 이름', '결제');
  await fill('X', '480');
  await fill('Y', '100');
  await click('선택 해제');
  await page.getByLabel('출발 도메인', { exact: true }).selectOption({ label: '주문' });
  await page.getByLabel('도착 도메인', { exact: true }).selectOption({ label: '결제' });
  await fill('관계 이름', '결제 요청');
  await click('관계 연결');
  await click('T 텍스트');
  await fill('자유 텍스트', '주문에서 결제로 전달합니다.');
  await fill('X', '100');
  await fill('Y', '360');
  await fill('너비', '320');
  await page
    .getByLabel('도메인 맵 캔버스', { exact: true })
    .hover({ position: { x: 850, y: 450 } });
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await page
    .getByRole('button', { name: '배율 100%로 초기화', exact: true })
    .filter({ hasText: '110%' })
    .waitFor();
  await click('배율 100%로 초기화');
  await click('주문 도메인 열기');
  await click('T 텍스트');
  await fill('자유 텍스트', '주문 내부 메모');
  await click('확대');
  await click('도메인 맵');
  const saved = await save();
  assert.equal(saved.document.domains.length, 2);
  assert.equal(saved.document.domainRelations.length, 1);
  assert.equal(saved.document.notes.length, 2);
  assert.equal(saved.project.version, 1);
  await page.screenshot({ path: '.cache/verification/domain-map.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: new RegExp(username) }).waitFor();
  await page.getByRole('button', { name: new RegExp(projectName) }).click();
  await page.getByRole('group', { name: '주문', exact: true }).waitFor();
  await click('주문 도메인 열기');
  await page.getByText('주문 내부 메모', { exact: true }).waitFor();
  await click('도메인 맵');
  // Delay acknowledgement, edit while saving, and ensure the subsequent save persists that edit.
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(
    '**/api/projects/*/document',
    async (route) => {
      await gate;
      await route.continue();
    },
    { times: 1 },
  );
  await page
    .getByRole('group', { name: '주문', exact: true })
    .click({ position: { x: 50, y: 25 } });
  await fill('도메인 이름', '주문 수정1');
  await click('저장');
  await fill('도메인 이름', '주문 수정2');
  release();
  await page.getByRole('button', { name: '저장', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() =>
    document.querySelector('.save-state')?.textContent?.includes('저장하지 않은 변경'),
  );
  const saved2 = await save();
  assert(saved2.document.domains.some((d) => d.name === '주문 수정2'));
  // Simulate an old browser saving after another client's update.
  const latest = await api(`/projects/${projectId}`);
  await api(`/projects/${projectId}/document`, 'PUT', {
    expectedVersion: latest.project.version,
    document: latest.document,
  });
  await fill('도메인 이름', '충돌한 내 변경');
  await click('저장');
  await page.getByText('! 저장 충돌', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('도메인 이름', { exact: true }).inputValue(),
    '충돌한 내 변경',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await click('최신 내용 다시 열기');
  await page.getByText('✓ 저장 완료', { exact: true }).waitFor();
  // Reopening a conflict must recover when the active domain was deleted remotely.
  await click('주문 수정2 도메인 열기');
  const beforeDelete = await api(`/projects/${projectId}`);
  const { removeDomain } = await import('../packages/model/dist/index.js');
  const removedId = beforeDelete.document.domains.find((d) => d.name === '주문 수정2').id;
  await api(`/projects/${projectId}/document`, 'PUT', {
    expectedVersion: beforeDelete.project.version,
    document: removeDomain(beforeDelete.document, removedId),
  });
  await click('T 텍스트');
  await fill('자유 텍스트', '삭제된 화면의 로컬 편집');
  await click('저장');
  await page.getByText('! 저장 충돌', { exact: true }).waitFor();
  page.once('dialog', (dialog) => dialog.accept());
  await click('최신 내용 다시 열기');
  await page.getByText('✓ 저장 완료', { exact: true }).waitFor();
  await page.getByLabel('도메인 맵 캔버스', { exact: true }).waitFor();
  await click('T 텍스트');
  await fill('자유 텍스트', '복구 후 편집');
  await save();
  await click('← 갤러리');
  await fill('프로젝트 검색', projectName);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.cache/verification/gallery-mobile.png', fullPage: true });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'mobile horizontal overflow',
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  page.once('dialog', (dialog) => dialog.accept());
  await click('보관');
  await click('보관함');
  await page.getByRole('button', { name: new RegExp(projectName) }).click();
  await click('확대');
  assert.equal(await page.getByRole('button', { name: '저장', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: browser identity, gallery, domain/relationship/note edits, nested view, save/reopen, in-flight edits, stale conflict, mobile layout, archived navigation.',
  );
} catch (error) {
  console.log('BROWSER ERRORS', errors);
  console.log(await page.locator('body').innerText());
  await page.screenshot({ path: '.cache/verification/failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
  if (projectId) await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
  if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
}
