import { useState } from 'react';
import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { NativeEditorField } from './native-editor-form.js';
import {
  parseNativeLabels,
  addNativeLabel,
  changeNativeLabel,
  moveNativeLabel,
  removeNativeLabel,
  nativeLabelLimit,
  nativeLabelsFromLines,
} from './native-label-draft.js';
registerTranslations({
  '순서가 있는 값 목록': 'Ordered value list',
  '값 {count}개': '{count} values',
  '값 {position}': 'Value {position}',
  '빈 문자열': 'Empty string',
  '{bytes}바이트': '{bytes} bytes',
  '값 추가': 'Add value',
  '빈 문자열 추가': 'Add empty string',
  '값 목록 (한 줄에 하나)': 'Values (one per line)',
  '값별 편집': 'Edit individual values',
  '여러 줄로 일괄 입력': 'Enter values in bulk',
  '한 줄에 하나씩 입력하거나 붙여넣으세요. 빈 줄은 건너뛰며 값의 공백과 순서는 그대로 저장됩니다.':
    'Enter or paste one value per line. Blank lines are skipped; whitespace within values and order are preserved.',
  '전체 입력을 지우면 값 목록이 비워집니다. 빈 값 하나는 빈 문자열 추가로 입력하세요.':
    'Clearing the input removes all values. Use Add empty string for a single empty value.',
  '빈 문자열이나 개행을 포함한 값은 값별 편집으로 보존됩니다.':
    'Empty strings and values containing line breaks are preserved in individual editing mode.',
  '값 삭제': 'Delete value',
  위로: 'Move up',
  아래로: 'Move down',
  '각 값의 빈 문자열·개행·공백과 순서는 그대로 저장됩니다.':
    'Empty strings, line breaks, whitespace and order are retained for each value.',
  '보관된 값 목록 초안을 읽을 수 없습니다. 원문은 보존됩니다. 보관 내용을 확인해 주세요.':
    'The archived value-list draft cannot be read. Its original is preserved. Review the archived input.',
  '값 목록 변경을 적용할 수 없습니다. 기존 초안은 유지됩니다.':
    'The value-list change cannot be applied. The existing draft is preserved.',
  '기존 줄 형식 초안을 보존했습니다. 자동으로 값을 분리하지 않습니다. 보관 내용을 확인해 주세요.':
    'The old line-based draft is preserved. Values are not split automatically. Review the archived input.',
});
export function NativeLabelFields({
  value,
  onChange,
  disabled = false,
  maxItems = nativeLabelLimit,
  legacyDraft = false,
}: {
  value: string;
  onChange: (raw: string) => void;
  disabled?: boolean;
  maxItems?: number;
  legacyDraft?: boolean;
}) {
  const { t } = useI18n(),
    [error, setError] = useState(false),
    [individual, setIndividual] = useState(false),
    [bulkInput, setBulkInput] = useState({ value: '', text: '' });
  if (legacyDraft)
    return (
      <p role="alert">
        {t(
          '기존 줄 형식 초안을 보존했습니다. 자동으로 값을 분리하지 않습니다. 보관 내용을 확인해 주세요.',
        )}
      </p>
    );
  let labels: string[];
  try {
    labels = parseNativeLabels(value);
  } catch {
    return (
      <p role="alert">
        {t('보관된 값 목록 초안을 읽을 수 없습니다. 원문은 보존됩니다. 보관 내용을 확인해 주세요.')}
      </p>
    );
  }
  const edit = (next: () => string) => {
    if (disabled) return;
    try {
      onChange(next());
      setError(false);
    } catch {
      setError(true);
    }
  };
  const requiresIndividual = labels.some((label) => label === '' || /[\r\n]/.test(label)),
    showIndividual = individual || requiresIndividual;
  return (
    <fieldset disabled={disabled}>
      <legend>{t('순서가 있는 값 목록')}</legend>
      <p>{t('값 {count}개', { count: labels.length })}</p>
      {requiresIndividual && (
        <p>{t('빈 문자열이나 개행을 포함한 값은 값별 편집으로 보존됩니다.')}</p>
      )}
      <Button disabled={disabled || requiresIndividual} onClick={() => setIndividual(!individual)}>
        {t(showIndividual ? '여러 줄로 일괄 입력' : '값별 편집')}
      </Button>
      {showIndividual ? (
        <>
          <p>{t('각 값의 빈 문자열·개행·공백과 순서는 그대로 저장됩니다.')}</p>
          {labels.map((label, index) => (
            <div key={index}>
              <NativeEditorField
                label={t('값 {position}', { position: index + 1 })}
                value={label}
                onChange={(next) =>
                  edit(() => {
                    const raw = changeNativeLabel(value, index, next);
                    setIndividual(true);
                    return raw;
                  })
                }
                multiline
                disabled={disabled}
              />
              <p>
                {label === '' ? `${t('빈 문자열')} · ` : ''}
                {t('{bytes}바이트', { bytes: new TextEncoder().encode(label).byteLength })}
              </p>
              <Button
                disabled={disabled || index === 0}
                onClick={() => edit(() => moveNativeLabel(value, index, -1))}
              >
                {t('위로')}
              </Button>
              <Button
                disabled={disabled || index === labels.length - 1}
                onClick={() => edit(() => moveNativeLabel(value, index, 1))}
              >
                {t('아래로')}
              </Button>
              <Button
                disabled={disabled}
                onClick={() => edit(() => removeNativeLabel(value, index))}
              >
                {t('값 삭제')}
              </Button>
            </div>
          ))}
        </>
      ) : (
        <>
          <p>
            {t(
              '한 줄에 하나씩 입력하거나 붙여넣으세요. 빈 줄은 건너뛰며 값의 공백과 순서는 그대로 저장됩니다.',
            )}
          </p>
          <p>
            {t(
              '전체 입력을 지우면 값 목록이 비워집니다. 빈 값 하나는 빈 문자열 추가로 입력하세요.',
            )}
          </p>
          <NativeEditorField
            label={t('값 목록 (한 줄에 하나)')}
            value={bulkInput.value === value ? bulkInput.text : labels.join('\n')}
            onChange={(next) =>
              edit(() => {
                const raw = nativeLabelsFromLines(next, maxItems);
                setBulkInput({ value: raw, text: next });
                return raw;
              })
            }
            multiline
            disabled={disabled}
          />
        </>
      )}
      <Button
        disabled={disabled || labels.length >= Math.min(nativeLabelLimit, maxItems)}
        onClick={() =>
          edit(() => {
            const raw = addNativeLabel(value);
            setIndividual(true);
            return raw;
          })
        }
      >
        {t(showIndividual ? '값 추가' : '빈 문자열 추가')}
      </Button>
      {error && (
        <p role="alert">{t('값 목록 변경을 적용할 수 없습니다. 기존 초안은 유지됩니다.')}</p>
      )}
    </fieldset>
  );
}
