import { useRef, useState, type ReactNode } from 'react';
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
      return {
        draft:
          typeof localStorage === 'undefined'
            ? fresh()
            : (loadNativeEditorDraft(context.userId, context.snapshot.project.id, draftKey) ??
              fresh()),
        error: '',
      };
    } catch (error) {
      return { draft: fresh(), error: message(error) };
    }
  });
  const [draft, setDraft] = useState(loaded.draft);
  const latest = useRef(loaded.draft);
  const [error, setError] = useState(loaded.error);
  const [storageError, setStorageError] = useState(loaded.error);
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
    draft.expected.version !== currentExpected.version ||
    draft.expected.sequence !== currentExpected.sequence ||
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
  async function save() {
    if (context.busy || stale || disabled || storageError) return;
    const captured = latest.current;
    try {
      const commands = build(captured.values);
      try {
        storeNativeEditorDraft(captured);
      } catch (error) {
        setStorageError(message(error));
        return;
      }
      if (await context.onSave(commands, captured.expected, captured)) {
        discardNativeEditorDraft(context.userId, context.snapshot.project.id, captured);
        if (latest.current.revision === captured.revision) {
          const next = fresh();
          latest.current = next;
          setDraft(next);
        }
      }
    } catch (error) {
      setError(message(error));
    }
  }
  return (
    <form
      className="native-property-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
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
          const current = latest.current;
          preserve({
            ...current,
            revision: nativeDurableId(),
            values: { ...current.values, [field]: value },
          });
        })}
        <Button type="submit" disabled={context.busy || stale || disabled || !!storageError}>
          {t('저장 요청')}
        </Button>
        <Button
          disabled={!!storageError}
          onClick={() => {
            discardNativeEditorDraft(context.userId, context.snapshot.project.id, draft);
            const next = fresh();
            latest.current = next;
            setDraft(next);
            setError('');
          }}
        >
          {t('입력 초기화')}
        </Button>
      </fieldset>
    </form>
  );
}
