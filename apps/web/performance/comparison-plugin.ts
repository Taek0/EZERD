import type { Plugin } from 'vite';

/** Diagnostic only: deliberately ignores callback identity on an immutable read-only pan tree. */
export function comparisonPlugin(controlPath: string): Plugin {
  return {
    name: 'canvas-comparison-only',
    enforce: 'pre',
    transform(source, id) {
      const path = id.replaceAll('\\', '/').split('?')[0]!;
      const name = path.endsWith('/features/tables/TableEditor.tsx')
        ? 'TableNodeContent'
        : path.endsWith('/features/relations/TableRelations.tsx')
          ? 'TableRelationsSvg'
          : null;
      if (!name) return;
      const marker = `export function ${name}(`;
      if (!source.includes(marker)) this.error(`Missing comparison target ${name}`);
      const simple =
        name === 'TableNodeContent'
          ? `if (__comparison.variant === 'simple-cards') return <div className="comparison-simple-card">{props.document.tables?.find(t => t.id === props.tableId)?.physical.name}</div>;`
          : `if (__comparison.variant === 'no-relations') return null;`;
      return {
        code: `import { memo as __comparisonMemo } from 'react';
import { comparisonControl as __comparison } from ${JSON.stringify(controlPath)};
${source.replace(marker, `function ${name}Detailed(`)}
const ${name}Cached = __comparisonMemo(${name}Detailed, (a, b) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(key => {
    const left = (a as any)[key], right = (b as any)[key];
    return typeof left === 'function' && typeof right === 'function' || Object.is(left, right);
  });
});
export function ${name}(props: Parameters<typeof ${name}Detailed>[0]) {
  ${simple}
  const View = __comparison.variant === 'memo-leaves' ? ${name}Cached : ${name}Detailed;
  return <View {...props} />;
}`,
        map: null,
      };
    },
  };
}
