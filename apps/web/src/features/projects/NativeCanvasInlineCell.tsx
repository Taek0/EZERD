import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { NativeDesignDocument } from '@ezerd/model';
import { Button, Input, Tooltip } from '../../components/ui/index.js';
import { SearchType } from '../../components/ui/SearchType.js';
import { message } from '../../shared/api/client.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import type { NativeEditorContext } from './native-editor-form.js';
import {
  discardNativeEditorDraft,
  loadNativeEditorDraft,
  storeNativeEditorDraft,
  type NativeEditorDraft,
} from './native-editor-draft.js';
import { nativeDurableId } from './native-durable-queue.js';
import { useNativeExportBlocker } from './native-export-state.js';
import { nativeFormatInitial } from './native-editor-format.js';
import { nativeTypeCurrentLabel } from './native-editor-policy.js';
import {
  nativeInlineCommand,
  nativeInlineInput,
  nativeInlineKey,
  nativeInlineTypeCommand,
  nativeInlineTypeOptions,
  type NativeInlineTarget,
} from './native-inline-edit.js';

registerTranslations({
  '고급 형식 편집': 'Edit advanced format',
  '입력을 보관했습니다. 다시 포커스하여 수정하세요.': 'Input preserved. Focus again to edit.',
  '타입 옵션을 고급 형식 편집기에서 확인하세요.':
    'Review type options in the advanced format editor.',
  '저장 기준이 변경되었습니다. 보관된 입력을 최신 내용과 비교해 주세요.':
    'The save baseline changed. Compare preserved input with the latest values.',
});

export interface NativeCanvasInlineCellProps {
  document: NativeDesignDocument;
  target: NativeInlineTarget;
  /** Omit context, or pass disabled, for a text-only read-only cell. */
  context?: NativeEditorContext | undefined;
  onSelect?: ((target: NativeInlineTarget) => void) | undefined;
  onAdvancedFormat?: ((target: NativeInlineTarget, focusTarget?: HTMLElement) => void) | undefined;
  disabled?: boolean | undefined;
  label?: string | undefined;
  display?: string | undefined;
  title?: boolean | undefined;
  className?: string | undefined;
}

/** The key isolates hook state and pending callbacks across actor/project/field changes. */
export function NativeCanvasInlineCell(props: NativeCanvasInlineCellProps) {
  const { document, target, context } = props;
  const table = document.tables?.find((item) => item.id === target.tableId);
  const column = target.columnId
    ? document.columns?.find((item) => item.id === target.columnId && item.tableId === table?.id)
    : undefined;
  if (!table || (target.columnId && !column)) return null;
  const input = nativeInlineInput(document, target);
  const display =
    props.display ??
    (target.field === 'format' && column ? nativeTypeCurrentLabel(column, document) : input.value);
  if (!context || props.disabled)
    return (
      <span className={props.className} title={display}>
        {display || '—'}
      </span>
    );
  return (
    <EditableNativeCanvasInlineCell
      {...props}
      context={context}
      display={display}
      key={JSON.stringify([context.userId, context.snapshot.project.id, nativeInlineKey(target)])}
    />
  );
}

function EditableNativeCanvasInlineCell({
  document,
  target,
  context,
  onSelect,
  onAdvancedFormat,
  label,
  display,
  title = false,
  className,
}: NativeCanvasInlineCellProps & { context: NativeEditorContext; display: string }) {
  const { t } = useI18n();
  const input = nativeInlineInput(document, target);
  const key = nativeInlineKey(target);
  const typeCell = target.mode === 'physical' && target.field === 'format' && !!input.column;
  const root = useRef<HTMLSpanElement>(null);
  const latest = useRef({ context, document, target, onAdvancedFormat });
  useLayoutEffect(() => {
    latest.current = { context, document, target, onAdvancedFormat };
  });
  const active = useRef(true);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NativeEditorDraft | null>(null);
  const current = useRef<NativeEditorDraft | null>(null);
  const original = useRef<NativeEditorDraft | null>(null);
  const composing = useRef(false);
  const deferredBlur = useRef(false);
  const restoring = useRef(false);
  const returningFromAdvanced = useRef(false);
  const pending = useRef(false);
  const finishing = useRef(false);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [saving, setSaving] = useState(false);
  const dirty =
    !!draft &&
    Object.keys(draft.values).some((field) => draft.values[field] !== draft.before[field]);
  useNativeExportBlocker(
    context.userId,
    context.snapshot.project.id,
    dirty,
    !!storageError,
    `editor:${key}`,
  );
  const fieldLabel =
    label ??
    t(
      target.field === 'name'
        ? '이름'
        : target.field === 'comment'
          ? '설명'
          : target.field === 'required'
            ? '필수'
            : typeCell
              ? '타입'
              : '의미 타입',
    );

  function fresh(): NativeEditorDraft {
    const {
      context: latestContext,
      document: latestDocument,
      target: latestTarget,
    } = latest.current;
    const snapshot = latestContext.snapshot;
    const value = nativeInlineInput(latestDocument, latestTarget).value;
    return {
      userId: latestContext.userId,
      projectId: snapshot.project.id,
      key,
      revision: nativeDurableId(),
      expected: {
        version: snapshot.project.version,
        sequence: snapshot.sequence,
        databaseRevision: snapshot.project.databaseRevision,
      },
      before: { value },
      values: { value },
    };
  }
  function persist(next: NativeEditorDraft) {
    current.current = next;
    setDraft(next);
    try {
      storeNativeEditorDraft(next);
      setStorageError('');
    } catch (failure) {
      setStorageError(message(failure));
    }
  }
  function begin() {
    if (!active.current || restoring.current || pending.current || latest.current.context.busy)
      return;
    try {
      const { context: ctx } = latest.current;
      const recovered = loadNativeEditorDraft(ctx.userId, ctx.snapshot.project.id, key);
      original.current = recovered;
      current.current = recovered ?? fresh();
      setDraft(current.current);
      finishing.current = false;
      deferredBlur.current = false;
      setError('');
      setEditing(true);
      onSelect?.(target);
    } catch (failure) {
      setStorageError(message(failure));
    }
  }
  function restoreFocus() {
    restoring.current = true;
    root.current?.focus();
    restoring.current = false;
  }
  useLayoutEffect(() => {
    if (editing || !restoring.current) return;
    restoreFocus();
  });
  function finish(returnFocus: boolean) {
    finishing.current = true;
    restoring.current = returnFocus;
    setEditing(false);
  }
  function change(value: string, query?: string) {
    const before = current.current;
    if (!active.current || !before || pending.current) return;
    persist({
      ...before,
      revision: nativeDurableId(),
      values: { value, ...(query === undefined ? {} : { query }) },
    });
  }
  function cancel() {
    if (!active.current) return;
    if (pending.current) {
      finish(true);
      return;
    }
    try {
      const before = original.current;
      if (before) persist({ ...before, revision: nativeDurableId() });
      else if (current.current) {
        const ref = current.current;
        discardNativeEditorDraft(ref.userId, ref.projectId, ref);
        current.current = null;
        setDraft(null);
        setStorageError('');
      }
      setError('');
      finish(true);
    } catch (failure) {
      setStorageError(message(failure));
    }
  }
  function advanced() {
    const {
      context: ctx,
      document: doc,
      target: selected,
      onAdvancedFormat: open,
    } = latest.current;
    if (!active.current || !open || pending.current) return;
    try {
      const { table, column } = nativeInlineInput(doc, selected);
      const chosen = current.current;
      const formatKey = `format:${column ? 'column' : 'table'}:${column?.id ?? table.id}`;
      // Hand off the selected type without replacing an existing advanced draft or its baseline.
      if (
        column &&
        chosen &&
        chosen.values.value !== chosen.before.value &&
        !loadNativeEditorDraft(ctx.userId, ctx.snapshot.project.id, formatKey)
      ) {
        const initial = nativeFormatInitial(table, column);
        storeNativeEditorDraft({
          ...chosen,
          key: formatKey,
          revision: nativeDurableId(),
          before: initial,
          values: { ...initial, typeChoice: chosen.values.value ?? '' },
        });
      }
      finish(false);
      returningFromAdvanced.current = true;
      open(selected, root.current ?? undefined);
    } catch (failure) {
      setStorageError(message(failure));
    }
  }
  async function commit(returnFocus: boolean) {
    if (!active.current || finishing.current || pending.current) return;
    const selected = current.current;
    if (!selected) return;
    if (composing.current) {
      deferredBlur.current = !returnFocus;
      return;
    }
    const { context: ctx, document: doc, target: selectedTarget } = latest.current;
    // Query text is durable input, but only a catalog selection can become a type command.
    if (typeCell && selected.values.query !== undefined) {
      setError(t('입력을 보관했습니다. 다시 포커스하여 수정하세요.'));
      finish(returnFocus);
      return;
    }
    if (selected.values.value === selected.before.value) {
      try {
        discardNativeEditorDraft(selected.userId, selected.projectId, selected);
        current.current = null;
        setDraft(null);
        finish(returnFocus);
      } catch (failure) {
        setStorageError(message(failure));
      }
      return;
    }
    const snapshot = ctx.snapshot;
    if (
      ctx.busy ||
      selected.userId !== ctx.userId ||
      selected.projectId !== snapshot.project.id ||
      selected.expected.version !== snapshot.project.version ||
      selected.expected.sequence !== snapshot.sequence ||
      selected.expected.databaseRevision !== snapshot.project.databaseRevision
    ) {
      setError(t('저장 기준이 변경되었습니다. 보관된 입력을 최신 내용과 비교해 주세요.'));
      finish(returnFocus);
      return;
    }
    try {
      storeNativeEditorDraft(selected);
      setStorageError('');
      const command = typeCell
        ? nativeInlineTypeCommand(doc, selectedTarget, selected.values.value ?? '')
        : nativeInlineCommand(doc, selectedTarget, selected.values.value ?? '');
      if (!command) {
        finish(returnFocus);
        return;
      }
      pending.current = true;
      setSaving(true);
      finish(returnFocus);
      const saved = await ctx.onSave([command], selected.expected, {
        key,
        revision: selected.revision,
      });
      if (!active.current || current.current?.revision !== selected.revision) return;
      if (saved) {
        discardNativeEditorDraft(selected.userId, selected.projectId, selected);
        current.current = null;
        setDraft(null);
        setError('');
      } else setError(t('입력을 보관했습니다. 다시 포커스하여 수정하세요.'));
    } catch (failure) {
      if (!active.current || current.current?.revision !== selected.revision) return;
      setError(message(failure));
      finish(returnFocus);
      if (typeCell && latest.current.onAdvancedFormat) advanced();
    } finally {
      pending.current = false;
      if (active.current) setSaving(false);
    }
  }
  function keyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (!editing) return;
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if (!typeCell && event.key === 'Enter') {
      event.preventDefault();
      void commit(true);
    }
  }
  return (
    <Tooltip content={`${fieldLabel}: ${display || t('미입력')}`}>
      <span
        ref={root}
        className={[
          title ? 'table-inline table-title-inline' : 'table-inline',
          typeCell ? 'table-type-trigger' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        data-inline-cell
        data-dirty={dirty || undefined}
        aria-label={fieldLabel}
        title={`${fieldLabel}: ${display || t('미입력')}`}
        tabIndex={editing || context.busy || saving ? -1 : 0}
        onFocus={(event) => {
          if (event.target !== event.currentTarget) return;
          if (returningFromAdvanced.current) returningFromAdvanced.current = false;
          else begin();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (!editing) begin();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (!editing) begin();
        }}
        onPointerDown={(event) => {
          if (editing) event.stopPropagation();
        }}
        onKeyDown={keyDown}
        onKeyDownCapture={(event) => {
          if (
            editing &&
            (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) &&
            (event.key === 'Enter' || event.key === 'Escape')
          )
            event.stopPropagation();
          else if (editing && event.key === 'Escape') keyDown(event);
          else if (editing && typeCell && event.altKey && event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            advanced();
          } else if (!editing && (event.key === 'F2' || event.key === 'Enter')) {
            event.preventDefault();
            event.stopPropagation();
            begin();
          }
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          if (deferredBlur.current) {
            deferredBlur.current = false;
            queueMicrotask(() => {
              if (active.current) void commit(false);
            });
          }
        }}
        onInputCapture={(event) => {
          if (typeCell && editing && event.target instanceof HTMLInputElement)
            change(current.current?.values.value ?? '', event.target.value);
        }}
      >
        {editing ? (
          typeCell ? (
            <>
              <SearchType
                value={draft?.values.value ?? input.value}
                options={nativeInlineTypeOptions(document, target)}
                label={fieldLabel}
                autoFocus
                showSearchIcon={false}
                onValueChange={(value) => change(value)}
                onEditEnd={(reason) => {
                  if (reason === 'escape') {
                    if (!composing.current) cancel();
                  } else void commit(reason === 'selection');
                }}
              />
              {onAdvancedFormat && (
                <Button
                  tabIndex={-1}
                  aria-label={t('고급 형식 편집')}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={advanced}
                >
                  …
                </Button>
              )}
            </>
          ) : (
            <Input
              autoFocus
              aria-label={fieldLabel}
              {...(title ? { className: 'table-title-input', maxLength: 120 } : {})}
              value={draft?.values.value ?? input.value}
              onChange={(event) => change(event.target.value)}
              onBlur={() => {
                void commit(false);
              }}
            />
          )
        ) : (
          display || '—'
        )}
        {draft?.values.query !== undefined && <span role="status">{draft.values.query}</span>}
        {(error || storageError) && <span role="alert">{error || storageError}</span>}
      </span>
    </Tooltip>
  );
}
