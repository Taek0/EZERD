import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function configureApplication(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  app.useBodyParser('json', { limit: '2mb' });
  const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  if (existsSync(`${webRoot}/index.html`)) {
    // UI and API share one origin/port for LAN hosting. Only public build assets are served.
    app.useStaticAssets(webRoot, { dotfiles: 'deny' });
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('Web build missing. Run pnpm build before hosting.');
  }
}
