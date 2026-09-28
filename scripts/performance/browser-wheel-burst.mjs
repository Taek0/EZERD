import { readMeasurement } from './browser-pan.mjs';

/** Internal replay through the real DOM wheel listener; not native input latency. */
export async function measureWheelBurst(tab) {
  await tab.playwright.getByRole('button', { name: 'Reset fixture', exact: true }).click();
  await tab.playwright
    .getByRole('button', { name: 'Replay 120 wheel inputs', exact: true })
    .click();
  await tab.playwright
    .getByRole('textbox', { name: 'Measurement JSON', exact: true })
    .waitFor({ state: 'visible' });
  const output = await readMeasurement(tab);
  const result = output.result;
  const count = (name) => result.summary.find((span) => span.name === name)?.count ?? 0;
  const camera = (text) => {
    const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(text);
    if (!match) throw new Error('Unrecognized camera transform');
    return match.slice(1).map(Number);
  };
  const before = camera(result.before.cameraTransform),
    after = camera(result.after.cameraTransform);
  if (
    result.outcome !== 'complete' ||
    !result.documentUnchanged ||
    result.metadata.mode !== 'internal-replay' ||
    result.metadata.scenario !== 'WHEEL_BURST' ||
    result.events.wheel !== 120 ||
    count('Canvas.tsx.moveViewport') !== 120 ||
    count('Canvas.tsx.applyCameraFrame') !== 1 ||
    count('Canvas.tsx.Canvas') !== 1 ||
    Math.abs(after[0] - before[0] + 120) > 0.01 ||
    Math.abs(after[1] - before[1]) > 0.01 ||
    after[2] !== before[2] ||
    result.summary.some(
      (span) =>
        /\.(tableCardMetrics|tableCardSize|relationGeometry|layoutDomainRelations)$/.test(
          span.name,
        ) && span.count,
    )
  )
    throw new Error('Wheel burst did not coalesce without losing input');
  return output;
}
