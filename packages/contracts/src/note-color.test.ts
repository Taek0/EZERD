import { expect, it } from 'vitest';
import { noteSchema } from './workspace.js';
it('accepts legacy notes and optional valid colors', () => {
  const note = { id: 'memo', viewId: 'overview', text: 'long\ntext' };
  expect(noteSchema.parse(note)).toEqual(note);
  expect(noteSchema.parse({ ...note, color: '#123ABC' }).color).toBe('#123ABC');
  expect(noteSchema.safeParse({ ...note, color: 'red' }).success).toBe(false);
});
