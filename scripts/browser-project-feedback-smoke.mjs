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
 await mkdir('.cache/verification',{recursive:true});await page.goto('http://127.0.0.1:5173');await page.getByRole('textbox',{name:'함께 사용할 이름'}).fill(`피드백작성자${stamp}`);const identity=waitResponse(r=>r.url().endsWith('/api/users')&&r.request().method()==='POST');await click('워크스페이스 시작하기 →');const author=await(await identity).json();ids.push(author.id);const second=await api('/users','POST',{username:`피드백동료${stamp}`});ids.push(second.id);
 await page.getByRole('textbox',{name:'새 프로젝트 이름',exact:true}).fill(name);const created=waitResponse(r=>r.url().endsWith('/api/projects')&&r.request().method()==='POST');await click('프로젝트 만들기');projectId=(await(await created).json()).id;
 const surface=page.getByLabel('도메인 맵 캔버스',{exact:true});await surface.waitFor();
 const firstClick={x:120,y:180};const matrix=await page.locator('.canvas-world').evaluate(el=>{const m=new DOMMatrix(getComputedStyle(el).transform);return {x:m.e,y:m.f,zoom:m.a};});
 await surface.click({position:firstClick,button:'right'});await page.getByRole('menuitem',{name:'이 위치에 핀 남기기',exact:true}).click();await panel.waitFor();assert(await panel.getByRole('checkbox',{name:'빈 공간에 연결',exact:true}).isChecked());assert(await panel.getByRole('checkbox',{name:'프로젝트 전체 핀',exact:true}).isChecked());
 const first=await createPin('우클릭 위치 핀');assert.equal(first.objectId,null);assert(Math.abs(first.x-(firstClick.x-matrix.x)/matrix.zoom)<2);assert(Math.abs(first.y-(firstClick.y-matrix.y)/matrix.zoom)<2);
 await panel.getByText('우클릭 위치 핀',{exact:true}).waitFor();
 // A completed explicit draft must not override the next ordinary blank selection.
 const nextClick={x:190,y:300};await surface.click({position:nextClick});const nextMatrix=await page.locator('.canvas-world').evaluate(el=>{const m=new DOMMatrix(getComputedStyle(el).transform);return {x:m.e,y:m.f,zoom:m.a};});const next=await createPin('다음 빈 공간 핀');assert.equal(next.objectId,null);assert(Math.abs(next.x-(nextClick.x-nextMatrix.x)/nextMatrix.zoom)<2);assert(Math.abs(next.y-(nextClick.y-nextMatrix.y)/nextMatrix.zoom)<2);assert.notDeepEqual({x:next.x,y:next.y},{x:first.x,y:first.y});
 await api(`/projects/${projectId}/threads`,'POST',{authorId:second.id,viewId:'overview',objectId:null,x:460,y:280,body:'동료의 프로젝트 핀',mentionIds:[]});await click('새로고침',panel);await panel.getByText('동료의 프로젝트 핀',{exact:true}).waitFor();
 const thread=panel.locator('.comment-thread').filter({hasText:'동료의 프로젝트 핀'});await thread.getByRole('button',{name:/답글 .*답글 남기기/}).click();await thread.getByRole('textbox',{name:'답글 등록'}).fill('스레드 답글 확인');await click('답글 등록',thread);await thread.locator('.comment-reply').getByText('스레드 답글 확인',{exact:true}).waitFor();

 // Compact pin fields expand for composition; switching pins and closing preserves drafts.
 await page.keyboard.press('Tab');
 const reply=thread.getByRole('textbox',{name:'답글 등록'});
 await reply.fill('유지되는 답글 초안');
 await page.waitForTimeout(200);const fieldHeight=await reply.evaluate(el=>el.getBoundingClientRect().height);assert(fieldHeight>=64);
 const other=panel.locator('.comment-thread').filter({hasText:'우클릭 위치 핀'});
 await other.getByRole('button',{name:/답글 .*답글 남기기/}).click();
 await thread.getByRole('button',{name:/답글 .*답글 남기기/}).click();assert.equal(await reply.inputValue(),'유지되는 답글 초안');
 const container=page.locator('.comments-container');
 const motion=await container.evaluate(el=>getComputedStyle(el).transitionDuration);assert(motion.includes('0.22s'));
 await click('핀 닫기',panel);assert(await container.evaluate(el=>el.inert));
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.comments-container')).visibility==='hidden');
 assert.equal(await container.evaluate(el=>el.getBoundingClientRect().width),0);
 await click('핀');await panel.waitFor();assert.equal(await reply.inputValue(),'유지되는 답글 초안');
 await page.waitForFunction(()=>document.querySelector('.comments-container').getBoundingClientRect().width===340);
 assert.equal(await thread.locator('.comment-message p').first().evaluate(el=>getComputedStyle(el).fontSize),'14px');
 assert.equal(await page.locator('.comment-pin').first().evaluate(el=>getComputedStyle(el).borderBottomLeftRadius),'4px');
 await reply.fill('');await panel.getByRole('heading',{name:'새 핀',exact:true}).click();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.comment-composer textarea')).filter(el=>el.checkVisibility()).every(el=>el.getBoundingClientRect().height===28));
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await container.evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 await click('핀 닫기',panel);await click('핀');await panel.waitFor();await page.emulateMedia({reducedMotion:'no-preference'});
 for(const width of [1100,560,390]) {await page.setViewportSize({width,height:900});await page.waitForTimeout(250);assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth));}
 await page.screenshot({path:'.cache/verification/project-feedback-pins-mobile.png',fullPage:true});
 await page.setViewportSize({width:1700,height:1100});await page.waitForTimeout(250);
 await page.screenshot({path:'.cache/verification/project-feedback-pins.png',fullPage:true});
 if(!await button('저장').isDisabled()){const saved=waitResponse(r=>r.url().endsWith('/document')&&r.request().method()==='PUT');await click('저장');assert.equal((await saved).status(),200);await page.getByText('✓ 저장 완료',{exact:true}).waitFor();}await click('← 갤러리');await page.getByRole('textbox',{name:'프로젝트 검색',exact:true}).fill(name);const card=page.locator('.project-card').filter({hasText:name});await card.waitFor();const archive=button('보관',card);await archive.click();const archiveDialog=page.getByRole('dialog',{name:'프로젝트 보관',exact:true});await archiveDialog.waitFor();assert(await button('취소',archiveDialog).evaluate(el=>el===document.activeElement));await page.keyboard.press('Escape');await archiveDialog.waitFor({state:'hidden'});assert(await archive.evaluate(el=>el===document.activeElement));assert.equal((await api(`/projects/${projectId}`)).project.status,'active');
 await archive.click();await click('취소',archiveDialog);assert.equal((await api(`/projects/${projectId}`)).project.status,'active');await archive.click();const archived=waitResponse(r=>r.url().endsWith(`/api/projects/${projectId}`)&&r.request().method()==='PATCH');await click('보관',archiveDialog);assert.equal((await archived).status(),200);await click('보관함');await card.waitFor();assert.equal((await api(`/projects/${projectId}`)).project.status,'archived');
 await click('삭제',card);const deleteDialog=page.getByRole('dialog',{name:'프로젝트 영구 삭제',exact:true});await deleteDialog.waitFor();assert((await deleteDialog.innerText()).includes('핀과 답글'));await click('취소',deleteDialog);assert.equal((await api(`/projects/${projectId}`)).project.status,'archived');await click('삭제',card);await page.screenshot({path:'.cache/verification/project-feedback-confirm.png',fullPage:true});const deleted=waitResponse(r=>r.url().endsWith(`/api/projects/${projectId}`)&&r.request().method()==='DELETE');await click('영구 삭제',deleteDialog);assert.equal((await deleted).status(),200);await card.waitFor({state:'detached'});assert.equal((await fetch(`http://127.0.0.1:3001/api/projects/${projectId}`)).status,404);
 assert.deepEqual(nativeDialogs,[]);assert.deepEqual(errors,[]);console.log('PASS: ephemeral actual-app archive Escape/cancel/confirm, focus return, delete cancel/confirm, no native dialogs, right-click blank coordinates, consumed pin draft, all-author pins and threaded reply.');
} catch(error) { console.log(errors);console.log(await page.locator('body').innerText());await page.screenshot({path:'.cache/verification/project-feedback-failure.png',fullPage:true});throw error; }
finally { await browser.close();if(projectId)await pool.query('DELETE FROM projects WHERE id=$1',[projectId]);if(ids.length)await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[ids]);await pool.end(); }

