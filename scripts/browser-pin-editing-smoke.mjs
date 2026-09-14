import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=await import(process.env.EZERD_PLAYWRIGHT_MODULE||'playwright');
const require=createRequire(new URL('../apps/server/package.json',import.meta.url));const pg=require('pg');
const {readConfig}=await import('../apps/server/dist/config.js');const config=readConfig();assert(['localhost','127.0.0.1'].includes(new URL(config.DATABASE_URL).hostname));
const pool=new pg.Pool({connectionString:config.DATABASE_URL});const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1700,height:1100}});page.setDefaultTimeout(12000);
const errors=[],nativeDialogs=[],ids=[];let projectId;const stamp=Date.now(),name=`피드백 검증 ${stamp}`;
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{nativeDialogs.push(d.type());void d.dismiss();});
const api=async(path,method='GET',data)=>{const r=await fetch('http://127.0.0.1:3001/api'+path,{method,headers:{'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});assert(r.ok,`${method} ${path}: ${r.status}`);return r.json();};
const button=(label,scope=page)=>scope.getByRole('button',{name:label,exact:true});
const click=(label,scope=page)=>button(label,scope).click();
const waitResponse=(match)=>{const pending=page.waitForResponse(match);pending.catch(()=>{});return pending;};
async function createPin(text){const response=waitResponse(r=>r.url().endsWith('/threads')&&r.request().method()==='POST');await panel.getByRole('textbox',{name:'핀 등록',exact:true}).fill(text);await click('핀 등록',panel);const r=await response;assert.equal(r.status(),201);return r.json();}
const panel=page.getByRole('complementary',{name:'핀',exact:true});
try {
 await mkdir('.cache/verification',{recursive:true});await page.goto('http://127.0.0.1:5173');await page.getByRole('textbox',{name:'함께 사용할 이름'}).fill(`핀작성자${stamp}`);const identity=waitResponse(r=>r.url().endsWith('/api/users')&&r.request().method()==='POST');await click('워크스페이스 시작하기 →');const author=await(await identity).json();ids.push(author.id);
 await page.getByRole('textbox',{name:'새 프로젝트 이름',exact:true}).fill(name);const created=waitResponse(r=>r.url().endsWith('/api/projects')&&r.request().method()==='POST');await click('프로젝트 만들기');projectId=(await(await created).json()).id;
 await page.getByLabel('도메인 맵 캔버스',{exact:true}).waitFor();await click('핀');await panel.waitFor();
 const input=panel.getByRole('textbox',{name:'핀 등록',exact:true});let posts=0;page.on('request',r=>{if(r.method()==='POST'&&/\/threads(?:\/[^/]+\/messages)?$/.test(r.url()))posts++;});
 await input.fill('   ');await input.press('Enter');assert.equal(posts,0);
 await input.fill('첫 줄');await input.press('Shift+Enter');await input.press('End');await input.press('A');assert.equal(await input.inputValue(),'첫 줄\nA');assert.equal(posts,0);
 // Real DOM composition events exercise React's IME event guards.
 await input.dispatchEvent('compositionstart',{data:'한'});await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});assert.equal(posts,0);await input.dispatchEvent('compositionend',{data:'한'});
 await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});assert.equal(posts,0);
 const sent=waitResponse(r=>r.url().endsWith('/threads')&&r.request().method()==='POST');await input.press('Enter');const first=await(await sent).json();assert.equal(first.messages[0].body,'첫 줄\nA');assert.equal(posts,1);await page.waitForFunction(()=>document.querySelector('.new-thread textarea').value==='');
 const second=await createPin('남길 핀');await panel.getByText('남길 핀',{exact:true}).waitFor();
 const keep=panel.locator(`#thread-${second.id}`);const reply=keep.getByRole('textbox',{name:'답글 등록'});await reply.fill('답글 Enter 전송');const replied=waitResponse(r=>r.url().endsWith('/messages')&&r.request().method()==='POST');await reply.press('Enter');assert.equal((await replied).status(),201);await keep.getByText('답글 Enter 전송',{exact:true}).waitFor();await reply.fill('유지할 답글 초안');await input.fill('유지할 새 핀 초안');
 const target=panel.locator(`#thread-${first.id}`);await target.getByRole('button',{name:'핀 삭제',exact:true}).click();const dialog=page.getByRole('dialog',{name:'핀 삭제',exact:true});await dialog.waitFor();assert((await dialog.innerText()).includes('모든 답글'));assert(await button('취소',dialog).evaluate(el=>el===document.activeElement));await click('취소',dialog);assert.equal((await api(`/projects/${projectId}/threads`)).length,2);
 await target.getByRole('button',{name:'핀 삭제',exact:true}).click();const deleted=waitResponse(r=>r.url().endsWith(`/threads/${first.id}`)&&r.request().method()==='DELETE');await click('삭제',dialog);assert.equal((await deleted).status(),200);await target.waitFor({state:'detached'});assert.equal(await reply.inputValue(),'유지할 답글 초안');assert.equal(await input.inputValue(),'유지할 새 핀 초안');assert.deepEqual((await api(`/projects/${projectId}/threads`)).map(t=>t.id),[second.id]);
 await input.fill('');await reply.fill('');await panel.getByRole('heading',{name:'새 핀',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.new-thread textarea').getBoundingClientRect().height===28);
 assert.equal(await input.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(242, 243, 245)');assert.equal(await input.evaluate(el=>getComputedStyle(el).borderRadius),'8px');await input.focus();await page.waitForFunction(()=>document.querySelector('.new-thread textarea').getBoundingClientRect().height>=64);assert.equal(await page.locator('.comment-pin').first().evaluate(el=>getComputedStyle(el).borderBottomLeftRadius),'4px');
 await page.screenshot({path:'.cache/verification/pin-editing-flow.png',fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(nativeDialogs,[]);console.log('PASS: blank guard, Shift+Enter newline, Korean IME guard, Enter pin/reply, custom delete cancel/confirm, other pin/drafts retained, gray 28/64px field, native dialogs 0.');
} catch(error) {console.log(errors);console.log(await page.locator('body').innerText());await page.screenshot({path:'.cache/verification/pin-editing-flow-failure.png',fullPage:true});throw error;}
finally {await browser.close();if(projectId)await pool.query('DELETE FROM projects WHERE id=$1',[projectId]);if(ids.length)await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[ids]);await pool.end();}
