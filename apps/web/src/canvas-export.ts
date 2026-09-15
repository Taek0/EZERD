type Bounds = { x: number; y: number; width: number; height: number };

/** Export the complete visible view, independently of current pan/zoom. */
export async function exportCanvasPng(
  world: HTMLElement,
  nodes: Bounds[],
  name: string,
): Promise<void> {
  if (!nodes.length) return;
  await document.fonts.ready;
  const padding = 64;
  // Orthogonal detours and labels can extend beyond card bounds.
  const contentBounds = [...nodes];
  world.querySelectorAll<SVGGraphicsElement>('svg.relations > g').forEach((group) => {
    const box = group.getBBox();
    if (box.width || box.height)
      contentBounds.push({ x: box.x, y: box.y, width: box.width, height: box.height });
  });
  const left = Math.min(...contentBounds.map((n) => n.x)) - padding;
  const top = Math.min(...contentBounds.map((n) => n.y)) - padding;
  const width = Math.ceil(Math.max(...contentBounds.map((n) => n.x + n.width)) - left + padding);
  const height = Math.ceil(Math.max(...contentBounds.map((n) => n.y + n.height)) - top + padding);
  const scale = 2;
  if (width * height * scale * scale > 120_000_000 || Math.max(width, height) * scale > 32760)
    throw new Error('Export dimensions exceed browser limits');
  const clone = world.cloneNode(true) as HTMLElement;
  const originals = [world, ...world.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  originals.forEach((element, index) => {
    const target = copies[index] as HTMLElement | SVGElement;
    const computed = getComputedStyle(element);
    const style = Array.from(computed)
      .map((key) => `${key}:${computed.getPropertyValue(key)};`)
      .join('');
    target.setAttribute('style', style);
    if (element instanceof HTMLInputElement) target.setAttribute('value', element.value);
  });
  clone
    .querySelectorAll(
      'button,.resize-handle,.domain-connection-preview,.connection-preview-layer,.review-pin,.relation-route-handle,.table-relation-route-control,[data-export-hidden]',
    )
    .forEach((element) => element.remove());
  clone.style.cssText += `;position:absolute;left:0;top:0;transform:translate(${-left}px,${-top}px);width:${width}px;height:${height}px;overflow:visible;`;
  clone.querySelectorAll('.canvas-node').forEach((element) => {
    const node = element as HTMLElement;
    node.style.boxShadow = 'none';
    node.style.outline = 'none';
    node.style.opacity = '1';
  });
  // SVG images cannot load external font URLs. Embed only subsets used by this view.
  const codepoints = [...(world.textContent ?? '')].map((char) => char.codePointAt(0)!);
  const fontRules: string[] = [];
  const sheets = Array.from(document.styleSheets);
  for (const sheet of sheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const range = rule.style.getPropertyValue('unicode-range');
      const matches =
        !range ||
        range.split(',').some((part) => {
          const [start, end] = part.trim().replace(/^U\+/i, '').split('-');
          const low = parseInt(start!.replace(/\?/g, '0'), 16),
            high = parseInt((end ?? start!).replace(/\?/g, 'f'), 16);
          return codepoints.some((point) => point >= low && point <= high);
        });
      if (!matches) continue;
      let css = rule.cssText;
      for (const match of [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)]) {
        const response = await fetch(new URL(match[1]!, sheet.href ?? document.baseURI));
        if (!response.ok) throw new Error('Font unavailable');
        const blob = await response.blob();
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        css = css.replace(match[0], `url("${data}")`);
      }
      fontRules.push(css);
    }
  }
  const fontStyle = document.createElement('style');
  fontStyle.textContent = fontRules.join('\n');
  clone.prepend(fontStyle);
  const background = getComputedStyle(world.closest('.canvas-surface') ?? world).backgroundColor;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${width}px;height:${height}px;background:${background === 'rgba(0, 0, 0, 0)' ? '#f8fafc' : background};overflow:hidden">${new XMLSerializer().serializeToString(clone)}</div></foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.scale(scale, scale);
  context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('PNG generation failed'))),
      'image/png',
    ),
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}-2x.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
