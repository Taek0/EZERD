import type { Plugin } from 'vite';
import { execFileSync } from 'node:child_process';
/** Rebuild the original product implementation with the corrected same harness. */
export function panelBaselinePlugin(): Plugin {
  const paths = [
    'apps/web/src/features/projects/NativeERDCanvas.tsx',
    'apps/web/src/features/projects/NativeProjectView.tsx',
    'apps/web/src/features/projects/NativeAdvancedEditor.tsx',
  ];
  const source = new Map(
    paths.map((path) => [
      path,
      execFileSync('git', ['show', `1745501:${path}`], { encoding: 'utf8' }),
    ]),
  );
  return {
    name: 'panel-original-product-only',
    enforce: 'pre',
    transform(code, id) {
      const path = id.replaceAll('\\', '/').split('?')[0]!;
      const target = paths.find((target) => path.endsWith('/' + target));
      return target ? { code: source.get(target)!, map: null } : undefined;
    },
  };
}
