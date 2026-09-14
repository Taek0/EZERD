import {chooseSelect,selectTrigger,stablePopover} from './browser-select.mjs';
import assert from 'node:assert/strict';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
const {chromium}=await import(process.env.EZERD_PLAYWRIGHT_MODULE||'playwright');
const filename=`__ui-qa-${Date.now()}.html`;
const target=new URL('../apps/web/'+filename,import.meta.url);
const html=`<!doctype html><html><head><link rel="stylesheet" href="/fonts/apple-sd-gothic-neo/fonts.css"></head><body><div id="qa"></div><script type="module">
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {Button,IconButton,Input,Select,Checkbox,Field,ContextMenu,TabButton} from '/src/components/ui/index.tsx';
import '/src/components/ui/tailwind.css';import '/src/tokens.css';import '/src/components/ui/ui.css';import '/src/styles.css';
const h=React.createElement;
function Demo(){const [actions,A]=useState(0),[submits,S]=useState(0),[position,P]=useState(null),[selected,V]=useState('a'),[checked,C]=useState(false),[blockedMode,B]=useState('');
return h('main',{style:{padding:32,maxWidth:600}},h('form',{onSubmit:e=>{e.preventDefault();S(n=>n+1)}},
h(Field,{id:'qa-name',label:'이름',hint:'힌트',error:'검증 안내'},h(Input,{defaultValue:'테스트',required:true})),
h(Button,{onClick:()=>A(n=>n+1)},'일반'),h(Button,{disabled:true,onClick:()=>A(n=>n+100)},'비활성'),h(Button,{id:'loading-button',loading:true,onClick:()=>A(n=>n+100)},'로딩'),h(Button,{type:'submit'},'제출')),
h('fieldset',{id:'dynamic-fieldset',style:{border:0,padding:0,margin:0}},h('label',{},'선택',h(Select,{'aria-label':'선택',value:selected,onValueChange:V,readOnly:blockedMode==='readonly',disabled:blockedMode==='disabled'},h('option',{value:'a'},'Alpha'),h('option',{value:'b'},'Beta')))),
h('fieldset',{disabled:true},h('legend',{},'읽기 전용'),h(Select,{'aria-label':'비활성 선택',value:'a',onValueChange:()=>A(n=>n+100)},h('option',{value:'a'},'Alpha'),h('option',{value:'b'},'Beta')),h(Input,{'aria-label':'비활성 입력',defaultValue:'읽기 전용'})),
h('label',{},h(Checkbox,{checked,onChange:e=>C(e.target.checked)}),'확인'),
h(IconButton,{'aria-label':'도움말',tooltip:'필드 도움말'},'?'),
h(Button,{id:'menu-trigger',onClick:()=>P({x:160,y:400})},'메뉴 열기'),
h(ContextMenu,{position,onClose:()=>P(null),label:'작업 메뉴',items:[{id:'disabled',label:'차단 항목',disabled:true,onAction:()=>A(n=>n+100)},{id:'first',label:'첫 항목',onAction:()=>{A(n=>n+1);document.getElementById('qa-name').focus()}},{id:'second',label:'둘째 항목',onAction:()=>A(n=>n+1)}]}),
h('div',{className:'tabs'},h(TabButton,{selected:true},'진행 중'),h(TabButton,{selected:false},'보관함')),
h(Button,{id:'readonly-toggle','aria-pressed':blockedMode==='readonly',onClick:()=>B(v=>v==='readonly'?'':'readonly')},'QA 읽기 전용 전환'),h(Button,{id:'disabled-toggle','aria-pressed':blockedMode==='disabled',onClick:()=>B(v=>v==='disabled'?'':'disabled')},'QA 비활성 전환'),
h('output',{id:'result'},JSON.stringify({actions,submits,selected,checked})));}
createRoot(document.getElementById('qa')).render(h(Demo));
</script></body></html>`;
await writeFile(target,html);
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1000,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const button=name=>page.getByRole('button',{name,exact:true});
const state=async()=>JSON.parse(await page.locator('#result').innerText());
try{
 await mkdir('.cache/verification',{recursive:true});await page.goto('http://127.0.0.1:5173/'+filename);await button('일반').waitFor();
 await button('일반').click();assert.deepEqual(await state(),{actions:1,submits:0,selected:'a',checked:false});
 for(const name of ['비활성','로딩']){assert(await button(name).isDisabled());await button(name).evaluate(el=>el.click());}
 assert.equal((await state()).actions,1);
 await button('제출').click();assert.equal((await state()).submits,1);
 await page.getByLabel('이름',{exact:true}).press('Enter');assert.equal((await state()).submits,2);
 assert.equal(await page.getByLabel('이름',{exact:true}).getAttribute('aria-describedby'),'qa-name-hint qa-name-error');
 await chooseSelect(page,page,/^선택/,'Beta');await page.getByRole('checkbox',{name:'확인',exact:true}).check();assert.equal((await state()).selected,'b');assert.equal((await state()).checked,true);
 const choice=selectTrigger(page,/^선택/);
 assert(await selectTrigger(page,/^비활성 선택/).isDisabled(),'Select must inherit disabled fieldset');
 await choice.focus();await page.keyboard.press('ArrowDown');await page.getByRole('listbox').waitFor();await stablePopover(page);await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='option');await page.keyboard.press('Home');await page.keyboard.press('Enter');await page.getByRole('listbox').waitFor({state:'hidden'});assert.equal((await state()).selected,'a');
 await choice.focus();await page.keyboard.press('ArrowDown');await page.getByRole('listbox').waitFor();await stablePopover(page);await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='option');await page.keyboard.press('Escape');await page.getByRole('listbox').waitFor({state:'hidden'});assert(await choice.evaluate(el=>el===document.activeElement),'Escape restores Select trigger focus');
 await choice.click();await page.getByRole('option',{name:'Beta',exact:true}).waitFor();await stablePopover(page);await page.screenshot({path:'.cache/verification/untitled-components-select.png'});await page.keyboard.press('Escape');await page.getByRole('listbox').waitFor({state:'hidden'});
 await choice.focus();await page.keyboard.press('ArrowDown');await page.getByRole('listbox').waitFor();await stablePopover(page);await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='option');await page.keyboard.press('Tab');await page.getByRole('listbox').waitFor({state:'hidden'});assert(!(await choice.evaluate(el=>el===document.activeElement)),'Tab moves beyond Select');
 assert(await page.getByRole('checkbox',{name:'확인',exact:true}).evaluate(el=>el===document.activeElement),'Tab skips disabled fieldset and reaches checkbox');
 await choice.focus();await page.keyboard.press('ArrowDown');await page.getByRole('listbox').waitFor();await stablePopover(page);await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='option');await page.keyboard.press('Shift+Tab');await page.getByRole('listbox').waitFor({state:'hidden'});assert(await button('제출').evaluate(el=>el===document.activeElement),'Shift+Tab reaches preceding submit button');
 // Host state can change while its Select overlay is open. These fixture-only
 // controls intentionally invoke application state updates outside the modal overlay.
 const beforeBlocked=(await state()).selected;
 await choice.click();await page.getByRole('listbox').waitFor();await stablePopover(page);
 await page.locator('#dynamic-fieldset').evaluate(el=>{el.disabled=true;});await page.getByRole('listbox').waitFor({state:'hidden'});assert(await choice.isDisabled());assert.equal((await state()).selected,beforeBlocked);
 await page.locator('#dynamic-fieldset').evaluate(el=>{el.disabled=false;});await page.waitForFunction(()=>!document.querySelector('button.ui-select[aria-label="선택"]').disabled);assert.equal(await choice.getAttribute('aria-expanded'),'false');assert.equal(await page.getByRole('listbox').count(),0);
 for(const mode of ['readonly','disabled']) {
   await choice.click();await page.getByRole('listbox').waitFor();await stablePopover(page);
   const toggle=page.locator('#'+mode+'-toggle');await toggle.evaluate(el=>el.click());await page.getByRole('listbox').waitFor({state:'hidden'});assert.equal(await toggle.getAttribute('aria-pressed'),'true');assert.equal((await state()).selected,beforeBlocked);
   if(mode==='disabled')assert(await choice.isDisabled());else {await choice.click();assert.equal(await choice.getAttribute('aria-expanded'),'false');assert.equal(await page.getByRole('listbox').count(),0);}
   await toggle.click();assert.equal(await toggle.getAttribute('aria-pressed'),'false');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await choice.getAttribute('aria-expanded'),'false');assert.equal(await page.getByRole('listbox').count(),0);assert.equal((await state()).selected,beforeBlocked);
 }
 await button('도움말').focus();await page.getByRole('tooltip').waitFor();assert.equal(await page.getByRole('tooltip').innerText(),'필드 도움말');await page.keyboard.press('Escape');
 await button('메뉴 열기').click();await page.getByRole('menu',{name:'작업 메뉴'}).waitFor();await stablePopover(page);await page.screenshot({path:'.cache/verification/untitled-components-menu.png'});
 await page.waitForFunction(()=>document.activeElement?.textContent==='첫 항목');await page.keyboard.press('ArrowDown');await page.waitForFunction(()=>document.activeElement?.textContent==='둘째 항목');await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.activeElement?.id==='menu-trigger');assert.equal(await page.getByRole('menu').count(),0);
 await button('메뉴 열기').click();await page.getByRole('menuitem',{name:'첫 항목',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.id==='qa-name');assert.equal((await state()).actions,2);
 await button('메뉴 열기').click();await page.getByLabel('이름',{exact:true}).click();assert.equal(await page.getByRole('menu').count(),0);
 assert.equal(await button('진행 중').evaluate(el=>getComputedStyle(el).color),'rgb(48, 91, 231)');assert.notEqual(await button('진행 중').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
 assert.deepEqual(errors,[]);console.log('PASS: common UI form compatibility and visible React Aria Select keyboard/disabled fieldset, disabled/loading, select/checkbox, field labels, tooltip focus, menu keyboard/dismiss/focus and selected blue tab.');
}catch(error){console.log('PAGE ERRORS',errors);console.log(await page.locator('body').innerHTML());throw error;}finally{await browser.close();await unlink(target);}
