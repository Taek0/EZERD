import type { NativeDesignDocument } from '@ezerd/model';
import { nativeCanvasSvg } from './native-canvas-png.js';
import type { nativeCanvasScene } from './NativeERDCanvas.js';

const fontFamily = 'EZERDPdf';
// PDF 1.7's standard page limit is 200 inches (14,400 points).
const maxPagePoints = 14400;
export function nativePdfPageSize(width: number, height: number) {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0))
    throw Error('canvas.export-size-limit');
  const scale = Math.min(0.75, maxPagePoints / Math.max(width, height));
  return { width: width * scale, height: height * scale };
}

let fonts: Promise<{ regular: string; bold: string }> | undefined;
function loadFonts() {
  return (fonts ??= Promise.all(
    (['Regular', 'Bold'] as const).map(async (weight) => {
      const response = await fetch(
        `${import.meta.env.BASE_URL}fonts/pdf/NanumGothic-${weight}.ttf`,
      );
      if (!response.ok) throw Error('canvas.export-font-unavailable');
      const bytes = await response.arrayBuffer();
      // svg2pdf measures text in the browser; use exactly the embedded PDF font there too.
      const face = new FontFace(fontFamily, bytes, { weight: weight === 'Bold' ? '700' : '400' });
      await face.load();
      globalThis.document.fonts.add(face);
      const array = new Uint8Array(bytes);
      let binary = '';
      for (let offset = 0; offset < array.length; offset += 8192)
        binary += String.fromCharCode(...array.subarray(offset, offset + 8192));
      return btoa(binary);
    }),
  )
    .then(([regular, bold]) => ({ regular: regular!, bold: bold! }))
    .catch((error: unknown) => {
      fonts = undefined;
      throw error;
    }));
}

export async function exportNativeCanvasPdf(
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
  const prepared = nativeCanvasSvg(document, scene, mode, 'pdf');
  const page = nativePdfPageSize(prepared.bounds.width, prepared.bounds.height);
  const [{ jsPDF }, { svg2pdf }, font] = await Promise.all([
    import('jspdf'),
    import('svg2pdf.js'),
    loadFonts(),
  ]);
  check();
  const pdf = new jsPDF({
    orientation: page.width > page.height ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [page.width, page.height],
    compress: true,
    putOnlyUsedFonts: true,
  });
  for (const style of ['normal', 'bold'] as const) {
    const filename = `NanumGothic-${style}.ttf`;
    pdf.addFileToVFS(filename, style === 'bold' ? font.bold : font.regular);
    pdf.addFont(filename, fontFamily, style);
  }
  pdf.setFont(fontFamily);
  pdf.setProperties({ title: name, creator: 'EZERD' });
  // CSS Color 5 color-mix is unsupported by svg2pdf's color parser.
  const svgText = prepared.svg
    .replace(/font-family:[^;}]+/g, `font-family:${fontFamily}`)
    .replace(/font-weight:600/g, 'font-weight:700')
    .replace(/color-mix\(in srgb, (#[\da-f]{6}) 8%, #f5f7fa\)/gi, (_, color: string) => {
      const base = [245, 247, 250];
      return (
        '#' +
        base
          .map((value, index) =>
            Math.round(
              value * 0.92 + parseInt(color.slice(1 + index * 2, 3 + index * 2), 16) * 0.08,
            )
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')
      );
    });
  const svg = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement;
  await svg2pdf(svg, pdf, { width: page.width, height: page.height, loadImages: false });
  check();
  const blob = pdf.output('blob');
  await beforeDownload?.();
  check();
  const url = URL.createObjectURL(blob);
  const link = globalThis.document.createElement('a');
  try {
    link.href = url;
    link.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
    globalThis.document.body.append(link);
    check();
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return { ...page, pages: pdf.getNumberOfPages(), type: blob.type };
}
