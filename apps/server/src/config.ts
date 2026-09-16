import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const envSchema = z.object({
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
