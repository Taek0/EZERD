import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function configureApplication(app: NestExpressApplication): void {
  // Only a loopback reverse proxy may supply the client address used by request limits.
  app.set('trust proxy', 'loopback');
  app.setGlobalPrefix('api');
  // Sync requests carry a validated baseline, final candidate, and semantic diff.
  // Each document is capped at 1.5 MB by the shared contract, so the transport
  // envelope must allow the bounded duplicated representation.
  app.useBodyParser('json', { limit: '8mb' });
  const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  if (existsSync(`${webRoot}/index.html`)) {
    // UI and API share one origin/port for LAN hosting. Only public build assets are served.
    app.useStaticAssets(webRoot, { dotfiles: 'deny' });
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('Web build missing. Run pnpm build before hosting.');
  }
}
