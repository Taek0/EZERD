import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readConfig } from '../apps/server/dist/config.js';
const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const pg = require('pg');
const config = readConfig();
assert(['127.0.0.1', 'localhost'].includes(new URL(config.DATABASE_URL).hostname));
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const projectIds = []; let userId;
const prefix = `홈 검증 ${Date.now()}`;
const api = async (path, method = 'GET', value) => {
  const response = await fetch('http://127.0.0.1:3001/api' + path, { method, headers: { 'content-type': 'application/json' }, ...(value ? { body: JSON.stringify(value) } : {}) });
  assert(response.ok, `${method} ${path} ${response.status}`); return response.json();
};
const settle = () => page.waitForFunction(() => document.getAnimations().every(a => a.playState === 'finished' || a.playState === 'idle'));
async function metrics() {
  return page.evaluate(() => {
    const measure = selector => {
      const el = document.querySelector(selector), r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom, fontSize:parseFloat(s.fontSize), fontFamily:s.fontFamily, fontWeight:s.fontWeight, letterSpacing:s.letterSpacing, lineHeight:s.lineHeight, transform:s.transform, display:s.display, alignItems:s.alignItems, justifyContent:s.justifyContent, paddingTop:s.paddingTop, paddingBottom:s.paddingBottom };
    };
    return { header:measure('.app-header'), logo:measure('.brand'), hero:measure('.gallery-hero'), heroTitle:measure('.gallery-hero h1'), footer:measure('.gallery footer'), card:measure('.project-card'), status:measure('.project-state'), nameInput:measure('.create-project input'), search:measure('.search input'), create:measure('.create-project > button'), notification:measure('.notifications > button'), user:measure('.user-button'), gallery:measure('.gallery'), grid:measure('.project-grid'), loadedFonts:[...document.fonts].filter(f=>f.status==='loaded').map(f=>({family:f.family,weight:f.weight})), pageHeight:document.documentElement.scrollHeight };
  });
}
try {
  await mkdir('.cache/verification', { recursive:true });
  // Development watch mode can briefly restart the API after a web build.
  let ready=false;
  for(let attempt=0;attempt<40;attempt++){try{ready=(await fetch('http://127.0.0.1:3001/api/health/ready')).ok;}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,200));}
  assert(ready,'Local API must be ready before home verification');
  const user = await api('/users', 'POST', { username:'Taek' }); userId = user.id;
  const project = await api('/projects', 'POST', { name:prefix }); projectIds.push(project.id);
  await context.addInitScript(id => localStorage.setItem('ezerd.userId', id), userId);
  await page.goto(process.env.EZERD_WEB_URL || 'http://127.0.0.1:3001');
  await page.getByRole('button', {name:new RegExp(prefix)}).waitFor();
  await page.getByRole('textbox', {name:'프로젝트 검색',exact:true}).fill(prefix);
  await page.waitForFunction(() => document.querySelectorAll('.project-card').length===1);
  await page.evaluate(() => document.fonts.ready);
  await settle();
  const current = await metrics();
  if (process.env.EZERD_HOME_BASELINE === '1') {
    await writeFile('.cache/verification/home-before.json', JSON.stringify(current,null,2));
    await page.screenshot({path:'.cache/verification/home-before.png',fullPage:true});
    console.log('BASELINE',JSON.stringify(current));
  } else {
    const previous=JSON.parse(await readFile('.cache/verification/home-before.json','utf8'));
    assert(current.gallery.width > previous.gallery.width, 'home uses more horizontal space');
    assert(current.card.width < previous.card.width - 20 && current.card.height < previous.card.height - 20, 'cards materially smaller');
    assert(current.nameInput.fontSize === previous.nameInput.fontSize - 1, 'name input font one step smaller');
    assert(current.nameInput.height <= 40 && current.search.height <= 40, 'compact input heights');
    assert(current.nameInput.width < previous.nameInput.width && current.search.width < previous.search.width, 'compact input widths');
    assert(current.footer.fontSize === previous.footer.fontSize + 1, 'footer font one step larger');
    assert(current.footer.bottom >= 1030 && current.footer.bottom <= 1080, 'short gallery footer near viewport bottom');
    assert(current.footer.y > current.grid.bottom + 25, 'footer separator after content');
    assert(current.notification.height < previous.notification.height && current.user.height < previous.user.height, 'top right controls smaller');
    assert.equal(current.header.height,previous.header.height);
    assert.equal(current.logo.fontSize,previous.logo.fontSize);
    assert.equal(current.hero.height,previous.hero.height);
    assert.equal(current.heroTitle.fontSize,previous.heroTitle.fontSize);
    assert.equal(current.heroTitle.y,previous.heroTitle.y);
    assert.equal(current.status.letterSpacing,'normal');
    assert(current.status.fontSize>=12);
    assert(current.card.width>=170 && current.card.width<=190 && current.card.height<=140,'reference-sized compact card');
    assert(await page.locator('.project-card').first().evaluate(card=>{const title=card.querySelector('.project-open').getBoundingClientRect(),meta=card.querySelector(':scope > p').getBoundingClientRect(),actions=card.querySelector('.card-actions').getBoundingClientRect();return title.bottom<=meta.y+1 && meta.bottom<=actions.y+1 && card.scrollWidth<=card.clientWidth;}),'compact card text/actions overlap');
    assert.equal(current.status.transform,'none');
    assert.equal(current.create.alignItems,'center');
    assert.equal(current.create.justifyContent,'center');
    assert.equal(current.create.paddingTop,current.create.paddingBottom);
    await writeFile('.cache/verification/home-after.json',JSON.stringify(current,null,2));
    await page.screenshot({path:'.cache/verification/home-after.png',fullPage:true});
    await page.getByRole('textbox',{name:'새 프로젝트 이름',exact:true}).fill(prefix+' 생성');
    const created = page.waitForResponse(r=>r.url().endsWith('/api/projects')&&r.request().method()==='POST');
    await page.locator('.create-project > button').click();
    const made=await(await created).json();projectIds.push(made.id);
    await page.getByRole('button',{name:'← 갤러리',exact:true}).click();
    await page.getByRole('button',{name:'보관함',exact:true}).click();
    await page.getByText('검색 결과가 없습니다',{exact:true}).waitFor();
    assert(await page.evaluate(()=>document.querySelector('.gallery footer').getBoundingClientRect().bottom>innerHeight-50),'empty archive footer');
    await page.getByRole('button',{name:'진행 중',exact:true}).click();
    for(let i=0;i<14;i++){const p=await api('/projects','POST',{name:prefix+' '+(i+1)});projectIds.push(p.id);}
    await page.reload();await page.getByRole('textbox',{name:'프로젝트 검색',exact:true}).fill(prefix);
    await page.waitForFunction(()=>document.querySelectorAll('.project-card').length>=16);
    const long=await metrics();const lastCard=await page.locator('.project-card').last().boundingBox();assert(long.footer.y>=long.grid.bottom-1 && long.footer.y>lastCard.y+lastCard.height+30,'long gallery footer must follow all cards');
    await page.setViewportSize({width:390,height:844});await settle();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
    await page.screenshot({path:'.cache/verification/home-after-mobile.png',fullPage:false});
    assert.deepEqual(errors,[]);
    console.log('PASS: home dimensions, bottom footer/long grid, preserved header/hero, compact inputs/account buttons, create action, status typography and mobile.');
    console.log('AFTER',JSON.stringify(current));
  }
} catch(error) { console.log(await page.locator('body').innerText()); await page.screenshot({path:'.cache/verification/home-failure.png',fullPage:true}); throw error; }
finally { await browser.close(); if(projectIds.length)await pool.query('DELETE FROM projects WHERE id=ANY($1::uuid[])',[projectIds]);if(userId)await pool.query('DELETE FROM users WHERE id=$1',[userId]);await pool.end(); }




