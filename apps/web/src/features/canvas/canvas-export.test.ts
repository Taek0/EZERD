import { describe, expect, it } from 'vitest';
import { exportStyleValue, prepareExportContent } from './canvas-export.js';

describe('PNG SVG resource references', () => {
  it('keeps relation markers local to the exported SVG', () => {
    expect(
      exportStyleValue(
        'url("https://example.com/editor#arrow")',
        'https://example.com/editor#view',
      ),
    ).toBe('url("#arrow")');
    expect(exportStyleValue('url(#arrow)', 'https://example.com/editor')).toBe('url("#arrow")');
  });
  it('preserves external resources and ordinary styles', () => {
    expect(
      exportStyleValue('url("https://example.com/asset.svg#arrow")', 'https://example.com/editor'),
    ).toBe('url("https://example.com/asset.svg#arrow")');
    expect(exportStyleValue('rgb(0, 0, 0)', 'https://example.com/editor')).toBe('rgb(0, 0, 0)');
  });
});

// Minimal DOM tree for the node test environment, including textContent's child replacement.
class ExportElement {
  parent: ExportElement | undefined;
  text = '';
  constructor(
    readonly tag: string,
    readonly attributes: Record<string, string> = {},
    public children: ExportElement[] = [],
  ) {
    children.forEach((child) => (child.parent = this));
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }
  set textContent(value: string | null) {
    this.children.forEach((child) => (child.parent = undefined));
    this.children = [];
    this.text = value ?? '';
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  querySelectorAll(selector: string): ExportElement[] {
    return this.children.flatMap((child) => [
      ...(selector.split(',').some((part) => {
        if (part.startsWith('[')) return part.slice(1, -1) in child.attributes;
        if (part.startsWith('.')) return child.attributes.class?.split(' ').includes(part.slice(1));
        return child.tag === part;
      })
        ? [child]
        : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this);
    this.parent = undefined;
  }
}

describe('PNG clone content', () => {
  it.each(['button', 'input'])('keeps the saved full type when the editor contains a %s', (tag) => {
    const editor = new ExportElement(tag, { value: 'uncommitted search' });
    editor.text = tag === 'button' ? 'VARCHAR(32)' : 'uncommitted search';
    const cell = new ExportElement(
      'span',
      { 'data-export-text': 'VARCHAR(32)', style: 'color:rgb(115,125,135);font-size:13px;' },
      [editor, new ExportElement('div', { role: 'listbox' })],
    );
    const clone = new ExportElement('div', {}, [
      cell,
      new ExportElement('button'),
      new ExportElement('div', { class: 'resize-handle' }),
      new ExportElement('span', { 'data-export-hidden': '' }),
    ]);

    prepareExportContent(clone as unknown as HTMLElement);

    expect(clone.children).toEqual([cell]);
    expect(cell.textContent).toBe('VARCHAR(32)');
    expect(cell.children).toEqual([]);
    expect(cell.getAttribute('style')).toBe('color:rgb(115,125,135);font-size:13px;');
    expect(clone.querySelectorAll('button,input,[role]')).toEqual([]);
  });

  it('preserves ENUM, array, and precision text without interpreting markup', () => {
    const types = ['주문_상태[]', 'NUMERIC(10,2)[]', '<custom>&type'];
    const cells = types.map((type) => new ExportElement('span', { 'data-export-text': type }));
    const clone = new ExportElement('div', {}, cells);
    prepareExportContent(clone as unknown as HTMLElement);
    expect(cells.map((cell) => cell.textContent)).toEqual(types);
    expect(cells.every((cell) => cell.children.length === 0)).toBe(true);
  });
});
