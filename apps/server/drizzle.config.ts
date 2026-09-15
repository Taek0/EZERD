import { defineConfig } from 'drizzle-kit';
import { readConfig } from './src/config.js';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: readConfig().DATABASE_URL },
  strict: true,
});
