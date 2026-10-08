import { useEffect, useId, useRef, useState } from 'react';
import type { NativeHistoryPage, ProjectDocumentState } from '@ezerd/contracts';
import { Button, Collapse, DisclosureButton, Select } from '../../components/ui/index.js';
import { message } from '../../shared/api/client.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { describeChanges, nativeHistoryPreview } from './native-history-labels.js';
import { nativeEditorExportBlocked } from './native-export-state.js';
import './native-history-dialog.css';
import {
  fetchNativeHistory,
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
  const { t } = useI18n(),
    dialog = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState<NativeHistoryPage | null>(null),
    [pending, setPending] = useState<NativeHistoryPending | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const active = useRef(true);
  const filterId = useId();
  const [filter, setFilter] = useState<NativeHistoryFilter>('all');
  // Presentation only: preserve the server's ascending page/cursor and undo ordering.
  const history = [...filterNativeHistory(page?.history ?? [], filter)].sort(
    (a, b) => b.sequence - a.sequence,
  );
  async function load(since = 0) {
    const next = await fetchNativeHistory(snapshot.project.id, since);
    setPage((old) =>
      since && old ? { ...next, history: [...old.history, ...next.history] } : next,
    );
  }
  async function act(source?: string, command?: 'undo' | 'restore') {
    setBusy(true);
    setError('');
    try {
      const input = pending ?? (await stageNativeHistory(userId, snapshot, source!, command!));
      setPending(input);
      const output = await sendNativeHistory(input);
      if (!active.current) return;
      setPending(null);
      onReload();
      if (output.result.status === 'accepted') onClose();
      else setError(t('변경 요청이 적용되지 않았습니다. 최신 이력을 확인해 주세요.'));
    } catch (cause) {
      if (!active.current) return;
      setError(message(cause));
      try {
        const stored = await loadNativeHistoryPending(userId, snapshot.project.id);
        if (active.current) setPending(stored);
      } catch (storageCause) {
        setError(message(storageCause));
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!embedded) dialog.current?.showModal();
    active.current = true;
    let alive = true;
    void loadNativeHistoryPending(userId, snapshot.project.id)
      .then((stored) => {
        if (alive) setPending(stored);
      })
      .catch((cause) => {
        if (alive) setError(message(cause));
      });
    void fetchNativeHistory(snapshot.project.id)
      .then((result) => {
        if (alive) setPage(result);
      })
      .catch((cause) => {
        if (alive) setError(message(cause));
      });
    return () => {
      active.current = false;
      alive = false;
      dialog.current?.close();
    };
  }, [userId, snapshot.project.id]);
  const content = (
    <>
      <h2 id="native-history-title">{t('설계 이력')}</h2>
      {error && <p role="alert">{error}</p>}
      {pending && (
        <div role="status">
          <p>{t('확인되지 않은 이력 변경 요청이 있습니다.')}</p>
          <Button disabled={busy} onClick={() => void act()}>
            {t('저장 결과 확인')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError('');
              void cancelNativeHistory(pending)
                .then(() => {
                  if (active.current) {
                    setPending(null);
                    onReload();
                  }
                })
                .catch((cause) => {
                  if (active.current) setError(message(cause));
                })
                .finally(() => {
                  if (active.current) setBusy(false);
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
              <NativeHistoryChanges
                lines={describeChanges(entry.changes, snapshot.sourceDocument, page?.history ?? [])}
              />
              {deleted && (
                <Button disabled={blocked} onClick={() => void act(entry.operationId, 'restore')}>
                  {t('삭제 복원')}
                </Button>
              )}
            </li>
          );
        })}
      </ol>
      {page?.nextSince !== null && page?.nextSince !== undefined && (
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void load(page.nextSince!)
              .catch((cause) => setError(message(cause)))
              .finally(() => setBusy(false));
          }}
        >
          {t('이력 더 보기')}
        </Button>
      )}
      <Button disabled={busy} onClick={onClose}>
        {t('닫기')}
      </Button>
    </>
  );
  return embedded ? (
    <div className="native-history-content">{content}</div>
  ) : (
    <dialog
      ref={dialog}
      className="project-ddl-dialog native-history-dialog"
      aria-labelledby="native-history-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {content}
    </dialog>
  );
}
