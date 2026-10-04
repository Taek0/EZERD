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
} from './native-label-draft.js';
registerTranslations({
  '순서가 있는 값 목록': 'Ordered value list',
  '값 {count}개': '{count} values',
  '값 {position}': 'Value {position}',
  '빈 문자열': 'Empty string',
  '{bytes}바이트': '{bytes} bytes',
  '값 추가': 'Add value',
  '값 삭제': 'Delete value',
  위로: 'Move up',
  아래로: 'Move down',
  '각 값의 빈 문자열·개행·공백과 순서는 그대로 저장됩니다.':
    'Empty strings, line breaks, whitespace and order are retained for each value.',
  '보관된 값 목록 초안을 읽을 수 없습니다. 원문은 보존됩니다. 입력 초기화 또는 보관 다시 시도를 사용하세요.':
    'The archived value-list draft cannot be read. Its original is preserved. Reset input or retry preserving it.',
  '값 목록 변경을 적용할 수 없습니다. 기존 초안은 유지됩니다.':
    'The value-list change cannot be applied. The existing draft is preserved.',
  '기존 줄 형식 초안을 보존했습니다. 자동으로 값을 분리하지 않습니다. 보관 내용을 확인한 뒤 입력 초기화로 최신 값에서 다시 편집하세요.':
    'The old line-based draft is preserved. Values are not split automatically. Review the archived input, then reset input to edit the latest values.',
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
    [error, setError] = useState(false);
  if (legacyDraft)
    return (
      <p role="alert">
        {t(
          '기존 줄 형식 초안을 보존했습니다. 자동으로 값을 분리하지 않습니다. 보관 내용을 확인한 뒤 입력 초기화로 최신 값에서 다시 편집하세요.',
        )}
      </p>
    );
  let labels: string[];
  try {
    labels = parseNativeLabels(value);
  } catch {
    return (
      <p role="alert">
        {t(
          '보관된 값 목록 초안을 읽을 수 없습니다. 원문은 보존됩니다. 입력 초기화 또는 보관 다시 시도를 사용하세요.',
        )}
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
  return (
    <fieldset disabled={disabled}>
      <legend>{t('순서가 있는 값 목록')}</legend>
      <p>{t('값 {count}개', { count: labels.length })}</p>
      <p>{t('각 값의 빈 문자열·개행·공백과 순서는 그대로 저장됩니다.')}</p>
      {labels.map((label, index) => (
        <div key={index}>
          <NativeEditorField
            label={t('값 {position}', { position: index + 1 })}
            value={label}
            onChange={(next) => edit(() => changeNativeLabel(value, index, next))}
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
          <Button disabled={disabled} onClick={() => edit(() => removeNativeLabel(value, index))}>
            {t('값 삭제')}
          </Button>
        </div>
      ))}
      <Button
        disabled={disabled || labels.length >= Math.min(nativeLabelLimit, maxItems)}
        onClick={() => edit(() => addNativeLabel(value))}
      >
        {t('값 추가')}
      </Button>
      {error && (
        <p role="alert">{t('값 목록 변경을 적용할 수 없습니다. 기존 초안은 유지됩니다.')}</p>
      )}
    </fieldset>
  );
}
