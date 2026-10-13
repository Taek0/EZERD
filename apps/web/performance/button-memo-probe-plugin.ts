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
