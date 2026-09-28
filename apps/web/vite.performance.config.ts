import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { measurementPlugin } from './performance/instrumentation.js';

export default defineConfig(() => ({
  plugins: [
    measurementPlugin(
      fileURLToPath(new URL('./src/shared/performance/collector.ts', import.meta.url)),
    ),
    react(),
    tailwindcss(),
  ],
  define: {
    __PERF_DIRTY__: JSON.stringify(
      Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
    ),
    __PERF_COMMIT__: JSON.stringify(
      execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    ),
  },
  build: {
    outDir: 'dist-performance',
    rollupOptions: { input: fileURLToPath(new URL('./performance/index.html', import.meta.url)) },
  },
  preview: { host: '127.0.0.1', port: 4175, strictPort: true },
}));
