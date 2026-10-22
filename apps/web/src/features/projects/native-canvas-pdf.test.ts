import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decorationFixture } from './native-canvas-decoration-test-fixtures.js';
import { nativeCanvasScene } from './NativeERDCanvas.js';
import { nativeCanvasSvg, nativePngBounds } from './native-canvas-png.js';
import { exportNativeCanvasPdf, nativePdfPageSize } from './native-canvas-pdf.js';

const mocked = vi.hoisted(() => ({
  options: vi.fn(),
  svg: vi.fn(async () => {}),
  addFont: vi.fn(),
  addFile: vi.fn(),
}));
vi.mock('jspdf', () => ({
  jsPDF: class {
    constructor(options: unknown) {
      mocked.options(options);
    }
    addFileToVFS = mocked.addFile;
    addFont = mocked.addFont;
    setFont() {}
    setProperties() {}
    output() {
      return new Blob(['%PDF'], { type: 'application/pdf' });
    }
    getNumberOfPages() {
      return 1;
    }
  },
}));
vi.mock('svg2pdf.js', () => ({ svg2pdf: mocked.svg }));

const click = vi.fn(),
  remove = vi.fn(),
  revoke = vi.fn();
let link: { href: string; download: string; click: typeof click; remove: typeof remove };
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocked.svg.mockImplementation(async () => {});
  link = { href: '', download: '', click, remove };
  vi.stubGlobal('document', {
    fonts: { add: vi.fn() },
    body: { append: vi.fn() },
    createElement: () => link,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })),
  );
  vi.stubGlobal(
    'FontFace',
    class {
      async load() {
        return this;
      }
    },
  );
  vi.stubGlobal(
    'DOMParser',
    class {
      parseFromString(xml: string) {
        return { documentElement: { xml } };
      }
    },
  );
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:pdf', revokeObjectURL: revoke });
});
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('single page vector PDF', () => {
  it.each([
    [1000, 500],
    [500, 1000],
    [100000, 70000],
  ])('preserves aspect ratio for %s × %s', (width, height) => {
    const page = nativePdfPageSize(width, height);
    expect(Math.max(page.width, page.height)).toBeLessThanOrEqual(14400);
    expect(page.width / page.height).toBeCloseTo(width / height);
  });
  it('rejects invalid dimensions', () => {
    for (const width of [0, -1, Infinity, NaN])
      expect(() => nativePdfPageSize(width, 10)).toThrow('canvas.export-size-limit');
  });
  it('allows vector scenes exceeding the PNG raster allocation budget', () => {
    const source = decorationFixture(),
      scene = nativeCanvasScene(source, '__tables__', 'physical');
    scene.nodes[1]!.x = 1e7;
    expect(() => nativePngBounds(source, scene)).toThrow('canvas.export-size-limit');
    const output = nativeCanvasSvg(source, scene, 'physical', 'pdf');
    expect(output.svg).toContain('records');
    expect(output.bounds.width).toBeGreaterThan(1e7);
  });
  it('embeds regular and bold Korean fonts and downloads a single vector page', async () => {
    const source = decorationFixture();
    const result = await exportNativeCanvasPdf(
      source,
      nativeCanvasScene(source, 'overview', 'physical'),
      'physical',
      '설계/name',
    );
    expect(result).toMatchObject({ pages: 1, type: 'application/pdf' });
    expect(mocked.addFont.mock.calls.map((args) => args.slice(1))).toEqual([
      ['EZERDPdf', 'normal'],
      ['EZERDPdf', 'bold'],
    ]);
    const svg = (mocked.svg.mock.calls[0] as unknown as [{ xml: string }])[0].xml;
    expect(svg).toContain('font-family:EZERDPdf');
    expect(svg).not.toContain('font-weight:600');
    expect(svg).not.toContain('color-mix(');
    expect(svg).not.toContain('<image');
    expect(link.download).toBe('설계_name.pdf');
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:pdf');
  });
  it('does not start when the captured context is already stale', async () => {
    const source = decorationFixture();
    await expect(
      exportNativeCanvasPdf(
        source,
        nativeCanvasScene(source, '__tables__', 'physical'),
        'physical',
        'name',
        () => false,
      ),
    ).rejects.toThrow('canvas.export-context-changed');
    expect(mocked.svg).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
  it('does not download after asynchronous conversion changes the captured context', async () => {
    const source = decorationFixture();
    let current = true;
    mocked.svg.mockImplementation(async () => {
      current = false;
    });
    await expect(
      exportNativeCanvasPdf(
        source,
        nativeCanvasScene(source, '__tables__', 'physical'),
        'physical',
        'name',
        () => current,
      ),
    ).rejects.toThrow('canvas.export-context-changed');
    expect(click).not.toHaveBeenCalled();
  });
  it('checks the captured context again after the last download barrier', async () => {
    const source = decorationFixture();
    let current = true;
    await expect(
      exportNativeCanvasPdf(
        source,
        nativeCanvasScene(source, '__tables__', 'physical'),
        'physical',
        'name',
        () => current,
        async () => {
          current = false;
        },
      ),
    ).rejects.toThrow('canvas.export-context-changed');
    expect(click).not.toHaveBeenCalled();
  });
});
