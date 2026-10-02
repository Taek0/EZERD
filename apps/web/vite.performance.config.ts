import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { measurementPlugin } from './performance/instrumentation.js';
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
          legacy: fileURLToPath(new URL('./performance/index.html', import.meta.url)),
          compare: fileURLToPath(new URL('./performance/compare.html', import.meta.url)),
          native: fileURLToPath(new URL('./performance/native.html', import.meta.url)),
        },
      },
    },
    preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  };
});
