import assert from 'node:assert/strict';

// Exercise the visible React Aria trigger and portal options, never its hidden form select.
export function selectTrigger(scope, name) {
  const label = typeof name === 'string' ? name : name.source.replace(/^\^/, '');
  return scope.locator('button.ui-select[aria-label=' + JSON.stringify(label) + ']');
}
export async function chooseSelect(page, scope, name, label) {
  const trigger = selectTrigger(scope, name);
  assert.equal(await trigger.evaluate(element => element.tagName), 'BUTTON');
  await trigger.click();
  const option = page.getByRole('option', {name: label, exact: true});
  await option.waitFor({state: 'visible'});
  await option.click();
  await page.getByRole('listbox').waitFor({state: 'hidden'});
  assert((await trigger.innerText()).includes(label), `Visible selection must show ${label}`);
}

export async function stablePopover(page) {
  await page.waitForFunction(() => {
    const popover = document.querySelector('.ui-popover:not([data-entering]):not([data-exiting]), .ui-context-menu');
    return popover && getComputedStyle(popover).opacity === '1' && popover.getAnimations().every(animation => animation.playState === 'finished');
  });
}
