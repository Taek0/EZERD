import { copyFile, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';

const root = new URL('../', import.meta.url);
await mkdir(new URL('.data/postgres/', root), { recursive: true });
try {
  await copyFile(new URL('.env.example', root), new URL('.env', root), constants.COPYFILE_EXCL);
  console.log('Created .env for local development.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Existing .env preserved.');
}

