import { memo, useEffect, useMemo, useRef, type PointerEvent, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { relationLayoutSchema } from '@ezerd/contracts';
import type { NativeDesignDocument, RelationLayout } from '@ezerd/model';
import { NativeCanvasInputForm } from './NativeCanvasInputForm.js';
import { NativeEditorField } from './native-editor-form.js';
import {
  nativeRouteKey,
  nativeRouteCommand,
  nativeRouteGeometry,
  nativeRouteDrag,
  type NativeRouteScene,
} from './native-route-edit.js';
import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
registerTranslations({
  '관계선 경로 편집': 'Edit relationship route',
  '자동 경로로 복원': 'Restore automatic route',
  연결점: 'Connection point',
  '출발 연결점': 'Source connection point',
  '도착 연결점': 'Target connection point',
  '경로 구간': 'Route segment',
  '드래그 또는 방향키로 이동한 뒤 저장하세요.': 'Drag or use arrow keys, then save.',
  '개인 배치가 변경되었습니다. 입력을 보관한 뒤 초기화해 주세요.':
    'Personal layout changed. Preserve your input before resetting.',
});
type Context = ComponentProps<typeof NativeCanvasInputForm>['context'];
function RouteHandles({
  scene,
  relationId,
  route,
  world,
  change,
  disabled,
}: {
  scene: NativeRouteScene;
  relationId: string;
  route: RelationLayout;
  world: HTMLDivElement;
  change: (route: RelationLayout) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const drag = useRef<{
    pointerId: number;
    kind: number | 'source' | 'target';
    start: { x: number; y: number };
    route: RelationLayout;
    points: { x: number; y: number }[];
  } | null>(null);
  const geometry = nativeRouteGeometry(scene, relationId, route);
  const point = (event: PointerEvent<SVGGraphicsElement>) => {
    const matrix = event.currentTarget.getScreenCTM();
    return matrix
      ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      : null;
  };
  const handles = [
    { key: 'source' as const, point: geometry.points[0]!, label: t('출발 연결점') },
    { key: 'target' as const, point: geometry.points.at(-1)!, label: t('도착 연결점') },
    ...geometry.points.slice(0, -1).map((a, i) => ({
      key: i,
      point: {
        x: (a.x + geometry.points[i + 1]!.x) / 2,
        y: (a.y + geometry.points[i + 1]!.y) / 2,
      },
      label: `${t('경로 구간')} ${i + 1}`,
    })),
  ];
  return createPortal(
    <svg className="native-route-controls" onWheel={(e) => e.stopPropagation()}>
      <path className="native-route-preview" d={geometry.path} />
      {handles.map((handle) => (
        <circle
          key={handle.key}
          cx={handle.point.x}
          cy={handle.point.y}
          r={handle.key === 'source' || handle.key === 'target' ? 7 : 5}
          tabIndex={disabled ? -1 : 0}
          role="slider"
          aria-label={handle.label}
          aria-valuetext={`${Math.round(handle.point.x)}, ${Math.round(handle.point.y)}`}
          aria-valuenow={Math.round(handle.point.x)}
          aria-valuemin={-10000000}
          aria-valuemax={10000000}
          aria-disabled={disabled}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            const start = point(event);
            if (!start) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              pointerId: event.pointerId,
              kind: handle.key,
              start,
              route,
              points: geometry.points,
            };
          }}
          onPointerMove={(event) => {
            const d = drag.current;
            if (disabled || d?.pointerId !== event.pointerId) return;
            const next = point(event);
            if (next)
              change(nativeRouteDrag(scene, relationId, d.route, d.points, d.kind, next, d.start));
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointerId === event.pointerId) {
              drag.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={(event) => {
            if (disabled) return;
            const delta = (
              {
                ArrowLeft: [-1, 0],
                ArrowRight: [1, 0],
                ArrowUp: [0, -1],
                ArrowDown: [0, 1],
              } as Record<string, number[]>
            )[event.key];
            if (!delta) return;
            event.preventDefault();
            event.stopPropagation();
            const step = event.shiftKey ? 20 : 5;
            change(
              nativeRouteDrag(
                scene,
                relationId,
                route,
                geometry.points,
                handle.key,
                { x: handle.point.x + delta[0]! * step, y: handle.point.y + delta[1]! * step },
                handle.point,
              ),
            );
          }}
        />
      ))}
    </svg>,
    world,
  );
}
export const NativeRelationEditor = memo(function NativeRelationEditor({
  document,
  scene,
  viewId,
  relationId,
  world,
  context,
  personalVersion,
  onClose,
}: {
  document: NativeDesignDocument;
  scene: NativeRouteScene;
  viewId: string;
  relationId: string;
  world: HTMLDivElement | null;
  context: Context;
  personalVersion: number | undefined;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const saveContext = useMemo(
    () => ({
      ...context,
      onSave: async (...args: Parameters<Context['onSave']>) => {
        const saved = await context.onSave(...args);
        if (saved && active.current) onClose();
        return saved;
      },
    }),
    [context, onClose],
  );

  const existing = document.layout.relations?.find(
    (r) => r.viewId === viewId && r.relationId === relationId,
  ) ?? { viewId, relationId, offset: 0 };
  if (!scene.relations.some((item) => item.relation.id === relationId)) return null;
  return (
    <aside
      className="native-inline-editor native-route-editor"
      onWheel={(event) => event.stopPropagation()}
      role="dialog"
      aria-label={t('관계선 경로 편집')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="native-inline-heading">
        <strong>{t('관계선 경로 편집')}</strong>
        <Button onClick={onClose}>{t('닫기')}</Button>
      </div>
      <p>{t('드래그 또는 방향키로 이동한 뒤 저장하세요.')}</p>
      <NativeCanvasInputForm
        key={nativeRouteKey(viewId, relationId)}
        context={saveContext}
        title={t('관계선 경로 편집')}
        draftKey={nativeRouteKey(viewId, relationId)}
        initial={{
          route: JSON.stringify(existing),
          reset: 'false',
          personalVersion: String(personalVersion ?? ''),
        }}
        disabled={false}
        build={(values) => {
          if (values.personalVersion !== String(personalVersion ?? ''))
            throw Error(t('개인 배치가 변경되었습니다. 입력을 보관한 뒤 초기화해 주세요.'));
          return [
            nativeRouteCommand(
              document,
              viewId,
              relationId,
              values.route ?? '',
              values.reset === 'true',
            ),
          ];
        }}
      >
        {(values, change) => {
          const parsed = (() => {
            try {
              return relationLayoutSchema.safeParse(JSON.parse(values.route ?? ''));
            } catch {
              return null;
            }
          })();
          const raw = (() => {
            try {
              return JSON.parse(values.route ?? '');
            } catch {
              return null;
            }
          })();
          const editableAnchor = (key: 'sourceAnchor' | 'targetAnchor') => {
            const anchor = raw?.[key];
            return anchor && ['left', 'right', 'top', 'bottom'].includes(anchor.side)
              ? { side: anchor.side, ratio: typeof anchor.ratio === 'number' ? anchor.ratio : 0.5 }
              : existing[key];
          };
          const route: RelationLayout = parsed?.success
            ? parsed.data
            : {
                ...existing,
                offset: typeof raw?.offset === 'number' ? raw.offset : existing.offset,
                sourceAnchor: editableAnchor('sourceAnchor'),
                targetAnchor: editableAnchor('targetAnchor'),
              };
          const mismatch = values.personalVersion !== String(personalVersion ?? '');
          return (
            <>
              {mismatch && (
                <p role="alert">
                  {t('개인 배치가 변경되었습니다. 입력을 보관한 뒤 초기화해 주세요.')}
                </p>
              )}
              {!parsed?.success && <p role="alert">{t('경로 입력을 확인해 주세요.')}</p>}
              {parsed?.success && route && world && (
                <RouteHandles
                  scene={scene}
                  relationId={relationId}
                  route={values.reset === 'true' ? { viewId, relationId, offset: 0 } : route}
                  world={world}
                  disabled={context.busy || mismatch}
                  change={(next) => {
                    change('reset', 'false');
                    change('route', JSON.stringify(next));
                  }}
                />
              )}
              {route && (
                <>
                  <NativeEditorField
                    label="간격"
                    type="number"
                    value={String(route.offset)}
                    onChange={(value) => {
                      change('reset', 'false');
                      change('route', JSON.stringify({ ...route, offset: Number(value) }));
                    }}
                  />
                  {(['sourceAnchor', 'targetAnchor'] as const).map((key, index) => (
                    <div key={key}>
                      <NativeEditorField
                        label={index === 0 ? '출발 연결점' : '도착 연결점'}
                        value={route[key]?.side ?? 'auto'}
                        choices={['auto', 'left', 'right', 'top', 'bottom'].map((value) => ({
                          value,
                          label: value,
                        }))}
                        onChange={(side) => {
                          change('reset', 'false');
                          change(
                            'route',
                            JSON.stringify({
                              ...route,
                              [key]:
                                side === 'auto'
                                  ? undefined
                                  : { side, ratio: route[key]?.ratio ?? 0.5 },
                            }),
                          );
                        }}
                      />
                      {route[key] && (
                        <NativeEditorField
                          label="위치 (0–1)"
                          type="number"
                          value={String(route[key]!.ratio)}
                          onChange={(value) =>
                            change(
                              'route',
                              JSON.stringify({
                                ...route,
                                [key]: { ...route[key], ratio: Number(value) },
                              }),
                            )
                          }
                        />
                      )}
                    </div>
                  ))}
                </>
              )}
              <Button onClick={() => change('reset', 'true')}>{t('자동 경로로 복원')}</Button>
              {values.reset === 'true' && <p role="status">{t('자동 경로로 복원')}</p>}
            </>
          );
        }}
      </NativeCanvasInputForm>
    </aside>
  );
});
