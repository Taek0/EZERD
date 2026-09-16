import { expect, it } from 'vitest';
import { addNote, createEmptyDocument, updateNote } from './document.js';
it('preserves note content and color across independent edits', () => {
  const before = addNote(
    createEmptyDocument(),
    { id: 'memo', viewId: 'overview', text: 'first' },
    { x: 0, y: 0 },
  );
  const colored = updateNote(before, 'memo', { color: '#123abc' });
  expect(updateNote(colored, 'memo', 'next\nline').notes[0]).toEqual({
    id: 'memo',
    viewId: 'overview',
    text: 'next\nline',
    color: '#123abc',
  });
  expect(before.notes[0]).not.toHaveProperty('color');
  expect(() => updateNote(before, 'memo', { color: 'invalid' })).toThrow();
});
