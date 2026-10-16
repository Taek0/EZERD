import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { NativeHistoryPage, ProjectDocumentState } from '@ezerd/contracts';
import { Button, Collapse, DisclosureButton, Select } from '../../components/ui/index.js';
import { message } from '../../shared/api/client.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { describeChanges, nativeHistoryPreview } from './native-history-labels.js';
import { nativeEditorExportBlocked } from './native-export-state.js';
import './native-history-dialog.css';
import {
  fetchRecentNativeHistory,
  loadNativeHistoryPending,
  sendNativeHistory,
  stageNativeHistory,
  cancelNativeHistory,
  type NativeHistoryPending,
  nativeHistoryFilters,
  filterNativeHistory,
  type NativeHistoryFilter,
} from './native-history.js';

registerTranslations({
  '설계 이력': 'Design history',
  '이력 더 보기': 'Load more history',
  '실행 취소': 'Undo',
  '삭제 복원': 'Restore deletion',
  '저장 결과 확인': 'Check save result',
  '확인되지 않은 이력 변경 요청이 있습니다.': 'A history change is unconfirmed.',
  '내 작업만 현재 설계의 충돌을 확인한 뒤 되돌릴 수 있습니다.':
    'Only your own operations can be compensated after checking the current design for conflicts.',
  '형식 변경 이전 이력': 'History from an earlier format',
  처리됨: 'Accepted',
  거부됨: 'Rejected',
  '변경 요청이 적용되지 않았습니다. 최신 이력을 확인해 주세요.':
    'The change was not applied. Review the latest history.',
  '요청 취소 확정': 'Confirm request cancellation',
  닫기: 'Close',
  '히스토리 동작 필터': 'History action filter',
  전체: 'All',
  추가: 'Add',
  수정: 'Edit',
  이동: 'Move',
  '크기 변경': 'Resize',
  '순서 변경': 'Reorder',
  삭제: 'Delete',
  관계: 'Relationships',
  '데이터베이스 변경': 'Database changes',
  '동작 필터': 'Action filter',
  '{shown} / {total}개': '{shown} / {total}',
  '일치하는 이력이 없습니다.': 'No matching history.',
  '최근 편집 순': 'Newest first',
  '이력을 불러오는 중입니다.': 'Loading history.',
  '다시 시도': 'Retry',
});
export function NativeHistoryChanges({ lines }: { lines: readonly string[] }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const { t } = useI18n();
  const preview = nativeHistoryPreview(lines);
  const list = (values: readonly string[]) => (
    <ul className="native-history-changes">
      {values.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ul>
  );
  return (
    <div>
      {!expanded && list(preview.lines)}
      {preview.expandable && (
        <>
          <DisclosureButton
            className="native-history-more"
            variant="ghost"
            expanded={expanded}
            controls={id}
            onClick={() => setExpanded(!expanded)}
          >
            {t(expanded ? '변경 내용 접기' : '변경 내용 더보기')}
          </DisclosureButton>
          <Collapse open={expanded} id={id}>
            {list(lines)}
          </Collapse>
        </>
      )}
    </div>
  );
}

export function NativeHistoryDialog({
  userId,
  snapshot,
  canEdit,
  onClose,
  onReload,
  embedded = false,
}: {
  embedded?: boolean;
  userId: string;
  snapshot: ProjectDocumentState;
  canEdit: boolean;
  onClose: () => void;
  onReload: () => void;
}) {
  const { t, locale } = useI18n(),
    dialog = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState<NativeHistoryPage | null>(null),
    [pending, setPending] = useState<NativeHistoryPending | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  const filterId = useId();
  const [filter, setFilter] = useState<NativeHistoryFilter>('all');
  const history = [...filterNativeHistory(page?.history ?? [], filter)].sort(
    (a, b) => b.sequence - a.sequence,
  );
  const descriptions = useMemo(
    () =>
      new Map(
        page?.history.map((entry) => [
          entry.operationId,
          describeChanges(entry.changes, snapshot.sourceDocument, page.history),
        ]) ?? [],
      ),
    [page, snapshot.sourceDocument, locale],
  );
  async function loadOlder(before: number) {
    const controller = request.current;
    if (!controller || controller.signal.aborted || loading) return;
    setLoading(true);
    setError('');
    try {
      const next = await fetchRecentNativeHistory(snapshot.project.id, {
        before,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setPage((old) =>
        old
          ? {
              ...next,
              history: [
                ...new Map(
                  [...old.history, ...next.history].map((entry) => [entry.operationId, entry]),
                ).values(),
              ],
            }
          : next,
      );
    } catch (cause) {
      if (!controller.signal.aborted) setError(message(cause));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  async function act(source?: string, command?: 'undo' | 'restore') {
    const controller = request.current;
    const current = () =>
      active.current && controller === request.current && !controller?.signal.aborted;
    setBusy(true);
    setError('');
    try {
      const input = pending ?? (await stageNativeHistory(userId, snapshot, source!, command!));
      if (!current()) return;
      setPending(input);
      const output = await sendNativeHistory(input);
      if (!current()) return;
      setPending(null);
      onReload();
      if (output.result.status === 'accepted') onClose();
      else setError(t('변경 요청이 적용되지 않았습니다. 최신 이력을 확인해 주세요.'));
    } catch (cause) {
      if (!current()) return;
      setError(message(cause));
      try {
        const stored = await loadNativeHistoryPending(userId, snapshot.project.id);
        if (current()) setPending(stored);
      } catch (storageCause) {
        if (current()) setError(message(storageCause));
      }
    } finally {
      if (current()) setBusy(false);
    }
  }
  useEffect(() => {
    if (!embedded) dialog.current?.showModal();
    active.current = true;
    let alive = true;
    setPage(null);
    setPending(null);
    setError('');
    void loadNativeHistoryPending(userId, snapshot.project.id)
      .then((stored) => {
        if (alive) setPending(stored);
      })
      .catch((cause) => {
        if (alive) setError(message(cause));
      });
    return () => {
      active.current = false;
      alive = false;
      dialog.current?.close();
    };
  }, [userId, snapshot.project.id, embedded]);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    setBusy(false);
    setLoading(true);
    setError('');
    void fetchRecentNativeHistory(snapshot.project.id, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setPage((old) => {
          if (!old) return result;
          const existing = new Set(old.history.map((entry) => entry.operationId));
          // Keep the contiguous older range only when the new head joins it.
          // A gap must restart pagination, otherwise intermediate edits disappear.
          if (!result.history.some((entry) => existing.has(entry.operationId))) return result;
          return {
            ...result,
            nextBefore: old.nextBefore,
            history: [
              ...new Map(
                [...old.history, ...result.history].map((entry) => [entry.operationId, entry]),
              ).values(),
            ],
          };
        });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId, snapshot.project.id, snapshot.sequence, retry]);
  const content = (
    <>
      <h2 id="native-history-title">{t('설계 이력')}</h2>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">{t('이력을 불러오는 중입니다.')}</p>}
      {!loading && error && (
        <Button onClick={() => setRetry((value) => value + 1)}>{t('다시 시도')}</Button>
      )}
      {pending && (
        <div role="status">
          <p>{t('확인되지 않은 이력 변경 요청이 있습니다.')}</p>
          <Button disabled={busy} onClick={() => void act()}>
            {t('저장 결과 확인')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              const controller = request.current;
              const current = () =>
                active.current && controller === request.current && !controller?.signal.aborted;
              setBusy(true);
              setError('');
              void cancelNativeHistory(pending)
                .then(() => {
                  if (current()) {
                    setPending(null);
                    onReload();
                  }
                })
                .catch((cause) => {
                  if (current()) setError(message(cause));
                })
                .finally(() => {
                  if (current()) setBusy(false);
                });
            }}
          >
            {t('요청 취소 확정')}
          </Button>
        </div>
      )}
      <div className="native-history-filter-bar">
        <label htmlFor={filterId}>{t('동작 필터')}</label>
        <Select
          id={filterId}
          aria-label={t('히스토리 동작 필터')}
          value={filter}
          onValueChange={(value) => setFilter(value as NativeHistoryFilter)}
        >
          {nativeHistoryFilters.map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </Select>
        <span className="native-history-count" role="status">
          {t('{shown} / {total}개', {
            shown: history.length,
            total: page?.history.length ?? 0,
          })}
        </span>
      </div>
      <p className="native-history-order">{t('최근 편집 순')}</p>
      {page && history.length === 0 && <p>{t('일치하는 이력이 없습니다.')}</p>}
      <ol className="native-history-list" aria-label={t('설계 이력')} tabIndex={0}>
        {history.map((entry) => {
          const own = entry.result.actor.id === userId,
            native = entry.format === 'native',
            accepted = entry.result.status === 'accepted';
          const blocked =
            busy ||
            !!pending ||
            !canEdit ||
            !own ||
            !native ||
            !accepted ||
            snapshot.project.status !== 'active' ||
            nativeEditorExportBlocked(userId, snapshot.project.id);
          const deleted = entry.changes.some((change) => change.afterExists === false);
          return (
            <li key={entry.operationId} value={entry.sequence}>
              <span>
                {entry.sequence} · {entry.result.actor.username} ·{' '}
                {new Date(entry.result.createdAt).toLocaleString()} ·{' '}
                {t(accepted ? '처리됨' : '거부됨')}
              </span>
              {!native && <span> · {t('형식 변경 이전 이력')}</span>}
              <NativeHistoryChanges lines={descriptions.get(entry.operationId) ?? []} />
              {deleted && (
                <Button disabled={blocked} onClick={() => void act(entry.operationId, 'restore')}>
                  {t('삭제 복원')}
                </Button>
              )}
            </li>
          );
        })}
      </ol>
      {page?.nextBefore !== null && page?.nextBefore !== undefined && (
        <Button disabled={busy || loading} onClick={() => void loadOlder(page.nextBefore!)}>
          {t('이력 더 보기')}
        </Button>
      )}
      <Button disabled={busy} onClick={onClose}>
        {t('닫기')}
      </Button>
    </>
  );
  return embedded ? (
    <div className="native-history-content" onWheel={(event) => event.stopPropagation()}>
      {content}
    </div>
  ) : (
    <dialog
      ref={dialog}
      className="project-ddl-dialog native-history-dialog"
      aria-labelledby="native-history-title"
      onWheel={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {content}
    </dialog>
  );
}
