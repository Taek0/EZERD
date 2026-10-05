import { memo } from 'react';
import { nativeEditorCommandSchema } from '@ezerd/contracts';
import type { NativeDesignDocument } from '@ezerd/model';
import {
  NativeEditorField,
  NativeEditorForm,
  type NativeEditorContext,
} from './native-editor-form.js';
import { NativeFormatEditor } from './native-editor-format.js';
import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
registerTranslations({
  '캔버스에서 편집': 'Edit on canvas',
  '더블클릭 또는 F2로 편집': 'Double-click or press F2 to edit',
  '닫아도 미저장 입력은 보관됩니다.': 'Unsaved input is preserved when closed.',
  이름: 'Name',
  설명: 'Comment',
  '의미 타입': 'Semantic type',
  필수: 'Required',
});
export interface NativeInlineTarget {
  tableId: string;
  columnId?: string;
  mode: 'physical' | 'logical';
  field: 'name' | 'comment' | 'semanticType' | 'required' | 'format';
}
export const nativeInlineKey = (target: NativeInlineTarget) =>
  `canvas:inline:${JSON.stringify([target.tableId, target.columnId ?? '', target.mode, target.field])}`;
export function nativeInlineInput(document: NativeDesignDocument, target: NativeInlineTarget) {
  const table = document.tables?.find((t) => t.id === target.tableId);
  const column = target.columnId
    ? document.columns?.find((c) => c.id === target.columnId && c.tableId === target.tableId)
    : undefined;
  if (!table || (target.columnId && !column)) throw Error('document.object-not-found');
  const item = column ?? table;
  const value =
    target.field === 'name'
      ? item[target.mode].name
      : target.field === 'comment'
        ? target.mode === 'physical'
          ? item.physical.comment
          : item.logical.definition
        : target.field === 'semanticType'
          ? (column?.logical.semanticType ?? '')
          : target.field === 'required'
            ? String(column?.logical.required ?? false)
            : '';
  return { table, column, value };
}
export function nativeInlineCommand(
  document: NativeDesignDocument,
  target: NativeInlineTarget,
  value: string,
) {
  const { column, table } = nativeInlineInput(document, target);
  if (target.field === 'format') throw Error('native.inline-format-required');
  if (
    (target.field === 'semanticType' || target.field === 'required') &&
    (!column || target.mode !== 'logical')
  )
    throw Error('native.inline-field-invalid');
  if (target.field === 'required' && !['true', 'false'].includes(value))
    throw Error('native.inline-value-invalid');
  const field =
    target.field === 'comment'
      ? target.mode === 'physical'
        ? 'comment'
        : 'definition'
      : target.field;
  return nativeEditorCommandSchema.parse({
    type: column ? 'patch_column' : 'patch_table',
    id: column?.id ?? table.id,
    patch: { [target.mode]: { [field]: target.field === 'required' ? value === 'true' : value } },
  });
}
export const NativeCanvasInlineEditor = memo(function NativeCanvasInlineEditor({
  document,
  target,
  context,
  onClose,
}: {
  document: NativeDesignDocument;
  target: NativeInlineTarget;
  context: NativeEditorContext;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const table = document.tables?.find((item) => item.id === target.tableId);
  const column = target.columnId
    ? document.columns?.find(
        (item) => item.id === target.columnId && item.tableId === target.tableId,
      )
    : undefined;
  if (!table || (target.columnId && !column)) return null;
  const input = nativeInlineInput(document, target);
  return (
    <aside
      className="native-inline-editor"
      role="dialog"
      aria-label={t('캔버스에서 편집')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="native-inline-heading">
        <strong>{column?.physical.name || table.physical.name || t('캔버스에서 편집')}</strong>
        <Button onClick={onClose}>{t('닫기')}</Button>
      </div>
      <p>{t('닫아도 미저장 입력은 보관됩니다.')}</p>
      {target.field === 'format' ? (
        <NativeFormatEditor
          key={nativeInlineKey(target)}
          document={document}
          table={table}
          {...(column ? { column } : {})}
          context={context}
        />
      ) : (
        <NativeEditorForm
          key={nativeInlineKey(target)}
          context={context}
          draftKey={nativeInlineKey(target)}
          title={t('캔버스에서 편집')}
          initial={{ value: input.value }}
          build={(values) => [nativeInlineCommand(document, target, values.value ?? '')]}
        >
          {(values, change) => (
            <NativeEditorField
              label={
                target.field === 'name'
                  ? '이름'
                  : target.field === 'comment'
                    ? '설명'
                    : target.field === 'required'
                      ? '필수'
                      : '의미 타입'
              }
              value={values.value ?? ''}
              multiline={target.field === 'comment'}
              {...(target.field === 'required'
                ? {
                    choices: [
                      { value: 'false', label: 'false' },
                      { value: 'true', label: 'true' },
                    ],
                  }
                : {})}
              onChange={(value) => change('value', value)}
            />
          )}
        </NativeEditorForm>
      )}
    </aside>
  );
});
