import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const filename = `__table-feedback-${Date.now()}.html`;
const target = new URL('../apps/web/' + filename, import.meta.url);
await writeFile(
  target,
  `<!doctype html><html><head><link rel="stylesheet" href="/fonts/apple-sd-gothic-neo/fonts.css"></head><body><div id="qa"></div><script type="module">
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {Canvas} from '/src/Canvas.tsx';import {ConfirmProvider} from '/src/components/ui/ConfirmProvider.tsx';
import {createEmptyDocument,addDomain,addTable,addColumn,upsertKey,createForeignKeyFromPrimaryKey,setViewport,upsertDomainRelation} from '@ezerd/model';
import '/src/components/ui/tailwind.css';import '/src/tokens.css';import '/src/components/ui/ui.css';import '/src/styles.css';import '/src/inspector.css';
const h=React.createElement,meta={common:{},logical:{},physical:{}};
let seed=addDomain(createEmptyDocument(),{id:'d',name:'테스트',description:'',color:'#2e90fa'},{x:40,y:40});
for(const [id,name,x,y] of [['user','user',0,0],['product','product',900,400]]){
 seed=addTable(seed,{id,domainId:'d',scope:'physical',logical:{name,definition:''},physical:{name,schema:'public',comment:''},customProperties:meta},{x,y});
 for(const [suffix,columnName,type] of [['id','id','uuid'],['note',id==='user'?'code':'note','text']])seed=addColumn(seed,{id:id+'-'+suffix,tableId:id,scope:'physical',logical:{name:columnName,definition:'',semanticType:'',required:false},physical:{name:columnName,type:{name:type,isArray:false},nullable:suffix!=='id',defaultExpression:null,comment:''},customProperties:meta});
 seed=upsertKey(seed,{id:id+'-pk',tableId:id,scope:'physical',kind:'primary',name:'',columnIds:[id+'-id']});
}
seed=createForeignKeyFromPrimaryKey(seed,{relationId:'r1',primaryTableId:'user',foreignTableId:'product',primaryKeyId:'user-pk',columnIds:['fk-base']});
seed=addDomain(seed,{id:'d2',name:'보조',description:''},{x:550,y:40}); seed=upsertDomainRelation(seed,{id:'dr',sourceDomainId:'d',targetDomainId:'d2',name:'흐름',description:'',direction:'forward'}); seed=setViewport(seed,{viewId:'d',x:70,y:140,zoom:.75});
function Demo(){const [doc,setDoc]=useState(seed),[commits,setCommits]=useState(0);return h(ConfirmProvider,null,h('main',{style:{height:'96vh'}},h(Canvas,{document:doc,onChange:next=>{setDoc(next);setCommits(n=>n+1);},onPreviewChange:setDoc,readOnly:false}),h('button',{id:'fixture-isolate',onClick:()=>setDoc(d=>({...d,tableRelations:d.tableRelations.filter(r=>r.id==='r1')}))},'관계 격리'),h('button',{id:'fixture-reload',onClick:()=>setDoc(JSON.parse(JSON.stringify(doc)))} ,'문서 다시 읽기'),h('output',{id:'document-state',hidden:true},JSON.stringify(doc)),h('output',{id:'commits',hidden:true},commits)));}createRoot(document.getElementById('qa')).render(h(Demo));
</script></body></html>`,
);
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  const state = async () => JSON.parse(await page.locator('#document-state').textContent());
  const commits = async () => Number(await page.locator('#commits').textContent());
  await page.goto((process.env.EZERD_WEB_URL || 'http://127.0.0.1:5175') + '/' + filename);
  await page.locator('.relation').getByText('흐름').click();
  await page.getByRole('textbox', { name: '관계 이름', exact: true }).fill('변경 흐름');
  assert.equal((await state()).domainRelations[0].name, '변경 흐름');
  assert.equal(await page.getByRole('button', { name: '관계 수정', exact: true }).count(), 0);
  await page.getByRole('textbox', { name: '관계 이름', exact: true }).fill('');
  assert.equal((await state()).domainRelations[0].name, '변경 흐름');
  await page.getByRole('textbox', { name: '관계 이름', exact: true }).fill('완료 흐름');
  await page.getByRole('button', { name: '테스트 도메인 열기' }).click();
  const user = page.getByRole('group', { name: 'user', exact: true });
  assert.equal(
    await user.locator('header strong').evaluate((e) => getComputedStyle(e).fontSize),
    '28px',
  );
  await user.focus();
  await page
    .locator('.table-inspector .panel-row')
    .filter({ hasText: 'code' })
    .getByRole('button')
    .click();
  const controls = page.locator('.table-column-type-controls');
  const typeBox = await controls.getByRole('combobox', { name: '타입', exact: true }).boundingBox();
  const enumBox = await controls.getByRole('button', { name: /ENUM/ }).boundingBox();
  assert(typeBox.x < enumBox.x);
  let width = (await user.boundingBox()).width;
  await user.locator('header').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'NULL 숨기기', exact: true }).click();
  const noNull = (await user.boundingBox()).width;
  assert(noNull < width);
  await user.locator('header').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'comment 숨기기', exact: true }).click();
  assert((await user.boundingBox()).width < noNull);
  await page.getByRole('button', { name: 'ENUM', exact: true }).click();
  assert.equal(
    await page.locator('.enum-dialog').evaluate((e) => getComputedStyle(e).animationName),
    'enum-dialog-enter',
  );
  await page.getByRole('button', { name: 'ENUM 관리 닫기' }).click();
  await page.locator('.table-relation-line[data-relation-id="r1"]').press('Enter');
  await page.getByRole('button', { name: /ON DELETE/ }).waitFor();
  await page.getByRole('button', { name: /ON UPDATE/ }).waitFor();
  const dot = page.locator('.table-route-endpoint-dot').first();
  assert.equal(await dot.getAttribute('r'), '4');
  assert.notEqual(await dot.evaluate((e) => getComputedStyle(e).fill), 'none');
  await page.getByRole('button', { name: '도메인 뷰', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '도메인 뷰' });
  await picker.getByRole('checkbox', { name: '테스트', exact: true }).check();
  await picker.getByRole('checkbox', { name: '보조', exact: true }).check();
  await picker.getByRole('button', { name: '적용', exact: true }).click();
  const before = (await state()).layout.nodes;
  const userBox = await user.boundingBox();
  await page.mouse.move(userBox.x + 20, userBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(userBox.x + 60, userBox.y + 50, { steps: 3 });
  await page.mouse.up();
  assert.deepEqual((await state()).layout.nodes, before);
  const segment = page
    .locator('.table-route-control-group[data-relation-id="r1"] .table-route-segment')
    .nth(1);
  const pos = await segment.evaluate((e) => {
    const p = e.getPointAtLength(e.getTotalLength() / 2);
    const q = new DOMPoint(p.x, p.y).matrixTransform(e.getScreenCTM());
    return { x: q.x, y: q.y, h: e.classList.contains('horizontal') };
  });
  const count = await commits();
  await page.mouse.move(pos.x, pos.y);
  await page.mouse.down();
  await page.mouse.move(pos.x + (pos.h ? 0 : 20), pos.y + (pos.h ? 20 : 0), { steps: 4 });
  await page.mouse.up();
  assert.equal(await commits(), count + 1);
  assert.deepEqual((await state()).layout.nodes, before);
  assert(
    (await state()).layout.relations.some((r) => r.relationId === 'r1' && r.waypoints?.length),
  );
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '.cache/table-feedback.png', fullPage: true });
  console.log(
    'PASS domain live edits, type/ENUM order, hidden width, fonts, ENUM motion, FK actions, endpoint dots, fixed combined tables with draggable routes',
  );
} finally {
  await browser?.close();
  await unlink(target);
}
