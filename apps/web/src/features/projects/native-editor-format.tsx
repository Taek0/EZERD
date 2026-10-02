import {
  nativeColumnTypeSchema,
  nativeColumnPatchSchema,
  nativeTablePatchSchema,
} from '@ezerd/contracts';
import {
  nativeDefaultDisplay,
  nativeGenerationDisplay,
  nativeExpressionDisplay,
  type NativeColumn,
  type NativeDesignDocument,
  type NativeTable,
  type NativeDefaultValue,
  type NativeGeneration,
} from '@ezerd/model';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import {
  NativeEditorField,
  NativeEditorForm,
  type NativeEditorContext,
} from './native-editor-form.js';
import {
  NativeExpressionFields,
  nativeExpressionFromInputs,
  nativeExpressionInputs,
} from './native-editor-expression.js';
import {
  nativeEditorPolicy,
  nativeTypeChoice,
  nativeTypeCurrentLabel,
  nativeTypeReady,
  nativeTypeParameterRules,
} from './native-editor-policy.js';
import type { NativeWebCommand } from './native-save.js';

registerTranslations({
  '형식·DB 옵션 편집': 'Edit type and database options',
  '현재 값': 'Current values',
  엔진: 'Engine',
  '현재 데이터베이스': 'Current database',
  사용: 'Enabled',
  '사용 안 함': 'Disabled',
  파라미터: 'Parameters',
  '배열 차원': 'Array dimensions',
  '타입 변경 시 기존 기본값·생성 규칙·ON UPDATE 제거를 확인했습니다.':
    'I reviewed removal of the existing default, generation and ON UPDATE on type change.',
  스키마: 'Schema',
  '값 목록 (한 줄에 하나)': 'Values (one per line)',
  '생성 식 변경': 'Change generation expression',
  '리터럴 종류': 'Literal type',
  값: 'Value',
  연산자: 'Operator',
});
const json = (value: unknown) => JSON.stringify(value);
const yes = (value: boolean | undefined) => (value ? 'true' : 'false');
const split = (value: string) => value.split('\n');
export function nativeFormatInitial(
  table: NativeTable,
  column?: NativeColumn,
): Record<string, string> {
  if (!column) {
    const options = table.physical.options;
    return {
      namespace:
        table.physical.namespace.kind === 'postgresSchema' ? table.physical.namespace.name : '',
      charset: options.database === 'mysql' ? (options.charset ?? '') : '',
      collation: options.database === 'mysql' ? (options.collation ?? '') : '',
      strict: yes(options.database === 'sqlite' && options.strict),
      withoutRowid: yes(options.database === 'sqlite' && options.withoutRowid),
      optionsJSON: json(options),
      namespaceJSON: json(table.physical.namespace),
    };
  }
  const { type, defaultValue, generation, options } = column.physical;
  const parameters =
    type.kind === 'builtin'
      ? Object.fromEntries(
          Object.entries(type.parameters).map(([key, value]) => [
            `parameter:${key}`,
            String(value),
          ]),
        )
      : {};
  return {
    typeChoice: nativeTypeChoice(type),
    typeJSON: json(type),
    ...parameters,
    array: 'array' in type ? String(type.array?.dimensions ?? '') : '',
    values: type.kind === 'valueList' ? type.values.join('\n') : '',
    declaredName: type.kind === 'declared' ? type.name : '',
    numericArguments: type.kind === 'declared' ? type.numericArguments.join('\n') : '',
    nullable: yes(column.physical.nullable),
    defaultChoice:
      defaultValue.kind === 'literal' ? `literal:${defaultValue.literalType}` : defaultValue.kind,
    defaultValue: defaultValue.kind === 'literal' ? String(defaultValue.value) : '',
    defaultJSON: json(defaultValue),
    generationChoice:
      generation.kind === 'computed' ? `computed:${generation.storage}` : generation.kind,
    identityMode: generation.kind === 'identity' ? generation.mode : 'byDefault',
    generationJSON: json(generation),
    generationExpressionMode: 'preserve',
    ...nativeExpressionInputs(generation.kind === 'computed' ? generation.expression : undefined),
    optionsJSON: json(options),
    charset: options.database === 'mysql' ? (options.charset ?? '') : '',
    collation: options.collation ?? '',
    removeOnUpdate: 'false',
    confirmTypeReset: 'false',
  };
}
function changed(values: Record<string, string>, before: Record<string, string>, fields: string[]) {
  return fields.some((key) => (values[key] ?? '') !== (before[key] ?? ''));
}
/** Build only edited native fields; untouched stored variants/options are never normalized away. */
export function nativeFormatCommands(
  document: NativeDesignDocument,
  table: NativeTable,
  column: NativeColumn | undefined,
  values: Record<string, string>,
  before: Record<string, string>,
): NativeWebCommand[] {
  const policy = nativeEditorPolicy(document, table, column);
  const requireFeature = (id: Parameters<typeof policy.feature>[0]) => {
    const decision = policy.feature(id);
    if (!decision.usable) throw new Error(decision.code ?? 'feature.not-implemented');
  };
  if (!column) {
    const physical: Record<string, unknown> = {};
    if (changed(values, before, ['namespace'])) {
      requireFeature('schema');
      physical.namespace = { kind: 'postgresSchema', name: values.namespace };
    }
    const options = JSON.parse(before.optionsJSON!) as NativeTable['physical']['options'];
    if (changed(values, before, ['charset', 'collation', 'strict', 'withoutRowid'])) {
      if (options.database === 'mysql') {
        if (values.charset !== before.charset) {
          requireFeature('charset');
          if (values.charset) options.charset = values.charset;
          else delete options.charset;
        }
        if (values.collation !== before.collation) {
          requireFeature('collation');
          if (values.collation) options.collation = values.collation;
          else delete options.collation;
        }
      } else if (options.database === 'sqlite') {
        if (values.strict !== before.strict) {
          if (values.strict === 'true') requireFeature('strictTable');
          options.strict = values.strict === 'true';
        }
        if (values.withoutRowid !== before.withoutRowid) {
          if (values.withoutRowid === 'true') requireFeature('withoutRowid');
          options.withoutRowid = values.withoutRowid === 'true';
        }
      }
      physical.options = options;
    }
    return Object.keys(physical).length
      ? [{ type: 'patch_table', id: table.id, patch: nativeTablePatchSchema.parse({ physical }) }]
      : [];
  }
  const physical: Record<string, unknown> = {};
  const parameterKeys = [...new Set([...Object.keys(values), ...Object.keys(before)])].filter(
    (key) => key.startsWith('parameter:'),
  );
  const typeChanged = changed(values, before, [
    'typeChoice',
    'array',
    'values',
    'declaredName',
    'numericArguments',
    ...parameterKeys,
  ]);
  if (typeChanged) {
    const selected = values.typeChoice ?? '';
    const parameters = Object.fromEntries(
      Object.entries(nativeTypeParameterRules(selected)).flatMap(([key, rule]) => {
        const token = values[`parameter:${key}`];
        return token === undefined || token === ''
          ? []
          : [
              [
                key,
                rule.kind === 'boolean'
                  ? token === 'true'
                  : rule.kind === 'integer'
                    ? Number(token)
                    : token,
              ],
            ];
      }),
    );
    const type = nativeColumnTypeSchema.parse(
      selected.startsWith('enum:')
        ? {
            kind: 'projectEnum',
            database: 'postgresql',
            enumId: selected.slice(5),
            ...(values.array ? { array: { dimensions: Number(values.array) } } : {}),
          }
        : selected === 'declared'
          ? {
              kind: 'declared',
              database: 'sqlite',
              name: values.declaredName,
              numericArguments: split(values.numericArguments ?? '').filter(Boolean),
            }
          : selected === 'untyped'
            ? { kind: 'untyped', database: 'sqlite' }
            : selected === 'mysql:enum' || selected === 'mysql:set'
              ? {
                  kind: 'valueList',
                  database: 'mysql',
                  typeId: selected,
                  values: split(values.values ?? ''),
                }
              : {
                  kind: 'builtin',
                  database: document.database.kind,
                  typeId: selected,
                  parameters,
                  ...(document.database.kind === 'postgresql' && values.array
                    ? { array: { dimensions: Number(values.array) } }
                    : {}),
                },
    ) as NativeColumn['physical']['type'];
    if (!nativeTypeReady(document, table, type)) throw new Error('type.not-implemented');
    if (
      'array' in type &&
      type.array &&
      !policy.feature('array', {
        ...(type.kind === 'builtin' ? { typeId: type.typeId } : { projectEnum: true }),
      }).usable
    )
      throw new Error('feature.not-implemented');
    if (values.confirmTypeReset !== 'true') throw new Error('native.type-reset-review-required');
    physical.type = type;
    physical.defaultValue = { kind: 'none' };
    physical.generation = { kind: 'none' };
    const options = JSON.parse(before.optionsJSON!) as NativeColumn['physical']['options'];
    if (options.database === 'mysql') delete options.onUpdate;
    physical.options = options;
  } else {
    if (changed(values, before, ['defaultChoice', 'defaultValue'])) {
      const choice = values.defaultChoice!;
      let value: NativeDefaultValue;
      if (choice === 'none') value = { kind: 'none' };
      else {
        if (!nativeTypeReady(document, table, column.physical.type))
          throw new Error('type.not-implemented');
        value =
          choice === 'null'
            ? { kind: 'null' }
            : ({
                kind: 'literal',
                literalType: choice.slice(8),
                value:
                  choice === 'literal:boolean'
                    ? values.defaultValue === 'true'
                    : values.defaultValue,
              } as NativeDefaultValue);
      }
      physical.defaultValue = value;
    }
    if (
      changed(values, before, [
        'generationChoice',
        'identityMode',
        'generationExpressionMode',
        'expressionColumn',
        'expressionOperator',
        'expressionLiteralType',
        'expressionValue',
      ])
    ) {
      const choice = values.generationChoice!;
      let generation: NativeGeneration;
      if (choice === 'none') generation = { kind: 'none' };
      else if (choice === 'serial') {
        requireFeature('serial');
        generation = { kind: 'serial', database: 'postgresql' };
      } else if (choice === 'identity') {
        requireFeature('identity');
        const original = JSON.parse(before.generationJSON!) as NativeGeneration;
        generation = {
          ...(original.kind === 'identity' ? original : {}),
          kind: 'identity',
          database: 'postgresql',
          mode: values.identityMode as 'always' | 'byDefault',
        };
      } else if (choice === 'autoIncrement') {
        requireFeature('autoIncrement');
        generation = {
          kind: 'autoIncrement',
          database: document.database.kind as 'mysql' | 'sqlite',
        };
      } else {
        requireFeature(choice === 'computed:stored' ? 'generatedStored' : 'generatedVirtual');
        const original = JSON.parse(before.generationJSON!) as NativeGeneration;
        generation = {
          kind: 'computed',
          database: document.database.kind,
          storage: choice === 'computed:stored' ? 'stored' : 'virtual',
          expression:
            values.generationExpressionMode === 'preserve' && original.kind === 'computed'
              ? original.expression
              : nativeExpressionFromInputs(values),
        };
      }
      physical.generation = generation;
    }
  }
  if (values.nullable !== before.nullable) physical.nullable = values.nullable === 'true';
  if (changed(values, before, ['charset', 'collation', 'removeOnUpdate'])) {
    const options = (physical.options ??
      JSON.parse(before.optionsJSON!)) as NativeColumn['physical']['options'];
    if (values.collation !== before.collation) {
      requireFeature('collation');
      if (values.collation) options.collation = values.collation as 'BINARY';
      else delete options.collation;
    }
    if (options.database === 'mysql') {
      if (values.charset !== before.charset) {
        requireFeature('charset');
        if (values.charset) options.charset = values.charset;
        else delete options.charset;
      }
      if (values.removeOnUpdate === 'true') delete options.onUpdate;
    }
    physical.options = options;
  }
  return Object.keys(physical).length
    ? [{ type: 'patch_column', id: column.id, patch: nativeColumnPatchSchema.parse({ physical }) }]
    : [];
}

export function NativeFormatEditor({
  context,
  document,
  table,
  column,
}: {
  context: NativeEditorContext;
  document: NativeDesignDocument;
  table: NativeTable;
  column?: NativeColumn;
}) {
  const { t } = useI18n();
  const policy = nativeEditorPolicy(document, table, column);
  const blocked = (id: Parameters<typeof policy.feature>[0]) => !policy.feature(id).usable;
  const reason = (code: string | undefined) =>
    t(code?.endsWith('not-supported') ? '이 DB에서 지원하지 않음' : '미구현 또는 실행 검증 미완료');
  const bool = [
    { value: 'false', label: 'false' },
    { value: 'true', label: 'true' },
  ];
  return (
    <NativeEditorForm
      context={context}
      title={t('형식·DB 옵션 편집')}
      draftKey={`format:${column ? 'column' : 'table'}:${column?.id ?? table.id}`}
      initial={nativeFormatInitial(table, column)}
      build={(values, before) => nativeFormatCommands(document, table, column, values, before)}
    >
      {(values, change) => {
        const field = (
          name: string,
          label: string,
          disabled = false,
          choices?: Parameters<typeof NativeEditorField>[0]['choices'],
          multiline = false,
        ) => (
          <NativeEditorField
            label={label}
            value={values[name] ?? ''}
            disabled={disabled}
            onChange={(value) => change(name, value)}
            {...(choices ? { choices } : {})}
            multiline={multiline}
          />
        );
        if (!column)
          return (
            <>
              <p>
                {t('현재 값')}: {t('스키마')}:{' '}
                {table.physical.namespace.kind === 'postgresSchema'
                  ? table.physical.namespace.name || 'public'
                  : table.physical.namespace.kind === 'legacyNamespace'
                    ? table.physical.namespace.original
                    : table.physical.namespace.kind === 'mysqlCurrentDatabase'
                      ? t('현재 데이터베이스')
                      : 'main'}
                {table.physical.options.database === 'mysql' && (
                  <>
                    {' · '}
                    {t('엔진')}: {table.physical.options.engine}
                    {table.physical.options.charset &&
                      ` · Charset: ${table.physical.options.charset}`}
                    {table.physical.options.collation &&
                      ` · Collation: ${table.physical.options.collation}`}
                  </>
                )}
                {table.physical.options.database === 'sqlite' && (
                  <>
                    {' · '}STRICT: {t(table.physical.options.strict ? '사용' : '사용 안 함')}
                    {' · '}WITHOUT ROWID:{' '}
                    {t(table.physical.options.withoutRowid ? '사용' : '사용 안 함')}
                  </>
                )}
              </p>
              {field('namespace', '스키마', blocked('schema'))}
              {field('charset', 'Charset', blocked('charset'))}
              {field('collation', 'Collation', blocked('collation'))}
              {field('strict', 'STRICT', blocked('strictTable') && values.strict !== 'true', bool)}
              {field(
                'withoutRowid',
                'WITHOUT ROWID',
                blocked('withoutRowid') && values.withoutRowid !== 'true',
                bool,
              )}
              <p>
                {reason(policy.feature('schema').code)} ·{' '}
                {reason(policy.feature('strictTable').code)}
              </p>
            </>
          );
        const current = nativeTypeChoice(column.physical.type);
        const choices: { value: string; label: string; disabled: boolean }[] = policy.types.map(
          (item) => ({
            value: item.definition.id,
            label: `${item.definition.id}${item.usable ? '' : ` · ${reason(item.code)}`}`,
            disabled: !item.usable,
          }),
        );
        choices.push(
          ...(document.enums ?? []).map((item) => ({
            value: `enum:${item.id}`,
            label: `ENUM ${item.schema}.${item.name} · ${reason(policy.feature('enumType').code)}`,
            disabled: blocked('enumType'),
          })),
        );
        for (const value of ['declared', 'untyped'])
          choices.push({
            value,
            label: `SQLite ${value} · ${reason('type.not-implemented')}`,
            disabled: true,
          });
        if (!choices.some((choice) => choice.value === current))
          choices.push({
            value: current,
            label: nativeTypeCurrentLabel(column, document),
            disabled: true,
          });
        const ready = !!policy.types.find((item) => item.definition.id === values.typeChoice)
          ?.usable;
        const typeChanged =
          values.typeChoice !== current ||
          Object.keys(values).some(
            (key) =>
              key.startsWith('parameter:') &&
              values[key] !== nativeFormatInitial(table, column)[key],
          ) ||
          values.array !== nativeFormatInitial(table, column).array ||
          values.values !== nativeFormatInitial(table, column).values;
        const generationChoices = [
          { value: 'none', label: 'none' },
          ...(
            ['serial', 'identity', 'autoIncrement', 'computed:stored', 'computed:virtual'] as const
          ).map((value) => {
            const id =
              value === 'computed:stored'
                ? 'generatedStored'
                : value === 'computed:virtual'
                  ? 'generatedVirtual'
                  : value;
            return {
              value,
              label: `${value} · ${reason(policy.feature(id).code)}`,
              disabled: blocked(id),
            };
          }),
        ];
        const defaults = [
          'none',
          'null',
          'literal:string',
          'literal:number',
          'literal:boolean',
          'literal:binary',
          'literal:json',
          'literal:typedText',
          'expression',
          'legacyExpression',
        ].map((value) => ({
          value,
          label: value,
          disabled:
            value !== 'none' &&
            (!nativeTypeReady(document, table, column.physical.type) ||
              value === 'expression' ||
              value === 'legacyExpression'),
        }));
        return (
          <>
            <p>
              {t('현재 값')}: {nativeTypeCurrentLabel(column, document)} ·{' '}
              {nativeDefaultDisplay(column.physical.defaultValue, document)} ·{' '}
              {nativeGenerationDisplay(column.physical.generation, document)}
            </p>
            {field('typeChoice', '타입', false, choices)}
            {Object.entries(nativeTypeParameterRules(values.typeChoice ?? '')).map(
              ([key, rule]) => (
                <div key={key}>
                  {field(
                    `parameter:${key}`,
                    `${t('파라미터')} ${key}${rule.kind === 'integer' ? ` (${rule.min}…${rule.max})` : ''}`,
                    !ready,
                    rule.kind === 'choice'
                      ? [
                          { value: '', label: '—' },
                          ...rule.values.map((value) => ({ value, label: value })),
                        ]
                      : rule.kind === 'boolean'
                        ? [{ value: '', label: '—' }, ...bool]
                        : undefined,
                  )}
                </div>
              ),
            )}
            {field('array', '배열 차원', blocked('array'))}
            {values.typeChoice?.startsWith('mysql:') &&
              ['mysql:enum', 'mysql:set'].includes(values.typeChoice) &&
              field('values', '값 목록 (한 줄에 하나)', !ready, undefined, true)}
            {column.physical.type.kind === 'declared' && (
              <p>
                {column.physical.type.name} ({column.physical.type.numericArguments.join(', ')})
              </p>
            )}
            {field('nullable', 'NULL', false, bool)}
            {field('defaultChoice', '기본값', typeChanged, defaults)}
            {values.defaultChoice?.startsWith('literal:') &&
              field(
                'defaultValue',
                '값',
                typeChanged || !nativeTypeReady(document, table, column.physical.type),
                values.defaultChoice === 'literal:boolean' ? bool : undefined,
              )}
            {field('generationChoice', '생성', typeChanged, generationChoices)}
            {values.generationChoice === 'identity' &&
              field(
                'identityMode',
                'Identity',
                typeChanged || blocked('identity'),
                ['always', 'byDefault'].map((value) => ({ value, label: value })),
              )}
            {values.generationChoice?.startsWith('computed:') && (
              <>
                {field(
                  'generationExpressionMode',
                  '생성 식 변경',
                  typeChanged ||
                    blocked(
                      values.generationChoice === 'computed:stored'
                        ? 'generatedStored'
                        : 'generatedVirtual',
                    ),
                  [
                    { value: 'preserve', label: t('현재 값') },
                    { value: 'compare', label: t('수정') },
                  ],
                )}
                {values.generationExpressionMode !== 'preserve' && (
                  <NativeExpressionFields
                    values={values}
                    change={change}
                    columns={(document.columns ?? []).filter(
                      (item) => item.tableId === table.id && item.id !== column.id,
                    )}
                    disabled={
                      typeChanged ||
                      blocked(
                        values.generationChoice === 'computed:stored'
                          ? 'generatedStored'
                          : 'generatedVirtual',
                      )
                    }
                  />
                )}
              </>
            )}
            {typeChanged &&
              field(
                'confirmTypeReset',
                '타입 변경 시 기존 기본값·생성 규칙·ON UPDATE 제거를 확인했습니다.',
                false,
                bool,
              )}
            {field('charset', 'Charset', blocked('charset'))}
            {field(
              'collation',
              'Collation',
              blocked('collation'),
              document.database.kind === 'sqlite'
                ? [
                    { value: '', label: '—' },
                    ...['BINARY', 'NOCASE', 'RTRIM'].map((value) => ({ value, label: value })),
                  ]
                : undefined,
            )}
            {column.physical.options.database === 'mysql' && column.physical.options.onUpdate && (
              <>
                <p>
                  ON UPDATE {nativeExpressionDisplay(column.physical.options.onUpdate, document)}
                </p>
                {field('removeOnUpdate', 'ON UPDATE 제거', false, bool)}
              </>
            )}
            <p>{t('미검증 기능은 새로 사용할 수 없습니다. 현재 값은 보존됩니다.')}</p>
          </>
        );
      }}
    </NativeEditorForm>
  );
}
