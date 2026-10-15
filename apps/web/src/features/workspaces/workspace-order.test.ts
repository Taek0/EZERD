import { expect, it } from 'vitest';
import { moveWorkspace, workspaceDropIndex } from './workspace-order.js';

it('moves the grabbed workspace across neighbours without mutating the saved order', () => {
  const original = ['a', 'b', 'c', 'd'];
  expect(moveWorkspace(original, 'b', 3)).toEqual(['a', 'c', 'd', 'b']);
  expect(moveWorkspace(original, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
  expect(original).toEqual(['a', 'b', 'c', 'd']);
  expect(moveWorkspace(original, 'missing', 0)).toEqual(original);
});
it('uses row centres for differently sized workspace names and clamps outside drops', () => {
  expect(workspaceDropIndex(19, [20, 80, 150])).toBe(0);
  expect(workspaceDropIndex(81, [20, 80, 150])).toBe(2);
  expect(workspaceDropIndex(300, [20, 80, 150])).toBe(3);
});
