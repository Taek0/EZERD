import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
const { chromium } = await import(process.env.EZERD_PLAYWRIGHT_MODULE || 'playwright');
const filename = `__table-header-${Date.now()}.html`;
const target = new URL('../apps/web/' + filename, import.meta.url);
await writeFile(
  target,
  `<!doctype html><div id="qa"></div><script type="module">
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{Canvas}from'/src/Canvas.tsx';
import{createEmptyDocument,addDomain,addTable}from'@ezerd/model';
import'/src/components/ui/tailwind.css';import'/src/tokens.css';import'/src/components/ui/ui.css';import'/src/styles.css';import'/src/inspector.css';
const h=React.createElement;let seed=addDomain(createEmptyDocument(),{id:'d',name:'Orders',description:''},{x:40,y:40});
seed=addTable(seed,{id:'t',domainId:'d',scope:'physical',logical:{name:'주문',definition:''},physical:{name:'orders',schema:'public',comment:''},customProperties:{common:{},logical:{},physical:{}}},{x:80,y:80});
function Demo(){const[doc,D]=useState(seed);return h('main',null,h(Canvas,{document:doc,onChange:D,readOnly:new URLSearchParams(location.search).has('readonly')}),h('output',{id:'document-state',hidden:true},JSON.stringify(doc)));}createRoot(document.getElementById('qa')).render(h(Demo));
</script>`,
);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const state = async () => JSON.parse(await page.locator('#document-state').textContent());
const node = async () => (await state()).layout.nodes.find((n) => n.objectId === 't');
const title = () => page.locator('.table-node header .table-inline');
async function dragTitle(dx, dy) {
  const box = await title().boundingBox();
  await page.mouse.move(box.x + 30, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 30 + dx, box.y + 10 + dy, { steps: 6 });
  await page.mouse.up();
}
try {
  const url = (process.env.EZERD_WEB_URL || 'http://127.0.0.1:5173') + '/' + filename;
  await page.goto(url);
  await page.getByRole('button', { name: 'Orders 도메인 열기', exact: true }).click();
  await title().waitFor();
  const initial = await node();
  await dragTitle(2, 1);
  assert.deepEqual(await node(), initial, 'small movement must remain a click');
  await dragTitle(95, 55);
  const dragged = await node();
  assert(
    Math.abs(dragged.x - initial.x - 95) < 0.01 && Math.abs(dragged.y - initial.y - 55) < 0.01,
    'drag title text moves the table',
  );
  assert.equal(dragged.width, initial.width);
  assert.equal(dragged.height, initial.height);
  const moved = await node();
  await title().dblclick();
  const input = page
    .locator('.table-node')
    .getByRole('textbox', { name: '물리 테이블명', exact: true });
  await input.fill('order_entries');
  await input.press('Enter');
  assert.equal((await state()).tables[0].physical.name, 'order_entries');
  assert.deepEqual(await node(), moved, 'double-click editing must not move the table');
  await title().dblclick();
  await input.fill('cancelled');
  const fieldBox = await input.boundingBox();
  await page.mouse.move(fieldBox.x + 20, fieldBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(fieldBox.x + 80, fieldBox.y + 10, { steps: 5 });
  await page.mouse.up();
  assert.deepEqual(await node(), moved, 'input text selection must not drag the table');
  await input.press('Escape');
  assert.equal((await state()).tables[0].physical.name, 'order_entries');
  await page.goto(url + '?readonly');
  await page.getByRole('button', { name: 'Orders 도메인 열기', exact: true }).click();
  await title().waitFor();
  const readOnlyBefore = await state();
  await dragTitle(80, 30);
  await title().dblclick();
  assert.deepEqual(await state(), readOnlyBefore, 'read-only titles neither drag nor edit');
  assert.equal(await page.locator('.table-node input').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: title text drag, small-motion click, double-click Enter/Escape edit, input selection, read-only preservation.',
  );
} finally {
  await browser.close();
  await unlink(target);
}
