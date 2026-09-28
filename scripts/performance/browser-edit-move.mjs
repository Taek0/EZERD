import { readMeasurement } from './browser-pan.mjs';

export async function relationPaths(tab) {
  return tab.playwright.getByRole('img', { name: '테이블 관계', exact: true }).evaluate((element) =>
    Array.from(element.querySelectorAll('g[data-relation-id]')).map((group) => ({
      id: group.getAttribute('data-relation-id'),
      paths: Array.from(group.querySelectorAll('path[d]')).map((path) => path.getAttribute('d')),
    })),
  );
}

/** Korean fixture UI, matching the recorded baseline. Browser connection is supplied by the caller. */
export async function measureEditOrMove(tab, scenario) {
  if (!['EDIT', 'MOVE'].includes(scenario)) throw new Error('Unsupported scenario');
  await tab.playwright
    .getByRole('combobox', { name: 'Scenario', exact: true })
    .selectOption(scenario);
  await tab.playwright.getByRole('button', { name: 'Reset fixture', exact: true }).click();
  await tab.playwright.getByRole('button', { name: 'Arm measurement', exact: true }).click();
  const card = tab.playwright.getByRole('group', { name: 'table_0', exact: true });
  if (scenario === 'EDIT') {
    await card.getByText('id', { exact: true }).dblclick();
    const input = tab.playwright.getByRole('textbox', { name: '컬럼명', exact: true });
    await input.fill('측정용_고객_식별자');
    await input.press('Enter');
  } else {
    const rect = await card.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    });
    const x = rect.x + 140,
      y = rect.y + 20;
    if (x < 0 || y < 0 || rect.width < 240) throw new Error('Card header not suitable for drag');
    await tab.cua.drag({ path: [0, 20, 40, 60, 100].map((delta) => ({ x: x + delta, y })) });
  }
  if (
    (await tab.playwright.getByRole('status', { name: 'Measurement status' }).innerText()) !==
    'running'
  )
    throw new Error('Editor input was not captured');
  await tab.playwright.getByRole('button', { name: 'Finish measurement', exact: true }).click();
  await tab.playwright
    .getByRole('textbox', { name: 'Measurement JSON', exact: true })
    .waitFor({ state: 'visible' });
  const output = await readMeasurement(tab);
  const result = output.result;
  if (result.outcome !== 'complete' || result.documentUnchanged)
    throw new Error('Edit did not complete');
  if (scenario === 'EDIT' && result.after.firstColumn !== '측정용_고객_식별자')
    throw new Error('Incorrect edited value');
  if (
    scenario === 'MOVE' &&
    (Math.abs(result.after.firstNode.x - result.before.firstNode.x - 100) > 1 ||
      result.after.firstNode.y !== result.before.firstNode.y)
  )
    throw new Error('Incorrect drag destination');
  return { ...output, paths: await relationPaths(tab) };
}
