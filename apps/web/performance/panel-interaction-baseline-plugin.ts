import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';
export function panelInteractionBaselinePlugin(): Plugin {
  const paths = [
    'features/projects/NativeProjectView.tsx',
    'features/projects/NativeCanvasScene.tsx',
    'features/projects/use-navigator-resize.ts',
    'features/comments/PinPanelResizer.tsx',
  ];
  const sources = new Map(
    paths.map((path) => [
      path,
      execFileSync('git', ['show', `f9853fa:apps/web/src/${path}`], { encoding: 'utf8' }),
    ]),
  );
  return {
    name: 'panel-interaction-baseline',
    enforce: 'pre',
    transform(_code, id) {
      const path = paths.find((path) => id.replaceAll('\\', '/').endsWith('/src/' + path));
      return path ? { code: sources.get(path)!, map: null } : undefined;
    },
  };
}
