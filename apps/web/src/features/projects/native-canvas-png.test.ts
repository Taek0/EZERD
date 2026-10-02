import { afterEach, describe, expect, it, vi } from 'vitest';
import { decorationFixture } from './native-canvas-decoration-test-fixtures.js';
import { nativeCanvasScene } from './NativeERDCanvas.js';
import { nativeCanvasSvg, nativePngBounds, exportNativeCanvasPng } from './native-canvas-png.js';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('native PNG uses semantic source and common geometry', () => {
  it('serializes native labels/legacy data and common styles with XML escaping independent of camera', () => {
    const source = decorationFixture(),
      before = structuredClone(source),
      scene = nativeCanvasScene(source, '__tables__', 'physical');
    const output = nativeCanvasSvg(source, scene, 'physical');
    expect(output.svg).toContain('ORIGINAL_TYPE');
    expect(output.svg).toContain('&lt;script&gt;comment&lt;/script&gt;');
    expect(output.svg).not.toContain('<script>');
    expect(output.svg).toContain('stroke="#123456"');
    expect(output.svg).toContain('NOT NULL');
    source.layout.viewports = [{ viewId: '__tables__', x: 1e7, y: -1e7, zoom: 4 }];
    expect(
      nativeCanvasSvg(source, nativeCanvasScene(source, '__tables__', 'physical'), 'physical'),
    ).toEqual(output);
    expect(source.columns).toEqual(before.columns);
  });
  it('includes common domain relation geometry/labels and excludes table nodes from overview', () => {
    const source = decorationFixture(),
      scene = nativeCanvasScene(source, 'overview', 'physical'),
      { svg } = nativeCanvasSvg(source, scene, 'physical');
    expect(svg).toContain('Tracks');
    expect(svg).toContain('marker-start');
    expect(svg).toContain('data-object-id="a"');
    expect(svg).not.toContain('data-object-id="t"');
  });
  it('rejects empty or excessive pixel dimensions before allocating an image', () => {
    const source = decorationFixture(),
      scene = nativeCanvasScene(source, '__tables__', 'physical');
    expect(() => nativePngBounds(source, { ...scene, nodes: [] })).toThrow('canvas.export-empty');
    scene.nodes[1]!.x = 1e7;
    expect(() => nativePngBounds(source, scene)).toThrow('canvas.export-size-limit');
  });
  it('encodes image/png at the bounded common 2x scale and downloads only in the captured context', async () => {
    vi.useFakeTimers();
    const source = decorationFixture(),
      scene = nativeCanvasScene(source, '__tables__', 'physical');
    const click = vi.fn(),
      remove = vi.fn(),
      append = vi.fn(),
      draw = vi.fn(),
      scale = vi.fn(),
      revoke = vi.fn(),
      createUrl = vi.fn(() => 'blob:native-qa');
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ scale, drawImage: draw }),
        toBlob: (consume: (blob: Blob) => void, type: string) =>
          consume(new Blob(['PNG encoder fixture'], { type })),
      },
      link = { href: '', download: '', click, remove };
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        async decode() {}
      },
    );
    vi.stubGlobal('document', {
      createElement: (kind: string) => (kind === 'canvas' ? canvas : link),
      body: { append },
    });
    vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revoke });
    const result = await exportNativeCanvasPng(
      source,
      scene,
      'physical',
      'native/name',
      () => true,
    );
    expect(scale).toHaveBeenCalledWith(2, 2);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('image/png');
    expect(canvas.width).toBe(result.width * 2);
    expect(link.download).toBe('native_name-2x.png');
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:native-qa');
  });
  it('stops an image decode completed after actor/project context changes before canvas/download', async () => {
    let resolve!: () => void,
      current = true;
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        decode() {
          return new Promise<void>((done) => {
            resolve = done;
          });
        }
      },
    );
    const allocate = vi.fn();
    vi.stubGlobal('document', { createElement: allocate });
    const source = decorationFixture(),
      operation = exportNativeCanvasPng(
        source,
        nativeCanvasScene(source, '__tables__', 'physical'),
        'physical',
        'Source',
        () => current,
      );
    current = false;
    resolve();
    await expect(operation).rejects.toThrow('canvas.export-context-changed');
    expect(allocate).not.toHaveBeenCalled();
  });
});
