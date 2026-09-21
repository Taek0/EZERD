import { isIP } from 'node:net';

export type IPv4Cidr = { address: string; prefix: number };

function ipv4Number(address: string): number {
  return address.split('.').reduce((value, part) => (value * 256 + Number(part)) >>> 0, 0) >>> 0;
}

function privateBlock(address: number): '10' | '172' | '192' | undefined {
  if (address >= ipv4Number('10.0.0.0') && address <= ipv4Number('10.255.255.255')) return '10';
  if (address >= ipv4Number('172.16.0.0') && address <= ipv4Number('172.31.255.255')) return '172';
  if (address >= ipv4Number('192.168.0.0') && address <= ipv4Number('192.168.255.255'))
    return '192';
  return undefined;
}

export function isPrivateIPv4(address: string): boolean {
  return isIP(address) === 4 && privateBlock(ipv4Number(address)) !== undefined;
}

export function parseAllowedCidrs(value: string): IPv4Cidr[] {
  if (!value.trim()) return [];
  return value.split(',').map((raw) => {
    const item = raw.trim();
    const match = /^([^/]+)\/(\d{1,2})$/.exec(item);
    if (!match || isIP(match[1]!) !== 4) throw new Error('LAN_ALLOWED_CIDRS');
    const prefix = Number(match[2]);
    if (prefix < 1 || prefix > 32) throw new Error('LAN_ALLOWED_CIDRS');
    const address = ipv4Number(match[1]!);
    const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
    const first = (address & mask) >>> 0;
    const last = (first | (~mask >>> 0)) >>> 0;
    const block = privateBlock(first);
    if (!block || privateBlock(last) !== block) throw new Error('LAN_ALLOWED_CIDRS');
    return { address: match[1]!, prefix };
  });
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    (isIP(normalized) === 4 && normalized.split('.')[0] === '127')
  );
}
