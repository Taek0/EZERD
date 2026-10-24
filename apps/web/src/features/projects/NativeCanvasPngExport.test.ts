import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { decorationSnapshot } from './native-canvas-decoration-test-fixtures.js';
import { NativeCanvasPngExport } from './NativeCanvasPngExport.js';
import { nativeCanvasScene } from './NativeERDCanvas.js';

const exports = vi.hoisted(() => ({
  pdf: vi.fn(async () => {}),
  svg: vi.fn(async () => {}),
  png: vi.fn(async () => {}),
}));
vi.mock('./native-canvas-svg.js', () => ({ exportNativeCanvasSvg: exports.svg }));
vi.mock('./native-canvas-pdf.js', () => ({ exportNativeCanvasPdf: exports.pdf }));
vi.mock('./native-canvas-png.js', () => ({ exportNativeCanvasPng: exports.png }));

describe('canvas export controls', () => {
  it.each(['pdf', 'svg'] as const)(
    'uses normalized shared placements for %s and preserves the chosen filter and mode',
    async (format) => {
      vi.clearAllMocks();
      const snapshot = decorationSnapshot();
      snapshot.sourceDocument = structuredClone(snapshot.sourceDocument);
      snapshot.sourceDocument.layout.nodes = [];
      const filter = { domainIds: ['a'], unassigned: false };
      const sceneFor = vi.fn(nativeCanvasScene);
      let runPdf!: () => Promise<void>;
      const before = structuredClone(snapshot);
      renderToStaticMarkup(
        createElement(NativeCanvasPngExport, {
          snapshot,
          viewId: '__tables__',
          mode: 'logical',
          filter,
          sceneFor,
          renderControl(control) {
            runPdf = format === 'pdf' ? control.runPdf : control.runSvg;
            return null;
          },
        }),
      );
      await runPdf();
      expect(sceneFor).toHaveBeenCalledWith(
        expect.objectContaining({
          layout: expect.objectContaining({
            nodes: expect.arrayContaining([expect.objectContaining({ objectId: 't' })]),
          }),
        }),
        '__tables__',
        'logical',
        filter,
      );
      expect(exports[format]).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          nodes: expect.arrayContaining([expect.objectContaining({ objectId: 't' })]),
        }),
        'logical',
        snapshot.project.name,
        expect.any(Function),
      );
      expect(exports.png).not.toHaveBeenCalled();
      expect(snapshot).toEqual(before);
    },
  );
});
