import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { NativeDomainFilterValue } from './NativeDomainFilter.js';
import { requestFingerprint, sharedDocument } from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
import { exportNativeCanvasPdf } from './native-canvas-pdf.js';
import { exportNativeCanvasSvg } from './native-canvas-svg.js';
import { exportNativeCanvasPng } from './native-canvas-png.js';
import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
registerTranslations({
  'PNG 내보내기': 'Export PNG',
  'SVG 내보내기': 'Export SVG',
  'SVG 만드는 중…': 'Creating SVG…',
  'SVG를 만들지 못했습니다. 다시 시도해 주세요.': 'Could not create the SVG. Try again.',
  'PDF 내보내기 · 한 페이지': 'Export PDF · Single page',
  'PDF 만드는 중…': 'Creating PDF…',
  'PDF를 만들지 못했습니다. 다시 시도해 주세요.': 'Could not create the PDF. Try again.',
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
  filter = null,
  renderControl,
}: {
  snapshot: ProjectDocumentState;
  userId?: string;
  viewId: string;
  mode: 'physical' | 'logical';
  sceneFor: typeof nativeCanvasScene;
  filter?: NativeDomainFilterValue | null;
  renderControl?: (png: {
    run: () => Promise<void>;
    runPdf: () => Promise<void>;
    runSvg: () => Promise<void>;
    disabled: boolean;
    busy: boolean;
  }) => ReactNode;
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
      filter,
      requestFingerprint(sharedDocument(snapshot.sourceDocument)),
      snapshot.native.status === 'available'
        ? requestFingerprint(sharedDocument(snapshot.native.document))
        : null,
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
  return (
    <>
      {(() => {
        const disabled = busy || !shared;
        const run = async (format: 'png' | 'pdf' | 'svg' = 'png') => {
          if (busy) return;
          if (snapshot.sourceDocument.schemaVersion !== 2 || !shared) return;
          const nativeSource = snapshot.sourceDocument;
          const current = () => alive.current && active.current.generation === generation;
          setBusy(true);
          setError('');
          await (async () => {
            // The read model includes normalized shared placements also used by the canvas.
            const source = sharedDocument(
              format !== 'png' && snapshot.native.status === 'available'
                ? snapshot.native.document
                : nativeSource,
            );
            const exporter = {
              png: exportNativeCanvasPng,
              pdf: exportNativeCanvasPdf,
              svg: exportNativeCanvasSvg,
            }[format];
            return exporter(
              source,
              sceneFor(source, viewId, mode, filter),
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
                      : error instanceof Error && error.message === 'canvas.export-context-changed'
                        ? '화면 문맥이 바뀌어 내보내기를 중단했습니다.'
                        : format === 'svg'
                          ? 'SVG를 만들지 못했습니다. 다시 시도해 주세요.'
                          : format === 'pdf'
                            ? 'PDF를 만들지 못했습니다. 다시 시도해 주세요.'
                            : '이미지를 만들지 못했습니다. 다시 시도해 주세요.',
                );
            })
            .finally(() => {
              if (current()) setBusy(false);
            });
        };
        return renderControl ? (
          renderControl({
            run: () => run('png'),
            runPdf: () => run('pdf'),
            runSvg: () => run('svg'),
            disabled,
            busy,
          })
        ) : (
          <>
            <Button disabled={disabled} onClick={() => void run().catch(() => {})}>
              {t(busy ? 'PNG 만드는 중…' : 'PNG 내보내기')}
            </Button>
            <Button disabled={disabled} onClick={() => void run('svg').catch(() => {})}>
              {t(busy ? 'SVG 만드는 중…' : 'SVG 내보내기')}
            </Button>
            <Button disabled={disabled} onClick={() => void run('pdf').catch(() => {})}>
              {t(busy ? 'PDF 만드는 중…' : 'PDF 내보내기 · 한 페이지')}
            </Button>
          </>
        );
      })()}
      {!shared && <small>{t('공유 화면을 선택해 내보내 주세요.')}</small>}
      {error && <p role="alert">{t(error)}</p>}
    </>
  );
}
