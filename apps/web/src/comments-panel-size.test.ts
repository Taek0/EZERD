import { expect, it } from 'vitest';
import { clampCommentsPanelWidth } from './comments-panel-size.js';
it('clamps restored pin panel widths and rejects invalid preferences', () => {
  expect(clampCommentsPanelWidth(null)).toBe(340);
  expect(clampCommentsPanelWidth('NaN')).toBe(340);
  expect(clampCommentsPanelWidth(Infinity)).toBe(340);
  expect(clampCommentsPanelWidth('120')).toBe(280);
  expect(clampCommentsPanelWidth('900')).toBe(560);
  expect(clampCommentsPanelWidth('420')).toBe(420);
});
