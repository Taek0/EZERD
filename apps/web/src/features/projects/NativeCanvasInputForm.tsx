import { useNativeAutosave, requiresNativeConfirmation } from './use-native-autosave.js';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type {
  NativeEditorCommand,
  NativePersonalCanvasCommand,
  ProjectDocumentState,
  NativeEditorDraftRef as DraftRef,
} from '@ezerd/contracts';
import { Button } from '../../components/ui/index.js';
import { useI18n } from '../../shared/i18n/index.js';
import { message } from '../../shared/api/client.js';
import {
  loadNativeEditorDraft,
  storeNativeEditorDraft,
  discardNativeEditorDraft,
  rebaseNativeEditorDraft,
  type NativeEditorDraft,
} from './native-editor-draft.js';
import { nativeDurableId } from './native-durable-queue.js';
import { useNativeExportBlocker } from './native-export-state.js';
type CanvasCommand = NativeEditorCommand | NativePersonalCanvasCommand;
export type NativeCanvasSubmit = () => Promise<void>;
const expected = (snapshot: ProjectDocumentState) => ({
  version: snapshot.project.version,
  sequence: snapshot.sequence,
  databaseRevision: snapshot.project.databaseRevision,
});
/** Canvas forms keep incomplete private/shared input without putting private commands in shared pending. */
export function NativeCanvasInputForm({
  context,
  title,
  draftKey,
  initial,
  disabled,
  build,
  children,
  onSubmitReady,
}: {
  context: {
    userId: string;
    snapshot: ProjectDocumentState;
    busy: boolean;
    affectsSharedDocument: boolean;
    onSave: (
      commands: CanvasCommand[],
      expectation: ReturnType<typeof expected>,
      ref: DraftRef,
    ) => Promise<boolean>;
  };
  title: string;
  draftKey: string;
  initial: Record<string, string>;
  disabled: boolean;
  build: (values: Record<string, string>) => CanvasCommand[];
  children: (
    values: Record<string, string>,
    change: (field: string, value: string) => void,
  ) => ReactNode;
  onSubmitReady?: (submit: NativeCanvasSubmit) => void;
}) {
  const { t } = useI18n();
  const currentExpected = expected(context.snapshot);
  const fresh = (): NativeEditorDraft => ({
    userId: context.userId,
    projectId: context.snapshot.project.id,
    key: draftKey,
    revision: nativeDurableId(),
    expected: currentExpected,
    before: { ...initial },
    values: { ...initial },
  });
  const [loaded] = useState(() => {
    try {
      const recovered =
        typeof localStorage === 'undefined'
          ? null
          : loadNativeEditorDraft(context.userId, context.snapshot.project.id, draftKey);
      return {
        draft: recovered ?? fresh(),
        recovery: !!recovered,
        error: '',
      };
    } catch (error) {
      return { draft: fresh(), recovery: true, error: message(error) };
    }
  });
  const [draft, setDraft] = useState(loaded.draft);
  const latest = useRef(loaded.draft);
  const recoveryInput = useRef(loaded.recovery);
  const [error, setError] = useState(loaded.error);
  const [storageError, setStorageError] = useState(loaded.error);
  const submitting = useRef(new Set<string>());
  const submitLatest = useRef<NativeCanvasSubmit>(async () => {});
  const dirty = [...new Set([...Object.keys(draft.values), ...Object.keys(draft.before)])].some(
    (key) => draft.values[key] !== draft.before[key],
  );
  useNativeExportBlocker(
    context.userId,
    context.snapshot.project.id,
    context.affectsSharedDocument && dirty,
    context.affectsSharedDocument && !!storageError,
    `canvas:${draftKey}`,
  );
  const stale =
    (!context.affectsSharedDocument &&
      (draft.expected.version !== currentExpected.version ||
        draft.expected.sequence !== currentExpected.sequence)) ||
    draft.expected.databaseRevision !== currentExpected.databaseRevision;
  function preserve(next: NativeEditorDraft) {
    latest.current = next;
    setDraft(next);
    try {
      storeNativeEditorDraft(next);
      setStorageError('');
    } catch (error) {
      setStorageError(message(error));
    }
  }
  const [confirmation, setConfirmation] = useState(false);
  const autosave = useNativeAutosave({
    blocked: context.busy || stale || disabled || !!storageError,
    getBlocked: (draining) => (!draining && context.busy) || stale || disabled || !!storageError,
    save: (draining) => handleSubmit(false, draining),
  });
  async function handleSubmit(confirmed = false, draining = false) {
    let captured = latest.current;
    if (
      (!draining && context.busy) ||
      stale ||
      disabled ||
      storageError ||
      submitting.current.has(captured.revision)
    )
      return;
    if (
      context.affectsSharedDocument &&
      (captured.expected.version !== currentExpected.version ||
        captured.expected.sequence !== currentExpected.sequence)
    ) {
      captured = { ...captured, revision: nativeDurableId(), expected: currentExpected };
      preserve(captured);
    }
    submitting.current.add(captured.revision);
    setError('');
    try {
      const commands = build(captured.values);
      if (requiresNativeConfirmation(commands) && !confirmed) {
        setConfirmation(true);
        return;
      }
      setConfirmation(false);
      try {
        storeNativeEditorDraft(captured);
      } catch (error) {
        setStorageError(message(error));
        return;
      }
      if (await context.onSave(commands, captured.expected, captured)) {
        discardNativeEditorDraft(context.userId, context.snapshot.project.id, captured);
        if (latest.current.revision === captured.revision) {
          recoveryInput.current = false;
          const next = {
            ...captured,
            revision: nativeDurableId(),
            before: { ...captured.values },
            values: { ...captured.values },
          };
          latest.current = next;
          setDraft(next);
        }
      }
    } catch (error) {
      if (latest.current.revision === captured.revision) setError(message(error));
    } finally {
      submitting.current.delete(captured.revision);
    }
  }
  useLayoutEffect(() => {
    const current = latest.current;
    const baselineChanged =
      current.expected.version !== currentExpected.version ||
      current.expected.sequence !== currentExpected.sequence ||
      current.expected.databaseRevision !== currentExpected.databaseRevision;
    const inputChanged = [
      ...new Set([...Object.keys(current.values), ...Object.keys(current.before)]),
    ].some((key) => current.values[key] !== current.before[key]);
    // Clean local forms can follow a new shared baseline. Recovery and private CAS
    // evidence still require an explicit review/reset, even when their values are clean.
    if (
      !baselineChanged ||
      inputChanged ||
      submitting.current.size > 0 ||
      storageError ||
      recoveryInput.current ||
      current.before.personalVersion !== initial.personalVersion ||
      current.before.privateVersion !== initial.privateVersion
    )
      return;
    const next = fresh();
    latest.current = next;
    setDraft(next);
  }, [
    currentExpected.version,
    currentExpected.sequence,
    currentExpected.databaseRevision,
    draft.revision,
    storageError,
    initial,
  ]);
  useLayoutEffect(() => {
    submitLatest.current = handleSubmit;
  });
  useLayoutEffect(() => {
    let active = true;
    onSubmitReady?.(() => (active ? submitLatest.current() : Promise.resolve()));
    return () => {
      active = false;
    };
  }, [onSubmitReady]);
  return (
    <form
      {...autosave.compositionProps}
      className="native-property-editor"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <fieldset disabled={context.busy}>
        <legend>{title}</legend>
        {(error || storageError) && <p role="alert">{error || storageError}</p>}
        {stale && (
          <div role="status">
            <p>{t('저장 기준이 변경되었습니다. 보관된 입력을 최신 내용과 비교해 주세요.')}</p>
            <dl>
              {Object.entries(initial)
                .filter(([key]) => key !== 'id')
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>
            <Button
              disabled={draft.expected.databaseRevision !== currentExpected.databaseRevision}
              onClick={() => {
                try {
                  preserve(
                    rebaseNativeEditorDraft(draft, currentExpected, {
                      ...initial,
                      id: draft.before.id ?? initial.id!,
                    }),
                  );
                } catch (error) {
                  setError(message(error));
                }
              }}
            >
              {t('최신 저장 내용과 비교 후 수정')}
            </Button>
          </div>
        )}
        {children(draft.values, (field, value) => {
          setConfirmation(false);
          autosave.markChanged();
          const current = latest.current;
          preserve({
            ...current,
            revision: nativeDurableId(),
            values: { ...current.values, [field]: value },
          });
        })}
        {confirmation && (
          <Button
            disabled={context.busy || stale || !!storageError}
            onClick={() => void handleSubmit(true)}
          >
            {t('삭제 실행 확인')}
          </Button>
        )}
      </fieldset>
    </form>
  );
}
