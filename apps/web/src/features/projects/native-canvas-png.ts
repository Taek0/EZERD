import { nativeRelationEnds, nativeRelationEndPath } from './native-relation-presentation.js';
import { translate } from '../../shared/i18n/index.js';
import { nativeDomainGeometry } from './native-domain-lines.js';
import {
  nativeCardColor,
  nativeTableCanvasRows,
  nativeTableHeaderColor,
} from './native-canvas-style.js';
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
    .map((node: NodeLayout, index: number) => {
      const table = document.tables?.find((table) => table.id === node.objectId),
        domain = document.domains.find((domain) => domain.id === node.objectId),
        note = document.notes.find((note) => note.id === node.objectId);
      const title = table
        ? mode === 'physical'
          ? table.physical.name || table.logical.name
          : table.logical.name || table.physical.name
        : (domain?.name ?? '메모');
      let contents = text(node.x + 12, node.y + 26, title, 14);
      const cardClip = `native-card-${index}`;
      const clips: string[] = [
        `<clipPath id="${cardClip}"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8"/></clipPath>`,
      ];
      if (table) {
        const showNullable = table.canvasDisplay?.showNullable !== false,
          showComment = table.canvasDisplay?.showComment !== false;
        const remaining = (node.width - 2 - 48 - (showNullable ? 70 : 0)) / (showComment ? 3 : 2);
        const columns = [
          { key: 'keys', label: translate('키'), width: 48 },
          { key: 'name', label: translate('컬럼'), width: remaining },
          { key: 'type', label: translate('타입'), width: remaining },
          ...(showNullable
            ? [
                {
                  key: 'nullable',
                  label: mode === 'physical' ? 'NULL' : translate('필수'),
                  width: 70,
                },
              ]
            : []),
          ...(showComment
            ? [
                {
                  key: 'comment',
                  label: mode === 'physical' ? 'comment' : translate('정의'),
                  width: remaining,
                },
              ]
            : []),
        ];
        const owner =
          document.domains.find((domain) => domain.id === table.domainId)?.name ??
          translate('미지정');
        contents = `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="50" fill="${xml(nativeTableHeaderColor(document, table))}"/>`;
        clips.push(
          `<clipPath id="${cardClip}-title"><rect x="${node.x + 10}" y="${node.y}" width="${node.width * 0.58 - 20}" height="50"/></clipPath>`,
        );
        contents += `<g fill="#ffffff" class="native-png-header" clip-path="url(#${cardClip}-title)">${text(node.x + 10, node.y + 33, title, 22)}</g>`;
        clips.push(
          `<clipPath id="${cardClip}-owner"><rect x="${node.x + node.width * 0.6}" y="${node.y}" width="${node.width * 0.4 - 10}" height="50"/></clipPath>`,
        );
        contents += `<g class="native-png-header" clip-path="url(#${cardClip}-owner)">${text(node.x + node.width - 10, node.y + 21, owner, 12, 'end')}${mode === 'physical' && table.physical.namespace.kind === 'postgresSchema' ? text(node.x + node.width - 10, node.y + 36, table.physical.namespace.name || 'public', 10, 'end') : ''}</g>`;
        contents += `<rect x="${node.x}" y="${node.y + 50}" width="${node.width}" height="28" fill="#f6f8fb"/>`;
        let x = node.x + 1;
        for (const [i, col] of columns.entries()) {
          const clip = `${cardClip}-col-${i}`;
          clips.push(
            `<clipPath id="${clip}"><rect x="${x + 6}" y="${node.y + 50}" width="${Math.max(0, col.width - 12)}" height="${Math.max(0, node.height - 50)}"/></clipPath>`,
          );
          contents += `<g clip-path="url(#${clip})">${text(x + 6, node.y + 68, col.label, 11)}</g>`;
          x += col.width;
        }
        let offset = 78;
        for (const row of nativeTableCanvasRows(document, table, mode)) {
          const keys = row.keys.split(' '),
            pk = keys.includes('PK'),
            fk = keys.includes('FK');
          const fill = pk && fk ? '#f1f0ff' : pk ? '#fff7df' : fk ? '#edf5ff' : '#ffffff';
          contents += `<rect x="${node.x}" y="${node.y + offset}" width="${node.width}" height="${row.height}" fill="${fill}"/><path d="M ${node.x} ${node.y + offset + row.height} H ${node.x + node.width}" stroke="#d8dce4"/>`;
          let x = node.x + 1;
          for (const [i, col] of columns.entries()) {
            const value = String(
              row[col.key as 'keys' | 'name' | 'type' | 'nullable' | 'comment'] ||
                (col.key === 'comment' ? '—' : ''),
            );
            contents += `<g clip-path="url(#${cardClip}-col-${i})"><title>${xml(value)}</title>${text(x + 6, node.y + offset + row.height / 2 + 4, value.replaceAll('\n', ' '), col.key === 'keys' ? 11 : col.key === 'nullable' ? 10 : 13)}</g>`;
            x += col.width;
          }
          offset += row.height;
        }
      } else
        for (const [index, line] of (note?.text ?? domain?.description ?? '').split('\n').entries())
          contents += text(node.x + 12, node.y + 54 + index * 18, line);
      return `<g data-object-id="${xml(node.objectId)}"><defs>${clips.join('')}</defs><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="${note ? xml(note.color ?? '#fff9d9') : '#ffffff'}" stroke="${xml(nativeCardColor(document, node.objectId))}"/><g clip-path="url(#${cardClip})">${contents}</g></g>`;
    })
    .join('');
  const paths =
    scene.relations
      .map(({ relation, geometry, label }) => {
        const [source, target] = nativeRelationEnds(relation),
          width = Math.max(90, label.length * 8 + 24);
        const marker = (end: typeof source) => `native-png-crow-${end.min}-${end.max}`;
        return `<g class="native-png-relation"><path d="${xml(geometry.path)}" marker-start="url(#${marker(source)})" marker-end="url(#${marker(target)})"${mode === 'logical' ? ' stroke-dasharray="6 4"' : ''}/><rect x="${geometry.labelX - width / 2}" y="${geometry.labelY - 13}" width="${width}" height="28" rx="9" fill="#fafbfc" stroke="#bdc8d8"/>${text(geometry.labelX, geometry.labelY + 5, label, 12, 'middle')}</g>`;
      })
      .join('') +
    domains
      .map(
        ({ relation, geometry }) =>
          `<g><path d="${xml(geometry.path)}" marker-end="url(#native-png-arrow)"${relation.direction === 'both' ? ' marker-start="url(#native-png-arrow)"' : ''}/>${text(geometry.label.x, geometry.label.y, relation.name, 12, 'middle')}</g>`,
      )
      .join('');
  const relationColor = mode === 'physical' ? '#4169e1' : '#617087';
  const crowDefs = ([0, 1] as const)
    .flatMap((min) =>
      ([1, 'many'] as const).map(
        (max) =>
          `<marker id="native-png-crow-${min}-${max}" viewBox="0 0 32 24" refX="30" refY="12" markerWidth="32" markerHeight="24" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><g fill="none" stroke="${relationColor}" stroke-width="1.7"><path d="${nativeRelationEndPath(max)}"/>${min === 0 ? '<circle cx="10" cy="12" r="5" fill="#fafbfc"/>' : '<path d="M 13 4 L 13 20"/>'}</g></marker>`,
      ),
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><style>text{fill:#26344a;font-family:system-ui,sans-serif}path{stroke:#617087;stroke-width:1.5;fill:none}.native-png-header text{fill:#ffffff}.native-png-relation>path{stroke:${relationColor};stroke-width:2}marker[id^="native-png-crow"] path{stroke:${relationColor};stroke-width:1.7}marker path{fill:none}#native-png-arrow path{fill:#617087}</style><defs>${crowDefs}<marker id="native-png-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 Z"/></marker></defs><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#f6f8fb"/>${paths}${cards}</svg>`;
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
