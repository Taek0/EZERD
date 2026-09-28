import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { measurementPlugin } from './performance/instrumentation.js';

export default defineConfig(() => {
  const frameMode = process.env.EZERD_PERF_FRAME_MODE ?? 'raf';
  if (frameMode !== 'raf' && frameMode !== 'immediate')
    throw new Error('Invalid performance frame mode');
  return {
    plugins: [
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
      outDir: frameMode === 'raf' ? 'dist-performance' : 'dist-performance-immediate',
      rollupOptions: { input: fileURLToPath(new URL('./performance/index.html', import.meta.url)) },
    },
    preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  };
});
