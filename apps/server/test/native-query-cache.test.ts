import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { createEmptyNativeDocument, defaultDatabaseContext } from '@ezerd/model';
import { NativeQueryCache } from '../src/mcp/native-query-cache.js';

const database = { ...defaultDatabaseContext('postgresql'), revision: 0 };
const source = () => createEmptyNativeDocument(defaultDatabaseContext('postgresql'));

describe('native shared query cache', () => {
  it('preserves raw identifiers, names, exact numeric literals and imported legacy payloads', () => {
    const cache = new NativeQueryCache();
    const raw = source();
    raw.domains = [{ id: ' domain ', name: ' Domain ', description: ' raw description ' }];
    raw.columns = ['large-number', 'legacy-expression'].map((id) => ({
      id: ` ${id} `,
      tableId: ' table ',
      scope: 'both',
      logical: { name: ' Name ', definition: ' Definition ', semanticType: '', required: false },
      physical: {
        name: ' physical_name ',
        type: {
          kind: 'legacy',
          source: 'document-v1',
          original: { name: ' INT8 ', isArray: false },
        },
        nullable: true,
        comment: ' raw comment ',
        generation: { kind: 'none' },
        defaultValue:
          id === 'large-number'
            ? { kind: 'literal', literalType: 'number', value: '18446744073709551615' }
            : { kind: 'legacyExpression', source: 'document-v1', original: ' unregistered() ' },
        options: { database: 'postgresql' },
      },
      customProperties: { common: {}, logical: {}, physical: {} },
    }));
    const result = cache.parse('raw', raw, database);
    expect(result).toEqual(raw);
    expect(result).not.toBe(raw);
    expect(cache.get('raw')).toBe(result);
  });

  it('keeps parsed snapshots immutable without freezing the caller source', () => {
    const cache = new NativeQueryCache();
    const raw = source();
    const document = cache.parse('head', raw, database);
    expect(cache.get('head')).toBe(document);
    expect(Object.isFrozen(document.layout.nodes)).toBe(true);
    raw.domains.push({ id: 'later', name: 'Later', description: '' });
    expect(document.domains).toEqual([]);
    expect(() => document.domains.push({ id: 'bad', name: 'Bad', description: '' })).toThrow();
  });

  it('bounds entries and uses the most recently accessed snapshot', () => {
    const cache = new NativeQueryCache(2);
    cache.parse('first', source(), database);
    cache.parse('second', source(), database);
    cache.get('first');
    cache.parse('third', source(), database);
    expect(cache.get('first')).toBeDefined();
    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('third')).toBeDefined();
  });

  it('bounds source bytes and does not retain oversized snapshots', () => {
    const bytes = Buffer.byteLength(JSON.stringify(source()));
    const cache = new NativeQueryCache(32, bytes);
    cache.parse('first', source(), database);
    cache.parse('second', source(), database);
    expect(cache.get('first')).toBeUndefined();
    expect(cache.get('second')).toBeDefined();
    const large = source();
    large.domains.push({ id: 'large', name: 'Large', description: 'x'.repeat(100) });
    expect(cache.parse('large', large, database)).toEqual(large);
    expect(cache.get('large')).toBeUndefined();
    expect(cache.get('second')).toBeDefined();
  });

  it('rejects invalid source and database context without caching either', () => {
    const cache = new NativeQueryCache();
    try {
      cache.parse('invalid', {}, database);
      throw new Error('Expected invalid source rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'document.source-invalid',
      });
    }
    expect(cache.get('invalid')).toBeUndefined();
    expect(() =>
      cache.parse('changed', source(), { ...defaultDatabaseContext('mysql'), revision: 1 }),
    ).toThrow('현재 DB 설정');
    expect(cache.get('changed')).toBeUndefined();
    expect(() =>
      cache.parse(
        'v1',
        {
          schemaVersion: 1,
          domains: [],
          domainRelations: [],
          notes: [],
          layout: { nodes: [], viewports: [] },
        },
        database,
      ),
    ).toThrow('native v2');
    expect(cache.get('v1')).toBeUndefined();
  });
});
