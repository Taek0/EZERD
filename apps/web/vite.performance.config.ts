import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { measurementPlugin } from './performance/instrumentation.js';
import { panelBaselinePlugin } from './performance/panel-baseline-plugin.js';
import { panelProfilingPlugin } from './performance/panel-profiling-plugin.js';
import { comparisonPlugin } from './performance/comparison-plugin.js';

export default defineConfig(() => {
  const comparison = process.env.EZERD_PERF_COMPARISON === '1';
  const frameMode = process.env.EZERD_PERF_FRAME_MODE ?? 'raf';
  if (frameMode !== 'raf' && frameMode !== 'immediate')
    throw new Error('Invalid performance frame mode');
  return {
    resolve: {
      alias: comparison
        ? [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }]
        : [],
    },
    plugins: [
      ...(process.env.EZERD_PANEL_BASELINE === '1' ? [panelBaselinePlugin()] : []),
      ...(process.env.EZERD_PANEL_DETAIL === '1'
        ? [
            panelProfilingPlugin(
              fileURLToPath(new URL('./performance/panel-profiles.ts', import.meta.url)),
            ),
          ]
        : []),
      ...(comparison
        ? [
            comparisonPlugin(
              fileURLToPath(new URL('./performance/comparison-control.ts', import.meta.url)),
            ),
          ]
        : []),
      measurementPlugin(
        fileURLToPath(new URL('./src/shared/performance/collector.ts', import.meta.url)),
        frameMode,
      ),
      react(),
      tailwindcss(),
    ],
    define: {
      __PANEL_BASELINE__: JSON.stringify(process.env.EZERD_PANEL_BASELINE === '1'),
      __PERF_FRAME_MODE__: JSON.stringify(frameMode),
      __PERF_DIRTY__: JSON.stringify(
        Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
      ),
      __PERF_COMMIT__: JSON.stringify(
        execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      ),
    },
    build: {
      outDir: comparison
        ? 'dist-performance-comparison'
        : frameMode === 'raf'
          ? 'dist-performance'
          : 'dist-performance-immediate',
      rollupOptions: {
        input: {
          panels: fileURLToPath(new URL('./performance/panels.html', import.meta.url)),
          interactions: fileURLToPath(new URL('./performance/interactions.html', import.meta.url)),
          workspace: fileURLToPath(new URL('./performance/workspace.html', import.meta.url)),
          legacy: fileURLToPath(new URL('./performance/index.html', import.meta.url)),
          compare: fileURLToPath(new URL('./performance/compare.html', import.meta.url)),
          native: fileURLToPath(new URL('./performance/native.html', import.meta.url)),
        },
      },
    },
    preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  };
});
