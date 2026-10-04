import { nativeDomainGeometry } from './native-domain-lines.js';
import { nativeCardColor, nativeTableCanvasRows } from './native-canvas-style.js';
import type { NativeDesignDocument, NodeLayout } from '@ezerd/model';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
type Scene = ReturnType<typeof nativeCanvasScene>;
const xml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  );
const pathPoints = (path: string) => {
  const values = path.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  return Array.from({ length: Math.floor(values.length / 2) }, (_, i) => ({
    x: values[i * 2]!,
    y: values[i * 2 + 1]!,
  }));
};
export function nativePngBounds(document: NativeDesignDocument, scene: Scene) {
  if (!scene.nodes.length) throw Error('canvas.export-empty');
  const geometry = nativeDomainGeometry(document, scene.nodes);
  const points = [
    ...scene.nodes.flatMap((node) => [
      { x: node.x, y: node.y },
      { x: node.x + node.width, y: node.y + node.height },
    ]),
    ...scene.relations.flatMap(({ geometry, label }) => [
      ...geometry.points,
      { x: geometry.labelX - Math.max(90, label.length * 14 + 24) / 2, y: geometry.labelY - 12 },
      { x: geometry.labelX + Math.max(90, label.length * 14 + 24) / 2, y: geometry.labelY + 12 },
    ]),
    ...geometry.flatMap(({ geometry, relation }) => [
      ...pathPoints(geometry.path),
      { x: geometry.label.x - relation.name.length * 7 - 16, y: geometry.label.y - 12 },
      { x: geometry.label.x + relation.name.length * 7 + 16, y: geometry.label.y + 12 },
    ]),
  ];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
      throw Error('canvas.export-size-limit');
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const x = minX - 64,
    y = minY - 64;
  const width = Math.ceil(maxX - x + 64),
    height = Math.ceil(maxY - y + 64),
    scale = 2;
  // The same bounded browser raster budget as the existing common canvas PNG exporter.
  if (width * height * scale * scale > 120000000 || Math.max(width, height) * scale > 32760)
    throw Error('canvas.export-size-limit');
  return { x, y, width, height, scale };
}
const text = (x: number, y: number, value: string, size = 12, anchor = 'start') =>
  `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}">${xml(value)}</text>`;
export function nativeCanvasSvg(
  document: NativeDesignDocument,
  scene: Scene,
  mode: 'physical' | 'logical',
) {
  const bounds = nativePngBounds(document, scene),
    domains = nativeDomainGeometry(document, scene.nodes);
  const cards = scene.nodes
    .map((node: NodeLayout) => {
      const table = document.tables?.find((table) => table.id === node.objectId),
        domain = document.domains.find((domain) => domain.id === node.objectId),
        note = document.notes.find((note) => note.id === node.objectId);
      const title = table
        ? mode === 'physical'
          ? table.physical.name || table.logical.name
          : table.logical.name || table.physical.name
        : (domain?.name ?? '메모');
      let contents = text(node.x + 12, node.y + 26, title, 14);
      if (table) {
        let offset = 78;
        for (const row of nativeTableCanvasRows(document, table, mode)) {
          contents +=
            text(node.x + 8, node.y + offset + 18, row.keys, 10) +
            text(node.x + 46, node.y + offset + 18, row.name) +
            text(node.x + node.width * 0.57, node.y + offset + 18, row.type);
          if (row.comment)
            contents += text(
              node.x + 46,
              node.y + offset + 35,
              row.comment.replaceAll('\n', ' '),
              10,
            );
          if (row.nullable)
            contents += text(node.x + node.width * 0.57, node.y + offset + 35, row.nullable, 10);
          offset += row.height;
        }
      } else
        for (const [index, line] of (note?.text ?? domain?.description ?? '').split('\n').entries())
          contents += text(node.x + 12, node.y + 54 + index * 18, line);
      return `<g data-object-id="${xml(node.objectId)}"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" fill="${note ? '#fff9d9' : '#ffffff'}" stroke="${xml(nativeCardColor(document, node.objectId))}"/>${contents}</g>`;
    })
    .join('');
  const paths =
    scene.relations
      .map(
        ({ geometry, label }) =>
          `<g><path d="${xml(geometry.path)}" marker-end="url(#native-png-arrow)"/>${text(geometry.labelX, geometry.labelY, label, 12, 'middle')}</g>`,
      )
      .join('') +
    domains
      .map(
        ({ relation, geometry }) =>
          `<g><path d="${xml(geometry.path)}" marker-end="url(#native-png-arrow)"${relation.direction === 'both' ? ' marker-start="url(#native-png-arrow)"' : ''}/>${text(geometry.label.x, geometry.label.y, relation.name, 12, 'middle')}</g>`,
      )
      .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><style>text{fill:#26344a;font-family:system-ui,sans-serif}path{stroke:#617087;stroke-width:1.5;fill:none}marker path{fill:#617087}</style><defs><marker id="native-png-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 Z"/></marker></defs><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#f6f8fb"/>${paths}${cards}</svg>`;
  return { svg, bounds };
}
export async function exportNativeCanvasPng(
  document: NativeDesignDocument,
  scene: Scene,
  mode: 'physical' | 'logical',
  name: string,
  current: () => boolean = () => true,
  beforeDownload?: () => Promise<void>,
) {
  const prepared = nativeCanvasSvg(document, scene, mode);
  if (!current()) throw Error('canvas.export-context-changed');
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(prepared.svg)}`;
  await image.decode();
  if (!current()) throw Error('canvas.export-context-changed');
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = prepared.bounds.width * prepared.bounds.scale;
  canvas.height = prepared.bounds.height * prepared.bounds.scale;
  const context = canvas.getContext('2d');
  if (!context) throw Error('canvas.export-unavailable');
  context.scale(prepared.bounds.scale, prepared.bounds.scale);
  context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(Error('canvas.export-unavailable'))),
      'image/png',
    ),
  );
  if (!current()) throw Error('canvas.export-context-changed');
  await beforeDownload?.();
  if (!current()) throw Error('canvas.export-context-changed');
  const url = URL.createObjectURL(blob),
    link = globalThis.document.createElement('a');
  try {
    link.href = url;
    link.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}-2x.png`;
    globalThis.document.body.append(link);
    if (current()) link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return { ...prepared.bounds, type: blob.type };
}
