import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webRoot = fileURLToPath(new URL('../../', import.meta.url));
const viteUrl = import.meta.resolve('vite');

function resolveEnvironment(command: 'build' | 'serve', shellEnv: Record<string, string> = {}) {
  const fixture = mkdtempSync(join(webRoot, 'node_modules/.vite-environment-'));
  const app = join(fixture, 'apps/web');
  mkdirSync(app, { recursive: true });
  copyFileSync(join(webRoot, 'vite.config.ts'), join(app, 'vite.config.ts'));
  writeFileSync(join(fixture, '.env'), 'NODE_ENV=development\nPORT=4321\n');
  const env = { ...process.env };
  delete env.NODE_ENV;
  delete env.VITE_USER_NODE_ENV;
  delete env.PORT;
  Object.assign(env, shellEnv);
  try {
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { resolveConfig } from ${JSON.stringify(viteUrl)};
const defaults = ${JSON.stringify(command)} === 'build' ? 'production' : 'development';
const config = await resolveConfig({ configFile: 'vite.config.ts', logLevel: 'silent' }, ${JSON.stringify(command)}, defaults, defaults);
process.stdout.write(JSON.stringify({ production: config.isProduction, dev: config.env.DEV, proxy: config.server.proxy['/api'].target }));`,
      ],
      { cwd: app, env, encoding: 'utf8' },
    );
    return JSON.parse(output) as { production: boolean; dev: boolean; proxy: string };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe('Vite server environment isolation', () => {
  it('builds production assets when the server environment selects development', () => {
    expect(resolveEnvironment('build')).toMatchObject({ production: true, dev: false });
  });

  it('preserves explicitly requested development builds', () => {
    expect(resolveEnvironment('build', { NODE_ENV: 'development' })).toMatchObject({
      production: false,
      dev: true,
    });
  });

  it('uses the server environment port for the development proxy', () => {
    expect(resolveEnvironment('serve')).toMatchObject({
      production: false,
      dev: true,
      proxy: 'http://127.0.0.1:4321',
    });
  });

  it('prefers an explicit shell port for the development proxy', () => {
    expect(resolveEnvironment('serve', { PORT: '5432' }).proxy).toBe('http://127.0.0.1:5432');
  });
});
