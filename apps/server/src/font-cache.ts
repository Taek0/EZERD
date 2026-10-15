import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

type AssetResponse = {
  req: { originalUrl?: string; url?: string };
  setHeader(name: string, value: string): unknown;
};

/** Fixed HTML/CSS discover updates; only known content-versioned fonts get immutable caching. */
export function createFontCacheHeaders(webRoot: string) {
  const directory = 'fonts/apple-sd-gothic-neo/';
  const versions = new Map<string, string>();
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(resolve(webRoot, directory, 'manifest.json'), 'utf8'),
    );
    if (
      manifest &&
      typeof manifest === 'object' &&
      'files' in manifest &&
      Array.isArray(manifest.files)
    ) {
      for (const entry of manifest.files) {
        if (
          entry &&
          typeof entry.file === 'string' &&
          /^[\w.-]+\.woff2?$/.test(entry.file) &&
          typeof entry.sha256 === 'string' &&
          /^[a-f0-9]{64}$/.test(entry.sha256)
        )
          versions.set(directory + entry.file, entry.sha256);
      }
    }
  } catch {
    // Older public builds without a manifest remain usable with conservative caching.
  }
  return (response: AssetResponse, file: string): void => {
    const name = relative(webRoot, file).replaceAll('\\', '/');
    if (name.endsWith('.html') || name === `${directory}fonts.css`) {
      response.setHeader('Cache-Control', 'no-cache');
      return;
    }
    if (!name.startsWith(directory) || !/\.woff2?$/.test(name)) return;
    const url = new URL(response.req.originalUrl ?? response.req.url ?? '/', 'http://localhost');
    const expected = versions.get(name);
    response.setHeader(
      'Cache-Control',
      expected && url.searchParams.get('v') === expected
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    );
  };
}
