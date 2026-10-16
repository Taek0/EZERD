import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ command, mode }) => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  // Server-only NODE_ENV must not change the client build mode through loadEnv.
  const apiPort = command === 'serve' ? loadEnv(mode, root, '').PORT : undefined;
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': { target: `http://127.0.0.1:${apiPort || '3001'}`, changeOrigin: true, ws: true },
      },
    },
  };
});
