import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

const server = new URL('../apps/server/dist/main.js', import.meta.url);
const web = new URL('../apps/web/dist/index.html', import.meta.url);
if (!existsSync(server) || !existsSync(web))
  throw new Error('Run pnpm build and pnpm db:migrate before hosting.');
process.env.NODE_ENV = 'production';
// The dedicated hosting command intentionally overrides the development loopback default.
process.env.HOST = '0.0.0.0';
const { readConfig } = await import('../apps/server/dist/config.js');
const { PORT, MCP_ENABLED, MCP_PUBLIC_URL, LAN_ALLOWED_CIDRS } = readConfig();
console.log(`Local check: http://127.0.0.1:${PORT}/api/health/ready`);
for (const addresses of Object.values(networkInterfaces())) {
  for (const address of addresses ?? []) {
    if (address.family === 'IPv4' && !address.internal)
      console.log(`LAN candidate: http://${address.address}:${PORT}`);
  }
}
console.log(`Allowed client CIDRs: ${LAN_ALLOWED_CIDRS}`);
if (MCP_ENABLED) console.log(`MCP public URL: ${MCP_PUBLIC_URL}`);
console.log('Only clients in LAN_ALLOWED_CIDRS can connect. Ctrl+C stops the service.');
await import(server.href);
