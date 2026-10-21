// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => document.body.replaceChildren());

describe('native note color cascade', () => {
  it.each([
    ['#abcdef', '#000000', 'rgb(171, 205, 239)', 'rgb(0, 0, 0)'],
    ['#123456', '#ffffff', 'rgb(18, 52, 86)', 'rgb(255, 255, 255)'],
  ])('keeps %s visible before selection and after deselection', (background, ink, rgb, textRgb) => {
    // Match main.tsx: component CSS loads before shared legacy canvas styles.
    const css = [
      './NativeERDCanvas.css',
      '../../styles/styles.css',
      '../../styles/editor-feedback.css',
    ]
      .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
      .join('\n');
    const style = document.createElement('style');
    // jsdom does not resolve custom properties in background shorthands. Substitute
    // the scene's values while retaining the real selectors and stylesheet order.
    style.textContent = css
      .replaceAll('var(--native-note-color, #fff3c4)', background)
      .replaceAll('var(--native-note-text-color, #000000)', ink);
    const note = document.createElement('article');
    note.className = 'native-erd-node canvas-node note note-node';
    document.body.append(style, note);
    for (const selected of [false, true, false]) {
      note.dataset.selected = String(selected);
      note.classList.toggle('selected', selected);
      const painted = window.getComputedStyle(note);
      expect(painted.backgroundColor).toBe(rgb);
      expect(painted.color).toBe(textRgb);
    }
  });
});
