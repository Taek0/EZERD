import { memo, useLayoutEffect, useMemo, useRef } from 'react';
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
import { nativeTypeChoice } from './native-editor-policy.js';
import { loadNativeEditorDraft, discardNativeEditorDraft } from './native-editor-draft.js';
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
  focusTarget,
}: {
  document: NativeDesignDocument;
  target: NativeInlineTarget;
  context: NativeEditorContext;
  onClose: () => void;
  focusTarget?: HTMLElement | null | undefined;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const composing = useRef(false);
  const imeEnter = useRef(false);
  const active = useRef(true),
    targetKey = nativeInlineKey(target),
    identity = JSON.stringify([context.userId, context.snapshot.project.id, targetKey]),
    latest = useRef({ identity, context, onClose });
  useLayoutEffect(() => {
    active.current = true;
    returnFocus.current =
      focusTarget ??
      (globalThis.document?.activeElement instanceof HTMLElement
        ? globalThis.document.activeElement
        : null);
    const field = root.current?.querySelector<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), [role="combobox"]:not([aria-disabled="true"])',
    );
    field?.focus();
    return () => {
      active.current = false;
    };
  }, [identity, focusTarget]);
  useLayoutEffect(() => {
    latest.current = { identity, context, onClose };
  });
  function close() {
    if (!active.current || latest.current.identity !== identity) return;
    latest.current.onClose();
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
  }
  const saveContext = useMemo(
    () => ({
      ...context,
      onSave: async (...args: Parameters<NativeEditorContext['onSave']>) => {
        const current = latest.current;
        const expected = args[1],
          snapshot = current.context.snapshot;
        if (
          !active.current ||
          current.identity !== identity ||
          expected.version !== snapshot.project.version ||
          expected.sequence !== snapshot.sequence ||
          expected.databaseRevision !== snapshot.project.databaseRevision
        )
          return false;
        const source =
          target.field === 'format'
            ? loadNativeEditorDraft(current.context.userId, snapshot.project.id, targetKey)
            : null;
        const completesSource =
          source &&
          args[0].some(
            (command) =>
              command.type === 'patch_column' &&
              command.id === target.columnId &&
              command.patch.physical?.type &&
              nativeTypeChoice(command.patch.physical.type) === source.values.value,
          );
        const saved = await current.context.onSave(...args);
        if (saved && active.current && latest.current.identity === identity) {
          if (completesSource) discardNativeEditorDraft(source.userId, source.projectId, source);
          close();
        }
        return saved;
      },
    }),
    [context, identity],
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
      ref={root}
      className="native-inline-editor"
      onWheel={(event) => event.stopPropagation()}
      role="dialog"
      aria-label={t('캔버스에서 편집')}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onSubmitCapture={(event) => {
        if (composing.current || imeEnter.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyUpCapture={() => {
        imeEnter.current = false;
      }}
      onKeyDownCapture={(event) => {
        imeEnter.current =
          event.key === 'Enter' &&
          (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current);
        if (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) {
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.stopPropagation();
          }
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="native-inline-heading">
        <strong>{column?.physical.name || table.physical.name || t('캔버스에서 편집')}</strong>
        <Button onClick={close}>{t('닫기')}</Button>
      </div>
      <p>{t('닫아도 미저장 입력은 보관됩니다.')}</p>
      {target.field === 'format' ? (
        <NativeFormatEditor
          key={identity}
          document={document}
          table={table}
          {...(column ? { column } : {})}
          context={saveContext}
        />
      ) : (
        <NativeEditorForm
          key={identity}
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
