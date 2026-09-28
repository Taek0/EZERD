import { translate as t, useI18n, getLocale } from '../../shared/i18n/index.js';
import './translations.js';
import { Dialog, DialogTrigger } from 'react-aria-components';
import { useState } from 'react';
import { isEffectiveChange } from '@ezerd/model';
import { UntitledPopover } from '../../components/ui/untitled.js';
import { describeChanges, describeDeletedValues, historyMessage } from './sync-history-labels.js';
import './sync-history-panel.css';
import type { SyncSnapshot } from './sync-client.js';
import { Button, TabButton } from '../../components/ui/index.js';
import type { HistoryChange } from './sync-history-labels.js';

const historyFilters = [
  ['all', '전체'],
  ['add', '추가'],
  ['edit', '수정'],
  ['move', '이동'],
  ['resize', '크기 변경'],
  ['reorder', '순서 변경'],
  ['delete', '삭제'],
] as const;
type HistoryFilter = (typeof historyFilters)[number][0];

function changeAction(change: HistoryChange): Exclude<HistoryFilter, 'all'> {
  const path = change.path.replace(/^\/layout/, '');
  if (/\/\@move\//.test(path)) return 'reorder';
  if (/^\/[^/]+\/[^/]+$/.test(path)) {
    if (change.afterExists === false || (change.after === null && change.before !== null))
      return 'delete';
    if (change.beforeExists === false || (change.before === null && change.after !== null))
      return 'add';
  }
  if (/^\/nodes\/[^/]+\/position(?:\/|$)/.test(path)) return 'move';
  if (/^\/nodes\/[^/]+\/size(?:\/|$)/.test(path)) return 'resize';
  return 'edit';
}

export function filterHistory<T extends { changes: readonly HistoryChange[] }>(
  history: readonly T[],
  filter: HistoryFilter,
): (T & { changes: HistoryChange[] })[] {
  return history
    .map((entry) => ({
      ...entry,
      changes: entry.changes.filter(
        (change) =>
          isEffectiveChange(change) && (filter === 'all' || changeAction(change) === filter),
      ),
    }))
    .filter((entry) => entry.changes.length > 0);
}

const date = (value: string | number) =>
  new Date(value).toLocaleString(getLocale() === 'en' ? 'en-US' : 'ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
const isDeletion = (change: {
  path: string;
  before: unknown;
  after: unknown;
  afterExists?: boolean | undefined;
}) =>
  /^\/(views|enums|tables|columns|keys|tableRelations|domains|domainRelations|notes)\/[^/]+$/.test(
    change.path,
  ) &&
  (change.afterExists === false || (change.after === null && change.before !== null));

type SyncHistoryPanelProps = {
  snapshot: SyncSnapshot | null;
  onRestore?: (operationId: string) => void;
  onReapply?: (operationId: string) => void;
  onDiscard?: (operationId: string) => void;
  activeOperationId?: string | null;
  notice?: string;
};

export function SyncHistoryPanel(props: SyncHistoryPanelProps) {
  useI18n();
  const unresolvedCount =
    props.snapshot?.pending.filter((item) => item.state === 'unresolved').length ?? 0;
  return (
    <DialogTrigger>
      <Button className="sync-history-trigger" aria-haspopup="dialog">
        {t('히스토리')}
        {unresolvedCount ? ` ${unresolvedCount}` : ''}
      </Button>
      <UntitledPopover className="sync-history-popover" placement="bottom end" offset={10}>
        <Dialog aria-label={t('히스토리')} className="sync-history-dialog">
          {({ close }) => <SyncHistoryContent {...props} onClose={close} />}
        </Dialog>
      </UntitledPopover>
    </DialogTrigger>
  );
}

export function SyncHistoryContent({
  snapshot,
  onRestore,
  onReapply,
  onDiscard,
  activeOperationId,
  notice,
  onClose,
}: SyncHistoryPanelProps & { onClose?: () => void }) {
  useI18n();
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [copyFeedback, setCopyFeedback] = useState<{
    operationId: string;
    message: string;
    manualValue?: string;
  } | null>(null);
  const history = filterHistory(snapshot?.history ?? [], filter);
  const deletions = history.filter((entry) => entry.changes.some(isDeletion));
  const changes = history.filter((entry) => !entry.changes.some(isDeletion));
  const unresolved = snapshot?.pending.filter((item) => item.state === 'unresolved') ?? [];
  async function copyChanges(operationId: string, changes: readonly HistoryChange[]) {
    const value = JSON.stringify(changes);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setCopyFeedback({ operationId, message: t('변경 내용을 복사했습니다.') });
    } catch {
      setCopyFeedback({
        operationId,
        message: t('자동 복사를 사용할 수 없습니다. 아래 내용을 선택해 Ctrl+C로 복사하세요.'),
        manualValue: value,
      });
    }
  }
  return (
    <div className="sync-history-panel sync-history-content">
      <h2>{t('히스토리')}</h2>
      {notice && (
        <p className="sync-history-notice" role="status">
          {historyMessage(notice)}
        </p>
      )}
      <section>
        <h3>
          {t('미반영 편집')}
          <span>{unresolved.length}</span>
        </h3>
        {!unresolved.length ? (
          <p>{t('미반영 편집이 없습니다.')}</p>
        ) : (
          unresolved.map((item) => (
            <article key={item.operationId}>
              <strong>
                {describeChanges(
                  item.operation.changes,
                  snapshot!.document,
                  snapshot!.history,
                ).join(', ')}
              </strong>
              <small>
                {historyMessage(item.reason ?? t('자동 반영할 수 없습니다.'))} ·{' '}
                {date(item.createdAt)}
              </small>
              <div className="sync-history-actions">
                <Button
                  disabled={!onReapply || activeOperationId === item.operationId}
                  onClick={() => onReapply?.(item.operationId)}
                >
                  {t('재적용')}
                </Button>
                <Button onClick={() => void copyChanges(item.operationId, item.operation.changes)}>
                  {t('변경 내용 복사')}
                </Button>
                <Button
                  variant="danger"
                  disabled={!onDiscard || activeOperationId === item.operationId}
                  onClick={() => onDiscard?.(item.operationId)}
                >
                  {t('폐기')}
                </Button>
              </div>
              {copyFeedback?.operationId === item.operationId && (
                <div className="sync-history-copy-feedback" role="status">
                  <p>{copyFeedback.message}</p>
                  {copyFeedback.manualValue && (
                    <textarea
                      aria-label={t('수동 복사용 변경 내용')}
                      readOnly
                      value={copyFeedback.manualValue}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  )}
                </div>
              )}
            </article>
          ))
        )}
      </section>
      <div className="sync-history-filters" role="group" aria-label={t('히스토리 동작 필터')}>
        {historyFilters.map(([value, label]) => (
          <TabButton key={value} selected={filter === value} onClick={() => setFilter(value)}>
            {t(label)}
          </TabButton>
        ))}
      </div>
      <p className="sync-history-filter-summary" role="status">
        {t(historyFilters.find(([value]) => value === filter)![1])} · {history.length}
        {t('건')}
      </p>
      <section>
        <h3>
          {t('삭제')}
          <span>{deletions.length}</span>
        </h3>
        {!deletions.length ? (
          <p>{t('최근 삭제가 없습니다.')}</p>
        ) : (
          deletions
            .slice(-20)
            .reverse()
            .map((entry) => (
              <article key={entry.operationId}>
                <strong>
                  {describeChanges(entry.changes, snapshot!.document, snapshot!.history).join(', ')}
                </strong>
                <small>
                  {entry.actor.username} · {date(entry.createdAt)}
                </small>
                <details className="sync-history-preview">
                  <summary>{t('삭제 당시 내용 미리보기')}</summary>
                  {entry.changes.filter(isDeletion).map((change) => (
                    <p key={change.path}>
                      {describeDeletedValues(change, snapshot!.document, snapshot!.history).join(
                        ' · ',
                      )}
                    </p>
                  ))}
                </details>
                {filter !== 'all' && (
                  <small>{t('복원은 이 편집에서 삭제된 객체 전체에 적용됩니다.')}</small>
                )}
                <div className="sync-history-actions">
                  <Button
                    disabled={!onRestore || activeOperationId === entry.operationId}
                    onClick={() => onRestore?.(entry.operationId)}
                  >
                    {activeOperationId === entry.operationId ? t('복원 중…') : t('새 객체로 복원')}
                  </Button>
                </div>
              </article>
            ))
        )}
      </section>
      <section>
        <h3>
          {t('변경')}
          <span>{changes.length}</span>
        </h3>
        {!changes.length ? (
          <p>{t('최근 변경이 없습니다.')}</p>
        ) : (
          changes
            .slice(-30)
            .reverse()
            .map((entry) => (
              <article key={entry.operationId}>
                <strong>
                  {describeChanges(entry.changes, snapshot!.document, snapshot!.history).join(', ')}
                </strong>
                <small>
                  {entry.actor.username} · {date(entry.createdAt)}
                </small>
              </article>
            ))
        )}
      </section>
      <Button onClick={onClose}>{t('닫기')}</Button>
    </div>
  );
}
