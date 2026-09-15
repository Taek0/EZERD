import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const filename = `__direct-editing-${Date.now()}.html`;
const target = new URL('../apps/web/' + filename, import.meta.url);
await writeFile(
  target,
  `<!doctype html><html><head><link rel="stylesheet" href="/fonts/apple-sd-gothic-neo/fonts.css"></head><body><div id="qa"></div><script type="module">
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {Canvas} from '/src/Canvas.tsx';import {ConfirmProvider} from '/src/components/ui/ConfirmProvider.tsx';
import {createEmptyDocument,addDomain,addTable,addColumn,upsertKey,createForeignKeyFromPrimaryKey,setViewport} from '@ezerd/model';
import '/src/components/ui/tailwind.css';import '/src/tokens.css';import '/src/components/ui/ui.css';import '/src/styles.css';import '/src/inspector.css';
const h=React.createElement,meta={common:{},logical:{},physical:{}};
let seed=addDomain(createEmptyDocument(),{id:'d',name:'테스트',description:'',color:'#2e90fa'},{x:40,y:40});
for(const [id,name,x,y] of [['user','user',0,0],['product','product',900,400]]){
 seed=addTable(seed,{id,domainId:'d',scope:'physical',logical:{name,definition:''},physical:{name,schema:'public',comment:''},customProperties:meta},{x,y});
 for(const [suffix,columnName,type] of [['id','id','uuid'],['note',id==='user'?'code':'note','text']])seed=addColumn(seed,{id:id+'-'+suffix,tableId:id,scope:'physical',logical:{name:columnName,definition:'',semanticType:'',required:false},physical:{name:columnName,type:{name:type,isArray:false},nullable:suffix!=='id',defaultExpression:null,comment:''},customProperties:meta});
 seed=upsertKey(seed,{id:id+'-pk',tableId:id,scope:'physical',kind:'primary',name:'',columnIds:[id+'-id']});
}
seed=createForeignKeyFromPrimaryKey(seed,{relationId:'r1',primaryTableId:'user',foreignTableId:'product',primaryKeyId:'user-pk',columnIds:['fk-base']});
seed=setViewport(seed,{viewId:'d',x:70,y:140,zoom:.75});
function Demo(){const [doc,setDoc]=useState(seed),[commits,setCommits]=useState(0);return h(ConfirmProvider,null,h('main',{style:{height:'96vh'}},h(Canvas,{document:doc,onChange:next=>{setDoc(next);setCommits(n=>n+1);},onPreviewChange:setDoc,readOnly:false}),h('button',{id:'fixture-isolate',onClick:()=>setDoc(d=>({...d,tableRelations:d.tableRelations.filter(r=>r.id==='r1')}))},'관계 격리'),h('button',{id:'fixture-reload',onClick:()=>setDoc(JSON.parse(JSON.stringify(doc)))} ,'문서 다시 읽기'),h('output',{id:'document-state',hidden:true},JSON.stringify(doc)),h('output',{id:'commits',hidden:true},commits)));}createRoot(document.getElementById('qa')).render(h(Demo));
</script></body></html>`,
);
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const state = async () => JSON.parse(await page.locator('#document-state').textContent());
  const commits = async () => Number(await page.locator('#commits').textContent());
  await page.goto('http://127.0.0.1:5173/' + filename);
  await page.getByRole('button', { name: '테스트 도메인 열기' }).click();
  const user = page.getByRole('group', { name: 'user', exact: true });
  const product = page.getByRole('group', { name: 'product', exact: true });
  const code = user.locator('.table-column-row').filter({ hasText: 'code' });
  assert.equal(await code.getByRole('combobox').count(), 0);
  const typeFont = await code.locator('.table-type-trigger').evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.fontFamily, style.fontSize, style.fontWeight, style.letterSpacing];
  });
  await code.getByRole('button', { name: 'code 타입 편집', exact: true }).click();
  assert.deepEqual(
    await code.getByRole('combobox').evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.fontFamily, style.fontSize, style.fontWeight, style.letterSpacing];
    }),
    typeFont,
  );
  await code.getByRole('combobox', { name: 'code 타입', exact: true }).fill('INTEGER');
  await page.getByRole('option', { name: 'INTEGER', exact: true }).click();
  assert.equal(
    (await state()).columns.find((c) => c.id === 'user-note').physical.type.name,
    'integer',
  );
  assert.equal(await code.getByRole('combobox').count(), 0);
  const typeTrigger = code.getByRole('button', { name: 'code 타입 편집', exact: true });
  await typeTrigger.focus();
  await typeTrigger.press('Enter');
  await code.getByRole('combobox').fill('VARCHAR');
  assert.equal(await code.locator('.ui-search-type svg').count(), 0);
  await code.getByRole('combobox').press('Escape');
  assert.equal(await code.getByRole('combobox').count(), 0);
  assert.equal(
    (await state()).columns.find((c) => c.id === 'user-note').physical.type.name,
    'integer',
  );
  await typeTrigger.click();
  await code.getByRole('combobox').press('Tab');
  assert.equal(await code.getByRole('combobox').count(), 0);
  await code.getByRole('checkbox', { name: 'code NULL 허용', exact: true }).uncheck();
  assert.equal((await state()).columns.find((c) => c.id === 'user-note').physical.nullable, false);
  const note = product.locator('.table-column-row').filter({ hasText: 'note' });
  await note.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /PK.*지정/ }).click();
  assert(
    (await state()).keys.find((key) => key.id === 'product-pk').columnIds.includes('product-note'),
  );
  await product.click({ position: { x: 20, y: 140 } });
  await page
    .locator('.table-inspector .panel-row')
    .filter({ hasText: 'note' })
    .getByRole('button')
    .click();
  await page
    .locator('.table-column-editor')
    .getByRole('checkbox', { name: '기본 키 (PK)', exact: true })
    .uncheck();
  assert.deepEqual((await state()).keys.find((key) => key.id === 'product-pk').columnIds, [
    'product-id',
  ]);

  const surface = page.locator('.canvas-surface');
  const surfaceBox = await surface.boundingBox();
  const beforeTables = (await state()).tables.length;
  await surface.click({ position: { x: 30, y: surfaceBox.height - 90 }, button: 'right' });
  await page.getByRole('menuitem', { name: '새 테이블 생성', exact: true }).click();
  assert.equal((await state()).tables.length, beforeTables + 1);

  await user.locator('.table-column-pk').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'PK에서 관계 연결', exact: true }).click();
  await product.click({ position: { x: 20, y: 100 } });
  const dialog = page.getByRole('dialog', { name: 'PK → FK 관계 만들기', exact: true });
  const newName = dialog.getByRole('textbox', { name: '새 FK 컬럼 이름 1' });
  assert((await newName.inputValue()).length > 0);
  await newName.fill('');
  assert.equal(
    await dialog.getByRole('button', { name: '컬럼 추가 및 관계 생성' }).isDisabled(),
    true,
  );
  await newName.fill('owner_id');
  await dialog.getByRole('button', { name: /PK 쪽 대응관계/ }).click();
  await page.getByRole('option', { name: '0..1 · 없거나 하나', exact: true }).click();
  await dialog.getByRole('button', { name: /FK 쪽 대응관계/ }).click();
  await page
    .getByRole('listbox', { name: /FK 쪽 대응관계/ })
    .getByRole('option', { name: '1 · 정확히 하나', exact: true })
    .click();
  const beforeCreate = await commits();
  await dialog.getByRole('button', { name: '컬럼 추가 및 관계 생성' }).click();
  assert.equal(await commits(), beforeCreate + 1);
  const created = (await state()).columns.find((c) => c.physical.name === 'owner_id');
  assert(created && created.physical.nullable);
  assert(
    (await state()).keys.some((key) => key.kind === 'unique' && key.columnIds.includes(created.id)),
  );

  await page.locator('#fixture-isolate').click();
  const controls = page.locator('.table-route-control-group[data-relation-id="r1"]');
  const segments = controls.locator('.table-route-segment');
  const segmentCount = await segments.count();
  const segmentIndex = Math.min(1, segmentCount - 1);
  const segment = segments.nth(segmentIndex);
  const dragPoint = await segment.evaluate((path) => {
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const transformed = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
    return {
      x: transformed.x,
      y: transformed.y,
      horizontal: path.classList.contains('horizontal'),
    };
  });
  const beforeDrag = await commits();
  const beforeRoutes = (await state()).layout.relations ?? [];
  await page.mouse.move(dragPoint.x, dragPoint.y);
  await page.mouse.down();
  await page.mouse.move(
    dragPoint.x + (dragPoint.horizontal ? 0 : 20),
    dragPoint.y + (dragPoint.horizontal ? 20 : 0),
    { steps: 4 },
  );
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await commits(), beforeDrag);
  assert.deepEqual((await state()).layout.relations ?? [], beforeRoutes);
  await page.mouse.move(dragPoint.x, dragPoint.y);
  await page.mouse.down();
  await page.mouse.move(
    dragPoint.x + (dragPoint.horizontal ? 0 : 32),
    dragPoint.y + (dragPoint.horizontal ? 32 : 0),
    { steps: 8 },
  );
  assert.equal(await commits(), beforeDrag);
  await page.mouse.up();
  assert.equal(await commits(), beforeDrag + 1);
  const route = (await state()).layout.relations.find((r) => r.relationId === 'r1');
  assert(route.waypoints.length > 0);
  const line = page.locator('.table-relation-line[data-relation-id="r1"] .table-relation-stroke');
  const savedPath = await line.getAttribute('d');
  await page.locator('#fixture-reload').click();
  assert.equal(await line.getAttribute('d'), savedPath);

  const fkHandle = controls.getByRole('button', { name: /^관계 FK 연결 위치 조절/ });
  const handleBox = await fkHandle.boundingBox();
  const productBox = await product.boundingBox();
  const beforeAnchor = await commits();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    productBox.x + productBox.width * 0.7,
    productBox.y + productBox.height + 6,
    { steps: 8 },
  );
  assert.equal(await commits(), beforeAnchor);
  await page.mouse.up();
  const movedAnchor = (await state()).layout.relations.find((r) => r.relationId === 'r1');
  assert.equal(movedAnchor.sourceAnchor.side, 'bottom');
  assert.deepEqual(movedAnchor.targetAnchor, route.targetAnchor);
  assert.equal(await commits(), beforeAnchor + 1);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '.cache/direct-editing.png', fullPage: true });
  console.log(
    'PASS card type/NULL/PK, inspector PK, context table, editable FK names/cardinality, atomic creation, segment/anchor drag and persistence',
  );
} finally {
  await browser?.close();
  await unlink(target);
}
