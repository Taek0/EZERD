import { describe, expect, it } from 'vitest';
import {
  inspectorBounds,
  clampInspectorWidth,
  readInspectorWidth,
  shouldStackInspector,
} from './inspector-state.js';

describe('inspector geometry and preference', () => {
  it('reserves canvas space as the workspace contracts with other panels', () => {
    expect(inspectorBounds(1100).max).toBe(520);
    expect(inspectorBounds(720).max).toBe(300);
    expect(clampInspectorWidth(510, 720)).toBe(300);
    expect(clampInspectorWidth(200, 720)).toBe(280);
  });
  it('recovers invalid storage and retains a valid requested width independently of available space', () => {
    for (const value of [null, '', 'broken', 'Infinity', '-2'])
      expect(readInspectorWidth(value)).toBe(320);
    expect(readInspectorWidth('480')).toBe(480);
    expect(clampInspectorWidth(readInspectorWidth('480'), 720)).toBe(300);
    expect(clampInspectorWidth(readInspectorWidth('480'), 1000)).toBe(480);
  });
  it('stacks when both a usable canvas and the minimum inspector no longer fit', () => {
    expect(shouldStackInspector(699)).toBe(true);
    expect(shouldStackInspector(700)).toBe(false);
    for (const workspace of [700, 840, 877, 1024, 1172, 1580]) {
      expect(workspace - clampInspectorWidth(520, workspace)).toBeGreaterThanOrEqual(420);
    }
  });
});
