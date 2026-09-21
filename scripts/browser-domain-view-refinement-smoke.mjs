import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const filename = `__domain-refinement-${Date.now()}.html`,
  target = new URL('../apps/web/' + filename, import.meta.url);
await writeFile(
  target,
  `<!doctype html><html><head><link rel="stylesheet" href="/fonts/apple-sd-gothic-neo/fonts.css"></head><body><div id="qa"></div><script type="module">
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Canvas} from '/src/features/canvas/Canvas.tsx';import {ConfirmProvider} from '/src/components/ui/ConfirmProvider.tsx';import {createEmptyDocument,addDomain,addTable,addColumn,upsertKey,createForeignKeyFromPrimaryKey,setViewport} from '@ezerd/model';
import '/src/components/ui/tailwind.css';import '/src/styles/tokens.css';import '/src/components/ui/ui.css';import '/src/styles/styles.css';import '/src/styles/inspector.css';
const h=React.createElement,meta={common:{},logical:{},physical:{}};let seed=addDomain(createEmptyDocument(),{id:'a',name:'테스트',description:'',color:'#2e90fa'},{x:40,y:40});
seed=addDomain(seed,{id:'b',name:'결제',description:'',color:'#12b76a'},{x:450,y:40});
for(const [id,name,x,y] of [['t1','orders',0,0],['t2','payments',1100,500],['t3','barrier',730,-140]]){seed=addTable(seed,{id,domainId:id==='t3'?'b':'a',scope:'physical',logical:{name,definition:''},physical:{name,schema:'public',comment:''},customProperties:meta},{x,y});seed=addColumn(seed,{id:id+'c',tableId:id,scope:'physical',logical:{name:'id',definition:'',semanticType:'',required:true},physical:{name:'id',type:{name:'varchar',length:32,isArray:false},nullable:false,defaultExpression:null,comment:'식별자'},customProperties:meta});seed=upsertKey(seed,{id:id+'pk',tableId:id,scope:'physical',kind:'primary',name:id+'_pk',columnIds:[id+'c']});}
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
  const state = async () => JSON.parse(await page.locator('#document-state').textContent());
  const original = await state();
  await page.getByRole('button', { name: '도메인 뷰', exact: true }).click();
  assert.equal(await page.getByLabel('도메인 뷰 이름').count(), 0);
  assert.equal(await page.getByRole('button', { name: '새 뷰', exact: true }).count(), 0);
  const apply = page.getByRole('button', { name: '적용', exact: true });
  assert.equal(await apply.isDisabled(), true);
  await page.getByRole('checkbox', { name: '테스트', exact: true }).check();
  await page.getByRole('checkbox', { name: '결제', exact: true }).check();
  await apply.click();
  await page.locator('.table-node').first().waitFor();
  assert.equal(await page.locator('.table-node').count(), 3);
  let doc = await state();
  const id = doc.views[0].id,
    n = (table) => doc.layout.nodes.find((n) => n.viewId === id && n.objectId === table);
  assert.deepEqual([n('t2').x - n('t1').x, n('t2').y - n('t1').y], [1100, 500]);
  assert(n('t3').x >= n('t2').x + n('t2').width + 180);
  assert.deepEqual(
    doc.layout.nodes.filter((n) => ['a', 'b'].includes(n.viewId)),
    original.layout.nodes.filter((n) => ['a', 'b'].includes(n.viewId)),
  );
  await page.getByRole('button', { name: '도메인 뷰', exact: true }).click();
  await page.getByRole('checkbox', { name: '결제', exact: true }).uncheck();
  await page.getByRole('button', { name: '적용', exact: true }).click();
  doc = await state();
  assert.equal(doc.views.length, 1);
  assert.equal(doc.views[0].id, id);
  assert.equal(await page.locator('.table-node').count(), 2);
  assert.deepEqual([n('t2').x - n('t1').x, n('t2').y - n('t1').y], [1100, 500]);
  assert.equal(await page.locator('.table-relation-line').count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    'PASS checkbox-only domain picker, immediate apply, original relative coordinates, separated domains, one reusable view',
  );
} finally {
  await browser?.close();
  await unlink(target);
}
