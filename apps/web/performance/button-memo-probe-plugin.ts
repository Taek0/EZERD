import type { Plugin } from 'vite';
/** Diagnostic A/B: default shallow comparison, never ignore callbacks. */
export function buttonMemoProbePlugin(): Plugin {
  return {
    name: 'button-memo-probe',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/features/projects/NativeCanvasTableRows.tsx'))
        return;
      const marker = 'export function NativeCanvasTableRows(';
      if (!source.includes(marker)) this.error('Missing rows probe target');
      return {
        code: `import {memo as __probeMemo} from 'react';\n${source.replace(marker, 'function NativeCanvasTableRows(')}\nconst __MemoRows = __probeMemo(NativeCanvasTableRows);\nexport {__MemoRows as NativeCanvasTableRows};`,
        map: null,
      };
    },
  };
}
/** Causal probe only: omit closed explorer column buttons; not a product animation implementation. */
export function buttonNavigatorProbePlugin(): Plugin {
  return {
    name: 'button-navigator-probe',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/features/projects/NativeNavigatorTable.tsx')) return;
      const marker = 'shown.map((column) => (';
      if (!source.includes(marker)) this.error('Missing navigator probe target');
      return { code: source.replace(marker, '(open ? shown : []).map((column) => ('), map: null };
    },
  };
}
