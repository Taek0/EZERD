import { existsSync } from 'node:fs';

const server = new URL('../apps/server/dist/main.js', import.meta.url);
const web = new URL('../apps/web/dist/index.html', import.meta.url);
if (!existsSync(server) || !existsSync(web))
  throw new Error('Run pnpm build and pnpm db:migrate before hosting.');
process.env.NODE_ENV = 'production';
process.env.HOST = '127.0.0.1';
// The reverse proxy is the only LAN listener; the application remains loopback-only.
const { readConfig } = await import('../apps/server/dist/config.js');
const { PORT, MCP_ENABLED, MCP_PUBLIC_URL } = readConfig();
console.log(`Loopback upstream: http://127.0.0.1:${PORT}`);
if (MCP_ENABLED) console.log(`MCP public URL: ${MCP_PUBLIC_URL}`);
console.log('Connect through the configured HTTPS reverse proxy. Ctrl+C stops the service.');
await import(server.href);
