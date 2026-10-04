import { describe, expect, it } from 'vitest';
import {
  compileNativeDatabaseDDL,
  databaseFeatureIds,
  databaseFeatureCatalog,
  checkDatabaseFeature,
  defaultDatabaseContext,
} from '@ezerd/model';
import { nativeStoredDesignDocumentSchema } from '@ezerd/contracts';
import {
  nativeFeaturePathCases,
  nativeFeaturePathFixture,
  nativeFeaturePathReadiness,
  nativeFeaturePathCommands,
} from '../scripts/native-feature-path-fixtures.js';

describe('native full-path feature fixture engine combinations', () => {
  it('has a concrete candidate for every registered feature and each declared DB support subset', () => {
    expect(
      new Set(
        nativeFeaturePathCases
          .filter((spec) => databaseFeatureIds.includes(spec.feature as never))
          .map((spec) => spec.feature),
      ),
    ).toEqual(new Set(databaseFeatureIds));
    expect(
      nativeFeaturePathCases
        .filter((spec) => spec.kind === 'postgresql' && spec.feature === 'indexMethod')
        .map((spec) => spec.variant),
    ).toEqual(['btree', 'hash', 'gist', 'spgist', 'gin', 'brin']);
    expect(new Set(nativeFeaturePathCases.map((spec) => spec.key)).size).toBe(
      nativeFeaturePathCases.length,
    );
    for (const feature of databaseFeatureCatalog)
      for (const kind of ['postgresql', 'mysql', 'sqlite'] as const) {
        if (!feature.databases.includes(kind))
          expect(checkDatabaseFeature(defaultDatabaseContext(kind), feature.id)).toMatchObject({
            supported: false,
            usable: false,
            code: 'feature.not-supported',
          });
        else
          expect(
            nativeFeaturePathCases.some(
              (spec) => spec.kind === kind && spec.feature === feature.id,
            ),
          ).toBe(true);
      }
  });
  it.each(nativeFeaturePathCases)(
    '$key has canonical graph/shape and no engine error hidden behind a false gate',
    (spec) => {
      const fixture = nativeFeaturePathFixture(spec),
        before = structuredClone(fixture),
        policy = nativeFeaturePathReadiness(fixture);
      expect(nativeStoredDesignDocumentSchema.parse(fixture.prepare)).toEqual(fixture.prepare);
      expect(nativeStoredDesignDocumentSchema.parse(fixture.candidate)).toEqual(fixture.candidate);
      expect(policy.graph).toEqual([]);
      const nonGate = policy.errors.filter(
        (issue) =>
          ![
            'feature.not-implemented',
            'type.not-implemented',
            'default.not-ready',
            'column.on-update-not-ready',
          ].includes(issue.code),
      );
      expect(nonGate, JSON.stringify(policy.errors)).toEqual([]);
      const compiled = compileNativeDatabaseDDL(fixture.candidate);
      expect(compiled.canExport, JSON.stringify(compiled.issues)).toBe(true);
      expect(compiled.sql.length).toBeGreaterThan(0);
      expect(nativeFeaturePathCommands(fixture).length).toBeGreaterThan(0);
      expect(fixture).toEqual(before);
    },
  );
});
