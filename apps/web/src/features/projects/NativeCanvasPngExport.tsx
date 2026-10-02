import { useEffect, useRef, useState } from 'react';
import { requestFingerprint, sharedDocument } from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
import { exportNativeCanvasPng } from './native-canvas-png.js';
import {
  exportNativePrivateCanvasPng,
  prepareNativePrivatePng,
  type NativePngPersonalSnapshot,
} from './native-private-png.js';
import type { NativeDurableState } from './native-durable-queue.js';
import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
registerTranslations({
  'PNG 내보내기': 'Export PNG',
  'PNG 만드는 중…': 'Creating PNG…',
  '내보낼 카드가 없습니다.': 'There are no cards to export.',
  '이미지가 너무 큽니다. 내보낼 범위를 줄여 주세요.':
    'The image is too large. Export a smaller scope.',
  '화면 문맥이 바뀌어 내보내기를 중단했습니다.':
    'Export stopped because the active context changed.',
  '이미지를 만들지 못했습니다. 다시 시도해 주세요.': 'Could not create the image. Try again.',
  '공유 화면을 선택해 내보내 주세요.': 'Select a shared view to export.',
  '개인 화면을 불러온 뒤 PNG를 내보내 주세요.': 'Load your personal view before exporting PNG.',
  '저장된 개인 화면만 내보냅니다. 미저장 입력과 화면 확대·이동은 포함하지 않습니다.':
    'Exports your saved personal view. Unsaved input and local zoom or pan are excluded.',
  '개인 화면 저장 상태를 확인한 뒤 다시 내보내 주세요.':
    'Check the personal save status, then export again.',
  '저장된 개인 화면이 변경되었습니다. 최신 내용을 불러온 뒤 다시 내보내 주세요.':
    'Your saved personal view changed. Reload the latest content, then export again.',
});
export function NativeCanvasPngExport({
  snapshot,
  userId,
  viewId,
  mode,
  sceneFor,
  personal,
  personalBusy = false,
  writerState = 'unknown',
}: {
  snapshot: ProjectDocumentState;
  userId?: string;
  viewId: string;
  mode: 'physical' | 'logical';
  sceneFor: typeof nativeCanvasScene;
  personal?: NativePngPersonalSnapshot;
  personalBusy?: boolean;
  writerState?: NativeDurableState;
}) {
  const { t } = useI18n(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const shared =
    snapshot.sourceDocument.schemaVersion === 2 &&
    (['overview', '__tables__'].includes(viewId) ||
      snapshot.sourceDocument.domains.some((domain) => domain.id === viewId));
  const alive = useRef(true),
    identity = JSON.stringify([
      userId,
      snapshot.project.id,
      snapshot.project.version,
      snapshot.sequence,
      snapshot.project.databaseRevision,
      viewId,
      mode,
      requestFingerprint(sharedDocument(snapshot.sourceDocument)),
      shared ? null : personal?.version,
      !shared && personal ? requestFingerprint(personal.state) : null,
      shared ? null : personalBusy,
      shared ? null : writerState,
    ]),
    active = useRef({ identity, generation: 0 });
  if (active.current.identity !== identity)
    active.current = { identity, generation: active.current.generation + 1 };
  const generation = active.current.generation;
  useEffect(() => {
    setBusy(false);
    setError('');
  }, [identity]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  let privateReady = false;
  if (
    !shared &&
    userId &&
    personal &&
    !personalBusy &&
    ['empty', 'pending'].includes(writerState)
  ) {
    try {
      prepareNativePrivatePng(snapshot, personal, viewId);
      privateReady = true;
    } catch {
      /* Wait for a valid saved snapshot. */
    }
  }
  return (
    <>
      <Button
        disabled={busy || (!shared && !privateReady)}
        onClick={() => {
          if (snapshot.sourceDocument.schemaVersion !== 2 || (!shared && !privateReady)) return;
          const nativeSource = snapshot.sourceDocument;
          const current = () => alive.current && active.current.generation === generation;
          setBusy(true);
          setError('');
          void (async () => {
            if (!shared && userId && personal)
              return exportNativePrivateCanvasPng(
                userId,
                snapshot,
                personal,
                viewId,
                mode,
                sceneFor,
                current,
              );
            const source = sharedDocument(nativeSource);
            return exportNativeCanvasPng(
              source,
              sceneFor(source, viewId, mode),
              mode,
              snapshot.project.name,
              current,
            );
          })()
            .catch((error) => {
              if (current())
                setError(
                  error instanceof Error && error.message === 'canvas.export-empty'
                    ? '내보낼 카드가 없습니다.'
                    : error instanceof Error && error.message === 'canvas.export-size-limit'
                      ? '이미지가 너무 큽니다. 내보낼 범위를 줄여 주세요.'
                      : error instanceof Error && error.message === 'canvas.export-personal-changed'
                        ? '저장된 개인 화면이 변경되었습니다. 최신 내용을 불러온 뒤 다시 내보내 주세요.'
                        : error instanceof Error &&
                            error.message === 'canvas.export-private-writer-changed'
                          ? '개인 화면 저장 상태를 확인한 뒤 다시 내보내 주세요.'
                          : error instanceof Error &&
                              error.message === 'canvas.export-context-changed'
                            ? '화면 문맥이 바뀌어 내보내기를 중단했습니다.'
                            : '이미지를 만들지 못했습니다. 다시 시도해 주세요.',
                );
            })
            .finally(() => {
              if (current()) setBusy(false);
            });
        }}
      >
        {t(busy ? 'PNG 만드는 중…' : 'PNG 내보내기')}
      </Button>
      {!shared && (
        <small>
          {t(
            privateReady
              ? '저장된 개인 화면만 내보냅니다. 미저장 입력과 화면 확대·이동은 포함하지 않습니다.'
              : personalBusy || writerState === 'sending'
                ? '개인 화면 저장 상태를 확인한 뒤 다시 내보내 주세요.'
                : '개인 화면을 불러온 뒤 PNG를 내보내 주세요.',
          )}
        </small>
      )}
      {error && <p role="alert">{t(error)}</p>}
    </>
  );
}
