import { Dialog, DialogTrigger } from 'react-aria-components';
import { UntitledPopover } from './components/ui/untitled.js';
import { describeChanges, describeDeletedValues, historyMessage } from './sync-history-labels.js';
import './sync-history-panel.css';
import type { SyncSnapshot } from './sync-client.js';
import { Button } from './components/ui/index.js';

const date = (value: string | number) =>
  new Date(value).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
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
  const unresolvedCount =
    props.snapshot?.pending.filter((item) => item.state === 'unresolved').length ?? 0;
  return (
    <DialogTrigger>
      <Button className="sync-history-trigger" aria-haspopup="dialog">
        히스토리{unresolvedCount ? ` ${unresolvedCount}` : ''}
      </Button>
      <UntitledPopover className="sync-history-popover" placement="bottom end" offset={10}>
        <Dialog aria-label="히스토리" className="sync-history-dialog">
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
  const deletions = snapshot?.history.filter((entry) => entry.changes.some(isDeletion)) ?? [];
  const changes = snapshot?.history.filter((entry) => !entry.changes.some(isDeletion)) ?? [];
  const unresolved = snapshot?.pending.filter((item) => item.state === 'unresolved') ?? [];
  return (
    <div className="sync-history-panel sync-history-content">
      <h2>히스토리</h2>
      {notice && (
        <p className="sync-history-notice" role="status">
          {historyMessage(notice)}
        </p>
      )}
      <section>
        <h3>
          미반영 편집 <span>{unresolved.length}</span>
        </h3>
        {!unresolved.length ? (
          <p>미반영 편집이 없습니다.</p>
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
                {historyMessage(item.reason ?? '자동 반영할 수 없습니다.')} · {date(item.createdAt)}
              </small>
              <div className="sync-history-actions">
                <Button
                  disabled={!onReapply || activeOperationId === item.operationId}
                  onClick={() => onReapply?.(item.operationId)}
                >
                  재적용
                </Button>
                <Button
                  onClick={() => {
                    void navigator.clipboard.writeText(JSON.stringify(item.operation.changes));
                  }}
                >
                  변경 내용 복사
                </Button>
                <Button
                  variant="danger"
                  disabled={!onDiscard || activeOperationId === item.operationId}
                  onClick={() => onDiscard?.(item.operationId)}
                >
                  폐기
                </Button>
              </div>
            </article>
          ))
        )}
      </section>
      <section>
        <h3>
          삭제 <span>{deletions.length}</span>
        </h3>
        {!deletions.length ? (
          <p>최근 삭제가 없습니다.</p>
        ) : (
          deletions
            .slice(-20)
            .reverse()
            .map((entry) => (
              <article key={entry.operationId}>
                <strong>
                  {describeChanges(
                    entry.changes.filter(isDeletion),
                    snapshot!.document,
                    snapshot!.history,
                  ).join(', ')}
                </strong>
                <small>
                  {entry.actor.username} · {date(entry.createdAt)}
                </small>
                <details className="sync-history-preview">
                  <summary>삭제 당시 내용 미리보기</summary>
                  {entry.changes.filter(isDeletion).map((change) => (
                    <p key={change.path}>
                      {describeDeletedValues(change, snapshot!.document, snapshot!.history).join(
                        ' · ',
                      )}
                    </p>
                  ))}
                </details>
                <div className="sync-history-actions">
                  <Button
                    disabled={!onRestore || activeOperationId === entry.operationId}
                    onClick={() => onRestore?.(entry.operationId)}
                  >
                    {activeOperationId === entry.operationId ? '복원 중…' : '새 객체로 복원'}
                  </Button>
                </div>
              </article>
            ))
        )}
      </section>
      <section>
        <h3>
          변경 <span>{changes.length}</span>
        </h3>
        {!changes.length ? (
          <p>최근 변경이 없습니다.</p>
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
      <Button onClick={onClose}>닫기</Button>
    </div>
  );
}
