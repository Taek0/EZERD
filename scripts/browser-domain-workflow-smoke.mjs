import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
const {chromium}=await import(process.env.EZERD_PLAYWRIGHT_MODULE||'playwright');
const filename=`__domain-workflow-${Date.now()}.html`;
const target=new URL('../apps/web/'+filename,import.meta.url);
const html=`<!doctype html><html><head><link rel="stylesheet" href="/fonts/apple-sd-gothic-neo/fonts.css"></head><body><div id="qa"></div><script type="module">
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Canvas} from '/src/Canvas.tsx';import {createEmptyDocument,addDomain,upsertDomainRelation} from '@ezerd/model';
import '/src/components/ui/tailwind.css';import '/src/tokens.css';import '/src/components/ui/ui.css';import '/src/styles.css';
const h=React.createElement;let seed=createEmptyDocument();for(const [id,name,x,y] of [['a','Alpha',40,60],['b','Beta',390,60],['c','Gamma',390,390]])seed=addDomain(seed,{id,name,description:''},{x,y});
for(const [id,name] of [['r1','첫 흐름'],['r2','두번째 흐름']])seed=upsertDomainRelation(seed,{id,name,sourceDomainId:'a',targetDomainId:'b',direction:'forward',description:''});
function Demo(){const [doc,setDoc]=useState(seed);return h('main',{style:{height:'96vh'}},h(Canvas,{document:doc,onChange:setDoc,readOnly:false}),h('output',{id:'document-state',hidden:true},JSON.stringify(doc)));}createRoot(document.getElementById('qa')).render(h(Demo));
</script></body></html>`;
await writeFile(target,html);const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const state=async()=>JSON.parse(await page.locator('#document-state').textContent());const card=name=>page.getByRole('group',{name,exact:true});const blank=async()=>{const canvas=page.getByLabel('도메인 맵 캔버스',{exact:true});const box=await canvas.boundingBox();await canvas.click({position:{x:12,y:box.height-80},button:'right'});};
try {
 await page.goto((process.env.EZERD_WEB_URL||'http://127.0.0.1:5173')+'/'+filename);await card('Alpha').waitFor();
 assert.equal(await page.locator('.domain-panel-section[open]').count(),0);assert.equal(await page.getByRole('button',{name:'새 도메인 관계 생성',exact:true}).getAttribute('aria-expanded'),'false');
 const paths=await page.locator('g.relation > path').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')));assert.equal(new Set(paths).size,2,'parallel links have distinct curves');
 await card('Alpha').click({button:'right'});await page.getByRole('menuitem',{name:'도메인 직접 연결',exact:true}).click();await page.keyboard.press('Escape');assert.equal((await state()).domainRelations.length,2);
 await card('Alpha').click({button:'right'});await page.getByRole('menuitem',{name:'도메인 직접 연결',exact:true}).click();await card('Beta').click();assert.equal((await state()).domainRelations.length,3);
 assert.equal(await page.getByRole('button',{name:/연결된 도메인 관계/}).getAttribute('aria-expanded'),'true');
 const beforeFilter=await state();await card('Alpha').click({button:'right'});await page.getByRole('menuitem',{name:'연결된 도메인 강조',exact:true}).click();assert.match(await card('Gamma').getAttribute('class'),/domain-dimmed/);assert.doesNotMatch(await card('Beta').getAttribute('class'),/domain-dimmed/);assert.deepEqual(await state(),beforeFilter,'filter must never mutate document');await page.getByRole('button',{name:'강조 해제',exact:true}).click();
 await card('Alpha').click({button:'right'});await page.getByRole('menuitem',{name:'새 도메인 관계',exact:true}).click();assert.equal(await page.getByLabel('출발 도메인',{exact:true}).inputValue(),'a');await page.getByLabel('도착 도메인',{exact:true}).selectOption('c');await page.getByLabel('관계 이름',{exact:true}).fill('추가 흐름');await page.getByRole('button',{name:'관계 연결',exact:true}).click();assert.equal((await state()).domainRelations.length,4);
 const beforeLayout=await state();await blank();await page.getByRole('menuitem',{name:'자동 배치',exact:true}).click();const afterLayout=await state();assert.deepEqual(afterLayout.domains,beforeLayout.domains);assert.deepEqual(afterLayout.domainRelations,beforeLayout.domainRelations);assert.notDeepEqual(afterLayout.layout.nodes,beforeLayout.layout.nodes);
 const boxes=await page.locator('.domain-node').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};}));for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert(a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top,'automatic layout must not overlap rendered domain cards');}
 await blank();await page.getByRole('menuitem',{name:'새 도메인 생성',exact:true}).click();const afterCreate=await state();assert.equal(afterCreate.domains.length,4);assert.equal(afterCreate.domains.at(-1).color,'#8993a3');
 const contextNode=afterCreate.layout.nodes.find(n=>n.objectId===afterCreate.domains.at(-1).id);await page.getByRole('button',{name:'＋ 도메인',exact:true}).click();const toolbarDoc=await state();const toolbarNode=toolbarDoc.layout.nodes.find(n=>n.objectId===toolbarDoc.domains.at(-1).id);assert.notDeepEqual({x:toolbarNode.x,y:toolbarNode.y},{x:contextNode.x,y:contextNode.y},'toolbar create uses viewport center, not stale context position');
 assert.deepEqual(errors,[]);await page.screenshot({path:'.cache/domain-workflow.png',fullPage:true});console.log('PASS: collapsed groups, parallel curves, direct connect/Escape, selected relations, non-mutating filter, relation panel create, manual layout, gray domain creation.');
} finally {await browser.close();await unlink(target);}
