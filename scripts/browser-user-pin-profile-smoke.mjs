import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const require = createRequire(new URL('../apps/server/package.json', import.meta.url)),
  { Pool } = require('pg');
const { readConfig } = await import('../apps/server/dist/config.js');
const config = readConfig();
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.DATABASE_URL).hostname));
const pool = new Pool({ connectionString: config.DATABASE_URL });
let userId, projectId, browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1700, height: 1050 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const username = 'qa-user-' + randomUUID().slice(0, 8),
    projectName = 'qa-profile-' + randomUUID().slice(0, 8);
  await page.goto('http://127.0.0.1:5173/');
  await page.getByLabel('함께 사용할 이름').fill(username);
  const pin = page.getByLabel('사용자 PIN (숫자 4자리)');
  await pin.fill('123');
  assert.equal(
    await page.getByRole('button', { name: '워크스페이스 시작하기 →', exact: true }).isDisabled(),
    true,
  );
  await pin.fill('0012');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/users') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '워크스페이스 시작하기 →', exact: true }).click();
  const response = await created;
  const user = await response.json();
  assert.equal(response.status(), 201);
  userId = user.id;
  assert(!('pin' in user) && !('pinHash' in user));
  const menu = page.getByRole('button', { name: username + ', 사용자 메뉴', exact: true });
  await menu.click();
  const names = await page.getByRole('menuitem').allTextContents();
  assert(names.indexOf('이름 변경') < names.indexOf('색상 변경'));
  await page.getByRole('menuitem', { name: '색상 변경', exact: true }).click();
  await page.getByRole('button', { name: '사용자 색상 선택', exact: true }).click();
  await page.getByRole('button', { name: '#12b76a 색상', exact: true }).click();
  await page.keyboard.press('Escape');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/users/' + userId) && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: '색상 저장', exact: true }).click();
  assert.equal((await (await saved).json()).color, '#12b76a');
  assert.equal(
    await menu.locator('.ui-avatar').evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgb(18, 183, 106)',
  );
  const returningPage = await browser.newPage({ viewport: { width: 1700, height: 1050 } });
  await returningPage.goto('http://127.0.0.1:5173/');
  await returningPage.getByLabel('함께 사용할 이름').fill(username);
  await returningPage.getByLabel('사용자 PIN (숫자 4자리)').fill('0012');
  const reconnect = returningPage.waitForResponse(
    (r) => r.url().endsWith('/api/users') && r.request().method() === 'POST',
  );
  await returningPage.getByRole('button', { name: '워크스페이스 시작하기 →', exact: true }).click();
  const reconnected = await reconnect;
  assert.equal(reconnected.status(), 201);
  const restored = await reconnected.json();
  assert.equal(restored.id, userId);
  assert.equal(restored.color, '#12b76a');
  assert.equal(restored.createdAt, user.createdAt);
  await returningPage
    .getByRole('button', { name: username + ', 사용자 메뉴', exact: true })
    .waitFor();
  await returningPage.close();
  const projectResponse = await page.request.post('http://127.0.0.1:3001/api/projects', {
    data: { name: projectName },
  });
  assert.equal(projectResponse.status(), 201);
  projectId = (await projectResponse.json()).id;
  await page.reload();
  await page.getByRole('button', { name: projectName, exact: true }).click();
  await page.getByRole('button', { name: '핀', exact: true }).click();
  assert.equal(
    await page.getByRole('slider', { name: '핀 사이드탭 너비', exact: true }).count(),
    0,
  );
  const handle = page.getByRole('separator', { name: '핀 패널 너비 조절', exact: true });
  await handle.focus();
  await handle.press('Home');
  await page.waitForFunction(
    () =>
      Math.round(
        document.querySelector('.comments-container[data-open="true"]').getBoundingClientRect()
          .width,
      ) === 280,
  );
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x + 4, grip.y + 80);
  await page.mouse.down();
  await page.mouse.move(grip.x - 136, grip.y + 80, { steps: 8 });
  await page.mouse.up();
  assert.equal(await handle.getAttribute('aria-valuenow'), '420');
  assert.equal(await page.locator('.comments-container').getAttribute('data-resizing'), 'false');
  await handle.press('End');
  assert.equal(await handle.getAttribute('aria-valuenow'), '560');
  await page.waitForFunction(
    () =>
      Math.round(
        document.querySelector('.comments-container[data-open="true"]').getBoundingClientRect()
          .width,
      ) === 560,
  );
  await page.getByRole('button', { name: '핀 닫기', exact: true }).click();
  const surface = page.locator('.canvas-surface');
  await surface.click({ position: { x: 100, y: 100 }, button: 'right' });
  await page.getByRole('menuitem', { name: '이 위치에 핀 남기기', exact: true }).click();
  await page.getByRole('textbox', { name: '핀 등록', exact: true }).fill('색상 검증 핀');
  await page.getByRole('textbox', { name: '핀 등록', exact: true }).press('Enter');
  await page.locator('.comment-pin').waitFor();
  assert.equal(
    await page.locator('.comment-pin').evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgb(18, 183, 106)',
  );
  assert.equal(
    await page
      .locator('.comment-message .ui-avatar')
      .first()
      .evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgb(18, 183, 106)',
  );
  await page.reload();
  await page.getByRole('button', { name: projectName, exact: true }).click();
  await page.getByRole('button', { name: '핀', exact: true }).click();
  assert.equal(
    await page
      .getByRole('separator', { name: '핀 패널 너비 조절', exact: true })
      .getAttribute('aria-valuenow'),
    '560',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth);
  await page.waitForFunction(() => {
    const el = document.querySelector('.comments-container[data-open="true"]');
    return (
      Math.abs(
        el.getBoundingClientRect().width -
          Math.min(560, el.parentElement.getBoundingClientRect().width),
      ) < 0.1
    );
  });
  const panel = await page.locator('.comments-container[data-open="true"]').boundingBox();
  assert(panel.width <= 390);
  const mobileHandle = page.getByRole('separator', { name: '핀 패널 너비 조절', exact: true });
  const mobileGrip = await mobileHandle.boundingBox();
  assert.equal(
    await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.pin-panel-resizer'),
      { x: mobileGrip.x + 4, y: mobileGrip.y + 80 },
    ),
    true,
    'Mobile panel contents must not cover the resize border',
  );
  await page.mouse.move(mobileGrip.x + 4, mobileGrip.y + 80);
  await page.mouse.down();
  await page.mouse.move(mobileGrip.x + 44, mobileGrip.y + 80, { steps: 4 });
  await page.mouse.up();
  assert(
    Math.abs(
      Number(await mobileHandle.getAttribute('aria-valuenow')) - Math.max(280, panel.width - 40),
    ) < 1,
    JSON.stringify({
      stored: await mobileHandle.getAttribute('aria-valuenow'),
      panelWidth: panel.width,
      grip: mobileGrip,
      final: await page.locator('.comments-container[data-open="true"]').boundingBox(),
    }),
  );
  await page.screenshot({ path: '.cache/profile-pin-refinement.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS four-digit PIN registration and existing-user reconnect in a fresh session, saved user color, avatar/pin propagation, border drag and keyboard panel resize, reload persistence, mobile containment',
  );
} finally {
  await browser?.close();
  if (projectId) await pool.query('DELETE FROM projects WHERE id=$1', [projectId]);
  if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  await pool.end();
}
