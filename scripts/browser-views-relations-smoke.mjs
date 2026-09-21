import assert from 'node:assert/strict';
import { writeFile, unlink, readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const filename = `__feedback-canvas-${Date.now()}.html`;
const target = new URL('../apps/web/' + filename, import.meta.url);
await writeFile(
  target,
  `<!doctype html><html><head><link rel="stylesheet" href="/fonts/apple-sd-gothic-neo/fonts.css"></head><body><div id="qa"></div><script type="module">
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Canvas} from '/src/features/canvas/Canvas.tsx';import {ConfirmProvider} from '/src/components/ui/ConfirmProvider.tsx';import {createEmptyDocument,addDomain,addTable,addColumn,upsertKey,createForeignKeyFromPrimaryKey} from '@ezerd/model';
import '/src/components/ui/tailwind.css';import '/src/styles/tokens.css';import '/src/components/ui/ui.css';import '/src/styles/styles.css';import '/src/styles/inspector.css';
const h=React.createElement,meta={common:{},logical:{},physical:{}};let seed=createEmptyDocument();for(const [id,name,x] of [['a','주문',40],['b','결제',450],['c','배송',860]])seed=addDomain(seed,{id,name,description:'업무 설명을 확인합니다.'},{x,y:60});
for(const [id,domainId,name,x] of [['t1','a','orders',0],['t2','b','payments',0],['t3','c','deliveries',0]]){seed=addTable(seed,{id,domainId,scope:'physical',logical:{name,definition:''},physical:{name,schema:'public',comment:''},customProperties:meta},{x,y:0});seed=addColumn(seed,{id:id+'c',tableId:id,scope:'physical',logical:{name:'식별자',definition:'',dataType:'',nullable:false},physical:{name:'id',type:{name:'uuid'},nullable:false,defaultValue:'',comment:'고유 식별자'},customProperties:meta});seed=upsertKey(seed,{id:id+'pk',tableId:id,scope:'physical',kind:'primary',name:id+'_pk',columnIds:[id+'c']});}
seed=createForeignKeyFromPrimaryKey(seed,{relationId:'rel1',primaryTableId:'t1',foreignTableId:'t2',primaryKeyId:'t1pk',columnIds:['fk1']});
function Demo(){const [doc,setDoc]=useState(seed),[pin,setPin]=useState(null);return h(ConfirmProvider,null,h('main',{style:{height:'96vh'}},h(Canvas,{document:doc,onChange:setDoc,readOnly:false,onCreatePin:setPin}),h('output',{id:'document-state',hidden:true},JSON.stringify(doc)),h('output',{id:'pin-state',hidden:true},JSON.stringify(pin))));}createRoot(document.getElementById('qa')).render(h(Demo));
</script></body></html>`,
);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  acceptDownloads: true,
});
const errors = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.error(e.message);
});
const state = async () => JSON.parse(await page.locator('#document-state').textContent());
try {
  await page.goto('http://127.0.0.1:5173/' + filename);
  await page.getByRole('group', { name: '주문', exact: true }).waitFor();
  await page.getByRole('button', { name: '도메인 뷰', exact: true }).click();
  await page.getByLabel('도메인 뷰 이름').fill('주문과 결제');
  const apply = page.getByRole('button', { name: '적용', exact: true });
  assert.equal(await apply.isDisabled(), true);
  await page.getByRole('checkbox', { name: '주문', exact: true }).check();
  await page.getByRole('checkbox', { name: '결제', exact: true }).check();
  await apply.click();
  await page.getByRole('group', { name: 'orders', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: '도메인 뷰', exact: true }).count(), 0);
  assert.equal(await page.locator('.table-node').count(), 2);
  assert.equal(await page.locator('.breadcrumbs').innerText(), '← 도메인 맵으로\n주문과 결제');
  assert.deepEqual((await state()).views[0].domainIds, ['a', 'b']);
  await page.getByRole('group', { name: 'orders', exact: true }).click();
  const relationSection = page
    .locator('.inspector details')
    .filter({ has: page.locator(':scope > summary').filter({ hasText: '테이블 관계' }) })
    .first();
  await relationSection.locator(':scope > summary').click();
  const existing = relationSection.locator('details').first();
  await existing.locator(':scope > summary').click();
  const labels = await existing.locator('label').allTextContents();
  assert(
    labels.findIndex((x) => x.startsWith('출발 테이블 (PK)')) <
      labels.findIndex((x) => x.startsWith('대상 테이블 (FK)')),
    JSON.stringify(labels),
  );
  assert(
    labels.findIndex((x) => x.startsWith('출발 끝점 (PK)')) <
      labels.findIndex((x) => x.startsWith('대상 끝점 (FK)')),
    JSON.stringify(labels),
  );
  assert(
    labels.findIndex((x) => x.startsWith('PK / UNIQUE 컬럼')) <
      labels.findIndex((x) => x.startsWith('FK 컬럼')),
    JSON.stringify(labels),
  );
  const creation = page.getByRole('button', { name: '+ 테이블 관계 추가', exact: true });
  assert((await existing.boundingBox()).y < (await creation.boundingBox()).y);
  await page.screenshot({ path: '.cache/views-relations-order.png', fullPage: true });
  await page.getByRole('button', { name: '← 도메인 맵으로', exact: true }).click();
  await page.getByRole('group', { name: '주문', exact: true }).dblclick();
  await page.getByRole('group', { name: 'orders', exact: true }).waitFor();
  await page.getByRole('button', { name: /^목록/ }).click();
  const external = page
    .locator('.inspector details')
    .filter({ has: page.locator(':scope > summary').filter({ hasText: '다른 도메인 테이블' }) })
    .first();
  await external.locator(':scope > summary').click();
  await external.locator('.reference-table-row').waitFor({ state: 'visible' });
  assert.equal(await external.locator('.reference-table-row').count(), 1);
  assert.match(await external.innerText(), /payments/);
  assert.doesNotMatch(await external.innerText(), /deliveries/);
  assert.equal(await external.locator('button').count(), 0);
  const before = await state();
  await external.getByText('payments', { exact: true }).click();
  assert.deepEqual(await state(), before);
  assert.equal(await page.locator('.table-node').count(), 1);
  await page.screenshot({ path: '.cache/views-relations-references.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS apply immediately navigates and closes picker; PK precedes FK in all relationship fields; creation follows existing relations; external table list is filtered and click does not mutate document or nodes.',
  );
} finally {
  await browser.close();
  await unlink(target);
}
