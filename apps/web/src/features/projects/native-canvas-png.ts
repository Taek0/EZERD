import { nativeRelationEnds, nativeRelationEndPath } from './native-relation-presentation.js';
import { translate } from '../../shared/i18n/index.js';
import { nativeDomainGeometry } from './native-domain-lines.js';
import {
  nativeCardColor,
  nativeTableCanvasMetrics,
  nativeTableCanvasHeaderHeight,
  nativeRelationLabelWidth,
  nativeCanvasFontFamily,
  nativeTableCanvasTitle,
  nativeTableCanvasNamespace,
  nativeTableHeaderColor,
} from './native-canvas-style.js';
import type { NativeDesignDocument, NodeLayout } from '@ezerd/model';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
type Scene = ReturnType<typeof nativeCanvasScene> & { effectiveView?: string | undefined };
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
      { x: geometry.labelX - nativeRelationLabelWidth(label) / 2, y: geometry.labelY - 13 },
      { x: geometry.labelX + nativeRelationLabelWidth(label) / 2, y: geometry.labelY + 15 },
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
function wrappedText(
  x: number,
  y: number,
  value: string,
  width: number,
  size: number,
  lineHeight: number,
) {
  const lines: string[] = [];
  for (const paragraph of value.split('\n')) {
    let line = '',
      length = 0;
    for (const character of paragraph) {
      const advance = ((character.charCodeAt(0) > 255 ? 20 : 12.4) * size) / 20;
      if (line && length + advance > width) {
        lines.push(line);
        line = '';
        length = 0;
      }
      line += character;
      length += advance;
    }
    lines.push(line);
  }
  return lines.map((line, index) => text(x, y + index * lineHeight, line, size)).join('');
}
export function nativeCanvasSvg(
  document: NativeDesignDocument,
  scene: Scene,
  mode: 'physical' | 'logical',
) {
  const bounds = nativePngBounds(document, scene),
    domains = nativeDomainGeometry(document, scene.nodes);
  const globalView = (scene.effectiveView ?? scene.viewId) === '__tables__';
  const cards = scene.nodes
    .map((node: NodeLayout, index: number) => {
      const table = document.tables?.find((table) => table.id === node.objectId),
        domain = document.domains.find((domain) => domain.id === node.objectId),
        note = document.notes.find((note) => note.id === node.objectId);
      const title = table
        ? nativeTableCanvasTitle(table, mode) || translate('이름 없는 테이블')
        : (domain?.name ?? '메모');
      const namespace = table ? nativeTableCanvasNamespace(table, mode) : '';
      let contents = '';
      const cardClip = `native-card-${index}`;
      const clips: string[] = [
        `<clipPath id="${cardClip}"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${note ? 3 : table ? 5 : 12}"/></clipPath>`,
      ];
      if (table) {
        const showNullable = table.canvasDisplay?.showNullable !== false,
          showComment = table.canvasDisplay?.showComment !== false;
        const metrics = nativeTableCanvasMetrics(document, table, mode);
        const columns = [
          { key: 'keys', label: translate('키'), width: 0 },
          { key: 'name', label: translate('컬럼'), width: 0 },
          { key: 'type', label: translate('타입'), width: 0 },
          ...(showNullable
            ? [
                {
                  key: 'nullable',
                  label: mode === 'physical' ? 'NULL' : translate('필수'),
                  width: 0,
                },
              ]
            : []),
          ...(showComment
            ? [
                {
                  key: 'comment',
                  label: mode === 'physical' ? 'comment' : translate('정의'),
                  width: 0,
                },
              ]
            : []),
        ];
        const available = Math.max(
          node.width - 2 - 20 - (columns.length - 1) * 6,
          metrics.widths.reduce((sum, width) => sum + width, 0),
        );
        const minimum = metrics.widths.reduce((sum, width) => sum + width, 0);
        columns.forEach((column, index) => {
          column.width = (metrics.widths[index]! * available) / minimum;
        });
        const owner =
          document.domains.find((domain) => domain.id === table.domainId)?.name ??
          translate('미지정');
        contents = `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="50" fill="${xml(nativeTableHeaderColor(document, table))}"/>`;
        clips.push(
          `<clipPath id="${cardClip}-title"><rect x="${node.x + 10}" y="${node.y}" width="${(globalView ? node.width * 0.58 : node.width) - 20}" height="50"/></clipPath>`,
        );
        contents += `<g fill="#ffffff" class="native-png-header native-png-title" clip-path="url(#${cardClip}-title)">${text(node.x + 10, node.y + 34, title, 26)}</g>`;
        clips.push(
          `<clipPath id="${cardClip}-owner"><rect x="${node.x + node.width * 0.6}" y="${node.y}" width="${node.width * 0.4 - 10}" height="50"/></clipPath>`,
        );
        if (globalView)
          contents += `<g class="native-png-header" clip-path="url(#${cardClip}-owner)">${text(node.x + node.width - 10, node.y + 27, owner, 13, 'end')}${namespace ? text(node.x + node.width - 10, node.y + 40, namespace, 10, 'end') : ''}</g>`;
        contents += `<rect x="${node.x}" y="${node.y + 50}" width="${node.width}" height="34" fill="#f3f5f7"/>`;
        let x = node.x + 11;
        for (const [i, col] of columns.entries()) {
          const clip = `${cardClip}-col-${i}`;
          clips.push(
            `<clipPath id="${clip}"><rect x="${x}" y="${node.y + 50}" width="${Math.max(0, col.width)}" height="${Math.max(0, node.height - 50)}"/></clipPath>`,
          );
          contents += `<g class="native-png-column-head" clip-path="url(#${clip})">${text(x, node.y + 73, col.label, 14)}</g>`;
          x += col.width + 6;
        }
        let offset = nativeTableCanvasHeaderHeight;
        for (const row of metrics.rows) {
          const keys = row.keys.split(' '),
            pk = keys.includes('PK'),
            fk = keys.includes('FK');
          const fill = pk && fk ? '#f1f0ff' : pk ? '#fff7df' : fk ? '#edf5ff' : '#ffffff';
          contents += `<rect x="${node.x}" y="${node.y + offset}" width="${node.width}" height="${row.height}" fill="${fill}"/><path d="M ${node.x} ${node.y + offset + row.height} H ${node.x + node.width}" style="stroke:#edf0f3;stroke-width:1"/>`;
          let x = node.x + 11;
          for (const [i, col] of columns.entries()) {
            const value = String(
              row[col.key as 'keys' | 'name' | 'type' | 'nullable' | 'comment'] ||
                (col.key === 'comment' ? '—' : ''),
            );
            if (col.key === 'nullable') {
              const checked =
                mode === 'physical' ? row.column.physical.nullable : row.column.logical.required;
              contents += `<g class="native-png-null" clip-path="url(#${cardClip}-col-${i})"><title>${xml(translate(row.nullable))}</title><rect x="${x}" y="${node.y + offset + row.height / 2 - 8}" width="16" height="16" rx="4" fill="${checked ? '#4169e1' : '#fff'}" stroke="#d0d5dd"/>${checked ? `<path d="M ${x + 3} ${node.y + offset + row.height / 2} l 3 3 l 7 -7" stroke="#fff" stroke-width="2"/>` : ''}</g>`;
            } else
              contents += `<g class="native-png-${col.key}" clip-path="url(#${cardClip}-col-${i})"><title>${xml(value)}</title>${wrappedText(x, node.y + offset + 25, value, col.width, col.key === 'keys' ? 14 : 20, 28)}</g>`;
            x += col.width + 6;
          }
          offset += row.height;
        }
        if (!metrics.rows.length)
          contents += text(
            node.x + 12,
            node.y + nativeTableCanvasHeaderHeight + 26,
            translate('컬럼을 추가해 설계를 시작하세요.'),
            15,
          );
        // Original prepareExportContent strips action buttons, preserving their card chrome.
        contents += `<rect x="${node.x}" y="${node.y + node.height - 40}" width="${node.width}" height="40" fill="#f7f9fb"/>`;
      } else if (domain) {
        const domainTitle = wrappedText(node.x + 20, node.y + 73, title, node.width - 40, 28, 36.4);
        const titleRows = Math.min(2, (domainTitle.match(/<text /g) ?? []).length);
        const descriptionY = node.y + 103 + (titleRows - 1) * 36.4;
        clips.push(
          `<clipPath id="${cardClip}-domain-title"><rect x="${node.x + 20}" y="${node.y + 45}" width="${node.width - 40}" height="73"/></clipPath>`,
          `<clipPath id="${cardClip}-domain-body"><rect x="${node.x + 20}" y="${descriptionY - 16}" width="${node.width - 40}" height="${Math.max(0, node.y + node.height - 52 - descriptionY + 16)}"/></clipPath>`,
        );
        contents = `<path class="native-png-domain-accent" d="M ${node.x} ${node.y + 2.5} H ${node.x + node.width}" style="stroke:${xml(domain.color ?? '#8993a3')};stroke-width:5"/>`;
        contents += `<g class="native-png-domain-overline">${text(node.x + 20, node.y + 36, 'DOMAIN', 13)}</g>`;
        contents += `<g class="native-png-title" clip-path="url(#${cardClip}-domain-title)">${domainTitle}</g>`;
        contents += `<g class="native-png-domain-body" clip-path="url(#${cardClip}-domain-body)">${wrappedText(
          node.x + 20,
          descriptionY,
          domain.description || translate('업무 영역을 설명해 주세요'),
          node.width - 40,
          16,
          24.8,
        )}</g>`;
      } else if (note) {
        contents = `<path d="M ${node.x} ${node.y + 2} H ${node.x + node.width}" style="stroke:${xml(note.color ?? '#fff3c4')};stroke-width:4"/>`;
        contents += `<g class="native-png-note-body">${wrappedText(
          node.x + 20,
          node.y + 38,
          note.text || translate('더블클릭하여 메모를 작성하세요'),
          node.width - 40,
          15,
          25.5,
        )}</g>`;
      }
      return `<g data-object-id="${xml(node.objectId)}"><defs>${clips.join('')}</defs><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${note ? 3 : table ? 5 : 12}" fill="${note ? `color-mix(in srgb, ${xml(note.color ?? '#fff3c4')} 24%, white)` : domain ? `color-mix(in srgb, ${xml(domain.color ?? '#8993a3')} 8%, #f5f7fa)` : '#ffffff'}" stroke="${xml(nativeCardColor(document, node.objectId))}"/><g clip-path="url(#${cardClip})">${contents}</g></g>`;
    })
    .join('');
  const paths =
    scene.relations
      .map(({ relation, geometry, label }) => {
        const [source, target] = nativeRelationEnds(relation),
          width = nativeRelationLabelWidth(label);
        const marker = (end: typeof source) => `native-png-crow-${end.min}-${end.max}`;
        return `<g class="native-png-relation"><path d="${xml(geometry.path)}" marker-start="url(#${marker(source)})" marker-end="url(#${marker(target)})"${mode === 'logical' ? ' stroke-dasharray="6 4"' : ''}/><rect x="${geometry.labelX - width / 2}" y="${geometry.labelY - 13}" width="${width}" height="28" rx="9" fill="#fafbfc" stroke="#bdc8d8"/>${text(geometry.labelX, geometry.labelY + 5, label, 12, 'middle')}</g>`;
      })
      .join('') +
    domains
      .map(
        ({ relation, geometry }) =>
          `<g class="native-png-domain-relation"><path d="${xml(geometry.path)}" marker-end="url(#native-png-arrow)"${relation.direction === 'both' ? ' marker-start="url(#native-png-arrow)"' : ''}/>${geometry.labelAnchor ? `<path class="native-png-domain-leader" d="M ${geometry.labelAnchor.x} ${geometry.labelAnchor.y} L ${geometry.label.x} ${geometry.label.y + 4}"/>` : ''}${text(geometry.label.x, geometry.label.y, relation.name, 14, 'middle')}</g>`,
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><style>text{fill:#26344a;font-family:${nativeCanvasFontFamily}}path{stroke:#617087;stroke-width:1.5;fill:none}.native-png-header text{fill:#ffffff}.native-png-title text{font-weight:700}.native-png-column-head text{font-weight:600;fill:#617087}.native-png-domain-overline text{fill:#667995;letter-spacing:1.7px}.native-png-domain-body text{fill:#617087}.native-png-note-body text{fill:#555447}.native-png-relation>path{stroke:${relationColor};stroke-width:2}marker[id^="native-png-crow"] path{stroke:${relationColor};stroke-width:1.7}marker path{fill:none}.native-png-keys text{fill:#4169e1;font-weight:700}.native-png-type text{fill:#737d87;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.native-png-null path{stroke:#fff;stroke-width:2}.native-png-domain-relation>path{stroke:#74829a;stroke-width:1.7}.native-png-domain-relation .native-png-domain-leader{stroke-width:1;stroke-dasharray:3 3;opacity:.55}.native-png-domain-relation text{fill:#526582;stroke:#f6f8fb;stroke-width:5;paint-order:stroke}#native-png-arrow path{fill:#74829a;stroke:none}</style><defs>${crowDefs}<marker id="native-png-arrow" viewBox="0 0 10 10" markerWidth="7" markerHeight="7" refX="9" refY="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#f6f8fb"/>${paths}${cards}</svg>`;
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
