import { DialogTrigger, Dialog } from 'react-aria-components';
import { UntitledPopover } from '../../components/ui/untitled.js';
import { NativeHistoryDialog } from './NativeHistoryDialog.js';
import { useEffect, useRef, useState } from 'react';
import type { NativeHistoryPage, ProjectDocumentState } from '@ezerd/contracts';
import { Button, IconButton } from '../../components/ui/index.js';
import { useI18n } from '../../shared/i18n/index.js';
import { message } from '../../shared/api/client.js';
import { fetchNativeHistory, stageNativeHistory, sendNativeHistory } from './native-history.js';
import { nativeEditorExportBlocked } from './native-export-state.js';

export function nativeUndoCandidates(
  entries: NativeHistoryPage['history'],
  userId: string,
  localUndo: string[] = [],
) {
  const metadata = (entry: NativeHistoryPage['history'][number]) => {
    const raw = entry.deletionSnapshot;
    if (!raw || typeof raw !== 'object' || !('nativeHistory' in raw)) return null;
    const value = raw.nativeHistory;
    return value &&
      typeof value === 'object' &&
      'sourceOperationId' in value &&
      typeof value.sourceOperationId === 'string'
      ? value.sourceOperationId
      : null;
  };
  const consumed = new Set(
    entries
      .filter((entry) => entry.result.status === 'accepted')
      .map(metadata)
      .filter(Boolean),
  );
  return entries
    .filter(
      (entry) =>
        entry.format === 'native' &&
        entry.result.status === 'accepted' &&
        entry.result.actor.id === userId &&
        entry.changes.length &&
        !consumed.has(entry.operationId) &&
        (!metadata(entry) || localUndo.includes(entry.operationId)),
    )
    .sort((a, b) => a.sequence - b.sequence)
    .map((entry) => entry.operationId);
}

/** Uses the same durable, baseline-checked history path as the history panel. */
export function NativeHistoryControls({
  userId,
  snapshot,
  disabled,
  onReload,
  onHistory,
  historyOpen,
  onCloseHistory,
}: {
  historyOpen: boolean;
  onCloseHistory: () => void;
  userId: string;
  snapshot: ProjectDocumentState;
  disabled: boolean;
  onReload: () => void;
  onHistory: () => void;
}) {
  const { t } = useI18n();
  const [undo, setUndo] = useState<string[]>([]),
    [redo, setRedo] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState('');
  const localUndo = useRef<string[]>([]),
    ownSequence = useRef<number | null>(null),
    previousSequence = useRef(snapshot.sequence),
    mounted = useRef(true),
    sending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setReady(false);
    if (
      previousSequence.current !== snapshot.sequence &&
      ownSequence.current !== snapshot.sequence
    ) {
      setRedo([]);
      localUndo.current = [];
    }
    previousSequence.current = snapshot.sequence;
    void (async () => {
      let since = Math.max(0, snapshot.sequence - 100);
      const entries: NativeHistoryPage['history'] = [];
      for (let pages = 0; pages < 5; pages++) {
        const page = await fetchNativeHistory(snapshot.project.id, since);
        if (!active) return;
        if (page.sequence !== snapshot.sequence || page.version !== snapshot.project.version)
          return;
        entries.push(...page.history);
        if (page.nextSince === null) {
          setUndo(nativeUndoCandidates(entries, userId, localUndo.current));
          setReady(true);
          return;
        }
        if (page.nextSince <= since) throw Error('history.pagination-invalid');
        since = page.nextSince;
      }
    })().catch((cause) => {
      if (active) setError(message(cause));
    });
    return () => {
      active = false;
    };
  }, [
    userId,
    snapshot.project.id,
    snapshot.sequence,
    snapshot.project.version,
    snapshot.project.databaseRevision,
  ]);
  async function act(kind: 'undo' | 'redo') {
    const source = (kind === 'undo' ? undo : redo).at(-1);
    if (
      !source ||
      disabled ||
      !ready ||
      sending.current ||
      nativeEditorExportBlocked(userId, snapshot.project.id)
    )
      return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const pending = await stageNativeHistory(userId, snapshot, source, 'undo');
      const output = await sendNativeHistory(pending);
      if (!mounted.current) return;
      if (output.result.status !== 'accepted') {
        setError(t('변경 요청이 적용되지 않았습니다. 최신 이력을 확인해 주세요.'));
        return;
      }
      ownSequence.current = output.result.sequence;
      if (kind === 'undo') {
        setRedo((ids) => [...ids, output.result.operationId]);
        localUndo.current = localUndo.current.filter((id) => id !== source);
      } else {
        setRedo((ids) => ids.slice(0, -1));
        localUndo.current.push(output.result.operationId);
      }
      setReady(false);
      onReload();
    } catch (cause) {
      if (mounted.current) {
        setError(message(cause));
        onHistory();
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        disabled ||
        busy ||
        !ready ||
        historyOpen
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], dialog, [role="dialog"]',
        )
      )
        return;
      const key = event.key.toLowerCase();
      const kind =
        key === 'z'
          ? event.shiftKey
            ? 'redo'
            : 'undo'
          : key === 'y' && !event.shiftKey
            ? 'redo'
            : null;
      if (
        !kind ||
        !(kind === 'undo' ? undo : redo).length ||
        nativeEditorExportBlocked(userId, snapshot.project.id)
      )
        return;
      event.preventDefault();
      void act(kind);
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [disabled, busy, ready, historyOpen, undo, redo, userId, snapshot]);
  return (
    <>
      <div className="undo-controls" role="group" aria-label={t('변경 이력')}>
        <IconButton
          aria-label={t('실행 취소')}
          title={`${t('실행 취소')} (Ctrl/⌘ Z)`}
          tooltip={`${t('실행 취소')} (Ctrl/⌘ Z)`}
          aria-keyshortcuts="Control+Z Meta+Z"
          disabled={disabled || busy || !ready || !undo.length}
          onClick={() => void act('undo')}
        >
          ↶
        </IconButton>
        <IconButton
          aria-label={t('다시 실행')}
          title={`${t('다시 실행')} (Ctrl/⌘ Shift Z)`}
          tooltip={`${t('다시 실행')} (Ctrl/⌘ Shift Z)`}
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
          disabled={disabled || busy || !ready || !redo.length}
          onClick={() => void act('redo')}
        >
          ↷
        </IconButton>
        <DialogTrigger
          isOpen={historyOpen}
          onOpenChange={(open) => (open ? onHistory() : onCloseHistory())}
        >
          <Button disabled={busy}>{t('히스토리')}</Button>
          <UntitledPopover className="native-history-popover" placement="bottom end" offset={8}>
            <Dialog aria-label={t('히스토리')}>
              <NativeHistoryDialog
                embedded
                userId={userId}
                snapshot={snapshot}
                canEdit={!disabled}
                onReload={onReload}
                onClose={onCloseHistory}
              />
            </Dialog>
          </UntitledPopover>
        </DialogTrigger>
      </div>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
