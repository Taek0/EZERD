import type { ReactNode } from 'react';
import {
  nativeColumnTypeSchema,
  nativeColumnPatchSchema,
  nativeTablePatchSchema,
  nativeCanvasStyleCommandSchema,
} from '@ezerd/contracts';
import {
  nativeDefaultDisplay,
  nativeGenerationDisplay,
  nativeExpressionDisplay,
  inspectNativeDatabaseDocument,
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
  nativeTypeOptionLabel,
  nativeTypeCurrentLabel,
  nativeTypeReady,
  nativeTypeParameterRules,
} from './native-editor-policy.js';
import type { NativeWebCommand } from './native-save.js';
import { nativeEditorConditionText, nativeEditorErrorCode } from './native-editor-diagnostic.js';
import {
  nativeSelectedArrayPolicy,
  nativeSridParameterDecision,
} from './native-constraint-options.js';
import { NativeSridParameterField } from './native-constraint-option-fields.js';
import { NativeLabelFields } from './NativeLabelFields.js';
import { PanelSection } from '../../shared/editor/panel.js';
import { DomainColorPicker } from '../domains/DomainColorPicker.js';
import { Button, Checkbox, Input, Textarea } from '../../components/ui/index.js';
import { serializeNativeLabels, nativeLabelsForCommand } from './native-label-draft.js';
import {
  nativeBoundedInteger,
  nativeExactBoolean,
  nativeDefaultInput,
  nativeBuiltinDefaultInput,
  nativeIdentityFields,
  nativeIdentityInitial,
  nativeIdentityInput,
  nativeOnUpdateInput,
  nativeLiteralPolicy,
  nativeBuiltinDefaultPolicy,
  nativeOnUpdatePolicy,
  nativeGenerationPolicy,
  nativeFunctionOptionPolicies,
} from './native-editor-option-policy.js';

registerTranslations({
  'NULL · 기본값 · 배열 차원': 'Nullability, default and array dimensions',
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
  '엔진에서 허용': 'Allowed by the engine',
  '제품 검증 미완료': 'Product verification is incomplete',
  '현재 원문 유지': 'Preserve the current original value',
  '기본값 없음': 'No default',
  '현재값 유지': 'Keep current value',
  '환경 확인 후 기본값을 제거하거나 검증된 값으로 복구하세요.':
    'Verify the environment, then remove this default or recover with a verified value.',
  '입력 내용을 확인해 주세요. 초안은 원문으로 보관됩니다.':
    'Review the input. The draft retains its original text.',
  '기본값 함수': 'Default function',
  '기본값 식 변경': 'Change default expression',
  '인자 입력 필요': 'Arguments are required',
  'ON UPDATE 설정': 'ON UPDATE setting',
  'ON UPDATE 함수': 'ON UPDATE function',
  '입력·타입 조건에 맞지 않음': 'Input does not match the type constraints',
  '환경 검증 필요': 'Environment verification is required',
  '배열 차원은 1부터 6까지 입력하세요. 배열을 제거하려면 비워 두세요.':
    'Enter array dimensions from 1 to 6. Leave blank to remove the array.',
  'SET 값은 최대 64개이며 쉼표를 포함할 수 없습니다.':
    'SET supports at most 64 values, and values cannot contain commas.',
  '논리 속성 · 추가 속성': 'Logical and custom properties',
  '속성 이름': 'Property name',
  '속성 값': 'Property value',
  '속성 삭제': 'Delete property',
  '속성 추가': 'Add property',
  '추가 속성 입력을 확인해 주세요.': 'Review the custom property input.',
  '추가 속성의 이름은 비어 있거나 중복될 수 없습니다.':
    'Custom property names must be nonempty and unique.',
});
const json = (value: unknown) => JSON.stringify(value);
const yes = (value: boolean | undefined) => (value ? 'true' : 'false');
const split = (value: string) => value.split('\n');
export function nativeFormatInitial(
  table: NativeTable,
  column?: NativeColumn,
): Record<string, string> {
  const object = column ?? table;
  const metadata = Object.fromEntries(
    (['common', 'logical', 'physical'] as const).map((scope) => [
      `metadata:${scope}`,
      JSON.stringify(Object.entries(object.customProperties[scope])),
    ]),
  );
  if (!column) {
    const options = table.physical.options;
    return {
      ...metadata,
      color: table.color ?? '',
      showNullable: yes(table.canvasDisplay?.showNullable ?? true),
      showComment: yes(table.canvasDisplay?.showComment ?? true),
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
    ...metadata,
    semanticType: column.logical.semanticType,
    required: yes(column.logical.required),
    typeChoice: nativeTypeChoice(type),
    typeJSON: json(type),
    ...parameters,
    array: 'array' in type ? String(type.array?.dimensions ?? '') : '',
    labelsJSON: serializeNativeLabels(type.kind === 'valueList' ? type.values : []),
    declaredName: type.kind === 'declared' ? type.name : '',
    numericArguments: type.kind === 'declared' ? type.numericArguments.join('\n') : '',
    nullable: yes(column.physical.nullable),
    defaultChoice:
      defaultValue.kind === 'literal' ? `literal:${defaultValue.literalType}` : defaultValue.kind,
    defaultValue: defaultValue.kind === 'literal' ? String(defaultValue.value) : '',
    defaultJSON: json(defaultValue),
    defaultExpressionMode: 'preserve',
    defaultFunction:
      defaultValue.kind === 'expression' && defaultValue.expression.kind === 'call'
        ? defaultValue.expression.functionId
        : '',
    generationChoice:
      generation.kind === 'computed' ? `computed:${generation.storage}` : generation.kind,
    identityMode: generation.kind === 'identity' ? generation.mode : 'byDefault',
    generationJSON: json(generation),
    ...nativeIdentityInitial(generation),
    generationExpressionMode: 'preserve',
    ...nativeExpressionInputs(generation.kind === 'computed' ? generation.expression : undefined),
    optionsJSON: json(options),
    charset: options.database === 'mysql' ? (options.charset ?? '') : '',
    collation: options.collation ?? '',
    removeOnUpdate: 'false',
    onUpdateMode: 'preserve',
    onUpdateFunction:
      options.database === 'mysql' && options.onUpdate?.kind === 'call'
        ? options.onUpdate.functionId
        : '',
    confirmTypeReset: 'false',
  };
}
function changed(values: Record<string, string>, before: Record<string, string>, fields: string[]) {
  return fields.some((key) => (values[key] ?? '') !== (before[key] ?? ''));
}
export function nativeFormatGenerationInput(
  document: NativeDesignDocument,
  values: Record<string, string>,
  before: Record<string, string>,
): NativeGeneration {
  const choice = values.generationChoice;
  const original = JSON.parse(before.generationJSON ?? '{"kind":"none"}') as NativeGeneration;
  if (choice === 'none') return { kind: 'none' };
  if (choice === 'serial') return { kind: 'serial', database: 'postgresql' };
  if (choice === 'identity') return nativeIdentityInput(values, before, original);
  if (choice === 'autoIncrement') {
    if (document.database.kind === 'postgresql') throw new Error('generation.context-mismatch');
    return { kind: 'autoIncrement', database: document.database.kind };
  }
  if (choice !== 'computed:stored' && choice !== 'computed:virtual')
    throw new Error('native.generation-kind-invalid');
  return {
    kind: 'computed',
    database: document.database.kind,
    storage: choice === 'computed:stored' ? 'stored' : 'virtual',
    expression:
      values.generationExpressionMode === 'preserve' && original.kind === 'computed'
        ? original.expression
        : nativeExpressionFromInputs(values),
  };
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
  const inspectorPatch: Record<string, unknown> = {};
  const original = column ?? table;
  const properties = { ...original.customProperties };
  let metadataChanged = false;
  for (const scope of ['common', 'logical', 'physical'] as const) {
    const field = `metadata:${scope}`;
    if (!changed(values, before, [field])) continue;
    const entries: unknown = JSON.parse(values[field] ?? '[]');
    if (
      !Array.isArray(entries) ||
      entries.some(
        (entry) =>
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          typeof entry[0] !== 'string' ||
          !entry[0].trim() ||
          typeof entry[1] !== 'string',
      ) ||
      new Set(entries.map((entry) => entry[0])).size !== entries.length
    )
      throw new Error('추가 속성의 이름은 비어 있거나 중복될 수 없습니다.');
    properties[scope] = Object.fromEntries(entries);
    metadataChanged = true;
  }
  if (metadataChanged) inspectorPatch.customProperties = properties;
  if (column) {
    const logical: Record<string, unknown> = {};
    if (changed(values, before, ['semanticType'])) logical.semanticType = values.semanticType;
    if (changed(values, before, ['required']))
      logical.required = nativeExactBoolean(values.required ?? 'false');
    if (Object.keys(logical).length) inspectorPatch.logical = logical;
  }
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
    const patch = { ...inspectorPatch, ...(Object.keys(physical).length ? { physical } : {}) };
    const commands: NativeWebCommand[] = Object.keys(patch).length
      ? [{ type: 'patch_table', id: table.id, patch: nativeTablePatchSchema.parse(patch) }]
      : [];
    const display = {
      ...(changed(values, before, ['showNullable'])
        ? { showNullable: nativeExactBoolean(values.showNullable ?? 'true') }
        : {}),
      ...(changed(values, before, ['showComment'])
        ? { showComment: nativeExactBoolean(values.showComment ?? 'false') }
        : {}),
    };
    if (changed(values, before, ['color']) || Object.keys(display).length)
      commands.push(
        nativeCanvasStyleCommandSchema.parse({
          type: 'patch_canvas_style',
          target: { kind: 'table', id: table.id },
          patch: {
            ...(changed(values, before, ['color']) ? { color: values.color || null } : {}),
            ...(Object.keys(display).length ? { canvasDisplay: display } : {}),
          },
        }),
      );
    return commands;
  }
  const physical: Record<string, unknown> = {};
  const parameterKeys = [...new Set([...Object.keys(values), ...Object.keys(before)])].filter(
    (key) => key.startsWith('parameter:'),
  );
  const typeChanged = changed(values, before, [
    'typeChoice',
    'array',
    'values',
    'labelsJSON',
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
                  ? nativeExactBoolean(token)
                  : rule.kind === 'integer'
                    ? nativeBoundedInteger(token, rule.min, rule.max)
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
            ...(values.array
              ? { array: { dimensions: nativeBoundedInteger(values.array, 1, 6) } }
              : {}),
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
                  values: nativeLabelsForCommand(
                    values,
                    before,
                    'labelsJSON',
                    'values',
                    column.physical.type.kind === 'valueList' ? column.physical.type.values : [],
                  ),
                }
              : {
                  kind: 'builtin',
                  database: document.database.kind,
                  typeId: selected,
                  parameters,
                  ...(document.database.kind === 'postgresql' && values.array
                    ? { array: { dimensions: nativeBoundedInteger(values.array, 1, 6) } }
                    : {}),
                },
    ) as NativeColumn['physical']['type'];
    if (!nativeTypeReady(document, table, type)) throw new Error('type.not-implemented');
    if (type.kind === 'builtin' && Object.hasOwn(type.parameters, 'srid')) {
      const decision = nativeSridParameterDecision(
        document,
        column,
        type.typeId,
        values['parameter:srid'] ?? '',
      );
      if (!decision.allowed || !decision.usable)
        throw Error(decision.code ?? 'feature.not-implemented');
    }
    if (
      'array' in type &&
      type.array &&
      !nativeSelectedArrayPolicy(document, table, column, nativeTypeChoice(type), true).usable
    )
      throw new Error('feature.not-implemented');
    if (values.confirmTypeReset !== 'true') throw new Error('native.type-reset-review-required');
    physical.type = type;
    physical.defaultValue = { kind: 'none' };
    physical.generation = { kind: 'none' };
    const options = JSON.parse(before.optionsJSON!) as NativeColumn['physical']['options'];
    if (options.database === 'mysql') delete options.onUpdate;
    physical.options = options;
    if (type.kind === 'valueList') {
      const candidate = {
        ...document,
        columns: document.columns?.map((c) =>
          c.id === column.id
            ? {
                ...c,
                scope: c.scope === 'logical' ? ('physical' as const) : c.scope,
                physical: {
                  ...c.physical,
                  type,
                  defaultValue: { kind: 'none' as const },
                  generation: { kind: 'none' as const },
                  options,
                },
              }
            : c,
        ),
        tables: document.tables?.map((t) =>
          t.id === table.id && t.scope === 'logical' ? { ...t, scope: 'physical' as const } : t,
        ),
      };
      const issue = inspectNativeDatabaseDocument(candidate, document.database).find(
        (i) =>
          i.severity === 'error' && i.objectId === column.id && i.path.includes('/type/values'),
      );
      if (issue) throw Error(issue.code);
    }
  } else {
    if (
      changed(values, before, [
        'defaultChoice',
        'defaultValue',
        'defaultFunction',
        'defaultExpressionMode',
      ])
    ) {
      const choice = values.defaultChoice!;
      let value: NativeDefaultValue;
      if (choice === 'none') value = { kind: 'none' };
      else if (choice === 'expression') {
        value = nativeBuiltinDefaultInput(document, values.defaultFunction ?? '');
        if (value.kind !== 'expression') throw new Error('default.expression-validation-required');
        const decision = nativeBuiltinDefaultPolicy(document, table, column, value.expression, {
          nullable: nativeExactBoolean(values.nullable ?? String(column.physical.nullable)),
          generation:
            values.generationChoice === 'none' ? { kind: 'none' } : column.physical.generation,
        });
        if (!decision.productUsable) throw new Error(decision.code);
      } else {
        const input = nativeDefaultInput(
          document,
          table,
          column,
          choice,
          values.defaultValue ?? '',
          nativeExactBoolean(values.nullable ?? String(column.physical.nullable)),
        );
        if (!input.decision.productUsable)
          throw new Error(input.decision.code ?? 'default.not-ready');
        value = input.value;
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
        ...nativeIdentityFields.map((field) => `identity:${field}`),
      ])
    ) {
      const generation = nativeFormatGenerationInput(document, values, before);
      if (generation.kind !== 'none') {
        const decision = nativeGenerationPolicy(document, table, column, generation, {
          nullable: nativeExactBoolean(values.nullable ?? String(column.physical.nullable)),
          hasDefault:
            ((physical.defaultValue ?? column.physical.defaultValue) as NativeDefaultValue).kind !==
            'none',
        });
        if (!decision.productUsable) throw new Error(decision.code);
      }
      physical.generation = generation;
    }
  }
  if (
    values.nullable !== before.nullable &&
    column.physical.defaultValue.kind === 'null' &&
    physical.defaultValue === undefined
  ) {
    const decision = nativeLiteralPolicy(
      document,
      table,
      column,
      { kind: 'null' },
      nativeExactBoolean(values.nullable ?? ''),
    );
    if (!decision.engineAllowed) throw new Error(decision.code ?? 'default.null-not-supported');
  }
  if (
    physical.generation === undefined &&
    column.physical.generation.kind !== 'none' &&
    (values.nullable !== before.nullable || physical.defaultValue !== undefined)
  ) {
    const previous = nativeGenerationPolicy(document, table, column, column.physical.generation);
    const candidate = nativeGenerationPolicy(document, table, column, column.physical.generation, {
      nullable: nativeExactBoolean(values.nullable ?? String(column.physical.nullable)),
      hasDefault:
        ((physical.defaultValue ?? column.physical.defaultValue) as NativeDefaultValue).kind !==
        'none',
    });
    if (!candidate.engineAllowed && (previous.engineAllowed || candidate.code !== previous.code))
      throw new Error(candidate.code ?? 'generation.type-not-supported');
  }
  if (values.nullable !== before.nullable)
    physical.nullable = nativeExactBoolean(values.nullable ?? '');
  if (
    changed(values, before, [
      'charset',
      'collation',
      'removeOnUpdate',
      'onUpdateMode',
      'onUpdateFunction',
    ])
  ) {
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
      else if (values.onUpdateMode === 'none') delete options.onUpdate;
      else if (values.onUpdateMode === 'function') {
        const candidate = nativeOnUpdateInput(document, values.onUpdateFunction ?? '');
        const decision = nativeOnUpdatePolicy(
          document,
          column,
          candidate,
          (physical.generation as NativeGeneration | undefined) ?? column.physical.generation,
        );
        if (!decision.productUsable) throw new Error(decision.code);
        options.onUpdate = candidate;
      }
    }
    physical.options = options;
  }
  const patch = { ...inspectorPatch, ...(Object.keys(physical).length ? { physical } : {}) };
  return Object.keys(patch).length
    ? [{ type: 'patch_column', id: column.id, patch: nativeColumnPatchSchema.parse(patch) }]
    : [];
}
export function nativeFormatDraftIssue(
  document: NativeDesignDocument,
  table: NativeTable,
  column: NativeColumn | undefined,
  values: Record<string, string>,
): string | undefined {
  try {
    nativeFormatCommands(document, table, column, values, nativeFormatInitial(table, column));
  } catch (error) {
    return nativeEditorErrorCode(error);
  }
  return undefined;
}

export function NativeFormatEditor({
  context,
  document,
  table,
  column,
  mode,
  afterType,
}: {
  context: NativeEditorContext;
  document: NativeDesignDocument;
  table: NativeTable;
  column?: NativeColumn;
  mode?: 'physical' | 'logical';
  afterType?: ReactNode;
}) {
  const { t } = useI18n();
  const policy = nativeEditorPolicy(document, table, column);
  const blocked = (id: Parameters<typeof policy.feature>[0]) => !policy.feature(id).usable;
  const reason = (code: string | undefined) =>
    t(code?.endsWith('not-supported') ? '이 DB에서 지원하지 않음' : '미구현 또는 실행 검증 미완료');
  const condition = (code: string | undefined) =>
    code ? ` · ${nativeEditorConditionText(code)}` : '';
  const bool = [
    { value: 'false', label: 'false' },
    { value: 'true', label: 'true' },
  ];
  return (
    <NativeEditorForm
      context={context}
      title={t(mode === 'logical' ? '논리 속성 · 추가 속성' : '형식·DB 옵션 편집')}
      draftKey={`format:${column ? 'column' : 'table'}:${column?.id ?? table.id}`}
      initial={nativeFormatInitial(table, column)}
      disabled={(values) => !!nativeFormatDraftIssue(document, table, column, values)}
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
        const metadata = <NativeMetadataFields values={values} change={change} mode={mode} />;
        const color = !column && (
          <>
            <DomainColorPicker
              label={t('테이블 색상')}
              value={
                values.color ||
                document.domains.find((domain) => domain.id === table.domainId)?.color ||
                '#8993a3'
              }
              disabled={context.busy}
              onChange={(next) => change('color', next)}
              onReset={() => change('color', '')}
            />
            {(['showNullable', 'showComment'] as const).map((key) => (
              <label className="native-check-field" key={key}>
                <Checkbox
                  checked={values[key] === 'true'}
                  onChange={(event) => change(key, String(event.target.checked))}
                />
                {t(key === 'showNullable' ? 'NULL 표시' : '컬럼 설명 표시')}
              </label>
            ))}
          </>
        );
        if (mode === 'logical')
          return (
            <>
              {column && (
                <>
                  {field('semanticType', '의미 타입')}
                  <label className="native-check-field">
                    <Checkbox
                      checked={values.required === 'true'}
                      onChange={(event) => change('required', String(event.target.checked))}
                    />
                    {t('필수')}
                  </label>
                </>
              )}
              {color}
              {metadata}
            </>
          );
        if (!column)
          return (
            <>
              {color}
              {metadata}
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
              {(document.database.kind === 'postgresql'
                ? (['schema'] as const)
                : document.database.kind === 'mysql'
                  ? (['charset', 'collation'] as const)
                  : (['strictTable', 'withoutRowid'] as const)
              ).map((id) => {
                const code = policy.feature(id).code;
                return code ? <p key={id}>{nativeEditorConditionText(code)}</p> : null;
              })}
            </>
          );
        const current = nativeTypeChoice(column.physical.type);
        const choices: { value: string; label: string; disabled: boolean }[] = policy.types.map(
          (item) => ({
            value: item.definition.id,
            label: `${nativeTypeOptionLabel(item.definition.id)}${item.usable ? '' : ` · ${reason(item.code)}`}`,
            disabled: !item.usable,
          }),
        );
        choices.push(
          ...(document.database.kind === 'postgresql' ? (document.enums ?? []) : []).map(
            (item) => ({
              value: `enum:${item.id}`,
              label: `ENUM ${item.schema || 'public'}.${item.name}${blocked('enumType') ? ` · ${reason(policy.feature('enumType').code)}` : ''}`,
              disabled: blocked('enumType'),
            }),
          ),
        );
        for (const value of document.database.kind === 'sqlite' ? ['declared', 'untyped'] : [])
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
          (values.labelsJSON !== undefined &&
            values.labelsJSON !== nativeFormatInitial(table, column).labelsJSON);
        const arrayPolicy = nativeSelectedArrayPolicy(
          document,
          table,
          column,
          values.typeChoice ?? '',
          typeChanged,
        );
        const generationChoices = [
          { value: 'none', label: 'none' },
          ...(
            ['serial', 'identity', 'autoIncrement', 'computed:stored', 'computed:virtual'] as const
          )
            .filter(
              (value) =>
                policy.feature(
                  value === 'computed:stored'
                    ? 'generatedStored'
                    : value === 'computed:virtual'
                      ? 'generatedVirtual'
                      : value,
                ).supported || value === nativeFormatInitial(table, column).generationChoice,
            )
            .map((value) => {
              let decision;
              try {
                decision = nativeGenerationPolicy(
                  document,
                  table,
                  column,
                  nativeFormatGenerationInput(
                    document,
                    { ...values, generationChoice: value },
                    nativeFormatInitial(table, column),
                  ),
                );
              } catch (error) {
                decision = {
                  engineAllowed: false,
                  productUsable: false,
                  code: nativeEditorErrorCode(error),
                };
              }
              return {
                value,
                label: `${value} · ${t(decision.engineAllowed ? '엔진에서 허용' : '입력·타입 조건에 맞지 않음')}${decision.engineAllowed && !decision.productUsable ? ` · ${t('제품 검증 미완료')}` : ''}${condition(decision.code)}`,
                disabled:
                  !decision.productUsable &&
                  value !== nativeFormatInitial(table, column).generationChoice,
              };
            }),
        ];
        const defaults = policy.defaults.map((item) => ({
          value: item.choice,
          label:
            item.choice === 'none'
              ? t('기본값 없음')
              : item.preserved
                ? `${item.choice} · ${t('현재값 유지')}${!item.engineAllowed && item.code && !item.code.endsWith('not-ready') && item.code !== 'feature.not-implemented' ? condition(item.code) : ''}`
                : `${item.choice} · ${item.engineAllowed ? t('엔진에서 허용') : t(item.category === 'invalid' ? '입력·타입 조건에 맞지 않음' : item.category === 'environment' ? '환경 검증 필요' : '이 DB에서 지원하지 않음')}${item.engineAllowed && !item.productUsable ? ` · ${t('제품 검증 미완료')}` : ''}${condition(item.code)}`,
          disabled: !item.selectable,
        }));
        const originalDefault = column.physical.defaultValue;
        const defaultFunctions = nativeFunctionOptionPolicies(document, table, column, 'default');
        const onUpdateFunctions = nativeFunctionOptionPolicies(document, table, column, 'onUpdate');
        defaults.push({
          value: 'expression',
          label: `${t('기본값 함수')} · ${t(defaultFunctions.some((item) => item.engineAllowed) ? '엔진에서 허용' : '입력·타입 조건에 맞지 않음')}${defaultFunctions.some((item) => item.engineAllowed) && !defaultFunctions.some((item) => item.productUsable) ? ` · ${t('제품 검증 미완료')}` : ''}`,
          disabled:
            originalDefault.kind !== 'expression' &&
            !defaultFunctions.some((item) => item.productUsable),
        });
        if (originalDefault.kind === 'legacyExpression')
          defaults.push({ value: 'legacyExpression', label: t('현재 원문 유지'), disabled: false });
        const currentDefaultDecision =
          originalDefault.kind === 'expression'
            ? nativeBuiltinDefaultPolicy(document, table, column, originalDefault.expression)
            : nativeLiteralPolicy(document, table, column, originalDefault);
        const issue = nativeFormatDraftIssue(document, table, column, values);
        return (
          <>
            <p>
              {t('현재 값')}: {nativeTypeCurrentLabel(column, document)} ·{' '}
              {nativeDefaultDisplay(column.physical.defaultValue, document)} ·{' '}
              {nativeGenerationDisplay(column.physical.generation, document)}
            </p>
            {field('typeChoice', '타입', false, choices)}
            {Object.entries(nativeTypeParameterRules(values.typeChoice ?? '')).map(([key, rule]) =>
              key === 'srid' ? (
                <NativeSridParameterField
                  key={key}
                  document={document}
                  column={column}
                  typeId={values.typeChoice ?? ''}
                  value={values['parameter:srid'] ?? ''}
                  onChange={(value) => change('parameter:srid', value)}
                  disabled={!ready}
                />
              ) : (
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
            {values.typeChoice?.startsWith('mysql:') &&
              ['mysql:enum', 'mysql:set'].includes(values.typeChoice) && (
                <NativeLabelFields
                  value={values.labelsJSON ?? ''}
                  onChange={(raw) => change('labelsJSON', raw)}
                  disabled={!ready || context.busy}
                  maxItems={values.typeChoice === 'mysql:set' ? 64 : 1000}
                  legacyDraft={values.values !== undefined}
                />
              )}
            {values.typeChoice === 'mysql:set' && (
              <p>{t('SET 값은 최대 64개이며 쉼표를 포함할 수 없습니다.')}</p>
            )}
            {column.physical.type.kind === 'declared' && (
              <p>
                {column.physical.type.name} ({column.physical.type.numericArguments.join(', ')})
              </p>
            )}
            {afterType}
            <PanelSection title={t('NULL · 기본값 · 배열 차원')}>
              {field('nullable', 'NULL', false, bool)}
              {field('defaultChoice', '기본값', typeChanged, defaults)}
              {currentDefaultDecision.category === 'environment' && (
                <p role="status">
                  {t('환경 확인 후 기본값을 제거하거나 검증된 값으로 복구하세요.')}
                  {condition(currentDefaultDecision.code)}
                </p>
              )}
              {originalDefault.kind === 'expression' && !currentDefaultDecision.engineAllowed && (
                <p role="status">
                  {t('현재 원문 유지')}
                  {condition(currentDefaultDecision.code)}
                </p>
              )}
              {values.defaultChoice?.startsWith('literal:') &&
                field(
                  'defaultValue',
                  '값',
                  typeChanged,
                  values.defaultChoice === 'literal:boolean' ? bool : undefined,
                )}
              {issue && (
                <p role="alert">
                  {t('입력 내용을 확인해 주세요. 초안은 원문으로 보관됩니다.')}
                  {condition(issue)}
                </p>
              )}
              {values.defaultChoice === 'expression' && (
                <>
                  {field('defaultExpressionMode', '기본값 식 변경', typeChanged, [
                    { value: 'preserve', label: t('현재 원문 유지') },
                    {
                      value: 'replace',
                      label: t('수정'),
                      disabled: !defaultFunctions.some((item) => item.productUsable),
                    },
                  ])}
                  {field(
                    'defaultFunction',
                    '기본값 함수',
                    typeChanged || values.defaultExpressionMode === 'preserve',
                    [
                      { value: '', label: '—' },
                      ...defaultFunctions.map((item) => ({
                        value: item.id,
                        label: `${item.id.split(':')[1]} · ${t(item.requiresArguments ? '인자 입력 필요' : item.engineAllowed ? '엔진에서 허용' : '입력·타입 조건에 맞지 않음')}${condition(item.code)}`,
                        disabled: item.requiresArguments || !item.productUsable,
                      })),
                    ],
                  )}
                </>
              )}
              {(document.database.kind === 'postgresql' || values.array) && (
                <>
                  {field('array', '배열 차원', !arrayPolicy.usable)}
                  <p>
                    {t('배열 차원은 1부터 6까지 입력하세요. 배열을 제거하려면 비워 두세요.')}
                    {arrayPolicy.code ? condition(arrayPolicy.code) : ''}
                  </p>
                </>
              )}
              {field('generationChoice', '생성', typeChanged, generationChoices)}
              {values.generationChoice === 'identity' && (
                <>
                  {field(
                    'identityMode',
                    'Identity',
                    typeChanged,
                    ['always', 'byDefault'].map((value) => ({ value, label: value })),
                  )}
                  {nativeIdentityFields.map((name) => (
                    <div key={name}>
                      {field(
                        `identity:${name}`,
                        name === 'cache'
                          ? 'Identity cache (1…2147483647)'
                          : `Identity ${name}${name === 'cycle' ? '' : ' (integer token ≤100)'}`,
                        typeChanged,
                        name === 'cycle' ? [{ value: '', label: '—' }, ...bool] : undefined,
                      )}
                    </div>
                  ))}
                </>
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
              {document.database.kind === 'mysql' && (
                <>
                  {field('onUpdateMode', 'ON UPDATE 설정', typeChanged, [
                    { value: 'preserve', label: t('현재 원문 유지') },
                    { value: 'none', label: 'none' },
                    {
                      value: 'function',
                      label: t('ON UPDATE 함수'),
                      disabled: !onUpdateFunctions.some((item) => item.productUsable),
                    },
                  ])}
                  {values.onUpdateMode === 'function' &&
                    field('onUpdateFunction', 'ON UPDATE 함수', typeChanged, [
                      { value: '', label: '—' },
                      ...onUpdateFunctions.map((item) => ({
                        value: item.id,
                        label: `${item.id.split(':')[1]} · ${t(item.requiresArguments ? '인자 입력 필요' : item.engineAllowed ? '엔진에서 허용' : '입력·타입 조건에 맞지 않음')}${condition(item.code)}`,
                        disabled: item.requiresArguments || !item.productUsable,
                      })),
                    ])}
                </>
              )}
              {metadata}
            </PanelSection>
          </>
        );
      }}
    </NativeEditorForm>
  );
}

/** Rows keep names and values as durable input, including incomplete or duplicate names. */
function NativeMetadataFields({
  values,
  change,
  mode,
}: {
  values: Record<string, string>;
  change: (field: string, value: string) => void;
  mode?: 'physical' | 'logical' | undefined;
}) {
  const { t } = useI18n();
  return (
    <PanelSection title={t('추가 속성')}>
      {(['common', ...(mode ? [mode] : ['logical', 'physical'])] as const).map((scope) => {
        const field = `metadata:${scope}`;
        let rows: [string, string][];
        try {
          const parsed: unknown = JSON.parse(values[field] ?? '[]');
          if (
            !Array.isArray(parsed) ||
            parsed.some(
              (row) =>
                !Array.isArray(row) ||
                row.length !== 2 ||
                typeof row[0] !== 'string' ||
                typeof row[1] !== 'string',
            )
          )
            throw Error();
          rows = parsed;
        } catch {
          return (
            <p role="alert" key={scope}>
              {t('추가 속성 입력을 확인해 주세요.')}
            </p>
          );
        }
        const update = (next: [string, string][]) => change(field, JSON.stringify(next));
        return (
          <div className="native-metadata-group" key={scope}>
            <strong>
              {t(scope === 'common' ? '공통' : scope === 'logical' ? '논리' : '물리')}
            </strong>
            {(rows.some(([name]) => !name.trim()) ||
              new Set(rows.map(([name]) => name)).size !== rows.length) && (
              <p className="field-help" role="alert">
                {t('추가 속성의 이름은 비어 있거나 중복될 수 없습니다.')}
              </p>
            )}
            {rows.map(([name, value], index) => (
              <div className="native-metadata-row" key={index}>
                <Input
                  aria-label={`${t('속성 이름')} ${index + 1}`}
                  value={name}
                  maxLength={120}
                  onChange={(event) =>
                    update(
                      rows.map((row, at) => (at === index ? [event.target.value, row[1]] : row)),
                    )
                  }
                />
                <Textarea
                  aria-label={`${t('속성 값')} ${index + 1}`}
                  value={value}
                  maxLength={10000}
                  onChange={(event) =>
                    update(
                      rows.map((row, at) => (at === index ? [row[0], event.target.value] : row)),
                    )
                  }
                />
                <Button
                  variant="danger"
                  aria-label={`${t('속성 삭제')} ${index + 1}`}
                  onClick={() => update(rows.filter((_, at) => at !== index))}
                >
                  ×
                </Button>
              </div>
            ))}
            <Button disabled={rows.length >= 100} onClick={() => update([...rows, ['', '']])}>
              {t('속성 추가')}
            </Button>
          </div>
        );
      })}
    </PanelSection>
  );
}
