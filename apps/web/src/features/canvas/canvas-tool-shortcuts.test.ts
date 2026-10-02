import { describe, expect, it } from 'vitest';
import { canvasToolShortcut } from './canvas-tool-shortcuts.js';

const event = {
  key: 'v',
  code: 'KeyV',
  repeat: false,
  isComposing: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  defaultPrevented: false,
};
const context = { editing: false, overlayOpen: false, dragging: false };

describe('canvas tool shortcuts', () => {
  it.each([
    ['v', '', 'select'],
    ['V', '', 'select'],
    ['h', '', 'hand'],
    ['H', '', 'hand'],
    ['ㅍ', 'KeyV', 'select'],
    ['ㅗ', 'KeyH', 'hand'],
    ['x', 'KeyX', null],
  ])('maps %s (%s) to %s', (key, code, tool) => {
    expect(canvasToolShortcut({ ...event, key, code }, context)).toBe(tool);
  });

  it.each(['repeat', 'isComposing', 'ctrlKey', 'metaKey', 'altKey', 'defaultPrevented'] as const)(
    'ignores %s events',
    (flag) => {
      expect(canvasToolShortcut({ ...event, [flag]: true }, context)).toBeNull();
    },
  );

  it.each(['editing', 'overlayOpen', 'dragging'] as const)('ignores shortcuts while %s', (flag) => {
    expect(canvasToolShortcut(event, { ...context, [flag]: true })).toBeNull();
  });
});
