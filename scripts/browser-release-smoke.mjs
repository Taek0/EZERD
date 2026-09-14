// Keep the response promise observed while a UI action is awaiting, so cleanup still runs on timeout.
function responseWait(target, predicate) { const pending=target.waitForResponse(predicate); pending.catch(()=>{}); return pending; }
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const {chromium}=await import(process.env.EZERD_PLAYWRIGHT_MODULE||'playwright');
const require=createRequire(new URL('../apps/server/package.json',import.meta.url));const pg=require('pg');
const {readConfig}=await import('../apps/server/dist/config.js');
const config=readConfig();assert(['localhost','127.0.0.1'].includes(new URL(config.DATABASE_URL).hostname));
const pool=new pg.Pool({connectionString:config.DATABASE_URL});
const browser=await chromium.launch({channel:process.env.EZERD_BROWSER_CHANNEL||'chrome',headless:true});
const a=await browser.newContext({viewport:{width:1600,height:1100},acceptDownloads:true});const b=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await a.newPage(),other=await b.newPage();const errors=[];for(const p of [page,other])p.on('pageerror',e=>errors.push(e.message));
const ids=[],stamp=Date.now(),username=`설계자${stamp}`,reviewer=`검토자${stamp}`,projectName=`출시 검증 ${stamp}`;let projectId;
const button=(name,scope=page)=>scope.getByRole('button',{name,exact:true});
const click=(name,scope=page)=>button(name,scope).click();
const field=(name,scope=page)=>scope.getByRole('textbox',{name:new RegExp('^'+name)});
const fill=(name,value,scope=page)=>field(name,scope).fill(value);
const select=(name,label,scope=page)=>scope.getByRole('combobox',{name:new RegExp('^'+name)}).selectOption({label});
const api=async(path,method='GET',data)=>{const response=await fetch('http://127.0.0.1:3001/api'+path,{method,headers:{'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});assert(response.ok,`${method} ${path}: ${response.status}`);return response.json();};
async function identify(p,name){await p.goto('http://127.0.0.1:5173');await fill('함께 사용할 이름',name,p);const res=responseWait(p,r=>r.url().endsWith('/api/users')&&r.request().method()==='POST');await click('워크스페이스 시작하기 →',p);const user=await(await res).json();ids.push(user.id);return user;}
async function save(){const response=responseWait(page,r=>r.url().endsWith('/document')&&r.request().method()==='PUT');await click('저장');const result=await response;assert.equal(result.status(),200);await page.getByText('✓ 저장 완료',{exact:true}).waitFor();return result.json();}
async function makeTable(logical,physical){await click('+ 테이블');await fill('논리 테이블명',logical);await fill('물리 테이블명',physical);await click('+ 컬럼 추가');await page.locator('.table-inspector .table-edit-card > summary').last().click();await fill('논리 컬럼명','식별자');await fill('물리 컬럼명','id');await page.getByRole('combobox',{name:/^PostgreSQL 타입/}).fill('integer');await page.getByRole('checkbox',{name:'물리 NULL 허용',exact:true}).uncheck();await click('+ 키 추가');await select('키 종류','PRIMARY KEY');await fill('키 이름',physical+'_pk');await select('키 컬럼 추가','식별자');}
try{
 await mkdir('.cache/verification',{recursive:true});const author=await identify(page,username);const recipient=await identify(other,reviewer);
 await fill('새 프로젝트 이름',projectName);const created=responseWait(page,r=>r.url().endsWith('/api/projects')&&r.request().method()==='POST');await click('프로젝트 만들기');projectId=(await(await created).json()).id;
 await click('＋ 도메인');await fill('도메인 이름','주문');await fill('업무 설명','아주 긴 업무 설명도 카드 내부에서 겹치지 않고 안전하게 표시합니다.');await page.getByLabel('도메인 색상').fill('#e57638');await page.getByRole('spinbutton',{name:'X',exact:true}).fill('80');await page.getByRole('spinbutton',{name:'Y',exact:true}).fill('80');
 const orders=page.getByRole('group',{name:'주문',exact:true});const box=await orders.boundingBox();const handle=await orders.locator('.resize-handle').boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(box.x+100,box.y+60,{steps:4});await page.mouse.up();const resized=await orders.boundingBox();assert(resized.width>=239&&resized.height>=209);const title=await orders.locator('h2').boundingBox(),footer=await orders.locator('.enter-domain').boundingBox();assert(title.y+title.height<footer.y,'resize title/footer collision');
 await click('＋ 도메인');await fill('도메인 이름','결제');await page.getByRole('spinbutton',{name:'X',exact:true}).fill('500');await page.getByRole('spinbutton',{name:'Y',exact:true}).fill('80');
 await orders.click({button:'right'});await page.getByRole('menuitem',{name:'→ 결제',exact:true}).click();await fill('관계 이름','결제 요청');await click('관계 연결');await orders.click({position:{x:25,y:25}});await page.locator('#selected-domain-relations').getByRole('button',{name:/^결제 요청/}).waitFor();
 await click('속성 패널 숨기기');assert.equal(await page.locator('#canvas-inspector').evaluate(el => !!el.closest('[aria-hidden=true]')),true);await click('속성 패널 열기');await click('선택 해제');await button('도메인 관계').click();assert.equal(await page.locator('#business-relations').getAttribute('aria-hidden'),'true');await click('도메인 관계');
 await save();await page.screenshot({path:'.cache/verification/release-domain-map.png',fullPage:true});
 await click('PostgreSQL DDL ↓');await page.getByLabel('DDL 내보내기 결과').getByText('설계 전체',{exact:true}).waitFor();await click('DDL 결과 닫기');
 await click('주문 도메인 열기');await makeTable('주문 테이블','orders');await save();
 await select('모델 보기','논리');await page.getByRole('group',{name:'주문 테이블',exact:true}).getByText('주문 테이블',{exact:true}).waitFor();await select('모델 보기','함께');
 await click('도메인 맵');await click('결제 도메인 열기');await makeTable('결제 테이블','payments');
 await select('외부 테이블 참조','주문 / 주문 테이블');await click('참조 추가');await button('이 화면의 참조 제거').waitFor();await click('이 화면의 참조 제거');assert.equal(await page.getByRole('group',{name:'주문 테이블',exact:true}).count(),0);
 await select('외부 테이블 참조','주문 / 주문 테이블');await click('참조 추가');
 // Place the external reference away from its source table, then edit the local table.
 const external=page.getByRole('group',{name:'주문 테이블',exact:true});const eb=await external.boundingBox();await page.mouse.move(eb.x+30,eb.y+20);await page.mouse.down();await page.mouse.move(eb.x+360,eb.y+20,{steps:4});await page.mouse.up();
 await page.getByRole('group',{name:'결제 테이블',exact:true}).click({position:{x:25,y:25}});await click('+ 테이블 관계 추가');const relation=page.locator('.table-inspector .table-edit-card').last();await relation.locator('summary').click();await select('적용 범위','함께',relation);await select('대상 테이블','주문 / 주문 테이블',relation);await fill('논리 관계명','주문 결제',relation);await relation.getByRole('checkbox',{name:'물리 FK 정의',exact:true}).check();await fill('FK 이름','payments_order_fk',relation);await click('+ 컬럼 매핑',relation);
 const stored=await save();assert.equal(stored.document.tables.length,2);assert.equal(stored.document.tableRelations.length,1);assert.equal(stored.document.tables.find(t=>t.physical.name==='orders').logical.name,'주문 테이블');
 const downloadEvent=page.waitForEvent('download');await click('PostgreSQL DDL ↓');const download=await downloadEvent;await download.saveAs('.cache/verification/release.sql');assert(download.suggestedFilename().endsWith('.sql'));
 await page.screenshot({path:'.cache/verification/release-table-erd.png',fullPage:true});
 await click('검토 대화');const panel=page.getByRole('complementary',{name:'검토 대화',exact:true});await fill('댓글 등록','이 FK를 검토해 주세요.',panel);await panel.locator('.new-thread').getByRole('button',{name:'＠ 멘션',exact:true}).click();await fill('멘션할 사용자 검색',reviewer,panel);await panel.getByRole('button',{name:new RegExp('@'+reviewer)}).click();await click('댓글 등록',panel);await panel.getByText('이 FK를 검토해 주세요.',{exact:true}).waitFor();await fill('답글 등록','검토를 시작했습니다.',panel);await click('답글 등록',panel);await panel.getByText('검토를 시작했습니다.',{exact:true}).waitFor();
 const notifications=await api(`/users/${recipient.id}/notifications`);assert.equal(notifications.length,1);await other.getByRole('button',{name:/^알림/}).click();await other.getByRole('button',{name:/새 멘션/}).click();await other.getByText('이 FK를 검토해 주세요.',{exact:true}).waitFor();assert((await api(`/users/${recipient.id}/notifications`))[0].read);
 await click('해결',panel);await click('다시 열기',panel);
 const threads=await api(`/projects/${projectId}/threads`);assert.equal(threads[0].messages.length,2);
 await page.screenshot({path:'.cache/verification/release-comments.png',fullPage:true});
 const pin=page.locator('.comment-pin').first();const pinBefore=await pin.boundingBox();await page.getByRole('group',{name:'결제 테이블',exact:true}).focus();await page.keyboard.press('Shift+ArrowRight');await page.waitForFunction(previous=>{const el=document.querySelector('.comment-pin');return el && el.getBoundingClientRect().x > previous+9;},pinBefore.x);await save();
 // Deleting the attached table preserves the conversation and reports missing target.
 await click('검토 대화 닫기');page.once('dialog',d=>d.accept());await click('테이블 삭제');await save();await click('검토 대화');await panel.getByRole('button',{name:'대상 삭제됨',exact:true}).waitFor();assert.equal((await api(`/projects/${projectId}/threads`))[0].messages.length,2);
 // Blank-space pins use the clicked world coordinate, independently of model objects.
 await panel.getByRole('checkbox',{name:'빈 공간에 연결',exact:true}).check();await page.getByLabel('결제 내부 캔버스',{exact:true}).click({position:{x:100,y:100}});await fill('댓글 등록','빈 공간 검토',panel);const blankCreation=responseWait(page,r=>r.url().endsWith('/threads')&&r.request().method()==='POST');await click('댓글 등록',panel);assert.equal((await blankCreation).status(),201);await panel.getByText('빈 공간 검토',{exact:true}).waitFor();
 const blankThread=(await api(`/projects/${projectId}/threads`)).find(t=>t.messages[0].body==='빈 공간 검토');assert.equal(blankThread.objectId,null);await save();
 // A blank pin in a deleted domain remains in the thread list and jumps safely to overview.
 await click('도메인 맵');await page.getByRole('group',{name:'결제',exact:true}).click({position:{x:25,y:25}});page.once('dialog',dialog=>dialog.accept());await click('선택 항목 삭제');await save();
 const deletedViewThread=panel.locator('.comment-thread').filter({hasText:'빈 공간 검토'});await deletedViewThread.getByRole('button',{name:'대상 삭제됨',exact:true}).click();await page.getByLabel('도메인 맵 캔버스',{exact:true}).waitFor();await save();
 // Readable gallery depth and hover, mobile layout.
 await click('← 갤러리');await fill('프로젝트 검색',projectName);const card=page.locator('.project-card').filter({hasText:projectName});await card.waitFor();const before=await card.evaluate(el=>getComputedStyle(el).boxShadow);await card.hover();await page.waitForFunction(()=>{const el=document.querySelector('.project-card:hover');return el&&getComputedStyle(el).transform!=='none';});await page.waitForFunction(previous=>{const el=document.querySelector('.project-card:hover');return el&&getComputedStyle(el).boxShadow!==previous;},before);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.cache/verification/release-gallery-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');assert.deepEqual(errors,[]);
 console.log('PASS: release browser flows including UI1–7, tables/keys/FK, external references, DDL, two-user mentions, reply/resolve/reopen, preserved deleted-target threads.');
}catch(error){console.log('PAGE ERRORS',errors);console.log(await page.locator('body').innerText());await page.screenshot({path:'.cache/verification/release-failure.png',fullPage:true});throw error;}
finally{await browser.close();if(projectId)await pool.query('DELETE FROM projects WHERE id=$1',[projectId]);if(ids.length)await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[ids]);await pool.end();}






