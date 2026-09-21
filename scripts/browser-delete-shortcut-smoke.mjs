import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const filename = `__delete-shortcut-${Date.now()}.html`;
const target = new URL('../apps/web/' + filename, import.meta.url);
await writeFile(
  target,
  `<!doctype html><html><head><link rel="stylesheet" href="/fonts/apple-sd-gothic-neo/fonts.css"></head><body><div id="qa"></div><script type="module">
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {Canvas} from '/src/features/canvas/Canvas.tsx';import {ConfirmProvider} from '/src/components/ui/ConfirmProvider.tsx';
import {createEmptyDocument,addDomain,addTable,addColumn,upsertKey,createForeignKeyFromPrimaryKey,setViewport} from '@ezerd/model';
import '/src/components/ui/tailwind.css';import '/src/styles/tokens.css';import '/src/components/ui/ui.css';import '/src/styles/styles.css';import '/src/styles/inspector.css';
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
  await product.focus();
  await page.keyboard.press('Delete');
  let dialog = page.getByRole('dialog', { name: '테이블 삭제', exact: true });
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  assert.equal((await state()).tables.length, 2);
  await product.focus();
  await page.keyboard.press('Delete');
  dialog = page.getByRole('dialog', { name: '테이블 삭제', exact: true });
  await dialog.getByRole('button', { name: '삭제', exact: true }).click();
  assert.equal((await state()).tables.length, 1);
  assert.equal((await state()).tableRelations.length, 0);
  assert.equal(await commits(), 1);
  await user.focus();
  const input = page.locator('.table-inspector input').first();
  await input.focus();
  await page.keyboard.press('Delete');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal((await state()).tables.length, 1);
  await page.getByRole('button', { name: '← 도메인 맵으로', exact: true }).click();
  const domain = page.getByRole('group', { name: '테스트', exact: true });
  await domain.focus();
  await page.keyboard.press('Delete');
  dialog = page.getByRole('dialog', { name: '도메인 삭제', exact: true });
  await dialog.getByRole('button', { name: '삭제', exact: true }).click();
  assert.equal((await state()).domains.length, 0);
  assert.equal((await state()).tables.length, 0);
  assert.deepEqual(errors, []);
  console.log('PASS Delete table/domain, cancellation, input protection, dependent cleanup');
} finally {
  await browser?.close();
  await unlink(target);
}
