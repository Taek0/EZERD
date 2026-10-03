import {
  checkDatabaseFeature,
  type NativeDesignDocument,
  type NativeTableKey,
  type NativeTableRelation,
  type NativeColumn,
} from '@ezerd/model';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { NativeEditorField } from './native-editor-form.js';
import {
  nativeEnumOptionsDecision,
  nativeSridParameterDecision,
} from './native-constraint-options.js';
import { nativeEditorConditionText } from './native-editor-diagnostic.js';

registerTranslations({
  '제약 검사 시점': 'Constraint check timing',
  '지연 불가': 'Not deferrable',
  '지연 가능 · 기본 즉시 검사': 'Deferrable · initially immediate',
  '지연 가능 · 기본 지연 검사': 'Deferrable · initially deferred',
  'NULL을 같은 값으로 취급': 'Treat NULL values as equal',
  'NULL 동일 취급은 PostgreSQL 고유 키에서만 사용할 수 있습니다.':
    'Treating NULL values as equal is available only for PostgreSQL unique keys.',
  '이 DB에서는 현재 지연 설정을 지원하지 않습니다. 원문은 유지됩니다.':
    'This database does not support the current deferrability setting. The original is preserved.',
  'ENUM 이름과 스키마는 UTF-8 63바이트 이하로 입력하세요. 빈 스키마는 public을 사용합니다.':
    'ENUM names and schemas must be at most 63 UTF-8 bytes. An empty schema uses public.',
  'ENUM 값은 중복 없이 각각 UTF-8 63바이트 이하로 입력하세요.':
    'Enter each ENUM value without duplicates, using at most 63 UTF-8 bytes.',
  '이름 {nameBytes}바이트 · 스키마 {schemaBytes}바이트':
    'Name: {nameBytes} bytes · Schema: {schemaBytes} bytes',
  '{position}번째 값: {bytes}바이트': 'Value {position}: {bytes} bytes',
  '공간 참조계 (SRID)': 'Spatial reference system (SRID)',
  'SRID 제한 없음': 'No SRID restriction',
  '현재 원문 유지': 'Preserve the current original value',
});
export function NativeSridParameterField({
  document,
  column,
  typeId,
  value,
  onChange,
  disabled = false,
}: {
  document: NativeDesignDocument;
  column: NativeColumn;
  typeId: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n(),
    current = nativeSridParameterDecision(document, column, typeId, value);
  const choices = ['', '0', '4326'].map((token) => {
    const decision = nativeSridParameterDecision(document, column, typeId, token);
    return {
      value: token,
      label: `${token === '' ? t('SRID 제한 없음') : `SRID ${token}`}${decision.code ? ` · ${nativeEditorConditionText(decision.code)}` : ''}`,
      disabled: !decision.usable && token !== value,
    };
  });
  if (!choices.some((c) => c.value === value))
    choices.push({ value, label: t('현재 원문 유지'), disabled: true });
  return (
    <>
      <NativeEditorField
        label="공간 참조계 (SRID)"
        value={value}
        onChange={onChange}
        disabled={disabled}
        choices={choices}
      />
      {current.code && <p role="status">{nativeEditorConditionText(current.code)}</p>}
    </>
  );
}
export function NativeConstraintOptionFields({
  document,
  kind,
  keyKind,
  values,
  change,
  current = {},
  disabled = false,
}: {
  document: NativeDesignDocument;
  kind: 'key' | 'foreignKey';
  keyKind?: string;
  values: Record<string, string>;
  change: (key: string, value: string) => void;
  current?:
    | Pick<NativeTableKey, 'deferrable' | 'nullsNotDistinct'>
    | Pick<NativeTableRelation, 'deferrable'>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const supported =
    kind === 'foreignKey'
      ? checkDatabaseFeature(document.database, 'deferrableForeignKey').supported
      : document.database.kind === 'postgresql';
  const mode = values.deferrability ?? current.deferrable?.initially ?? 'none';
  const nulls =
    values.nullsNotDistinct ??
    String(('nullsNotDistinct' in current && current.nullsNotDistinct) || false);
  return (
    <>
      {(supported || current.deferrable) && (
        <>
          <NativeEditorField
            label="제약 검사 시점"
            value={mode}
            onChange={(v) => change('deferrability', v)}
            disabled={disabled || (!supported && !current.deferrable)}
            choices={[
              { value: 'none', label: t('지연 불가') },
              {
                value: 'immediate',
                label: t('지연 가능 · 기본 즉시 검사'),
                disabled: !supported && mode !== 'immediate',
              },
              {
                value: 'deferred',
                label: t('지연 가능 · 기본 지연 검사'),
                disabled: !supported && mode !== 'deferred',
              },
            ]}
          />
          {!supported && (
            <p role="status">
              {t('이 DB에서는 현재 지연 설정을 지원하지 않습니다. 원문은 유지됩니다.')}
            </p>
          )}
        </>
      )}
      {kind === 'key' &&
        (checkDatabaseFeature(document.database, 'nullsNotDistinct').supported ||
          'nullsNotDistinct' in current) && (
          <>
            <NativeEditorField
              label="NULL을 같은 값으로 취급"
              value={nulls}
              onChange={(v) => change('nullsNotDistinct', v)}
              disabled={disabled || document.database.kind !== 'postgresql'}
              choices={[
                { value: 'false', label: 'false' },
                { value: 'true', label: 'true', disabled: keyKind !== 'unique' },
              ]}
            />
            {keyKind !== 'unique' && (
              <p role="status">
                {t('NULL 동일 취급은 PostgreSQL 고유 키에서만 사용할 수 있습니다.')}
              </p>
            )}
          </>
        )}
    </>
  );
}
export function NativeEnumOptionSummary({
  document,
  id,
  name,
  schema,
  text,
}: {
  document: NativeDesignDocument;
  id: string;
  name: string;
  schema: string;
  text: string;
}) {
  const { t } = useI18n(),
    status = nativeEnumOptionsDecision(document, id, name, schema, text);
  return (
    <div role="status">
      <p>
        {t(
          'ENUM 이름과 스키마는 UTF-8 63바이트 이하로 입력하세요. 빈 스키마는 public을 사용합니다.',
        )}
      </p>
      <p>
        {t('이름 {nameBytes}바이트 · 스키마 {schemaBytes}바이트', {
          nameBytes: new TextEncoder().encode(name).byteLength,
          schemaBytes: new TextEncoder().encode(schema).byteLength,
        })}
      </p>
      <p>{t('ENUM 값은 중복 없이 각각 UTF-8 63바이트 이하로 입력하세요.')}</p>
      <ul>
        {status.byteCounts.slice(0, 1000).map((bytes, i) => (
          <li key={i}>{t('{position}번째 값: {bytes}바이트', { position: i + 1, bytes })}</li>
        ))}
      </ul>
      {!status.allowed && (
        <p>
          {status.code === 'enum.values-invalid'
            ? t('ENUM 값은 중복 없이 각각 UTF-8 63바이트 이하로 입력하세요.')
            : nativeEditorConditionText(status.code)}
        </p>
      )}
      {!status.usable && <p>{nativeEditorConditionText('feature.not-implemented')}</p>}
    </div>
  );
}
