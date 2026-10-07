import { useState } from 'react';

const properties = [
  'display',
  'visibility',
  'opacity',
  'position',
  'z-index',
  'pointer-events',
  'background-color',
  'background-image',
  'transform',
  'transform-origin',
  'overflow',
  'overflow-x',
  'overflow-y',
  'contain',
  'content-visibility',
  'clip-path',
  'filter',
  'backdrop-filter',
  'mix-blend-mode',
  'isolation',
  'will-change',
] as const;
function describe(element: Element) {
  const style = (pseudo?: string) => {
    const value = getComputedStyle(element, pseudo);
    return Object.fromEntries(
      [...properties, 'content'].map((key) => [key, value.getPropertyValue(key)]),
    );
  };
  return {
    tag: element.tagName,
    id: element.id,
    classes: element.className,
    rect: element.getBoundingClientRect().toJSON(),
    inline: element.getAttribute('style'),
    scroll: {
      left: element.scrollLeft,
      top: element.scrollTop,
      width: element.scrollWidth,
      height: element.scrollHeight,
    },
    hidden: element.getAttribute('hidden'),
    style: style(),
    before: style('::before'),
    after: style('::after'),
  };
}
export function captureVisualAudit() {
  const surface = document.querySelector('.native-erd-surface')!,
    world = document.querySelector('.native-erd-world')!,
    panel = document.querySelector('.native-editor-inspector')!;
  const chain: Element[] = [];
  for (let current: Element | null = world; current; current = current.parentElement)
    chain.push(current);
  const cards = [...world.querySelectorAll<HTMLElement>('.native-erd-node')];
  const panelRect = panel.getBoundingClientRect();
  const overlaps = [...document.querySelectorAll('*')].filter((element) => {
    if (element.closest('.visual-audit')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left < panelRect.right &&
      rect.right > panelRect.left &&
      rect.top < panelRect.bottom &&
      rect.bottom > panelRect.top &&
      (style.pointerEvents === 'none' ||
        style.position === 'fixed' ||
        style.position === 'absolute')
    );
  });
  return {
    at: new Date().toISOString(),
    viewport: [innerWidth, innerHeight],
    dpr: devicePixelRatio,
    scroll: [scrollX, scrollY],
    documentSize: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    userAgent: navigator.userAgent,
    assets: [...document.scripts].map((s) => s.src).filter(Boolean),
    camera: world.getAttribute('style'),
    surface: describe(surface),
    panel: describe(panel),
    chain: chain.map(describe),
    siblings: chain.flatMap((el) =>
      [...(el.parentElement?.children ?? [])].filter((sibling) => sibling !== el).map(describe),
    ),
    panelOverlaps: overlaps.map(describe),
    cards: cards.map((card) => ({
      objectId: card.dataset.objectId,
      ...describe(card),
      rowCount: card.querySelectorAll('.native-table-column-row').length,
      body: card.querySelector('.native-table-columns')
        ? describe(card.querySelector('.native-table-columns')!)
        : null,
      firstRow: card.querySelector('.native-table-column-row')
        ? describe(card.querySelector('.native-table-column-row')!)
        : null,
    })),
    lines: [...world.querySelectorAll('path')].map((p) => p.getAttribute('d')),
    hitPanel: document
      .elementsFromPoint(panelRect.x + panelRect.width / 2, Math.max(panelRect.top, 0) + 100)
      .map((el) => ({ tag: el.tagName, classes: el.className })),
  };
}
export function VisualLayerAudit() {
  const [output, setOutput] = useState('');
  return (
    <div className="visual-audit">
      <button onClick={() => setOutput(JSON.stringify(captureVisualAudit(), null, 2))}>
        Capture layer audit
      </button>
      <button
        disabled={!output}
        onClick={() => {
          const a = document.createElement('a');
          const url = URL.createObjectURL(new Blob([output], { type: 'application/json' }));
          a.href = url;
          a.download = `lowzoom-audit-${Date.now()}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        Download layer audit
      </button>
      <textarea aria-label="Layer audit JSON" readOnly value={output} />
    </div>
  );
}
