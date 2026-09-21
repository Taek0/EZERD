import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanAccessService } from '../src/network/network-access.js';
import { isPrivateIPv4, parseAllowedCidrs } from '../src/network/network-policy.js';
import { SyncGateway } from '../src/sync/sync.gateway.js';

const original = {
  NODE_ENV: process.env.NODE_ENV,
  HOST: process.env.HOST,
  LAN_ALLOWED_CIDRS: process.env.LAN_ALLOWED_CIDRS,
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('LAN network access', () => {
  it('accepts only valid private IPv4 CIDRs', () => {
    expect(
      parseAllowedCidrs('10.2.0.0/16,172.16.0.0/12,192.168.0.0/24,192.168.1.20/32'),
    ).toHaveLength(4);
    expect(isPrivateIPv4('192.168.1.20')).toBe(true);
    expect(isPrivateIPv4('8.8.8.8')).toBe(false);
    for (const invalid of [
      '',
      '0.0.0.0/0',
      '8.8.8.0/24',
      '192.168.1.0/33',
      '192.168.1.1',
      '192.168.1.0/abc',
      '172.0.0.0/8',
      '192.168.1.0/24,',
    ]) {
      if (invalid === '') expect(parseAllowedCidrs(invalid)).toEqual([]);
      else expect(() => parseAllowedCidrs(invalid)).toThrow('LAN_ALLOWED_CIDRS');
    }
  });

  it('allows loopback, IPv4 and IPv4-mapped IPv6 only within configured ranges', () => {
    process.env.NODE_ENV = 'test';
    process.env.LAN_ALLOWED_CIDRS = '192.168.40.0/24';
    const access = new LanAccessService();
    expect(access.isAllowed('127.0.0.1')).toBe(true);
    expect(access.isAllowed('::1')).toBe(true);
    expect(access.isAllowed('192.168.40.25')).toBe(true);
    expect(access.isAllowed('::ffff:192.168.40.25')).toBe(true);
    expect(access.isAllowed('::ffff:c0a8:2819')).toBe(true);
    expect(access.isAllowed('192.168.41.25')).toBe(false);
    expect(access.isAllowed('8.8.8.8')).toBe(false);
    expect(access.isAllowed(undefined)).toBe(false);
  });

  it('ignores forwarding headers and rejects HTTP before calling the next middleware', () => {
    process.env.NODE_ENV = 'test';
    process.env.LAN_ALLOWED_CIDRS = '192.168.40.0/24';
    const access = new LanAccessService();
    const next = vi.fn();
    const end = vi.fn();
    const setHeader = vi.fn();
    const response = { statusCode: 200, end, setHeader };
    access.middleware(
      {
        socket: { remoteAddress: '8.8.8.8' },
        headers: { 'x-forwarded-for': '192.168.40.25', forwarded: 'for=192.168.40.25' },
      } as never,
      response as never,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(403);
    expect(end).toHaveBeenCalledOnce();
  });

  it('rejects a WebSocket upgrade before session authentication', () => {
    const sessions = { authenticateToken: vi.fn() };
    const network = { isAllowed: vi.fn(() => false) };
    const gateway = new SyncGateway({} as never, sessions as never, network as never);
    const server = new EventEmitter();
    gateway.attach(server as never);
    const socket = { destroy: vi.fn() };
    server.emit(
      'upgrade',
      {
        url: '/api/sync?token=secret',
        socket: { remoteAddress: '8.8.8.8' },
        headers: { 'x-forwarded-for': '192.168.40.25' },
      },
      socket,
      Buffer.alloc(0),
    );
    expect(network.isAllowed).toHaveBeenCalledWith('8.8.8.8');
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(sessions.authenticateToken).not.toHaveBeenCalled();
  });
});
