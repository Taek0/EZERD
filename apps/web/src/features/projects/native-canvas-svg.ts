import type { NativeDesignDocument } from '@ezerd/model';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
import { nativeCanvasSvg } from './native-canvas-png.js';

export async function exportNativeCanvasSvg(
  document: NativeDesignDocument,
  scene: ReturnType<typeof nativeCanvasScene>,
  mode: 'physical' | 'logical',
  name: string,
  current: () => boolean = () => true,
  beforeDownload?: () => Promise<void>,
) {
  const check = () => {
    if (!current()) throw Error('canvas.export-context-changed');
  };
  check();
  const prepared = nativeCanvasSvg(document, scene, mode, 'svg');
  const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', prepared.svg], {
    type: 'image/svg+xml;charset=utf-8',
  });
  await beforeDownload?.();
  check();
  const url = URL.createObjectURL(blob);
  const link = globalThis.document.createElement('a');
  try {
    link.href = url;
    link.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.svg`;
    globalThis.document.body.append(link);
    check();
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return { ...prepared.bounds, type: blob.type };
}
