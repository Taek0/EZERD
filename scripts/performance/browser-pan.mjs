/** Use from the Browser skill's established tab. Does not launch a browser or connect via CDP. */
export async function readMeasurement(tab) {
  const field = tab.playwright.getByRole('textbox', { name: 'Measurement JSON', exact: true });
  const length = await field.evaluate((element) => element.value.length);
  if (length <= 0 || length > 20_000_000) throw new Error('Unexpected measurement JSON size');
  let raw = '';
  // Keep each DOM read below the browser tool's response limit.
  for (let start = 0; start < length; start += 50_000) {
    raw += await field.evaluate(
      (element, offset) => element.value.slice(offset, offset + 50_000),
      start,
    );
  }
  const result = JSON.parse(raw);
  if (result.schemaVersion !== 1 || !Array.isArray(result.samples))
    throw new Error('Invalid measurement result');
  return { raw, result };
}

/** Point must first be verified by the caller against the current canvas DOM/screenshot. */
export async function measurePan(tab, point) {
  if (![point.x, point.y].every(Number.isFinite))
    throw new Error('A verified canvas point is required');
  await tab.playwright.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('PAN');
  await tab.playwright.getByRole('button', { name: 'Reset fixture', exact: true }).click();
  // The button is disabled until fonts and initial rendering are ready; click waits for it.
  await tab.playwright.getByRole('button', { name: 'Arm measurement', exact: true }).click();
  if (
    (await tab.playwright.getByRole('status', { name: 'Measurement status' }).innerText()) !==
    'armed'
  )
    throw new Error('Could not arm measurement');
  await tab.cua.scroll({ ...point, scrollX: 100, scrollY: 0 });
  if (
    (await tab.playwright.getByRole('status', { name: 'Measurement status' }).innerText()) !==
    'running'
  )
    throw new Error('Wheel input was not captured');
  await tab.playwright.getByRole('button', { name: 'Finish measurement', exact: true }).click();
  await tab.playwright
    .getByRole('textbox', { name: 'Measurement JSON', exact: true })
    .waitFor({ state: 'visible' });
  const output = await readMeasurement(tab);
  if (output.result.outcome !== 'complete' || !output.result.documentUnchanged)
    throw new Error('Incomplete measurement or pan changed the document');
  return output;
}
