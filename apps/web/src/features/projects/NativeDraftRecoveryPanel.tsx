import { useEffect, useRef, useState } from 'react';
import { AnimatedDetails, Button, IconButton } from '../../components/ui/index.js';
import { requestFingerprint } from '@ezerd/model';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import {
  nativeDraftArchive,
  type NativeDraftArchiveEntry,
  type NativeDraftRecoveryRecord,
} from './native-draft-archive.js';
import {
  listNativeMemoryDrafts,
  forgetNativeMemoryDraft,
  subscribeNativeDraftMemory,
  type NativeDraftStorage,
} from './native-durable-drafts.js';

registerTranslations({
  '보관된 입력 복구': 'Recover preserved input',
  새로고침: 'Refresh',
  '보관된 입력 {count}개': '{count} preserved inputs',
  '입력 원문 보기': 'View original input',
  '속성 편집': 'Property changes',
  '설계 편집': 'Design changes',
  '저장하지 못한 입력': 'Unsaved input',
  '복구할 입력을 선택하세요. 원본을 보관한 채 사본을 만듭니다.':
    'Choose an input to recover. A copy is created and the original is kept.',
  '복구 후 내용을 확인하고 저장해 주세요.': 'Review the recovered input and save it.',
  '원문 다운로드': 'Download source',
  '복구 사본 만들기': 'Create recovery copy',
  '이 원문 폐기': 'Discard this source',
  '보관된 입력이 없습니다.': 'No preserved input.',
  '원래 저장 기준을 유지합니다. 복구 후 내용을 확인하고 명시적으로 저장해 주세요.':
    'The original save revision is preserved. Review recovered input and save explicitly.',
  '저장소를 읽지 못했습니다. 메모리 원문을 다운로드할 수 있습니다.':
    'Storage could not be read. You can download the source kept in memory.',
  '메모리 입력': 'Input in memory',
  '다른 저장 기준': 'Different save revision',
  '삭제되었거나 닫힌 편집 대상': 'Deleted object or closed editor',
  '이전 공유 저장소': 'Previous shared storage',
  '읽을 수 없는 원문': 'Unreadable source',
  '복구 사본을 만들었습니다. 원본도 보관됩니다.':
    'Recovery copy created. The source is also preserved.',
});
export interface NativeDraftRecoveryPanelProps {
  userId: string;
  projectId: string;
  currentExpected: { version: number; sequence: number; databaseRevision: number };
  /** Must consult the live account, not a captured render's user. */
  isActorCurrent: (userId: string) => boolean;
  onClose?: () => void;
  onRecovered: (entry: NativeDraftArchiveEntry) => void;
  isObjectAvailable?: (entry: NativeDraftArchiveEntry) => boolean;
  /** Live root routing/permission check, before any recovery copy changes the local head. */
  canRecover?: (entry: NativeDraftArchiveEntry) => boolean;
  storage?: NativeDraftStorage;
  onDownload?: (name: string, raw: string) => void;
}
function download(name: string, raw: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json;charset=utf-8' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
function draftInputTitle(entry: NativeDraftArchiveEntry): string | undefined {
  const values = entry.draft.values as Record<string, unknown>;
  for (const key of ['name', 'physicalName', 'logicalName', 'title']) {
    const value = values[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
export function NativeDraftRecoveryPanel(props: NativeDraftRecoveryPanelProps) {
  const { t } = useI18n();
  const latest = useRef(props);
  latest.current = props;
  const read = () => {
    let records: NativeDraftRecoveryRecord[] = [],
      error = '';
    // Rendering must not reveal the old account's records during a session change.
    if (!props.isActorCurrent(props.userId))
      return {
        records,
        memory: [],
        error: 'native.actor-mismatch',
        scope: [props.userId, props.projectId],
      };
    try {
      records = nativeDraftArchive(props.storage).records(props.userId, props.projectId);
    } catch {
      error = t('저장소를 읽지 못했습니다. 메모리 원문을 다운로드할 수 있습니다.');
    }
    return {
      records,
      memory: listNativeMemoryDrafts(props.userId, props.projectId, props.storage).filter(
        (value) => value.storageFailure,
      ),
      error,
      scope: [props.userId, props.projectId],
    };
  };
  const [state, setState] = useState(read);
  const [notice, setNotice] = useState('');
  const refresh = () => setState(read());
  useEffect(() => {
    refresh();
    const unsubscribe = subscribeNativeDraftMemory(refresh);
    globalThis.addEventListener?.('storage', refresh);
    return () => {
      unsubscribe();
      globalThis.removeEventListener?.('storage', refresh);
    };
  }, [props.userId, props.projectId, props.storage, props.isActorCurrent]);
  const act = (callback: () => void) => {
    try {
      if (
        latest.current.userId !== props.userId ||
        latest.current.projectId !== props.projectId ||
        latest.current.storage !== props.storage ||
        !latest.current.isActorCurrent(props.userId)
      )
        throw Error('native.actor-mismatch');
      callback();
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const visible =
    state.scope[0] === props.userId &&
    state.scope[1] === props.projectId &&
    props.isActorCurrent(props.userId);
  const records = visible ? state.records : [],
    memory = visible ? state.memory : [];
  return (
    <section aria-label={t('보관된 입력 복구')} className="native-draft-recovery">
      <header className="native-recovery-header">
        <div>
          <h3>{t('보관된 입력 복구')}</h3>
          <p>{t('복구할 입력을 선택하세요. 원본을 보관한 채 사본을 만듭니다.')}</p>
        </div>
        <div className="native-recovery-actions">
          <Button onClick={refresh}>{t('새로고침')}</Button>
          {props.onClose && (
            <IconButton aria-label={t('닫기')} onClick={props.onClose}>
              ×
            </IconButton>
          )}
        </div>
      </header>
      <p className="native-recovery-count">
        {t('보관된 입력 {count}개', { count: records.length + memory.length })} ·{' '}
        {t('복구 후 내용을 확인하고 저장해 주세요.')}
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!records.length && !memory.length && (
        <p className="native-recovery-empty">{t('보관된 입력이 없습니다.')}</p>
      )}
      <div className="native-recovery-list">
        {records.map((record) => (
          <article key={record.storageKey} className="native-recovery-card">
            <div className="native-recovery-card-heading">
              <strong>
                {record.entry
                  ? (draftInputTitle(record.entry) ??
                    t(record.entry.category === 'property' ? '속성 편집' : '설계 편집'))
                  : t('읽을 수 없는 원문')}
              </strong>
              {record.entry && (
                <time dateTime={record.entry.savedAt}>
                  {new Date(record.entry.savedAt).toLocaleString()}
                </time>
              )}
            </div>
            {record.legacy && <p className="panel-note">{t('이전 공유 저장소')}</p>}
            {record.entry &&
              requestFingerprint(record.entry.draft.expected) !==
                requestFingerprint(props.currentExpected) && <p>{t('다른 저장 기준')}</p>}
            {record.entry && props.isObjectAvailable && !props.isObjectAvailable(record.entry) && (
              <p>{t('삭제되었거나 닫힌 편집 대상')}</p>
            )}
            <AnimatedDetails className="native-recovery-source">
              <summary>{t('입력 원문 보기')}</summary>
              <p>{record.entry?.logicalKey}</p>
              <pre>{record.raw}</pre>
            </AnimatedDetails>
            <div className="native-recovery-actions">
              <Button
                onClick={() =>
                  act(() => (props.onDownload ?? download)('native-draft-source.json', record.raw))
                }
              >
                {t('원문 다운로드')}
              </Button>
              <Button
                variant="primary"
                disabled={
                  !record.entry || (props.canRecover ? !props.canRecover(record.entry) : false)
                }
                onClick={() =>
                  act(() => {
                    if (
                      !record.entry ||
                      (latest.current.canRecover && !latest.current.canRecover(record.entry))
                    )
                      throw Error('native.draft-recovery-unavailable');
                    const recovered = nativeDraftArchive(props.storage).recoverRecord(
                      props.userId,
                      props.projectId,
                      record,
                    );
                    props.onRecovered(recovered);
                    setNotice(t('복구 사본을 만들었습니다. 원본도 보관됩니다.'));
                  })
                }
              >
                {t('복구 사본 만들기')}
              </Button>
              <Button
                onClick={() =>
                  act(() =>
                    nativeDraftArchive(props.storage).dismiss(
                      props.userId,
                      props.projectId,
                      record,
                    ),
                  )
                }
              >
                {t('이 원문 폐기')}
              </Button>
            </div>
          </article>
        ))}
        {memory.map((item) => (
          <article key={item.key} className="native-recovery-card">
            <div className="native-recovery-card-heading">
              <strong>{t('저장하지 못한 입력')}</strong>
              <span>{t('메모리 입력')}</span>
            </div>
            <AnimatedDetails className="native-recovery-source">
              <summary>{t('입력 원문 보기')}</summary>
              <p>{item.key}</p>
              <pre>{JSON.stringify(item.value, null, 2)}</pre>
            </AnimatedDetails>
            <div className="native-recovery-actions">
              <Button
                onClick={() =>
                  act(() =>
                    (props.onDownload ?? download)(
                      'native-draft-memory.json',
                      JSON.stringify(item.value, null, 2),
                    ),
                  )
                }
              >
                {t('원문 다운로드')}
              </Button>
              <Button
                onClick={() =>
                  act(() => {
                    const current = listNativeMemoryDrafts(
                      props.userId,
                      props.projectId,
                      props.storage,
                    ).find((value) => value.key === item.key);
                    if (
                      !current ||
                      requestFingerprint(current.value) !== requestFingerprint(item.value)
                    )
                      throw Error('native.draft-changed');
                    forgetNativeMemoryDraft(item.key, props.storage);
                  })
                }
              >
                {t('이 원문 폐기')}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
