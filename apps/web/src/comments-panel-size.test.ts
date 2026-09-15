import { expect, it } from 'vitest';
import { clampCommentsPanelWidth, commentsPanelBounds } from './comments-panel-size.js';
it('clamps restored pin panel widths and rejects invalid preferences', () => {
  expect(clampCommentsPanelWidth(null)).toBe(340);
  expect(clampCommentsPanelWidth('NaN')).toBe(340);
  expect(clampCommentsPanelWidth(Infinity)).toBe(340);
  expect(clampCommentsPanelWidth('120')).toBe(280);
  expect(clampCommentsPanelWidth('900')).toBe(560);
  expect(clampCommentsPanelWidth('420')).toBe(420);
});
it('budgets docked comments without overwriting the stored preference', () => {
  const preference = clampCommentsPanelWidth('560');
  for (const workspaceWidth of [1121, 1280, 1366, 1512, 1920]) {
    const displayed = Math.min(preference, commentsPanelBounds(workspaceWidth).max);
    expect(workspaceWidth - displayed).toBeGreaterThanOrEqual(840);
  }
  expect(commentsPanelBounds(1280)).toEqual({ min: 280, max: 440 });
  expect(Math.min(preference, commentsPanelBounds(1920).max)).toBe(560);
});
