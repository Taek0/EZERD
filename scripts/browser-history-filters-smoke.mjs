import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink } from 'node:fs/promises';

const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const filename = `__history-filters-${Date.now()}.html`;
const target = new URL('../apps/web/' + filename, import.meta.url);
await writeFile(
  target,
  `<!doctype html><html><body><div id="qa"></div><script type="module">
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {createEmptyDocument} from '@ezerd/model';import {SyncHistoryContent} from '/src/features/collaboration/sync-history-panel.tsx';
import '/src/components/ui/tailwind.css';import '/src/styles/tokens.css';import '/src/components/ui/ui.css';import '/src/styles/styles.css';
const h=React.createElement, document=createEmptyDocument();
document.tables=[{id:'table',physical:{name:'orders'}}];
document.columns=[{id:'column-a',tableId:'table',physical:{name:'id'}},{id:'column-b',tableId:'table',physical:{name:'id'}}];
document.keys=[{id:'key',tableId:'table',kind:'primary',columnIds:['column-a']}];
document.layout.nodes=[{id:'node',objectId:'table'}];
const change=(path,before,after)=>({path,before,after});
const operation=(id,changes)=>({operationId:id,actor:{username:id},createdAt:'2026-09-15T00:00:00.000Z',changes,changedPaths:changes.map(c=>c.path)});
const noop=change('/keys/key/columnIds',['column-a'],['column-a']);
const moved=operation('move-actor',[change('/layout/nodes/node/position',{x:0,y:0},{x:40,y:20}),noop]);
const history=[moved,operation('noop-actor',[noop])];
const actual=[operation('type-actor',[change('/columns/column-a/physical/type',{name:'integer',isArray:false},{name:'uuid',isArray:false})]),operation('add-actor',[change('/tables/new',null,{physical:{name:'new_table'}})]),operation('delete-actor',[change('/tables/deleted',{physical:{name:'deleted_table'}},null)]),operation('key-actor',[change('/keys/key/columnIds',['column-a'],['column-b'])])];
function Demo(){const [full,setFull]=useState(false),[restored,setRestored]=useState('');return h('main',{style:{width:390,margin:'20px auto'}},h('button',{onClick:()=>setFull(true)},'실제 변경 포함'),h(SyncHistoryContent,{key:String(full),snapshot:{document,pending:[],history:full?[...history,...actual]:history},onRestore:setRestored}),h('output',null,restored));}
createRoot(window.document.getElementById('qa')).render(h(Demo));
</script></body></html>`,
);
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto((process.env.EZERD_WEB_URL || 'http://127.0.0.1:5173') + '/' + filename);
  const panel = page.locator('.sync-history-content');
  await panel.waitFor();
  const filter = async (label, count) => {
    await page
      .getByRole('group', { name: '히스토리 동작 필터' })
      .getByRole('button', { name: label, exact: true })
      .click();
    await page.waitForFunction(
      ({ label, count }) =>
        document.querySelector('.sync-history-filter-summary')?.textContent ===
        label + ' · ' + count + '건',
      { label, count },
    );
    assert.equal(await panel.locator('article').count(), count);
  };
  await filter('전체', 1);
  assert.match(await panel.innerText(), /테이블 ‘orders’ 이동/);
  assert.doesNotMatch(await panel.innerText(), /키 컬럼 변경|noop-actor/);
  await filter('이동', 1);
  assert.doesNotMatch(await panel.innerText(), /키 컬럼 변경/);
  await filter('수정', 0);
  assert.doesNotMatch(await panel.innerText(), /move-actor/);
  await page.getByRole('button', { name: '실제 변경 포함', exact: true }).click();
  await filter('전체', 5);
  await filter('수정', 2);
  assert.match(await panel.innerText(), /타입 변경: INTEGER → UUID/);
  assert.match(await panel.innerText(), /키 컬럼 변경: id → id/);
  assert.doesNotMatch(
    await panel.innerText(),
    /move-actor|add-actor|delete-actor|column-a|column-b/,
  );
  await filter('추가', 1);
  assert.match(await panel.innerText(), /new_table.*추가/);
  await filter('삭제', 1);
  assert.match(await panel.innerText(), /deleted_table.*삭제/);
  await page.getByText('삭제 당시 내용 미리보기', { exact: true }).click();
  await page.getByRole('button', { name: '새 객체로 복원', exact: true }).click();
  assert.equal(await page.locator('output').innerText(), 'delete-actor');
  await filter('이동', 1);
  assert.doesNotMatch(await panel.innerText(), /키 컬럼 변경|타입 변경/);
  await filter('크기 변경', 0);
  await filter('순서 변경', 0);
  await filter('전체', 5);
  await mkdir(new URL('../.cache/', import.meta.url), { recursive: true });
  await page.screenshot({ path: '.cache/history-filters.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS historic no-op exclusion, mixed move filtering, actual type/add/delete/key-ID changes, counts, restore callback; no browser errors',
  );
} finally {
  await browser?.close();
  await unlink(target);
}
