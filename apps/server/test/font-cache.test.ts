import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFontCacheHeaders } from '../src/font-cache.js';

const root = resolve('apps/web/public');
const base = '/fonts/apple-sd-gothic-neo/';
const manifest = JSON.parse(readFileSync(resolve(root, `.${base}manifest.json`), 'utf8')) as {
  files: { file: string; sha256: string }[];
};
describe('versioned font HTTP caching', () => {
  it('gives immutable caching only to a matching content version', () => {
    const headers = createFontCacheHeaders(root);
    const font = manifest.files[0]!;
    const file = resolve(root, `.${base}${font.file}`);
    const response = (url: string) => {
      const values: Record<string, string> = {};
      headers(
        {
          req: { originalUrl: url },
          setHeader: (key, value) => {
            values[key] = value;
          },
        },
        file,
      );
      return values['Cache-Control'];
    };
    expect(response(`${base}${font.file}?v=${font.sha256}`)).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(response(`${base}${font.file}`)).toBe('no-cache');
    expect(response(`${base}${font.file}?v=old`)).toBe('no-cache');
  });
  it('keeps HTML and fixed font CSS revalidatable', () => {
    const headers = createFontCacheHeaders(root);
    for (const file of ['index.html', 'fonts/apple-sd-gothic-neo/fonts.css']) {
      const values: Record<string, string> = {};
      headers(
        {
          req: { originalUrl: `/${file}` },
          setHeader: (key, value) => {
            values[key] = value;
          },
        },
        resolve(root, file),
      );
      expect(values['Cache-Control']).toBe('no-cache');
    }
  });
  it('versions every stylesheet reference with its actual bytes and preserves subset loading', () => {
    const css = readFileSync(resolve(root, `.${base}fonts.css`), 'utf8');
    const urls = [...css.matchAll(/url\(\.\/([^()]+)\)/g)].map((match) => match[1]);
    expect(urls).toHaveLength(manifest.files.length);
    for (const font of manifest.files) {
      const hash = createHash('sha256')
        .update(readFileSync(resolve(root, `.${base}${font.file}`)))
        .digest('hex');
      expect(hash).toBe(font.sha256);
      expect(urls).toContain(`${font.file}?v=${hash}`);
    }
    expect(css.match(/unicode-range:/g)).toHaveLength(manifest.files.length);
    expect(css.match(/font-display: swap/g)).toHaveLength(manifest.files.length);
  });
});
