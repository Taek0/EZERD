import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';

registerTranslations({
  '관계선 정리 중…': 'Arranging relation lines…',
  '관계선을 정리했어요': 'Relation lines arranged',
  '연결 구조가 변경되어 정리를 중단했어요':
    'Arrangement stopped because the connection structure changed',
  '관계선을 정리하지 못했어요. 다시 시도해 주세요.':
    'Could not arrange relation lines. Please try again.',
  '연결되면 정리 결과를 저장할게요': 'Arrangement will be saved when connected',
  '관계선 정리를 취소했어요': 'Relation arrangement cancelled',
  '관계선 정리 결과를 저장 중…': 'Saving relation arrangement…',
  '실행 취소': 'Undo',
  '카드 크기가 변경되어 정리를 중단했어요. 다시 실행해 주세요.':
    'Arrangement stopped because card sizes changed. Please run it again.',
  '화면이 변경되어 정리를 중단했어요': 'Arrangement stopped because the view changed',
  '관계선이 수정되어 최신 배치를 유지했어요':
    'Relation lines changed. The latest arrangement was preserved.',
  '정리 결과가 저장 한도를 초과했어요': 'The arrangement exceeds the save limit',
  '최신 변경사항을 반영해 저장 중…': 'Saving with the latest changes…',
  '{table} 주변 공간이 부족해요': 'There is not enough space around {table}',
  '{table} 외 {count}개 테이블 주변 공간이 부족해요':
    'There is not enough space around {table} and {count} other tables',
  '관계선 정리 결과를 저장하지 못했어요': 'Could not save the relation arrangement',

  취소: 'Cancel',
});

export interface RelationArrangeNotice {
  phase:
    'idle' | 'computing' | 'saving' | 'saved' | 'invalidated' | 'failed' | 'offline' | 'cancelled';
  reason?: string;
  canUndo: boolean;
  canCancel?: boolean;
  progress?: string;
  crowdedTableIds?: string[];
}
export function NativeRelationArrangeToast({
  status,
  onCancel,
  onUndo,
  crowdedTableNames = [],
}: {
  status: RelationArrangeNotice;
  crowdedTableNames?: string[];
  onCancel: () => void;
  onUndo: () => void;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(status.phase !== 'idle' && status.phase !== 'computing');
    if (status.phase === 'idle') return;
    // A pending operation must keep its cancellation action reachable until resolved.
    if ((status.phase === 'saving' || status.phase === 'offline') && status.canCancel) return;
    const timer = window.setTimeout(
      () => setVisible(status.phase === 'computing'),
      status.phase === 'computing' ? 250 : 8000,
    );
    return () => window.clearTimeout(timer);
  }, [status.phase, status.reason, status.canCancel]);
  const defaultText = {
    idle: '',
    computing: '관계선 정리 중…',
    saving: '관계선 정리 결과를 저장 중…',
    saved: '관계선을 정리했어요',
    invalidated: '연결 구조가 변경되어 정리를 중단했어요',
    failed: '관계선을 정리하지 못했어요. 다시 시도해 주세요.',
    offline: '연결되면 정리 결과를 저장할게요',
    cancelled: '관계선 정리를 취소했어요',
  }[status.phase];
  const reasonText: Record<string, string> = {
    size: '카드 크기가 변경되어 정리를 중단했어요. 다시 실행해 주세요.',
    structure: '연결 구조가 변경되어 정리를 중단했어요',
    scope: '화면이 변경되어 정리를 중단했어요',
    route: '관계선이 수정되어 최신 배치를 유지했어요',
    limit: '정리 결과가 저장 한도를 초과했어요',
    save: '관계선 정리 결과를 저장하지 못했어요',
  };
  const text =
    crowdedTableNames.length && (status.phase === 'saved' || status.reason === 'space')
      ? t(
          crowdedTableNames.length === 1
            ? '{table} 주변 공간이 부족해요'
            : '{table} 외 {count}개 테이블 주변 공간이 부족해요',
          { table: crowdedTableNames[0]!, count: crowdedTableNames.length - 1 },
        )
      : t(
          status.progress === 'retrying'
            ? '최신 변경사항을 반영해 저장 중…'
            : (reasonText[status.reason ?? ''] ?? defaultText),
        );
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={visible ? 'native-arrange-toast' : 'sr-only'}
    >
      {visible && (
        <>
          {status.phase === 'computing' && (
            <span className="native-arrange-spinner" aria-hidden="true" />
          )}
          <span className="native-arrange-toast-message">{text}</span>
          {status.phase === 'computing' || status.canCancel ? (
            <Button onClick={onCancel}>{t('취소')}</Button>
          ) : status.canUndo ? (
            <Button onClick={onUndo}>{t('실행 취소')}</Button>
          ) : null}
        </>
      )}
    </div>
  );
}
