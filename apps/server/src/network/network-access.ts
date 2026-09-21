import { BlockList, isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Injectable } from '@nestjs/common';
import { readConfig } from '../config.js';
import { parseAllowedCidrs } from './network-policy.js';

@Injectable()
export class LanAccessService {
  private readonly allowed = new BlockList();

  constructor() {
    const cidrs = parseAllowedCidrs(readConfig().LAN_ALLOWED_CIDRS);
    this.allowed.addSubnet('127.0.0.0', 8, 'ipv4');
    this.allowed.addAddress('::1', 'ipv6');
    for (const cidr of cidrs) this.allowed.addSubnet(cidr.address, cidr.prefix, 'ipv4');
  }

  isAllowed(remoteAddress: string | undefined): boolean {
    if (!remoteAddress) return false;
    const family = isIP(remoteAddress);
    return family !== 0 && this.allowed.check(remoteAddress, family === 6 ? 'ipv6' : 'ipv4');
  }

  readonly middleware = (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ): void => {
    if (this.isAllowed(request.socket.remoteAddress)) return next();
    response.statusCode = 403;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ statusCode: 403, message: '허용되지 않은 네트워크입니다.' }));
  };
}
