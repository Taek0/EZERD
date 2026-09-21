import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const filename = `__pin-filter-${Date.now()}.html`;
const target = new URL('../apps/web/' + filename, import.meta.url);
await writeFile(
  target,
  `<!doctype html><html><body><div id="qa"></div><script type="module">
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {CommentsPanel} from '/src/features/comments/CommentsPanel.tsx';import {ConfirmProvider} from '/src/components/ui/ConfirmProvider.tsx';import {createEmptyDocument} from '@ezerd/model';
import '/src/components/ui/tailwind.css';import '/src/styles/tokens.css';import '/src/components/ui/ui.css';import '/src/styles/styles.css';
const h=React.createElement,noop=()=>{},doc=createEmptyDocument();
function Demo(){const [active,setActive]=useState(null);return h(ConfirmProvider,null,h(CommentsPanel,{projectId:'00000000-0000-4000-8000-000000000001',userId:'00000000-0000-4000-8000-000000000002',document:doc,context:{viewId:'overview',selectedObjectId:null,position:{x:10,y:20}},activeThreadId:active,onThreads:noop,onNavigate:t=>setActive(t.id),onClose:noop,onCancelPinDraft:noop}));}createRoot(document.getElementById('qa')).render(h(Demo));
</script></body></html>`,
);
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const thread = {
    id: '00000000-0000-4000-8000-000000000003',
    projectId: '00000000-0000-4000-8000-000000000001',
    viewId: 'overview',
    objectId: null,
    x: 10,
    y: 20,
    resolved: false,
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    messages: [],
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      Object.assign(thread, req.postDataJSON());
      await route.fulfill({ json: thread });
    } else await route.fulfill({ json: req.url().endsWith('/users') ? [] : [thread] });
  });
  await page.goto('http://127.0.0.1:5173/' + filename);
  const resolved = page.getByRole('checkbox', { name: '해결됨 포함' });
  const all = page.getByRole('checkbox', { name: '프로젝트 전체 핀' });
  await all.uncheck();
  await page.getByRole('button', { name: '해결', exact: true }).click();
  await page.getByText('아직 핀이 없습니다.', { exact: false }).waitFor();
  assert.equal(await resolved.isChecked(), false);
  assert.equal(await all.isChecked(), false);
  await resolved.check();
  await page.getByRole('button', { name: '다시 열기', exact: true }).click();
  await page.getByRole('button', { name: '해결', exact: true }).waitFor();
  assert.equal(await resolved.isChecked(), true);
  assert.equal(await all.isChecked(), false);
  console.log('PASS resolve/reopen preserve both pin filters');
} finally {
  await browser?.close();
  await unlink(target);
}
