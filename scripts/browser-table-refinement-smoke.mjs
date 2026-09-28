import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const filename = `__table-refinement-${Date.now()}.html`,
  target = new URL('../apps/web/' + filename, import.meta.url);
await writeFile(
  target,
  `<!doctype html><html><head><link rel="stylesheet" href="/fonts/apple-sd-gothic-neo/fonts.css"></head><body><div id="qa"></div><script type="module">
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Canvas} from '/src/features/canvas/Canvas.tsx';import {ConfirmProvider} from '/src/components/ui/ConfirmProvider.tsx';import {createEmptyDocument,addDomain,addTable,addColumn,upsertKey,createForeignKeyFromPrimaryKey,setViewport} from '@ezerd/model';
import '/src/components/ui/tailwind.css';import '/src/styles/tokens.css';import '/src/components/ui/ui.css';import '/src/styles/styles.css';import '/src/styles/inspector.css';
const h=React.createElement,meta={common:{},logical:{},physical:{}};let seed=addDomain(createEmptyDocument(),{id:'a',name:'테스트',description:'',color:'#2e90fa'},{x:40,y:40});
for(const [id,name,x,y] of [['t1','orders',0,0],['t2','payments',1100,500],['t3','barrier',730,-140]]){seed=addTable(seed,{id,domainId:'a',scope:'physical',logical:{name,definition:''},physical:{name,schema:'public',comment:''},customProperties:meta},{x,y});seed=addColumn(seed,{id:id+'c',tableId:id,scope:'physical',logical:{name:'id',definition:'',semanticType:'',required:true},physical:{name:'id',type:{name:'varchar',length:32,isArray:false},nullable:false,defaultExpression:null,comment:'식별자'},customProperties:meta});seed=upsertKey(seed,{id:id+'pk',tableId:id,scope:'physical',kind:'primary',name:id+'_pk',columnIds:[id+'c']});}
seed=addColumn(seed,{...seed.columns[0],id:'t1extra',physical:{...seed.columns[0].physical,name:'title'}});seed.enums=Array.from({length:60},(_,i)=>({id:'enum'+i,name:'state_'+i,schema:'public',values:['pending','ready','done','archived']}));
seed=createForeignKeyFromPrimaryKey(seed,{relationId:'rel1',primaryTableId:'t1',foreignTableId:'t2',primaryKeyId:'t1pk',columnIds:['fk1']});seed=setViewport(seed,{viewId:'a',x:70,y:120,zoom:.65});
function Demo(){const [doc,setDoc]=useState(seed);return h(ConfirmProvider,null,h('main',{style:{height:'96vh'}},h(Canvas,{document:doc,onChange:setDoc,readOnly:false}),h('output',{id:'document-state',hidden:true},JSON.stringify(doc))));}createRoot(document.getElementById('qa')).render(h(Demo));
</script></body></html>`,
);
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1700, height: 1050 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/' + filename);
  await page.getByRole('button', { name: '테스트 도메인 열기' }).click();
  const state = async () => JSON.parse(await page.locator('#document-state').textContent());
  const card = page.getByRole('group', { name: 'orders', exact: true });
  await card.waitFor();
  assert.equal(
    await card.locator('header').evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgb(46, 144, 250)',
  );
  assert.match(await card.innerText(), /VARCHAR\(32\)/);
  await card.locator('[data-inline-cell]').nth(1).dblclick();
  await card.getByRole('textbox', { name: '컬럼명', exact: true }).fill('order_code');
  await page.keyboard.press('Tab');
  assert.equal(
    await card
      .getByRole('textbox', { name: '컬럼 comment', exact: true })
      .evaluate((e) => document.activeElement === e),
    true,
  );
  await card.getByRole('textbox', { name: '컬럼 comment', exact: true }).fill('설명 변경');
  await page.keyboard.press('Tab');
  assert.equal(
    await card.getByRole('textbox', { name: '컬럼명', exact: true }).inputValue(),
    'title',
  );
  await page.keyboard.press('Shift+Tab');
  assert.equal(
    await card.getByRole('textbox', { name: '컬럼 comment', exact: true }).inputValue(),
    '설명 변경',
  );
  await page.keyboard.press('Escape');
  assert.equal((await state()).columns.find((c) => c.id === 't1c').physical.name, 'order_code');
  await card.locator('header').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'NULL 숨기기', exact: true }).click();
  await card.locator('header').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'comment 숨기기', exact: true }).click();
  assert.equal(await card.locator('.table-column-head span').count(), 3);
  assert.deepEqual((await state()).tables.find((t) => t.id === 't1').canvasDisplay, {
    showNullable: false,
    showComment: false,
  });
  await card.click({ position: { x: 20, y: 130 } });
  const rows = page.locator('.table-inspector .panel-row[draggable=true]');
  await rows.first().waitFor();
  await rows.nth(1).getByRole('button').click();
  const editor = page.locator('.table-column-editor');
  await editor.waitFor();
  assert.equal(
    await editor.evaluate((e) =>
      e.parentElement.previousElementSibling.textContent.includes('title'),
    ),
    true,
  );
  assert.equal(
    await editor.evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgb(238, 243, 255)',
  );
  await editor.getByLabel('길이', { exact: true }).fill('48');
  assert.match(await card.innerText(), /VARCHAR\(48\)/);
  assert.match(await rows.nth(1).innerText(), /VARCHAR\(48\)/);
  await rows.first().dragTo(rows.nth(1));
  assert.deepEqual(
    (await state()).columns.filter((c) => c.tableId === 't1').map((c) => c.id),
    ['t1extra', 't1c'],
  );
  assert.equal(
    await editor.evaluate((e) =>
      e.parentElement.previousElementSibling.textContent.includes('title'),
    ),
    true,
  );
  await editor.getByRole('button', { name: '컬럼 편집 닫기' }).click();
  await editor.waitFor({ state: 'detached' });
  assert.equal(await rows.first().getByRole('button').getAttribute('aria-expanded'), 'false');
  await rows.first().getByRole('button').click();
  await editor.waitFor();
  await card.locator('.table-column-row').filter({ hasText: 'title' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '컬럼 삭제', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click();
  assert.equal(
    (await state()).columns.some((c) => c.id === 't1extra'),
    false,
  );
  await page.getByRole('button', { name: 'ENUM', exact: true }).click();
  await page.getByRole('textbox', { name: 'ENUM 검색' }).fill('state_45');
  assert.equal(await page.locator('.table-enum-item').count(), 1);
  assert.match(await page.locator('.table-enum-item').innerText(), /state_45/);
  const fieldset = page.locator('.table-enum-form');
  assert.equal(await fieldset.evaluate((e) => getComputedStyle(e).borderTopWidth), '0px');
  await page.getByLabel('ENUM 이름', { exact: true }).fill('new_state');
  await page
    .getByLabel('ENUM 값 (한 줄에 하나, 빈 줄은 빈 문자열)', { exact: true })
    .fill('one\ntwo');
  await page.getByRole('button', { name: 'ENUM 생성', exact: true }).click();
  assert.deepEqual((await state()).enums.find((e) => e.name === 'new_state').values, [
    'one',
    'two',
  ]);
  await page.screenshot({ path: '.cache/table-refinement.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS type dimensions, domain header color, Tab/ShiftTab commit, hidden fields, drag reorder, custom deletion, searchable compact ENUM',
  );
} finally {
  await browser?.close();
  await unlink(target);
}
