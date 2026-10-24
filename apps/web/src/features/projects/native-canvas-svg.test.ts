import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decorationFixture } from './native-canvas-decoration-test-fixtures.js';
import { nativeCanvasScene } from './NativeERDCanvas.js';
import { nativeCanvasSvg, nativePngBounds } from './native-canvas-png.js';
import { exportNativeCanvasSvg } from './native-canvas-svg.js';

const click = vi.fn(),
  remove = vi.fn(),
  revoke = vi.fn();
let link: { href: string; download: string; click: typeof click; remove: typeof remove };
let downloaded: Blob;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  link = { href: '', download: '', click, remove };
  vi.stubGlobal('document', { body: { append: vi.fn() }, createElement: () => link });
  vi.stubGlobal('URL', {
    createObjectURL: (blob: Blob) => {
      downloaded = blob;
      return 'blob:svg';
    },
    revokeObjectURL: revoke,
  });
});
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('vector SVG export', () => {
  it('downloads UTF-8 XML with escaped text, a sanitized filename and vector elements', async () => {
    const source = decorationFixture();
    source.domains[0]!.name = '설계 <태그> & "따옴표"';
    source.layout.nodes.find((node) => node.objectId === 'a')!.width = 800;
    const result = await exportNativeCanvasSvg(
      source,
      nativeCanvasScene(source, 'overview', 'physical'),
      'physical',
      '설계/name',
    );
    expect(result.type).toBe('image/svg+xml;charset=utf-8');
    const xml = await downloaded.text();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('설계 &lt;태그&gt; &amp; &quot;따옴표&quot;');
    expect(xml).toContain('<path');
    expect(xml).not.toContain('<image');
    expect(link.download).toBe('설계_name.svg');
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:svg');
  });
  it('allows large vector scenes but rejects nonfinite geometry and empty scenes', () => {
    const source = decorationFixture();
    const scene = nativeCanvasScene(source, '__tables__', 'physical');
    scene.nodes[1]!.x = 1e7;
    expect(() => nativePngBounds(source, scene)).toThrow('canvas.export-size-limit');
    expect(nativeCanvasSvg(source, scene, 'physical', 'svg').bounds.width).toBeGreaterThan(1e7);
    scene.nodes[1]!.x = Infinity;
    expect(() => nativeCanvasSvg(source, scene, 'physical', 'svg')).toThrow(
      'canvas.export-size-limit',
    );
    expect(() => nativeCanvasSvg(source, { ...scene, nodes: [] }, 'physical', 'svg')).toThrow(
      'canvas.export-empty',
    );
  });
  it.each(['start', 'barrier', 'append'] as const)(
    'prevents a stale download at %s',
    async (phase) => {
      const source = decorationFixture();
      let current = phase !== 'start';
      if (phase === 'append')
        vi.mocked(globalThis.document.body.append).mockImplementation(() => {
          current = false;
        });
      await expect(
        exportNativeCanvasSvg(
          source,
          nativeCanvasScene(source, '__tables__', 'logical'),
          'logical',
          'name',
          () => current,
          async () => {
            if (phase === 'barrier') current = false;
          },
        ),
      ).rejects.toThrow('canvas.export-context-changed');
      expect(click).not.toHaveBeenCalled();
      if (phase === 'append') {
        expect(remove).toHaveBeenCalledOnce();
        vi.runAllTimers();
        expect(revoke).toHaveBeenCalledWith('blob:svg');
      }
    },
  );
});
