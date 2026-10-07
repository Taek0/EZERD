import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export default defineConfig(() => {
  const baseline = process.env.EZERD_MARQUEE_BASELINE === '1';
  const file = 'apps/web/src/features/projects/NativeERDCanvas.tsx';
  const original = baseline
    ? execFileSync('git', ['show', `a27b0de:${file}`], { encoding: 'utf8' })
    : '';
  return {
    resolve: { alias: [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }] },
    plugins: [
      {
        name: 'marquee-baseline',
        enforce: 'pre',
        transform(_code, id) {
          if (
            baseline &&
            id
              .replaceAll('\\', '/')
              .split('?')[0]
              ?.endsWith('/' + file)
          )
            return { code: original, map: null };
        },
      },
      react(),
      tailwindcss(),
    ],
    define: {
      __MARQUEE_BASELINE__: JSON.stringify(baseline),
      __PERF_COMMIT__: JSON.stringify(
        execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      ),
    },
    build: {
      outDir: baseline ? 'dist-marquee-before' : 'dist-marquee-after',
      rollupOptions: {
        input: fileURLToPath(new URL('./performance/marquee.html', import.meta.url)),
      },
    },
  };
});
