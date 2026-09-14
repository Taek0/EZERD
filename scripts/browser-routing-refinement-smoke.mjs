import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
const {chromium}=await import(process.env.EZERD_PLAYWRIGHT_MODULE||'playwright');
const filename=`__routing-refinement-${Date.now()}.html`,target=new URL('../apps/web/'+filename,import.meta.url);
await writeFile(target,`<!doctype html><html><head><link rel="stylesheet" href="/fonts/apple-sd-gothic-neo/fonts.css"></head><body><div id="qa"></div><script type="module">
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Canvas} from '/src/Canvas.tsx';import {ConfirmProvider} from '/src/components/ui/ConfirmProvider.tsx';import {createEmptyDocument,addDomain,addTable,addColumn,upsertKey,createForeignKeyFromPrimaryKey,setViewport} from '@ezerd/model';
import '/src/components/ui/tailwind.css';import '/src/tokens.css';import '/src/components/ui/ui.css';import '/src/styles.css';import '/src/inspector.css';
const h=React.createElement,meta={common:{},logical:{},physical:{}};let seed=addDomain(createEmptyDocument(),{id:'a',name:'테스트',description:'',color:'#2e90fa'},{x:40,y:40});
for(const [id,name,x,y] of [['t1','orders',0,0],['t2','payments',1100,500],['t3','barrier',730,-140]]){seed=addTable(seed,{id,domainId:'a',scope:'physical',logical:{name,definition:''},physical:{name,schema:'public',comment:''},customProperties:meta},{x,y});seed=addColumn(seed,{id:id+'c',tableId:id,scope:'physical',logical:{name:'id',definition:'',semanticType:'',required:true},physical:{name:'id',type:{name:'varchar',length:32,isArray:false},nullable:false,defaultExpression:null,comment:'식별자'},customProperties:meta});seed=upsertKey(seed,{id:id+'pk',tableId:id,scope:'physical',kind:'primary',name:id+'_pk',columnIds:[id+'c']});}
seed=createForeignKeyFromPrimaryKey(seed,{relationId:'rel1',primaryTableId:'t1',foreignTableId:'t2',primaryKeyId:'t1pk',columnIds:['fk1']});seed=setViewport(seed,{viewId:'a',x:70,y:120,zoom:.65});
function Demo(){const [doc,setDoc]=useState(seed);return h(ConfirmProvider,null,h('main',{style:{height:'96vh'}},h(Canvas,{document:doc,onChange:setDoc,readOnly:false}),h('output',{id:'document-state',hidden:true},JSON.stringify(doc))));}createRoot(document.getElementById('qa')).render(h(Demo));
</script></body></html>`);
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1700,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/'+filename);await page.getByRole('button',{name:'테스트 도메인 열기'}).click();
 const relation=page.locator('.table-relation-line[data-relation-id="rel1"]');await relation.waitFor();
 const hit=relation.locator('.table-relation-hit');
 const location=await hit.evaluate(path=>{const p=path.getPointAtLength(path.getTotalLength()*.4),m=path.getScreenCTM();const t=new DOMPoint(p.x,p.y).matrixTransform(m);return {x:t.x,y:t.y};});
 await page.mouse.click(location.x,location.y);
 await page.locator('.inspector-selection .selection-kind').filter({hasText:'테이블 관계'}).waitFor();assert.equal(await page.locator('.table-node.selected').count(),0);assert.equal(await relation.evaluate(e=>e.classList.contains('selected')),true);
 await page.locator('.inspector .table-inspector details').evaluate(e=>{if(!e.open)throw new Error('Selected relation editor should be open');});
 await page.getByRole('button',{name:/출발 테이블/}).waitFor();
 const pathBefore=await hit.getAttribute('d');const adjust=page.getByRole('button',{name:'관계 선 조절 orders.id:payments'});const rect=await adjust.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2-150,rect.y+rect.height/2+110,{steps:8});await page.mouse.up();assert.notEqual(await hit.getAttribute('d'),pathBefore);
 await relation.locator('.table-relation-label').click({button:'right'});await page.getByRole('menuitem',{name:'관계 선 자동 정리'}).click();assert.equal(await hit.getAttribute('d'),pathBefore);
 const gap=await relation.evaluate(g=>{const r=g.getBBox(),m=g.getScreenCTM();for(let x=r.x+20;x<r.x+r.width;x+=35)for(let y=r.y+25;y<r.y+r.height;y+=35){const p=new DOMPoint(x,y).matrixTransform(m),el=document.elementFromPoint(p.x,p.y);if(el?.classList.contains('canvas-surface')||el?.classList.contains('canvas-world'))return {x:p.x,y:p.y};}return null;});
 assert(gap,'The empty area inside a bent relation must remain canvas background');if(gap){await page.mouse.click(gap.x,gap.y);assert.equal(await relation.evaluate(e=>e.classList.contains('selected')),false);}
 await page.screenshot({path:'.cache/routing-refinement.png',fullPage:true});assert.deepEqual(errors,[]);console.log('PASS independent relation selection, PK-first inspector, drag route, automatic reset, no browser errors');
}finally{await browser?.close();await unlink(target);}
