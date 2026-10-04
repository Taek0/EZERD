import { getDatabaseType, validateDatabaseTypeParameters } from './catalog.js';
import type { DatabaseContext } from './definitions.js';
import type { NativeColumnType, NativeGeneration } from './native-document.js';
import { getDatabaseProfile } from './profiles.js';
import { nativeTypeHasCoverage } from './literals.js';
import { checkDatabaseFeature } from './features.js';
import { hasDatabaseCoverage } from './definitions.js';
import { nativeFeatureCoverage } from './readiness.js';

export interface NativeKeyEligibility {
  /** Direct constraints with the profile's default operator class, without a prefix. */
  primaryAllowed: boolean;
  uniqueAllowed: boolean;
  usable: boolean;
  coverage: boolean;
  readinessCode?: 'type.declaration-not-ready';
  code?: string;
  category?: 'unsupported' | 'invalid';
  conditions: readonly string[];
  estimatedBytes?: number;
}

export interface NativeKeyFacts {
  charset?: string;
  generation?: NativeGeneration;
  /** Without a requested kind, readiness conservatively requires both key paths. */
  kind?: 'primary' | 'unique';
  strict?: boolean;
}

// Verified against CREATE TABLE + each direct constraint; no extension opclasses.
const pgNoBtree = new Set([
  'json',
  'jsonpath',
  'xml',
  'point',
  'line',
  'lseg',
  'box',
  'path',
  'polygon',
  'circle',
  'pg_snapshot',
  'txid_snapshot',
]);

export function keyEligibility(
  context: DatabaseContext,
  type: NativeColumnType,
  facts: NativeKeyFacts = {},
): NativeKeyEligibility {
  const decision = engineKeyEligibility(context, type, facts);
  const generation = facts.generation;
  const generationCovered =
    !generation ||
    generation.kind === 'none' ||
    (generation.database === context.kind &&
      hasDatabaseCoverage(
        nativeFeatureCoverage(
          generation.kind === 'computed'
            ? generation.storage === 'stored'
              ? 'generatedStored'
              : 'generatedVirtual'
            : generation.kind,
        ),
      ) &&
      !(
        context.kind === 'postgresql' &&
        generation.kind === 'computed' &&
        generation.storage === 'virtual' &&
        type.kind === 'projectEnum'
      ));
  const coverage =
    generationCovered &&
    nativeTypeHasCoverage(context, type, facts.strict) &&
    (facts.kind === 'unique' || checkDatabaseFeature(context, 'primaryKey').usable) &&
    (facts.kind === 'primary' || checkDatabaseFeature(context, 'unique').usable);
  const allowed =
    facts.kind === 'primary'
      ? decision.primaryAllowed
      : facts.kind === 'unique'
        ? decision.uniqueAllowed
        : decision.primaryAllowed || decision.uniqueAllowed;
  return {
    ...decision,
    coverage,
    usable: coverage && allowed,
    ...(allowed &&
      (type.kind === 'declared' || type.kind === 'untyped') && {
        readinessCode: 'type.declaration-not-ready' as const,
      }),
  };
}
function engineKeyEligibility(
  context: DatabaseContext,
  type: NativeColumnType,
  facts: NativeKeyFacts,
): NativeKeyEligibility {
  const denied = (
    code: string,
    category: 'unsupported' | 'invalid' = 'unsupported',
  ): NativeKeyEligibility => ({
    primaryAllowed: false,
    uniqueAllowed: false,
    usable: false,
    coverage: false,
    code,
    category,
    conditions: [],
  });
  try {
    getDatabaseProfile(context);
  } catch {
    return denied('database.profile-unsupported');
  }
  if (type.kind === 'legacy') return denied('legacy.type-unresolved');
  if (type.database !== context.kind) return denied('type.not-supported');
  if (type.kind === 'projectEnum')
    return {
      primaryAllowed: true,
      uniqueAllowed: true,
      usable: false,
      coverage: false,
      conditions: ['enum.definition-required'],
    };
  if (type.kind === 'declared' || type.kind === 'untyped')
    return {
      primaryAllowed: facts.generation?.kind !== 'computed',
      uniqueAllowed: true,
      usable: false,
      coverage: false,
      ...(facts.generation?.kind === 'computed' && {
        code: 'key.generated-not-supported',
        category: 'unsupported' as const,
      }),
      conditions: ['table.mode-validation-required'],
    };
  const definition = getDatabaseType(type.typeId);
  if (!definition || definition.databaseKind !== context.kind) return denied('type.not-supported');
  if (type.kind === 'builtin' && validateDatabaseTypeParameters(definition, type.parameters).length)
    return denied('type.parameter-invalid', 'invalid');
  if (type.kind === 'builtin' && definition.category === 'value-list')
    return denied('type.value-list-required');
  if (context.kind === 'postgresql' && pgNoBtree.has(definition.sqlName))
    return denied('key.type-not-supported');
  if (
    context.kind === 'mysql' &&
    (['json', 'geometry'].includes(definition.category) ||
      /^(tiny|medium|long)?(text|blob)$/.test(definition.sqlName))
  )
    return denied('key.type-not-supported');
  let estimatedBytes: number | undefined;
  if (type.kind === 'builtin' && context.kind === 'mysql') {
    const length = 'length' in type.parameters ? (type.parameters.length ?? 1) : 1;
    if (definition.category === 'binary') estimatedBytes = length;
    if (definition.category === 'string') {
      const width = (
        {
          ascii: 1,
          latin1: 1,
          binary: 1,
          utf8mb3: 3,
          utf8: 3,
          utf8mb4: 4,
          ucs2: 2,
          utf16: 4,
          utf16le: 4,
          utf32: 4,
        } as Record<string, number>
      )[(facts.charset ?? 'utf8mb4').toLowerCase()];
      if (!width) return denied('key.charset-unverified');
      estimatedBytes = length * width;
    }
    if (estimatedBytes !== undefined && estimatedBytes > 3072)
      return denied('key.length-exceeded', 'invalid');
  }
  const generatedPrimary =
    facts.generation?.kind === 'computed' &&
    (context.kind === 'sqlite' ||
      (context.kind === 'mysql' && facts.generation.storage === 'virtual'));
  return {
    primaryAllowed: !generatedPrimary,
    uniqueAllowed: true,
    usable: false,
    coverage: false,
    ...(generatedPrimary && {
      code: 'key.generated-not-supported',
      category: 'unsupported' as const,
    }),
    ...(estimatedBytes !== undefined && { estimatedBytes }),
    conditions:
      context.kind === 'mysql'
        ? ['key.innodb-byte-limit', 'key.composite-byte-limit']
        : context.kind === 'postgresql'
          ? ['key.btree-entry-size-limit']
          : ['key.sqlite-null-rowid-semantics'],
  };
}
