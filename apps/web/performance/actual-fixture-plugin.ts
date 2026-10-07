import type { Plugin, Connect } from 'vite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
/** Opt-in localhost-only snapshot route; never copied into a build/public asset. */
export function actualFixturePlugin(): Plugin {
  const enabled = process.env.EZERD_ACTUAL_FIXTURE === '1';
  const file = fileURLToPath(
    new URL(
      '../../../artifacts/performance/2026-10-07-actual-chrome/snapshot.json',
      import.meta.url,
    ),
  );
  const install = (middlewares: Connect.Server) =>
    middlewares.use('/__diagnostic/snapshot.json', async (req, res) => {
      if (
        !enabled ||
        req.method !== 'GET' ||
        !['127.0.0.1:4180', 'localhost:4180'].includes(req.headers.host ?? '')
      ) {
        res.statusCode = 404;
        res.end();
        return;
      }
      try {
        const data = await readFile(file);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(data);
      } catch {
        res.statusCode = 404;
        res.end();
      }
    });
  return {
    name: 'local-actual-fixture',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}
