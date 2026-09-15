import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { readConfig } = await import('../apps/server/dist/config.js');
const config = readConfig();
assert(
  ['localhost', '127.0.0.1'].includes(new URL(config.DATABASE_URL).hostname),
  'browser smoke cleanup is restricted to a local database',
);

const pool = new (require('pg').Pool)({ connectionString: config.DATABASE_URL });
const webBase = process.env.EZERD_WEB_URL || 'http://127.0.0.1:5173';
const apiBase = process.env.EZERD_API_URL || 'http://127.0.0.1:3001';
const pin = '2468';
const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const projectName = `자동동기화 QA ${stamp}`;
const userNames = Array.from({ length: 5 }, (_, index) => `협업QA${index + 1}-${stamp}`);
const errors = [];
const networkDiagnostics = [];
const websocketDiagnostics = [];
const metrics = {};
const createdUserIds = [];
let projectId;
let stage = 'startup';

function mark(next) {
  stage = next;
  console.log(`STAGE: ${next}`);
}

const responseWait = (page, predicate) => {
  const pending = page.waitForResponse(predicate);
  pending.catch(() => {});
  return pending;
};
const operationUrl = (url) =>
  /\/api\/projects\/[0-9a-f-]+\/operations$/.test(new URL(url).pathname);

async function ready() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const [api, web] = await Promise.all([
        fetch(`${apiBase}/api/health/ready`),
        fetch(`${webBase}/api/health/ready`),
      ]);
      if (api.ok && web.ok) return;
    } catch {
      /* retry while the local stack starts */
    }
    await delay(500);
  }
  throw new Error('local API/Vite readiness failed');
}

async function api(path, token, options = {}) {
  const response = await fetch(`${apiBase}/api${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...(options.body && typeof options.body !== 'string'
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
  assert(
    response.ok,
    `${options.method || 'GET'} ${path}: ${response.status} ${await response.clone().text()}`,
  );
  return response.status === 204 ? undefined : response.json();
}

async function identify(page, username) {
  await page.goto(webBase);
  await page.getByRole('textbox', { name: /^함께 사용할 이름/ }).fill(username);
  await page.getByLabel('사용자 PIN (숫자 4자리)').fill(pin);
  const userResponse = responseWait(
    page,
    (response) => response.url().endsWith('/api/users') && response.request().method() === 'POST',
  );
  const sessionResponse = responseWait(
    page,
    (response) =>
      response.url().endsWith('/api/sessions') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '워크스페이스 시작하기 →', exact: true }).click();
  const userReply = await userResponse;
  if (userReply.status() !== 201)
    throw new Error(`user creation: ${userReply.status()} ${await userReply.text()}`);
  const user = await userReply.json();
  createdUserIds.push(user.id);
  const sessionReply = await sessionResponse;
  if (sessionReply.status() !== 201)
    throw new Error(`session creation: ${sessionReply.status()} ${await sessionReply.text()}`);
  const session = await sessionReply.json();
  await page.getByRole('button', { name: `${username}, 사용자 메뉴`, exact: true }).waitFor();
  return { user, session };
}

async function waitForBaseline(page, action) {
  const pending = responseWait(
    page,
    (response) =>
      response.url().includes('/sync-baseline') && response.request().method() === 'POST',
  );
  await action();
  assert.equal((await pending).status(), 201);
  await page.getByRole('status').filter({ hasText: '동기화됨' }).waitFor();
}

async function openProject(page) {
  await page.getByRole('textbox', { name: '프로젝트 검색', exact: true }).fill(projectName);
  await waitForBaseline(page, () =>
    page.getByRole('button', { name: projectName, exact: true }).click(),
  );
}

async function waitSynced(page) {
  await page.getByRole('status').filter({ hasText: '동기화됨' }).waitFor({ timeout: 15_000 });
}

async function history(token) {
  return api(`/projects/${projectId}/history?since=0`, token);
}

async function waitHistory(token, predicate, timeout = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const entries = await history(token);
    const found = predicate(entries);
    if (found) return { entries, found };
    await delay(100);
  }
  throw new Error('timed out waiting for sync history');
}

async function waitAllSee(pages, name, timeout = 10_000) {
  await Promise.all(
    pages.map((page) => page.getByRole('group', { name, exact: true }).waitFor({ timeout })),
  );
}

async function selectDomain(page, name) {
  await page.getByRole('group', { name, exact: true }).focus();
  await page.getByLabel('도메인 이름', { exact: true }).waitFor();
}

function domainField(page, label) {
  return label === '업무 설명'
    ? page
        .locator('#canvas-inspector label')
        .filter({ hasText: /^업무 설명/ })
        .locator('textarea')
    : page.getByLabel(label, { exact: true });
}

async function setDomainField(page, name, label, value) {
  await selectDomain(page, name);
  const input = domainField(page, label);
  await input.fill(value);
  const pending = responseWait(
    page,
    (response) => response.request().method() === 'POST' && operationUrl(response.url()),
  );
  await page.mouse.click(100, 300);
  const reply = await pending;
  assert.equal(reply.status(), 201, await reply.text());
  await waitSynced(page);
}

async function indexedDbOperations(page, userId, expectedProjectId) {
  return page.evaluate(
    (project) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('ezerd-sync', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('operations')) {
            resolve([]);
            database.close();
            return;
          }
          const query = database
            .transaction('operations', 'readonly')
            .objectStore('operations')
            .index('projectId')
            .getAll(project);
          query.onerror = () => reject(query.error);
          query.onsuccess = () => {
            resolve(query.result);
            database.close();
          };
        };
      }),
    `${userId}:${expectedProjectId}`,
  );
}

async function composeIme(input, intermediate, finalValue) {
  await input.focus();
  await input.evaluate((element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    setter.call(element, value);
    element.dispatchEvent(
      new CompositionEvent('compositionupdate', { bubbles: true, data: value }),
    );
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: value,
        inputType: 'insertCompositionText',
        isComposing: true,
      }),
    );
  }, intermediate);
  await delay(650);
  await input.evaluate((element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }));
    setter.call(element, value);
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: value,
        inputType: 'insertText',
        isComposing: false,
      }),
    );
  }, finalValue);
}

async function dragNode(page, locator, dx, dy, steps = 10) {
  const before = await locator.boundingBox();
  assert(before, 'node must have a bounding box');
  const x = before.x + Math.min(80, before.width / 3);
  const y = before.y + Math.min(35, before.height / 3);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps });
  await page.mouse.up();
  return before;
}

const browser = await chromium.launch({
  channel: process.env.EZERD_BROWSER_CHANNEL || 'chrome',
  headless: true,
});
const contexts = [];
const pages = [];
const identities = [];
const operationRequests = new Map();
const eventRequests = new Map();
const websocketFacts = new Map();
const expectedOperationFailures = new Set();

try {
  mark('readiness');
  await mkdir('.cache/verification', { recursive: true });
  await ready();
  mark('five independent identities');
  for (let index = 0; index < 5; index++) {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    if (index === 2) {
      await context.addInitScript(() => {
        const NativeWebSocket = globalThis.WebSocket;
        const control = { dropNextOperation: false, droppedOperations: 0, syncSockets: [] };
        class ControlledWebSocket extends NativeWebSocket {
          constructor(url, protocols) {
            super(url, protocols);
            if (!String(url).includes('/api/sync')) return;
            control.syncSockets.push(this);
            this.addEventListener(
              'message',
              (event) => {
                if (!control.dropNextOperation) return;
                try {
                  const value = JSON.parse(String(event.data));
                  if (value.type !== 'operation') return;
                  control.dropNextOperation = false;
                  control.droppedOperations += 1;
                  event.stopImmediatePropagation();
                } catch {
                  /* Non-JSON frames do not belong to application sync. */
                }
              },
              true,
            );
          }
        }
        Object.defineProperty(globalThis, '__ezerdSyncTest', { value: control });
        globalThis.WebSocket = ControlledWebSocket;
      });
    }
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    page.on('pageerror', (error) => errors.push(`page ${index + 1}: ${error.message}`));
    page.on('requestfailed', (request) => {
      if (
        request.url().includes('/sync-baseline') ||
        (operationUrl(request.url()) && !expectedOperationFailures.has(page))
      ) {
        errors.push(
          `request ${index + 1}: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'failed'}`,
        );
      }
    });
    page.on('request', (request) => {
      if (request.url().includes('/api/'))
        networkDiagnostics.push(`request ${index + 1}: ${request.method()} ${request.url()}`);
    });
    page.on('response', (response) => {
      if (response.url().includes('/api/'))
        networkDiagnostics.push(`response ${index + 1}: ${response.status()} ${response.url()}`);
    });
    page.on('websocket', (socket) => {
      websocketDiagnostics.push(`open ${index + 1}: ${socket.url()}`);
      socket.on('framesent', (event) => {
        const payload = String(event.payload);
        websocketDiagnostics.push(`sent ${index + 1}: ${payload.slice(0, 500)}`);
        try {
          const value = JSON.parse(payload);
          if (value.type === 'subscribe' && typeof value.clientId === 'string')
            websocketFacts.get(page).subscribeClientIds.add(value.clientId);
        } catch {
          /* Vite HMR frames are unrelated to application sync. */
        }
      });
      socket.on('framereceived', (event) => {
        const payload = String(event.payload);
        websocketDiagnostics.push(`received ${index + 1}: ${payload.slice(0, 500)}`);
        try {
          const value = JSON.parse(payload);
          if (value.type === 'subscribed') websocketFacts.get(page).subscribed += 1;
          if (value.type === 'operation') websocketFacts.get(page).operations += 1;
        } catch {
          /* Vite HMR frames are unrelated to application sync. */
        }
      });
      socket.on('close', () => websocketDiagnostics.push(`close ${index + 1}: ${socket.url()}`));
      socket.on('socketerror', (error) =>
        websocketDiagnostics.push(`error ${index + 1}: ${error}`),
      );
    });
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        !/Failed to load resource|ERR_FAILED|ERR_INTERNET_DISCONNECTED/.test(message.text())
      )
        errors.push(`console ${index + 1}: ${message.text()}`);
    });
    const requests = [];
    operationRequests.set(page, requests);
    eventRequests.set(page, []);
    websocketFacts.set(page, { subscribeClientIds: new Set(), subscribed: 0, operations: 0 });
    page.on('request', (request) => {
      if (request.method() === 'POST' && operationUrl(request.url()))
        requests.push({ at: Date.now(), body: request.postDataJSON() });
      if (
        request.method() === 'GET' &&
        /\/api\/projects\/[0-9a-f-]+\/events$/.test(new URL(request.url()).pathname)
      )
        eventRequests.get(page).push(request.url());
    });
    contexts.push(context);
    pages.push(page);
    identities.push(await identify(page, userNames[index]));
  }

  const owner = pages[0];
  mark('create shared project baseline');
  const createResponse = responseWait(
    owner,
    (response) =>
      response.url().endsWith('/api/projects') && response.request().method() === 'POST',
  );
  const baselineResponse = responseWait(
    owner,
    (response) =>
      response.url().includes('/sync-baseline') && response.request().method() === 'POST',
  );
  await owner.getByRole('textbox', { name: '새 프로젝트 이름', exact: true }).fill(projectName);
  await owner.getByRole('button', { name: '프로젝트 만들기', exact: true }).click();
  const createdProject = await (await createResponse).json();
  projectId = createdProject.id;
  assert.equal((await baselineResponse).status(), 201);
  await waitSynced(owner);
  for (const page of pages.slice(1)) {
    await page.reload();
    await openProject(page);
  }

  // Create shared fixtures through the real editor and establish five-way propagation.
  mark('initial five-way propagation');
  await owner.getByRole('button', { name: '＋ 도메인', exact: true }).click();
  await waitSynced(owner);
  const initialSend = owner.waitForRequest(
    (request) => request.method() === 'POST' && operationUrl(request.url()),
  );
  await owner.getByLabel('도메인 이름', { exact: true }).fill('주문');
  await owner.getByLabel('도메인 이름', { exact: true }).press('Tab');
  await initialSend;
  const sentAt = operationRequests.get(owner).at(-1).at;
  await waitAllSee(pages.slice(1), '주문');
  metrics.initialFiveWayMs = Date.now() - sentAt;
  assert(
    metrics.initialFiveWayMs <= 1000,
    `initial five-way propagation exceeded 1s: ${metrics.initialFiveWayMs}ms`,
  );
  const clientIds = await Promise.all(
    pages.map((page) => page.evaluate(() => localStorage.getItem('ezerd.sync.clientId'))),
  );
  assert(
    clientIds.every((value) => typeof value === 'string' && value.length > 0),
    'every browser context must have a clientId',
  );
  assert.equal(
    new Set(clientIds).size,
    pages.length,
    'browser contexts must use distinct clientIds',
  );
  metrics.distinctClientIds = new Set(clientIds).size;
  for (let index = 0; index < pages.length; index++) {
    const facts = websocketFacts.get(pages[index]);
    assert(
      facts.subscribeClientIds.has(clientIds[index]),
      `browser ${index + 1} must subscribe with its own clientId`,
    );
    assert(facts.subscribed > 0, `browser ${index + 1} must receive a subscribed frame`);
    assert(facts.operations > 0, `browser ${index + 1} must receive an operation frame`);
  }
  metrics.websocketSubscribedContexts = pages.filter(
    (page) => websocketFacts.get(page).subscribed > 0,
  ).length;
  metrics.websocketOperationContexts = pages.filter(
    (page) => websocketFacts.get(page).operations > 0,
  ).length;
  await waitSynced(owner);
  await owner.getByRole('button', { name: '＋ 도메인', exact: true }).click();
  await waitSynced(owner);
  await owner.getByLabel('도메인 이름', { exact: true }).fill('결제');
  await owner.getByLabel('도메인 이름', { exact: true }).press('Tab');
  await waitSynced(owner);
  await waitAllSee(pages.slice(1), '결제');

  // Newly created cards share the editor's center spawn point. Move the selected top card
  // aside through the normal pointer interaction so both fixtures remain reachable.
  const arrangementBefore = operationRequests.get(owner).length;
  const arrangementSend = owner.waitForRequest(
    (request) => request.method() === 'POST' && operationUrl(request.url()),
  );
  await dragNode(owner, owner.getByRole('group', { name: '결제', exact: true }), 320, 120, 8);
  await arrangementSend;
  await waitHistory(identities[0].session.token, (entries) =>
    entries.some(
      (entry) =>
        entry.actor.id === identities[0].user.id &&
        entry.changedPaths.some((path) => path.endsWith('/position')),
    ),
  );
  await waitSynced(owner);
  metrics.fixtureArrangementRequests = operationRequests.get(owner).length - arrangementBefore;
  assert.equal(metrics.fixtureArrangementRequests, 1, 'fixture arrangement drag must submit once');

  // IME composition must not submit intermediate text; composition end debounces to one operation.
  mark('IME debounce');
  await selectDomain(owner, '주문');
  const imeInput = owner.getByLabel('도메인 이름', { exact: true });
  const imeRequests = operationRequests.get(owner);
  const beforeIme = imeRequests.length;
  await composeIme(imeInput, '한', '한글 주문');
  assert.equal(
    imeRequests.length,
    beforeIme,
    'IME composition emitted an operation before compositionend/debounce',
  );
  await waitHistory(identities[0].session.token, (entries) =>
    entries.some(
      (entry) =>
        entry.actor.id === identities[0].user.id &&
        entry.changedPaths.some((path) => path.endsWith('/name')) &&
        entry.document?.domains.some((domain) => domain.name === '한글 주문'),
    ),
  );
  await waitSynced(owner);
  assert.equal(
    imeRequests.length,
    beforeIme + 1,
    'compositionend must create exactly one debounced operation',
  );
  metrics.imeDebounceRequests = imeRequests.length - beforeIme;
  await waitAllSee(pages.slice(1), '한글 주문');

  // Pointer moves are local previews; pointerup creates one shared layout operation.
  mark('single drag commit');
  const draggedDomain = owner.getByRole('group', { name: '한글 주문', exact: true });
  const beforeDragRequests = imeRequests.length;
  const oldBox = await draggedDomain.boundingBox();
  assert(oldBox, 'dragged domain must have a bounding box');
  const dragX = oldBox.x + Math.min(80, oldBox.width / 3);
  const dragY = oldBox.y + Math.min(35, oldBox.height / 3);
  await owner.mouse.move(dragX, dragY);
  await owner.mouse.down();
  await owner.mouse.move(dragX + 140, dragY + 70, { steps: 14 });
  await delay(700);
  assert.equal(
    imeRequests.length,
    beforeDragRequests,
    'pointer moves before pointerup must not submit an operation',
  );
  const dragSend = owner.waitForRequest(
    (request) => request.method() === 'POST' && operationUrl(request.url()),
  );
  await owner.mouse.up();
  const dragRequest = await dragSend;
  const dragOperationId = dragRequest.postDataJSON().operationId;
  await waitHistory(identities[0].session.token, (entries) =>
    entries.some((entry) => entry.operationId === dragOperationId && entry.status === 'accepted'),
  );
  await waitSynced(owner);
  assert.equal(imeRequests.length, beforeDragRequests + 1, 'a drag must submit once at pointerup');
  const newBox = await draggedDomain.boundingBox();
  assert(newBox.x > oldBox.x + 100 && newBox.y > oldBox.y + 40, 'dragged card did not move');
  metrics.dragRequests = imeRequests.length - beforeDragRequests;

  // A delayed ACK cannot prevent another browser receiving the committed event.
  mark('late ACK event application');
  let releaseAck;
  const ackGate = new Promise((resolve) => {
    releaseAck = resolve;
  });
  let serverCommitted;
  const committed = new Promise((resolve) => {
    serverCommitted = resolve;
  });
  let ackFulfilled;
  const ackHandled = new Promise((resolve) => {
    ackFulfilled = resolve;
  });
  await owner.route('**/api/projects/*/operations', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    serverCommitted();
    await ackGate;
    await route.fulfill({ response });
    ackFulfilled();
  });
  await selectDomain(owner, '한글 주문');
  await domainField(owner, '업무 설명').fill('ACK 지연 중에도 전파');
  await owner.mouse.click(100, 300);
  await committed;
  await pages[1].getByText('ACK 지연 중에도 전파', { exact: true }).waitFor();
  releaseAck();
  await ackHandled;
  await owner.unroute('**/api/projects/*/operations');
  await waitSynced(owner);
  await delay(500);

  // Miss the last WebSocket event while offline, then reconnect and fetch the gap.
  mark('last event catch-up');
  await selectDomain(pages[2], '한글 주문');
  assert.equal(await domainField(pages[2], '업무 설명').inputValue(), 'ACK 지연 중에도 전파');
  await pages[2].evaluate(() => {
    globalThis.__ezerdSyncTest.dropNextOperation = true;
  });
  await setDomainField(pages[1], '한글 주문', '업무 설명', '마지막 이벤트 따라잡기');
  await pages[2].waitForFunction(() => globalThis.__ezerdSyncTest.droppedOperations === 1);
  await contexts[2].setOffline(true);
  await pages[2].evaluate(() => {
    const socket = [...globalThis.__ezerdSyncTest.syncSockets]
      .reverse()
      .find((value) => value.readyState === WebSocket.OPEN);
    if (!socket) throw new Error('sync WebSocket was not open before the forced reconnect');
    socket.close();
  });
  await delay(300);
  assert.equal(
    await domainField(pages[2], '업무 설명').inputValue(),
    'ACK 지연 중에도 전파',
    'offline browser must retain the pre-event value',
  );
  const catchupRequestsBeforeReconnect = eventRequests.get(pages[2]).length;
  const catchupStarted = Date.now();
  await contexts[2].setOffline(false);
  await selectDomain(pages[2], '한글 주문');
  await pages[2].waitForFunction(
    (value) =>
      [...document.querySelectorAll('textarea')].some((element) => element.value === value),
    '마지막 이벤트 따라잡기',
    { timeout: 8_000 },
  );
  metrics.lastEventCatchupMs = Date.now() - catchupStarted;
  assert(
    eventRequests.get(pages[2]).length > catchupRequestsBeforeReconnect,
    'reconnected browser must request missed events',
  );
  metrics.lastEventCatchupRequests =
    eventRequests.get(pages[2]).length - catchupRequestsBeforeReconnect;
  for (const page of pages) {
    await selectDomain(page, '한글 주문');
    await page.waitForFunction(
      (value) =>
        [...document.querySelectorAll('textarea')].some((element) => element.value === value),
      '마지막 이벤트 따라잡기',
    );
    assert.equal(await domainField(page, '업무 설명').inputValue(), '마지막 이벤트 따라잡기');
  }

  // Store an offline edit in IndexedDB, reload with submissions blocked, and restore the optimistic value.
  mark('offline IndexedDB reload');
  const offlinePage = pages[3];
  expectedOperationFailures.add(offlinePage);
  await offlinePage.route('**/api/projects/*/operations*', (route) => {
    if (
      route.request().method() === 'POST' ||
      /\/operations\/[0-9a-f-]+$/.test(new URL(route.request().url()).pathname)
    )
      return route.abort();
    return route.continue();
  });
  await selectDomain(offlinePage, '한글 주문');
  await domainField(offlinePage, '업무 설명').fill('IndexedDB 새로고침 복원');
  await domainField(offlinePage, '업무 설명').press('Tab');
  await offlinePage
    .getByRole('status')
    .filter({ hasText: /오프라인|확인 필요/ })
    .waitFor();
  await offlinePage.waitForFunction(
    (project) =>
      new Promise((resolve) => {
        const request = indexedDB.open('ezerd-sync', 1);
        request.onsuccess = () => {
          const query = request.result
            .transaction('operations')
            .objectStore('operations')
            .index('projectId')
            .getAll(project);
          query.onsuccess = () => resolve(query.result.length > 0);
        };
      }),
    `${identities[3].user.id}:${projectId}`,
  );
  assert(
    (await indexedDbOperations(offlinePage, identities[3].user.id, projectId)).length > 0,
    'offline operation must be durable before reload',
  );
  await offlinePage.reload();
  await offlinePage
    .getByRole('button', { name: projectName, exact: true })
    .waitFor()
    .catch(() => {});
  if (await offlinePage.getByRole('button', { name: projectName, exact: true }).count())
    await openProject(offlinePage);
  await selectDomain(offlinePage, '한글 주문');
  await domainField(offlinePage, '업무 설명').waitFor();
  assert.equal(await domainField(offlinePage, '업무 설명').inputValue(), 'IndexedDB 새로고침 복원');
  await offlinePage.unroute('**/api/projects/*/operations*');
  const offlineReplayStarted = Date.now();
  await offlinePage.reload();
  await offlinePage
    .getByRole('button', { name: projectName, exact: true })
    .waitFor()
    .catch(() => {});
  if (await offlinePage.getByRole('button', { name: projectName, exact: true }).count())
    await openProject(offlinePage);
  await waitHistory(identities[3].session.token, (entries) =>
    entries.some(
      (entry) =>
        entry.actor.id === identities[3].user.id &&
        entry.document?.domains.some((domain) => domain.description === 'IndexedDB 새로고침 복원'),
    ),
  );
  await selectDomain(pages[4], '한글 주문');
  await pages[4].waitForFunction(
    (value) =>
      [...document.querySelectorAll('textarea')].some((element) => element.value === value),
    'IndexedDB 새로고침 복원',
  );
  while (
    (await indexedDbOperations(offlinePage, identities[3].user.id, projectId)).length > 0 &&
    Date.now() - offlineReplayStarted < 12_000
  )
    await delay(50);
  assert.equal(
    (await indexedDbOperations(offlinePage, identities[3].user.id, projectId)).length,
    0,
    'acknowledged offline operation must leave IndexedDB',
  );
  expectedOperationFailures.delete(offlinePage);
  metrics.offlineReplayAckMs = Date.now() - offlineReplayStarted;

  // Independent properties merge, while the same property follows server approval order.
  mark('independent and same-property merge');
  await selectDomain(owner, '한글 주문');
  await selectDomain(pages[1], '한글 주문');
  await Promise.all([
    owner
      .getByLabel('도메인 이름', { exact: true })
      .fill('주문 독립병합')
      .then(() => owner.getByLabel('도메인 이름', { exact: true }).press('Tab'))
      .then(() => waitSynced(owner)),
    domainField(pages[1], '업무 설명')
      .fill('설명 독립병합')
      .then(() => domainField(pages[1], '업무 설명').press('Tab'))
      .then(() => waitSynced(pages[1])),
  ]);
  await waitAllSee(pages, '주문 독립병합');
  for (const page of pages) {
    await selectDomain(page, '주문 독립병합');
    assert.equal(await domainField(page, '업무 설명').inputValue(), '설명 독립병합');
  }
  let releaseLast;
  const lastGate = new Promise((resolve) => {
    releaseLast = resolve;
  });
  let ownerSubmissionStarted;
  const ownerStarted = new Promise((resolve) => {
    ownerSubmissionStarted = resolve;
  });
  const delayOwnerSubmission = async (route) => {
    if (route.request().method() === 'POST') {
      ownerSubmissionStarted();
      await lastGate;
    }
    await route.continue();
  };
  await owner.route('**/api/projects/*/operations', delayOwnerSubmission);
  const ownerLastResponse = responseWait(
    owner,
    (response) => operationUrl(response.url()) && response.request().method() === 'POST',
  );
  await selectDomain(owner, '주문 독립병합');
  await domainField(owner, '업무 설명').fill('서버 마지막 승인');
  await domainField(owner, '업무 설명').press('Tab');
  await ownerStarted;
  await setDomainField(pages[1], '주문 독립병합', '업무 설명', '서버 먼저 승인');
  releaseLast();
  assert.equal((await ownerLastResponse).status(), 201);
  await waitSynced(owner);
  await owner.unroute('**/api/projects/*/operations', delayOwnerSubmission);
  for (const page of pages) {
    await selectDomain(page, '주문 독립병합');
    await page.waitForFunction(
      (value) =>
        [...document.querySelectorAll('textarea')].some((element) => element.value === value),
      '서버 마지막 승인',
    );
  }

  // Own undo/redo converges. A later collaborator edit prevents stale undo from overwriting it.
  mark('undo redo and stale undo protection');
  await setDomainField(owner, '주문 독립병합', '업무 설명', 'undo 대상');
  for (const page of pages) {
    await selectDomain(page, '주문 독립병합');
    await page.waitForFunction(
      (value) =>
        [...document.querySelectorAll('textarea')].some((element) => element.value === value),
      'undo 대상',
    );
  }
  const beforeUndoEntries = await history(identities[0].session.token);
  const beforeUndoIds = new Set(beforeUndoEntries.map((entry) => entry.operationId));
  await owner.getByRole('button', { name: '실행 취소', exact: true }).click();
  const undoResult = await waitHistory(identities[0].session.token, (entries) =>
    entries.find(
      (entry) =>
        !beforeUndoIds.has(entry.operationId) &&
        entry.actor.id === identities[0].user.id &&
        entry.status === 'accepted',
    ),
  );
  assert(
    !beforeUndoIds.has(undoResult.found.operationId),
    'undo must create a new accepted operation',
  );
  metrics.undoAcceptedOperations = 1;
  for (const page of pages) {
    await selectDomain(page, '주문 독립병합');
    await page.waitForFunction(
      (value) =>
        [...document.querySelectorAll('textarea')].some((element) => element.value === value),
      '서버 마지막 승인',
    );
    assert.equal(await domainField(page, '업무 설명').inputValue(), '서버 마지막 승인');
  }
  const beforeRedoEntries = await history(identities[0].session.token);
  const beforeRedoIds = new Set(beforeRedoEntries.map((entry) => entry.operationId));
  await owner.getByRole('button', { name: '다시 실행', exact: true }).click();
  const redoResult = await waitHistory(identities[0].session.token, (entries) =>
    entries.find(
      (entry) =>
        !beforeRedoIds.has(entry.operationId) &&
        entry.actor.id === identities[0].user.id &&
        entry.status === 'accepted',
    ),
  );
  assert.notEqual(
    redoResult.found.operationId,
    undoResult.found.operationId,
    'redo must create a distinct accepted operation',
  );
  metrics.redoAcceptedOperations = 1;
  for (const page of pages) {
    await selectDomain(page, '주문 독립병합');
    await page.waitForFunction(
      (value) =>
        [...document.querySelectorAll('textarea')].some((element) => element.value === value),
      'undo 대상',
    );
    assert.equal(await domainField(page, '업무 설명').inputValue(), 'undo 대상');
  }
  await setDomainField(pages[1], '주문 독립병합', '업무 설명', '타인 후속 변경 보호');
  await owner.getByRole('button', { name: '실행 취소', exact: true }).click();
  const staleUndo = await waitHistory(identities[0].session.token, (entries) => {
    const latest = entries.at(-1);
    return latest?.actor.id === identities[0].user.id && latest.status === 'rejected'
      ? latest
      : undefined;
  });
  assert.match(staleUndo.found.reason ?? '', /후속 변경/);
  await owner
    .getByText(/후속 변경 때문에 실행 취소할 수 없습니다/)
    .first()
    .waitFor();
  for (const page of pages.slice(1)) {
    await selectDomain(page, '주문 독립병합');
    assert.equal(await domainField(page, '업무 설명').inputValue(), '타인 후속 변경 보호');
  }

  // A personal combined view keeps the other four users in their current view, allows content edits, and blocks layout edits.
  mark('personal combined view');
  await owner.getByRole('button', { name: '도메인 뷰', exact: true }).click();
  await owner.getByRole('checkbox', { name: '주문 독립병합', exact: true }).check();
  await owner.getByRole('checkbox', { name: '결제', exact: true }).check();
  await owner.getByRole('button', { name: '적용', exact: true }).click();
  await owner.getByLabel('도메인 뷰 내부 캔버스', { exact: true }).waitFor();
  for (const page of pages.slice(1))
    await page.getByLabel('도메인 맵 캔버스', { exact: true }).waitFor();
  await owner.getByRole('button', { name: '← 도메인 맵으로', exact: true }).click();
  await owner.getByRole('button', { name: '주문 독립병합 도메인 열기', exact: true }).click();
  await owner.getByRole('button', { name: '＋ 테이블', exact: true }).click();
  await owner.getByLabel('테이블명', { exact: true }).fill('orders_sync');
  await owner.getByLabel('테이블명', { exact: true }).press('Tab');
  await waitSynced(owner);
  await owner.getByRole('button', { name: '도메인 뷰', exact: true }).click();
  await owner.getByRole('checkbox', { name: '주문 독립병합', exact: true }).check();
  await owner.getByRole('checkbox', { name: '결제', exact: true }).check();
  await owner.getByRole('button', { name: '적용', exact: true }).click();
  const combinedTable = owner.getByRole('group', { name: 'orders_sync', exact: true });
  await combinedTable.click({ position: { x: 35, y: 30 } });
  const combinedTableName = owner
    .locator('#canvas-inspector')
    .getByRole('textbox', { name: '테이블명', exact: true });
  await combinedTableName.fill('orders_combined_edit');
  await combinedTableName.press('Tab');
  await waitSynced(owner);
  await pages[1].getByRole('button', { name: '주문 독립병합 도메인 열기', exact: true }).click();
  await pages[1].getByRole('group', { name: 'orders_combined_edit', exact: true }).waitFor();
  const renamedCombinedTable = owner.getByRole('group', {
    name: 'orders_combined_edit',
    exact: true,
  });
  const combinedBefore = await renamedCombinedTable.boundingBox();
  const historyBeforeBlockedDrag = (await history(identities[0].session.token)).length;
  await dragNode(owner, renamedCombinedTable, 120, 60, 8);
  await delay(800);
  const combinedAfter = await renamedCombinedTable.boundingBox();
  assert(
    Math.abs(combinedAfter.x - combinedBefore.x) < 1 &&
      Math.abs(combinedAfter.y - combinedBefore.y) < 1,
    'combined-view table layout must be read-only',
  );
  assert.equal(
    (await history(identities[0].session.token)).length,
    historyBeforeBlockedDrag,
    'blocked combined-view drag must not create history',
  );

  // Delete history offers restore and creates a new object id while keeping visible content.
  mark('history delete restore');
  await owner.getByRole('button', { name: '← 도메인 맵으로', exact: true }).click();
  await owner.getByRole('button', { name: '＋ 도메인', exact: true }).click();
  await owner.getByLabel('도메인 이름', { exact: true }).fill('복원 대상');
  await owner.getByLabel('도메인 이름', { exact: true }).press('Tab');
  await waitSynced(owner);
  const beforeDeletionDocument = (await api(`/projects/${projectId}`, identities[0].session.token))
    .document;
  const originalRestoredId = beforeDeletionDocument.domains.find(
    (domain) => domain.name === '복원 대상',
  ).id;
  await selectDomain(owner, '복원 대상');
  await owner.getByRole('button', { name: '도메인 삭제', exact: true }).click();
  await owner.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click();
  await waitSynced(owner);
  await owner.locator('details.sync-history > summary').click();
  const deletionSection = owner
    .locator('.sync-history-panel section')
    .filter({ has: owner.getByRole('heading', { name: /^삭제/ }) });
  await deletionSection.getByRole('button', { name: '새 객체로 복원', exact: true }).click();
  await owner.getByRole('group', { name: '복원 대상', exact: true }).waitFor();
  const restoredDocument = (await api(`/projects/${projectId}`, identities[0].session.token))
    .document;
  assert.notEqual(
    restoredDocument.domains.find((domain) => domain.name === '복원 대상').id,
    originalRestoredId,
    'history restore must create a new object id',
  );

  for (let index = 0; index < pages.length; index++) {
    assert.equal(
      (await indexedDbOperations(pages[index], identities[index].user.id, projectId)).length,
      0,
      `browser ${index + 1} must finish with an empty IndexedDB queue`,
    );
  }
  await owner.screenshot({ path: '.cache/verification/autosync-five-browser.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(`PASS: five-browser autosync acceptance ${JSON.stringify(metrics)}`);
} catch (error) {
  console.log('FAILED STAGE', stage);
  console.log('PARTIAL METRICS', metrics);
  console.log('PAGE ERRORS', errors);
  if (process.env.EZERD_VERBOSE_FAILURE === '1') {
    console.log('SYNC NETWORK (tail)', networkDiagnostics.slice(-80));
    console.log('SYNC WEBSOCKET (tail)', websocketDiagnostics.slice(-80));
  } else {
    console.log('SYNC DIAGNOSTIC COUNTS', {
      network: networkDiagnostics.length,
      websocket: websocketDiagnostics.length,
    });
  }
  if (projectId && identities[0]) {
    try {
      console.log(
        'SYNC HISTORY SUMMARY',
        (await history(identities[0].session.token)).map((entry) => ({
          operationId: entry.operationId,
          sequence: entry.sequence,
          status: entry.status,
          changedPaths: entry.changedPaths,
        })),
      );
    } catch {
      /* best effort */
    }
    for (let index = 0; index < identities.length; index++) {
      try {
        console.log(
          `INDEXEDDB SUMMARY ${index + 1}`,
          (await indexedDbOperations(pages[index], identities[index].user.id, projectId)).map(
            (entry) => ({
              operationId: entry.operationId,
              state: entry.state,
              reason: entry.reason,
            }),
          ),
        );
      } catch {
        /* best effort */
      }
    }
  }
  for (let index = 0; index < pages.length; index++) {
    try {
      await pages[index].screenshot({
        path: `.cache/verification/autosync-failure-${index + 1}.png`,
        fullPage: true,
      });
    } catch {
      /* best effort */
    }
  }
  throw error;
} finally {
  await browser.close();
  if (projectId) await pool.query('DELETE FROM projects WHERE id=$1', [projectId]);
  if (createdUserIds.length)
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [createdUserIds]);
  await pool.end();
}
