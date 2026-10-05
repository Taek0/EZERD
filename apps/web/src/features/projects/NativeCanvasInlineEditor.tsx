import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  nativeInlineKey,
  nativeInlineInput,
  nativeInlineCommand,
  type NativeInlineTarget,
} from './native-inline-edit.js';
export {
  nativeInlineKey,
  nativeInlineInput,
  nativeInlineCommand,
  type NativeInlineTarget,
} from './native-inline-edit.js';
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
  const active = useRef(true),
    targetKey = nativeInlineKey(target),
    latest = useRef(targetKey);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    latest.current = targetKey;
  }, [targetKey]);
  const saveContext = useMemo(
    () => ({
      ...context,
      onSave: async (...args: Parameters<NativeEditorContext['onSave']>) => {
        const saved = await context.onSave(...args);
        if (saved && active.current && latest.current === targetKey) onClose();
        return saved;
      },
    }),
    [context, onClose, targetKey],
  );

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
      onWheel={(event) => event.stopPropagation()}
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
          context={saveContext}
        />
      ) : (
        <NativeEditorForm
          key={nativeInlineKey(target)}
          context={saveContext}
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
