import { useEffect, useRef, useState } from 'react';
import type { NativeCanvasPersonalPending, ProjectDocumentState } from '@ezerd/contracts';
import { Button } from '../../components/ui/index.js';
import { message } from '../../shared/api/client.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import {
  discardArchivedNativePrivateCAS,
  loadNativePrivateCASArchive,
  verifyNativePrivateCASPrecondition,
  type NativePrivateCASArchive,
  type NativePrivateCASOptions,
} from './native-private-cas-proof.js';

registerTranslations({
  '개인 요청의 저장 기준 확인': 'Check the personal request precondition',
  '기준 확인': 'Check precondition',
  '저장 여부는 미확인이지만 원요청은 이후 적용될 수 없습니다.':
    'The save outcome is unconfirmed, but the original request cannot apply later.',
  '원요청과 입력을 이 브라우저에 보관했습니다.':
    'The original request and input are archived in this browser.',
  '아직 원요청의 저장 기준이 남아 있습니다. 동일 요청의 결과 확인·재시도를 사용해 주세요.':
    'The original precondition is still open. Use result recovery or retry for the same request.',
  '보관된 입력 보기': 'View archived input',
  '보관 후 대기 요청 해제': 'Release the archived pending request',
  '이전에 보관한 입력이 있습니다. 해제 전에 현재 기준을 다시 확인해 주세요.':
    'Archived input exists. Recheck the current precondition before releasing the request.',
});

/** Parent owns the pending card connection; this never invokes PUT or native cancellation. */
export function NativePrivateCASRecovery({
  userId,
  snapshot,
  pending,
  disabled = false,
  options = {},
  onDiscard,
  onArchive,
}: {
  userId: string;
  snapshot: ProjectDocumentState;
  pending: NativeCanvasPersonalPending;
  disabled?: boolean;
  options?: NativePrivateCASOptions;
  onDiscard?: (archive: NativePrivateCASArchive) => void;
  onArchive?: (archive: NativePrivateCASArchive) => void;
}) {
  const { t } = useI18n();
  const identity = JSON.stringify([
    userId,
    snapshot.project.id,
    pending.revision,
    snapshot.project.databaseRevision,
    snapshot.project.version,
    snapshot.sequence,
  ]);
  const active = useRef(identity);
  active.current = identity;
  const alive = useRef(true);
  const [busy, setBusy] = useState(false),
    [archive, setArchive] = useState<NativePrivateCASArchive | null>(null),
    [verified, setVerified] = useState(false),
    [open, setOpen] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setVerified(false);
    setOpen(false);
    setBusy(false);
    setError('');
    try {
      setArchive(loadNativePrivateCASArchive(pending, options.storage));
    } catch (cause) {
      setArchive(null);
      setError(message(cause));
    }
  }, [identity]);
  const scoped = (captured: string): NativePrivateCASOptions => ({
    ...options,
    assertCurrent: () => {
      if (!alive.current || active.current !== captured)
        throw Error('native.private-proof-scope-changed');
      options.assertCurrent?.();
    },
  });
  async function check() {
    const captured = identity;
    setBusy(true);
    setError('');
    setVerified(false);
    try {
      const result = await verifyNativePrivateCASPrecondition(
        userId,
        snapshot,
        pending,
        scoped(captured),
      );
      if (!alive.current || active.current !== captured) return;
      setOpen(result.outcome === 'unconfirmed');
      if (result.outcome === 'cas-precondition-consumed') {
        setArchive(result.archive);
        setVerified(true);
        onArchive?.(result.archive);
      }
    } catch (cause) {
      if (alive.current && active.current === captured) setError(message(cause));
    } finally {
      if (alive.current && active.current === captured) setBusy(false);
    }
  }
  async function release() {
    if (!verified) return;
    const captured = identity;
    setBusy(true);
    setError('');
    try {
      const saved = await discardArchivedNativePrivateCAS(
        userId,
        snapshot,
        pending,
        scoped(captured),
      );
      if (alive.current && active.current === captured) {
        setVerified(false);
        onDiscard?.(saved);
      }
    } catch (cause) {
      if (alive.current && active.current === captured) setError(message(cause));
    } finally {
      if (alive.current && active.current === captured) setBusy(false);
    }
  }
  return (
    <section aria-label={t('개인 요청의 저장 기준 확인')}>
      <Button disabled={disabled || busy} onClick={() => void check()}>
        {t('기준 확인')}
      </Button>
      {error && <p role="alert">{error}</p>}
      {open && (
        <p role="status">
          {t(
            '아직 원요청의 저장 기준이 남아 있습니다. 동일 요청의 결과 확인·재시도를 사용해 주세요.',
          )}
        </p>
      )}
      {archive && (
        <>
          <p role="status">
            {t(
              verified
                ? '저장 여부는 미확인이지만 원요청은 이후 적용될 수 없습니다.'
                : '이전에 보관한 입력이 있습니다. 해제 전에 현재 기준을 다시 확인해 주세요.',
            )}
          </p>
          <p>{t('원요청과 입력을 이 브라우저에 보관했습니다.')}</p>
          <details>
            <summary>{t('보관된 입력 보기')}</summary>
            <ul>
              {archive.pending.state.views.map((v) => (
                <li key={v.id}>{v.name}</li>
              ))}
              {archive.pending.state.notes.map((n) => (
                <li key={n.id}>{n.text}</li>
              ))}
              {archive.pending.state.viewports.map((v) => (
                <li key={v.viewId}>
                  {v.x}, {v.y}, {Math.round(v.zoom * 100)}%
                </li>
              ))}
            </ul>
          </details>
          <Button disabled={disabled || busy || !verified} onClick={() => void release()}>
            {t('보관 후 대기 요청 해제')}
          </Button>
        </>
      )}
    </section>
  );
}
