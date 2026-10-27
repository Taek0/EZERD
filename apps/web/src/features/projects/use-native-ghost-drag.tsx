import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { useI18n } from '../../shared/i18n/index.js';
import type { NodeLayout, Viewport } from '@ezerd/model';

type Session = {
  pointerId: number;
  x: number;
  y: number;
  zoom: number;
  nodes: NodeLayout[];
  cards: { title: string; color: string; textColor?: string }[];
  camera: Viewport;
  dx: number;
  dy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  pending: boolean;
  phase: 'dragging' | 'routing';
  controller: AbortController;
};
export function useNativeGhostDrag(options: {
  scope: readonly unknown[];
  camera: Viewport;
  describe: (node: NodeLayout) => { title: string; color: string; textColor?: string };
  commit: (placements: NodeLayout[], signal: AbortSignal) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const { t } = useI18n();
  const active = useRef<Session | null>(null);
  const [visible, setVisible] = useState<Session | null>(null);
  const hasVisibleSession = useRef(false);
  const layer = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const cancel = () => {
    active.current?.controller.abort();
    active.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (hasVisibleSession.current) {
      hasVisibleSession.current = false;
      setVisible(null);
    }
  };
  useLayoutEffect(() => {
    cancel();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && active.current) {
        event.preventDefault();
        cancel();
      }
    };
    const blur = () => {
      if (active.current?.phase === 'dragging') cancel();
    };
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('keydown', escape);
      window.addEventListener('blur', blur);
    }
    return () => {
      active.current?.controller.abort();
      active.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('keydown', escape);
        window.removeEventListener('blur', blur);
      }
    };
  }, options.scope);
  const paint = (session: Session) => {
    if (active.current !== session) return;
    frame.current = null;
    if (session && layer.current)
      layer.current.style.transform = `translate(${session.camera.x + session.dx * session.zoom}px, ${session.camera.y + session.dy * session.zoom}px) scale(${session.zoom})`;
  };
  const update = (event: PointerEvent<HTMLElement>, session: Session) => {
    const dx = (event.clientX - session.x) / session.zoom;
    const dy = (event.clientY - session.y) / session.zoom;
    if (session.pending && Math.abs(dx) + Math.abs(dy) < 4) return;
    session.pending = false;
    session.dx = Math.max(session.minX, Math.min(session.maxX, dx));
    session.dy = Math.max(session.minY, Math.min(session.maxY, dy));
    if (frame.current === null) frame.current = requestAnimationFrame(() => paint(session));
  };
  return {
    active: !!visible,
    begin(event: PointerEvent<HTMLElement>, nodes: NodeLayout[]) {
      if (active.current || !nodes.length || nodes.length > 100) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const session: Session = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        zoom: options.camera.zoom,
        camera: options.camera,
        nodes,
        cards: nodes.map(options.describe),
        dx: 0,
        dy: 0,
        minX: -1e7 - Math.min(...nodes.map((node) => node.x)),
        maxX: 1e7 - Math.max(...nodes.map((node) => node.x)),
        minY: -1e7 - Math.min(...nodes.map((node) => node.y)),
        maxY: 1e7 - Math.max(...nodes.map((node) => node.y)),
        pending: event.target instanceof Element && !!event.target.closest('.table-inline'),
        phase: 'dragging',
        controller: new AbortController(),
      };
      active.current = session;
      hasVisibleSession.current = true;
      setVisible(session);
    },
    move(event: PointerEvent<HTMLElement>) {
      const session = active.current;
      if (!session || session.pointerId !== event.pointerId) return false;
      if (session.phase === 'dragging') update(event, session);
      return true;
    },
    end(event: PointerEvent<HTMLElement>) {
      const session = active.current;
      if (!session || session.pointerId !== event.pointerId) return false;
      if (session.phase !== 'dragging') return true;
      update(event, session);
      session.phase = 'routing';
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      paint(session);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      if (!session.dx && !session.dy) {
        cancel();
        return true;
      }
      setVisible({ ...session });
      const placements = session.nodes.map((node) => ({
        ...node,
        x: node.x + session.dx,
        y: node.y + session.dy,
      }));
      void options.commit(placements, session.controller.signal).then(
        () => {
          if (active.current === session) cancel();
        },
        (error) => {
          if (active.current !== session) return;
          if (!session.controller.signal.aborted) options.onError(error);
          cancel();
        },
      );
      return true;
    },
    cancelPointer(event: PointerEvent<HTMLElement>) {
      if (active.current?.pointerId === event.pointerId && active.current.phase === 'dragging')
        cancel();
    },
    overlay: visible && (
      <div className="native-ghost-overlay" data-export-hidden="true">
        <div
          ref={layer}
          className="native-ghost-layer"
          aria-hidden="true"
          style={{
            transform: `translate(${visible.camera.x + visible.dx * visible.zoom}px, ${visible.camera.y + visible.dy * visible.zoom}px) scale(${visible.zoom})`,
          }}
        >
          {visible.nodes.map((node, index) => (
            <div
              className="native-ghost-card"
              key={node.id}
              style={{
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
                borderColor: visible.cards[index]!.color,
              }}
            >
              <strong
                style={{
                  background: visible.cards[index]!.color,
                  color: visible.cards[index]!.textColor ?? '#ffffff',
                }}
              >
                {visible.cards[index]!.title}
              </strong>
            </div>
          ))}
        </div>
        {visible.phase === 'routing' && (
          <div className="native-ghost-progress" role="status">
            {t('배치 계산 중…')}{' '}
            <button type="button" onClick={cancel}>
              {t('취소')}
            </button>
          </div>
        )}
      </div>
    ),
  };
}
