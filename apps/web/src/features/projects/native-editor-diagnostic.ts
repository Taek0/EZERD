import { registerTranslations, translate } from '../../shared/i18n/index.js';

const diagnosticCode = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;

/** Keep policy codes, never validator JSON, parser messages, or draft values. */
export function nativeEditorErrorCode(cause: unknown, fallback = 'native.input-invalid'): string {
  if (cause instanceof Error && cause.name === 'ZodError') {
    const issues: unknown = 'issues' in cause ? cause.issues : undefined;
    if (Array.isArray(issues)) {
      for (const issue of issues) {
        if (!issue || typeof issue !== 'object' || issue.code !== 'too_small') continue;
        const path: unknown = issue.path;
        if (!Array.isArray(path)) continue;
        if (path.at(-1) === 'columnId') return 'expression.column-required';
        if (path.at(-1) === 'parts') return 'index.key-parts-required';
      }
    }
    return 'native.input-shape-invalid';
  }
  return cause instanceof Error && cause.message.length <= 160 && diagnosticCode.test(cause.message)
    ? cause.message
    : fallback;
}

registerTranslations({
  '공간 참조계는 검증된 SRID 0 또는 4326을 사용하세요. 현재 원문은 유지됩니다.':
    'Use verified spatial reference SRID 0 or 4326. The current original is preserved.',
  '인덱스 키 컬럼을 먼저 추가하세요.': 'Add a column for the index key first.',
  '인덱스 키 컬럼 또는 키 식을 추가하세요.': 'Add an index key column or expression.',
  '식에서 사용할 컬럼을 선택하세요.': 'Select a column for the expression.',
  '현재 테이블의 물리 컬럼을 선택하세요.': 'Select a physical column in the current table.',
  '이 컬럼 타입이나 키 식에 사용할 수 없는 인덱스 방식입니다.':
    'This index method does not support the column type or key expression.',
  '접두 길이는 완성된 양의 정수로 입력하세요.':
    'Enter a complete positive integer for the prefix length.',
  '식 인덱스 키에는 접두 길이를 지정할 수 없습니다.':
    'An expression index key cannot have a prefix length.',
  '포함 컬럼은 중복 없이 선택하세요.': 'Select included columns without duplicates.',
  'FULLTEXT 키에는 문자 컬럼을, SPATIAL 키에는 NULL을 허용하지 않는 공간 컬럼을 선택하세요.':
    'Use character columns for FULLTEXT keys and non-nullable spatial columns for SPATIAL keys.',
  'FULLTEXT 키 컬럼의 문자 집합과 정렬 규칙을 맞추세요.':
    'Use matching character sets and collations for FULLTEXT key columns.',
  '숫자 컬럼이나 숫자 값을 사용하는 식을 입력하세요.':
    'Use numeric columns or values in this expression.',
  '문자 컬럼이나 문자 값을 사용하는 식을 입력하세요.':
    'Use character columns or values in this expression.',
  '조건에는 참 또는 거짓을 판단하는 식을 입력하세요.':
    'Use an expression that evaluates to true or false.',
  '함수에 필요한 인자를 모두 입력하세요.': 'Enter all required function arguments.',
  '이 DB에서 지원하는 함수를 선택하세요. 현재 원문은 유지됩니다.':
    'Select a function supported by this database. The current original is preserved.',
  '함수나 연산자의 입력 타입을 확인하세요.': 'Check the input types for the function or operator.',
  '식의 결과 타입을 대상 컬럼 타입에 맞추세요.':
    'Match the expression result type to the target column type.',
  '이 용도에서는 값이 일정하게 계산되는 함수만 사용할 수 있습니다.':
    'This purpose requires functions with a deterministic result.',
  '0으로 나누는 식은 사용할 수 없습니다.': 'An expression cannot divide by zero.',
  '기본값 식에서는 다른 컬럼을 참조할 수 없습니다.':
    'A default expression cannot reference another column.',
  '생성 식이 자기 자신이나 순환 참조를 포함하는지 확인하세요.':
    'Check the generated expression for self-references or circular references.',
  '입력값을 끝까지 작성하세요. 원문 초안은 유지됩니다.':
    'Complete the input value. The original draft is preserved.',
  '식이나 입력이 너무 큽니다. 항목 또는 중첩을 줄이세요.':
    'The expression or input is too large. Reduce the number of items or nesting.',
  '설계나 DB 설정이 변경되었습니다. 최신 내용을 확인한 뒤 입력을 다시 검토하세요.':
    'The design or database settings changed. Review the latest state and your input.',
  '현재 DB의 물리 테이블과 편집 대상을 선택하세요.':
    'Select a physical table and editing target in the current database.',
  '이 기능은 아직 저장 검증이 완료되지 않았습니다. 입력은 유지됩니다.':
    'Saving verification for this feature is incomplete. Your input is preserved.',
  '이 DB나 타입에서는 해당 조합을 지원하지 않습니다.':
    'This combination is not supported by the database or type.',
  '입력 항목을 확인하세요. 원문 초안은 유지됩니다.':
    'Review the input fields. The original draft is preserved.',
  '환경 확인 후 기본값을 제거하거나 검증된 값으로 복구하세요.':
    'Verify the environment, then remove this default or recover with a verified value.',
});

const conditions: Record<string, string> = {
  'index.key-columns-required': '인덱스 키 컬럼을 먼저 추가하세요.',
  'index.key-parts-required': '인덱스 키 컬럼 또는 키 식을 추가하세요.',
  'expression.column-required': '식에서 사용할 컬럼을 선택하세요.',
  'expression.column-not-found': '현재 테이블의 물리 컬럼을 선택하세요.',
  'index.method-not-supported': '이 컬럼 타입이나 키 식에 사용할 수 없는 인덱스 방식입니다.',
  'index.type-not-supported': '이 컬럼 타입이나 키 식에 사용할 수 없는 인덱스 방식입니다.',
  'index.expression-result-required': '식의 결과 타입을 대상 컬럼 타입에 맞추세요.',
  'index.prefix-input-incomplete': '접두 길이는 완성된 양의 정수로 입력하세요.',
  'index.expression-prefix-policy-required': '식 인덱스 키에는 접두 길이를 지정할 수 없습니다.',
  'index.include-columns-duplicate': '포함 컬럼은 중복 없이 선택하세요.',
  'index.special-type-not-supported':
    'FULLTEXT 키에는 문자 컬럼을, SPATIAL 키에는 NULL을 허용하지 않는 공간 컬럼을 선택하세요.',
  'index.fulltext-character-context-mismatch':
    'FULLTEXT 키 컬럼의 문자 집합과 정렬 규칙을 맞추세요.',
  'expression.numeric-required': '숫자 컬럼이나 숫자 값을 사용하는 식을 입력하세요.',
  'expression.string-required': '문자 컬럼이나 문자 값을 사용하는 식을 입력하세요.',
  'expression.boolean-required': '조건에는 참 또는 거짓을 판단하는 식을 입력하세요.',
  'expression.function-arguments-invalid': '함수에 필요한 인자를 모두 입력하세요.',
  'expression.function-arguments-required': '함수에 필요한 인자를 모두 입력하세요.',
  'expression.function-not-supported':
    '이 DB에서 지원하는 함수를 선택하세요. 현재 원문은 유지됩니다.',
  'expression.function-type-mismatch': '함수나 연산자의 입력 타입을 확인하세요.',
  'expression.operator-type-not-supported': '함수나 연산자의 입력 타입을 확인하세요.',
  'expression.comparison-type-mismatch': '함수나 연산자의 입력 타입을 확인하세요.',
  'expression.target-type-mismatch': '식의 결과 타입을 대상 컬럼 타입에 맞추세요.',
  'default.type-mismatch': '식의 결과 타입을 대상 컬럼 타입에 맞추세요.',
  'default.environment-value-unverified':
    '환경 확인 후 기본값을 제거하거나 검증된 값으로 복구하세요.',
  'type.srid-unverified':
    '공간 참조계는 검증된 SRID 0 또는 4326을 사용하세요. 현재 원문은 유지됩니다.',
  'expression.non-deterministic': '이 용도에서는 값이 일정하게 계산되는 함수만 사용할 수 있습니다.',
  'expression.division-by-zero': '0으로 나누는 식은 사용할 수 없습니다.',
  'default.column-reference-not-supported': '기본값 식에서는 다른 컬럼을 참조할 수 없습니다.',
  'generation.computed-cycle': '생성 식이 자기 자신이나 순환 참조를 포함하는지 확인하세요.',
  'generation.cycle': '생성 식이 자기 자신이나 순환 참조를 포함하는지 확인하세요.',
  'expression.complexity-limit': '식이나 입력이 너무 큽니다. 항목 또는 중첩을 줄이세요.',
  'expression.too-complex': '식이나 입력이 너무 큽니다. 항목 또는 중첩을 줄이세요.',
  'index.draft-too-large': '식이나 입력이 너무 큽니다. 항목 또는 중첩을 줄이세요.',
  'document.size-limit': '식이나 입력이 너무 큽니다. 항목 또는 중첩을 줄이세요.',
  'native.advanced-source-changed':
    '설계나 DB 설정이 변경되었습니다. 최신 내용을 확인한 뒤 입력을 다시 검토하세요.',
  'database.context-changed':
    '설계나 DB 설정이 변경되었습니다. 최신 내용을 확인한 뒤 입력을 다시 검토하세요.',
  'index.context-mismatch':
    '설계나 DB 설정이 변경되었습니다. 최신 내용을 확인한 뒤 입력을 다시 검토하세요.',
  'native.advanced-physical-table-required': '현재 DB의 물리 테이블과 편집 대상을 선택하세요.',
  'native.advanced-physical-object-required': '현재 DB의 물리 테이블과 편집 대상을 선택하세요.',
  'feature.not-implemented': '이 기능은 아직 저장 검증이 완료되지 않았습니다. 입력은 유지됩니다.',
};

/** Unknown diagnostics use guidance too; a code is never a user-facing fallback. */
export function nativeEditorConditionText(code: string | undefined): string {
  if (!code) return '';
  const condition = Object.hasOwn(conditions, code) ? conditions[code] : undefined;
  return translate(
    condition ??
      (code.startsWith('literal.') || code === 'native.integer-token-incomplete'
        ? '입력값을 끝까지 작성하세요. 원문 초안은 유지됩니다.'
        : code.endsWith('not-supported')
          ? '이 DB나 타입에서는 해당 조합을 지원하지 않습니다.'
          : code.endsWith('not-ready')
            ? '이 기능은 아직 저장 검증이 완료되지 않았습니다. 입력은 유지됩니다.'
            : '입력 항목을 확인하세요. 원문 초안은 유지됩니다.'),
  );
}
