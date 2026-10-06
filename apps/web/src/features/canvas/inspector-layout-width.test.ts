import { describe, expect, it } from 'vitest';
import {
  inspectorBounds,
  inspectorLayoutWidth,
  shouldStackInspector,
  clampInspectorWidth,
} from './inspector-state.js';
describe('inspector measurement equivalence', () => {
  it('preserves layout, keyboard bounds and stacking through narrow and breakpoint widths', () => {
    for (const width of [0, 279.5, 400, 699.99, 700, 739.5, 740, 939.9, 940, 1200, 2560]) {
      const measured = inspectorLayoutWidth(width);
      expect(inspectorBounds(measured)).toEqual(inspectorBounds(width));
      expect(shouldStackInspector(measured)).toBe(shouldStackInspector(width));
      for (const preference of [280, 320, 400, 520])
        expect(clampInspectorWidth(preference, measured)).toBe(
          clampInspectorWidth(preference, width),
        );
    }
  });
  it('does not change state when a wide pin transition leaves all constraints unchanged', () => {
    const widths = [1600, 1560, 1450, 1320, 1280].map(inspectorLayoutWidth);
    expect(new Set(widths).size).toBe(1);
    expect(inspectorLayoutWidth(699)).not.toBe(inspectorLayoutWidth(700));
  });
});
