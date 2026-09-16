import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { isLoopbackHost, isPrivateIPv4, parseAllowedCidrs } from './network-policy.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => /^postgres(ql)?:\/\//.test(value)),
    MCP_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    MCP_PUBLIC_URL: z.string().url().optional(),
    MCP_LOG_DIR: z.string().min(1).default('.data/logs/mcp'),
    LAN_ALLOWED_CIDRS: z.string().default(''),
  })
  .superRefine((value, context) => {
    let cidrsValid = true;
    try {
      parseAllowedCidrs(value.LAN_ALLOWED_CIDRS);
    } catch {
      cidrsValid = false;
      context.addIssue({
        code: 'custom',
        path: ['LAN_ALLOWED_CIDRS'],
        message: 'LAN_ALLOWED_CIDRS is invalid.',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      !isLoopbackHost(value.HOST) &&
      (value.LAN_ALLOWED_CIDRS.trim() === '' || !cidrsValid)
    )
      context.addIssue({
        code: 'custom',
        path: ['LAN_ALLOWED_CIDRS'],
        message: 'LAN_ALLOWED_CIDRS is required for a LAN bind.',
      });
    if (value.MCP_ENABLED && !value.MCP_PUBLIC_URL)
      context.addIssue({
        code: 'custom',
        path: ['MCP_PUBLIC_URL'],
        message: 'MCP_PUBLIC_URL is required when MCP is enabled.',
      });
    if (value.MCP_PUBLIC_URL) {
      let url: URL;
      try {
        url = new URL(value.MCP_PUBLIC_URL);
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['MCP_PUBLIC_URL'],
          message: 'MCP_PUBLIC_URL must be a valid URL.',
        });
        return;
      }
      const loopback = isLoopbackHost(url.hostname);
      const privateHttp =
        url.protocol === 'http:' &&
        (loopback || isPrivateIPv4(url.hostname)) &&
        Number(url.port || '80') === value.PORT;
      const secure = url.protocol === 'https:';
      if (
        (!secure && !privateHttp) ||
        url.pathname !== '/mcp' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        context.addIssue({
          code: 'custom',
          path: ['MCP_PUBLIC_URL'],
          message:
            'MCP_PUBLIC_URL must be a private LAN HTTP URL on PORT or an HTTPS /mcp URL without credentials, query, or fragment.',
        });
    }
  });

export function readConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // Never include raw environment values (especially database credentials) in logs.
    throw new Error(
      `Invalid environment: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}. Run pnpm setup and check .env.`,
    );
  }
  return result.data;
}
