import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
const {chromium}=await import(process.env.EZERD_PLAYWRIGHT_MODULE||'playwright');
const filename=`__ui-qa-${Date.now()}.html`;
const target=new URL('../apps/web/'+filename,import.meta.url);
const html=`<!doctype html><html><head><link rel="stylesheet" href="/fonts/apple-sd-gothic-neo/fonts.css"></head><body><div id="qa"></div><script type="module">
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {Button,IconButton,Input,Select,Checkbox,Field,ContextMenu,TabButton} from '/src/components/ui/index.tsx';
import '/src/components/ui/tailwind.css';import '/src/tokens.css';import '/src/components/ui/ui.css';import '/src/styles.css';
const h=React.createElement;
function Demo(){const [actions,A]=useState(0),[submits,S]=useState(0),[position,P]=useState(null),[selected,V]=useState('a'),[checked,C]=useState(false);
return h('main',{style:{padding:32,maxWidth:600}},h('form',{onSubmit:e=>{e.preventDefault();S(n=>n+1)}},
h(Field,{id:'qa-name',label:'이름',hint:'힌트',error:'검증 안내'},h(Input,{defaultValue:'테스트',required:true})),
h(Button,{onClick:()=>A(n=>n+1)},'일반'),h(Button,{disabled:true,onClick:()=>A(n=>n+100)},'비활성'),h(Button,{loading:true,onClick:()=>A(n=>n+100)},'로딩'),h(Button,{type:'submit'},'제출')),
h('label',{},'선택',h(Select,{value:selected,onChange:e=>V(e.target.value)},h('option',{value:'a'},'Alpha'),h('option',{value:'b'},'Beta'))),
h('label',{},h(Checkbox,{checked,onChange:e=>C(e.target.checked)}),'확인'),
h(IconButton,{'aria-label':'도움말',tooltip:'필드 도움말'},'?'),
h(Button,{id:'menu-trigger',onClick:()=>P({x:160,y:400})},'메뉴 열기'),
h(ContextMenu,{position,onClose:()=>P(null),label:'작업 메뉴',items:[{id:'disabled',label:'차단 항목',disabled:true,onAction:()=>A(n=>n+100)},{id:'first',label:'첫 항목',onAction:()=>{A(n=>n+1);document.getElementById('qa-name').focus()}},{id:'second',label:'둘째 항목',onAction:()=>A(n=>n+1)}]}),
h('div',{className:'tabs'},h(TabButton,{selected:true},'진행 중'),h(TabButton,{selected:false},'보관함')),
h('output',{id:'result'},JSON.stringify({actions,submits,selected,checked})));}
createRoot(document.getElementById('qa')).render(h(Demo));
</script></body></html>`;
await writeFile(target,html);
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const button=name=>page.getByRole('button',{name,exact:true});
const state=async()=>JSON.parse(await page.locator('#result').innerText());
try{
 await page.goto('http://127.0.0.1:5173/'+filename);await button('일반').waitFor();
 await button('일반').click();assert.deepEqual(await state(),{actions:1,submits:0,selected:'a',checked:false});
 for(const name of ['비활성','로딩']){assert(await button(name).isDisabled());await button(name).evaluate(el=>el.click());}
 assert.equal((await state()).actions,1);
 await button('제출').click();assert.equal((await state()).submits,1);
 await page.getByLabel('이름',{exact:true}).press('Enter');assert.equal((await state()).submits,2);
 assert.equal(await page.getByLabel('이름',{exact:true}).getAttribute('aria-describedby'),'qa-name-hint qa-name-error');
 await page.getByRole('combobox',{name:'선택',exact:true}).selectOption('b');await page.getByRole('checkbox',{name:'확인',exact:true}).check();assert.equal((await state()).selected,'b');assert.equal((await state()).checked,true);
 await button('도움말').focus();await page.getByRole('tooltip').waitFor();assert.equal(await page.getByRole('tooltip').innerText(),'필드 도움말');await page.keyboard.press('Escape');
 await button('메뉴 열기').click();await page.getByRole('menu',{name:'작업 메뉴'}).waitFor();
 await page.waitForFunction(()=>document.activeElement?.textContent==='첫 항목');await page.keyboard.press('ArrowDown');await page.waitForFunction(()=>document.activeElement?.textContent==='둘째 항목');await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.activeElement?.id==='menu-trigger');assert.equal(await page.getByRole('menu').count(),0);
 await button('메뉴 열기').click();await page.getByRole('menuitem',{name:'첫 항목',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.id==='qa-name');assert.equal((await state()).actions,2);
 await button('메뉴 열기').click();await page.getByLabel('이름',{exact:true}).click();assert.equal(await page.getByRole('menu').count(),0);
 assert.equal(await button('진행 중').evaluate(el=>getComputedStyle(el).color),'rgb(48, 91, 231)');assert.notEqual(await button('진행 중').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
 assert.deepEqual(errors,[]);console.log('PASS: common UI native form compatibility, disabled/loading, select/checkbox, field labels, tooltip focus, menu keyboard/dismiss/focus and selected blue tab.');
}finally{await browser.close();await unlink(target);}
