import { networkInterfaces } from 'node:os';
import { existsSync } from 'node:fs';

const server = new URL('../apps/server/dist/main.js', import.meta.url);
const web = new URL('../apps/web/dist/index.html', import.meta.url);
if (!existsSync(server) || !existsSync(web)) throw new Error('Run pnpm build and pnpm db:migrate before hosting.');
process.env.NODE_ENV = 'production';
process.env.HOST = '0.0.0.0';
// readConfig loads .env without overwriting the explicit LAN host above.
const { readConfig } = await import('../apps/server/dist/config.js');
const { PORT } = readConfig();
console.log(`Local: http://localhost:${PORT}`);
for (const addresses of Object.values(networkInterfaces())) {
  for (const address of addresses ?? []) {
    if (address.family === 'IPv4' && !address.internal) console.log(`LAN candidate: http://${address.address}:${PORT}`);
  }
}
console.log('Use the Wi-Fi adapter address on another device connected to the same network. Ctrl+C stops the service.');
await import(server.href);

