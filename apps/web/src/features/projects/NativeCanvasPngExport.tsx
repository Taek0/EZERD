import { useEffect, useRef, useState } from 'react';
import { sharedDocument, type NativeDesignDocument } from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
import { exportNativeCanvasPng } from './native-canvas-png.js';
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
});
export function NativeCanvasPngExport({
  snapshot,
  userId,
  viewId,
  mode,
  sceneFor,
}: {
  snapshot: ProjectDocumentState;
  userId?: string;
  viewId: string;
  mode: 'physical' | 'logical';
  sceneFor: typeof nativeCanvasScene;
}) {
  const { t } = useI18n(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const alive = useRef(true),
    identity = JSON.stringify([
      userId,
      snapshot.project.id,
      snapshot.project.version,
      snapshot.sequence,
      snapshot.project.databaseRevision,
      viewId,
      mode,
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
  const shared =
    snapshot.sourceDocument.schemaVersion === 2 &&
    (['overview', '__tables__'].includes(viewId) ||
      snapshot.sourceDocument.domains.some((domain) => domain.id === viewId));
  return (
    <>
      <Button
        disabled={busy || !shared}
        onClick={() => {
          if (snapshot.sourceDocument.schemaVersion !== 2 || !shared) return;
          const source: NativeDesignDocument = sharedDocument(snapshot.sourceDocument),
            scene = sceneFor(source, viewId, mode),
            current = () => alive.current && active.current.generation === generation;
          setBusy(true);
          setError('');
          void exportNativeCanvasPng(source, scene, mode, snapshot.project.name, current)
            .catch((error) => {
              if (current())
                setError(
                  error instanceof Error && error.message === 'canvas.export-empty'
                    ? '내보낼 카드가 없습니다.'
                    : error instanceof Error && error.message === 'canvas.export-size-limit'
                      ? '이미지가 너무 큽니다. 내보낼 범위를 줄여 주세요.'
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
      {!shared && <small>{t('공유 화면을 선택해 내보내 주세요.')}</small>}
      {error && <p role="alert">{t(error)}</p>}
    </>
  );
}
