import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

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
  })
  .superRefine((value, context) => {
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
      const loopback =
        url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
      const secure =
        url.protocol === 'https:' ||
        (value.NODE_ENV !== 'production' && loopback && url.protocol === 'http:');
      if (
        !secure ||
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
            'MCP_PUBLIC_URL must be an HTTPS /mcp URL without credentials, query, or fragment.',
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
