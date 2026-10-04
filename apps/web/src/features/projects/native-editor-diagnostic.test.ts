import { afterEach, describe, expect, it } from 'vitest';
import {
  nativeExpressionSchema,
  nativeGenerationSchema,
  nativeEditorCommandSchema,
} from '@ezerd/contracts';
import { setLocale } from '../../shared/i18n/index.js';
import { nativeEditorConditionText, nativeEditorErrorCode } from './native-editor-diagnostic.js';

afterEach(() => setLocale('ko'));
describe('native editor condition diagnostics', () => {
  it('classifies an actual Zod missing-column error without its schema JSON', () => {
    const result = nativeExpressionSchema.safeParse({ kind: 'column', columnId: '' });
    if (result.success) throw Error('Expected an invalid column reference');
    expect(result.error.message).toContain('too_small');
    expect(nativeEditorErrorCode(result.error)).toBe('expression.column-required');
  });
  it('classifies other actual Zod shape errors without exposing invalid values', () => {
    const result = nativeGenerationSchema.safeParse({ kind: 'internal_original_payload' });
    if (result.success) throw Error('Expected an invalid generation');
    expect(nativeEditorErrorCode(result.error)).toBe('native.input-shape-invalid');
    expect(nativeEditorConditionText(nativeEditorErrorCode(result.error))).not.toContain('payload');
  });
  it('classifies an actual empty index-parts schema error as a key prerequisite', () => {
    const result = nativeEditorCommandSchema.safeParse({
      type: 'add_index',
      value: {
        id: 'i',
        tableId: 't',
        name: 'idx',
        scope: 'physical',
        unique: false,
        parts: [],
        options: { database: 'sqlite' },
      },
    });
    if (result.success) throw Error('Expected missing index parts');
    expect(nativeEditorErrorCode(result.error)).toBe('index.key-parts-required');
  });
  it('retains stable policy codes and discards arbitrary parser and runtime messages', () => {
    expect(nativeEditorErrorCode(Error('index.method-not-supported'))).toBe(
      'index.method-not-supported',
    );
    for (const cause of [
      new SyntaxError('Unexpected token: original_secret'),
      Error('[{"origin":"array"}]'),
      Error('x.'.repeat(100)),
      undefined,
    ]) {
      expect(nativeEditorErrorCode(cause, 'index.draft-invalid')).toBe('index.draft-invalid');
    }
  });
  it.each(['ko', 'en'] as const)(
    'provides actionable %s guidance with safe unknown fallbacks',
    (locale) => {
      setLocale(locale);
      expect(nativeEditorConditionText('index.key-columns-required')).toBe(
        locale === 'ko'
          ? '인덱스 키 컬럼을 먼저 추가하세요.'
          : 'Add a column for the index key first.',
      );
      expect(nativeEditorConditionText('expression.column-required')).toBe(
        locale === 'ko'
          ? '식에서 사용할 컬럼을 선택하세요.'
          : 'Select a column for the expression.',
      );
      expect(nativeEditorConditionText('index.method-not-supported')).toContain(
        locale === 'ko' ? '인덱스 방식' : 'index method',
      );
      for (const code of [
        'unknown.private-details',
        '[{"origin":"array","minimum":1}]',
        '__proto__',
        'constructor',
      ]) {
        expect(nativeEditorConditionText(code)).toBe(
          locale === 'ko'
            ? '입력 항목을 확인하세요. 원문 초안은 유지됩니다.'
            : 'Review the input fields. The original draft is preserved.',
        );
      }
      expect(nativeEditorConditionText(undefined)).toBe('');
    },
  );
});
