import { afterEach, describe, expect, it, vi } from 'vitest';
import { decorationFixture } from './native-canvas-decoration-test-fixtures.js';
import { nativeCanvasScene } from './NativeERDCanvas.js';
import { nativeCanvasSvg, nativePngBounds, exportNativeCanvasPng } from './native-canvas-png.js';
import { nativeTableCanvasHeaderHeight, nativeTableCanvasMetrics } from './native-canvas-style.js';
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
    expect(output.svg).toContain('stroke="#c8d0de"');
    expect(output.svg).toContain('NOT NULL');
    expect(output.svg).toContain('native-png-header');
    expect(output.svg).toContain('height="50" fill="#123456"');
    expect(output.svg).toContain('native-png-crow-0-many');
    expect(output.svg).toContain('clip-path=');
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
  it('exports source row typography, line breaks, NULL checkbox and footer without altering native payloads', () => {
    const source = decorationFixture(),
      before = structuredClone(source);
    source.columns![0]!.physical.comment = 'First line\nSecond line';
    const scene = nativeCanvasScene(source, '__tables__', 'physical');
    const { svg } = nativeCanvasSvg(source, scene, 'physical');
    const metrics = nativeTableCanvasMetrics(source, source.tables![0]!, 'physical');
    expect(svg).toContain('font-size="26"');
    expect(svg).toContain('font-size="20"');
    expect(svg).toContain('native-png-null');
    expect(svg).toContain('native-png-footer');
    expect(svg).toContain(`height="${metrics.rows[0]!.height}"`);
    expect(svg).toContain(
      `y="${scene.nodes.find((node) => node.objectId === 't')!.y + nativeTableCanvasHeaderHeight}"`,
    );
    expect(svg).toMatch(/>First line<\/text>.*>Second line<\/text>/);
    expect(source.columns![0]!.physical.type).toEqual(before.columns![0]!.physical.type);
    expect(source.columns![0]!.physical.defaultValue).toEqual(
      before.columns![0]!.physical.defaultValue,
    );
  });
  it('exports source note body without its artificial heading and domain overline/navigation', () => {
    const source = decorationFixture();
    let { svg } = nativeCanvasSvg(
      source,
      nativeCanvasScene(source, '__tables__', 'physical'),
      'physical',
    );
    expect(svg).toContain('color-mix(in srgb, #abcdef 24%, white)');
    expect(svg).not.toContain('>메모</text>');
    ({ svg } = nativeCanvasSvg(
      source,
      nativeCanvasScene(source, 'overview', 'physical'),
      'physical',
    ));
    expect(svg).toContain('>DOMAIN</text>');
    expect(svg).toContain('native-png-domain-accent');
    expect(svg.replace(/<[^>]*>/g, '')).toContain('업무 영역을 설명해 주세요');
    expect(svg).toContain('>도메인 열기 ↗</text>');
  });
  it('respects the effective domain view while retaining the shared table placement identity', () => {
    const source = decorationFixture();
    const scene = { ...nativeCanvasScene(source, 'a', 'physical'), effectiveView: 'a' };
    expect(scene.nodes.find((node) => node.objectId === 't')!.viewId).toBe('__tables__');
    const { svg } = nativeCanvasSvg(source, scene, 'physical');
    expect(svg).toContain('>records</text>');
    expect(svg).not.toContain('>Orders</text>');
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
