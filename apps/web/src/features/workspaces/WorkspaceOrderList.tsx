import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { body, message, request } from '../../shared/api/client.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { moveWorkspace, workspaceDropIndex } from './workspace-order.js';
import type { Workspace } from './workspace-policy.js';

registerTranslations({
  '{name} 순서 변경': 'Reorder {name}',
  'Space로 이동 시작, 화살표로 순서 변경, Enter로 저장, Escape로 취소합니다.':
    'Press Space to pick up, arrows to move, Enter to save, Escape to cancel.',
  '{name}, {position}/{total}번째': '{name}, position {position} of {total}',
  '순서를 저장했습니다.': 'Order saved.',
  '순서 변경을 취소했습니다.': 'Reordering cancelled.',
});

export function WorkspaceOrderList({
  workspaces,
  selectedId,
  onSelect,
  onRefresh,
}: {
  workspaces: Workspace[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const [ids, setIds] = useState(() => workspaces.map((space) => space.id));
  const [dragged, setDragged] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const list = useRef<HTMLOListElement>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const priorRects = useRef(new Map<string, number>());
  const animations = useRef(new Map<string, { frame: number; offset: number; velocity: number }>());
  const currentIds = useRef(ids);
  const original = useRef(ids);
  const active = useRef<string | null>(null);
  const pointer = useRef<{
    id: number;
    y: number;
    top: number;
    height: number;
    lastY: number;
  } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const orderKey = JSON.stringify(workspaces.map((space) => space.id));
  function stopMotion() {
    for (const value of animations.current.values()) cancelAnimationFrame(value.frame);
    animations.current.clear();
    for (const row of rows.current.values()) row.style.transform = '';
  }
  useEffect(() => {
    revision.current += 1;
    pending.current = null;
    active.current = null;
    pointer.current = null;
    setDragged(null);
    setSaving(false);
    stopMotion();
    const next = workspaces.map((space) => space.id);
    currentIds.current = next;
    setIds(next);
    return () => {
      revision.current += 1;
      stopMotion();
    };
  }, [orderKey]);
  useLayoutEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const [id, row] of rows.current) {
      if (id === active.current && pointer.current) {
        row.style.transform = '';
        const drag = pointer.current;
        row.style.transform = `translateY(${drag.top + drag.lastY - drag.y - row.getBoundingClientRect().top}px)`;
        continue;
      }
      if (reducedMotion) continue;
      const before = priorRects.current.get(id);
      if (before === undefined) continue;
      const old = animations.current.get(id);
      if (old) cancelAnimationFrame(old.frame);
      row.style.transform = '';
      const offset = before - row.getBoundingClientRect().top;
      const motion = { offset, velocity: old?.velocity ?? 0, frame: 0 };
      let previous = performance.now();
      const tick = (now: number) => {
        const dt = Math.min((now - previous) / 1000, 0.032);
        previous = now;
        motion.velocity += (-420 * motion.offset - 41 * motion.velocity) * dt;
        motion.offset += motion.velocity * dt;
        row.style.transform = `translateY(${motion.offset}px)`;
        if (Math.abs(motion.offset) > 0.1 || Math.abs(motion.velocity) > 0.1)
          motion.frame = requestAnimationFrame(tick);
        else {
          row.style.transform = '';
          animations.current.delete(id);
        }
      };
      row.style.transform = `translateY(${offset}px)`;
      animations.current.set(id, motion);
      motion.frame = requestAnimationFrame(tick);
    }
    priorRects.current.clear();
  }, [ids]);
  function preview(next: string[]) {
    if (next.join() === currentIds.current.join()) return;
    priorRects.current = new Map(
      [...rows.current].map(([id, row]) => [id, row.getBoundingClientRect().top]),
    );
    currentIds.current = next;
    setIds(next);
    if (active.current) {
      const space = workspaces.find((item) => item.id === active.current);
      setAnnouncement(
        t('{name}, {position}/{total}번째', {
          name: space?.name ?? '',
          position: next.indexOf(active.current) + 1,
          total: next.length,
        }),
      );
    }
  }
  function begin(id: string) {
    if (pending.current || active.current) return false;
    const moving = animations.current.get(id);
    if (moving) {
      cancelAnimationFrame(moving.frame);
      animations.current.delete(id);
    }
    original.current = currentIds.current;
    active.current = id;
    setDragged(id);
    setError('');
    return true;
  }
  async function finish(cancel = false) {
    if (!active.current) return;
    active.current = null;
    pointer.current = null;
    setDragged(null);
    stopMotion();
    if (cancel) {
      preview(original.current);
      setAnnouncement(t('순서 변경을 취소했습니다.'));
      return;
    }
    const next = currentIds.current;
    if (next.join() === original.current.join()) return;
    const controller = new AbortController();
    pending.current = controller;
    const version = revision.current;
    setSaving(true);
    try {
      const result = await request<Workspace[]>('/api/workspaces/order', {
        ...body('PATCH', { workspaceIds: next }),
        signal: controller.signal,
      });
      if (controller.signal.aborted || revision.current !== version) return;
      preview(result.map((space) => space.id));
      setAnnouncement(t('순서를 저장했습니다.'));
      onRefresh();
    } catch (cause) {
      if (controller.signal.aborted || revision.current !== version) return;
      preview(original.current);
      setError(message(cause));
      onRefresh();
    } finally {
      if (pending.current === controller && revision.current === version) {
        pending.current = null;
        setSaving(false);
      }
    }
  }
  return (
    <>
      <p className="workspace-sr-only" id="workspace-reorder-help">
        {t('Space로 이동 시작, 화살표로 순서 변경, Enter로 저장, Escape로 취소합니다.')}
      </p>
      <ol
        ref={list}
        className="workspace-order-list"
        aria-label={t('워크스페이스')}
        aria-busy={saving}
        onPointerMove={(event) => {
          const drag = pointer.current;
          const id = active.current;
          if (!drag || !id || drag.id !== event.pointerId) return;
          drag.lastY = event.clientY;
          const row = rows.current.get(id)!;
          const offset = drag.top + event.clientY - drag.y;
          row.style.transform = '';
          const naturalTop = row.getBoundingClientRect().top;
          row.style.transform = `translateY(${offset - naturalTop}px)`;
          const centre = offset + drag.height / 2;
          const others = currentIds.current.filter((value) => value !== id);
          const centres = others.map((other) => {
            const element = rows.current.get(other)!;
            return (
              element.offsetTop +
              element.offsetHeight / 2 +
              element.offsetParent!.getBoundingClientRect().top
            );
          });
          preview(moveWorkspace(currentIds.current, id, workspaceDropIndex(centre, centres)));
        }}
        onPointerUp={() => void finish()}
        onPointerCancel={() => void finish(true)}
        onLostPointerCapture={() => {
          if (pointer.current) void finish(true);
        }}
      >
        {ids.map((id) => {
          const space = workspaces.find((item) => item.id === id);
          if (!space) return null;
          return (
            <li
              key={id}
              ref={(node) => {
                if (node) rows.current.set(id, node);
                else rows.current.delete(id);
              }}
              className="workspace-order-row"
              data-dragging={dragged === id || undefined}
            >
              <button
                type="button"
                className="workspace-menu-row"
                disabled={!!dragged}
                onClick={() => onSelect(id)}
                aria-current={selectedId === id ? 'true' : undefined}
              >
                <span className="workspace-initial" aria-hidden="true">
                  {Array.from(space.name)[0]?.toUpperCase()}
                </span>
                <span className="workspace-row-copy">
                  <strong>{space.name}</strong>
                  <small>
                    {t({ owner: '소유자', editor: '편집자', viewer: '뷰어' }[space.role])}
                    {space.status === 'archived' ? ` · ${t('보관됨')}` : ''}
                  </small>
                </span>
                {selectedId === id && (
                  <span className="workspace-selected-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
              <button
                type="button"
                className="workspace-drag-handle"
                aria-label={t('{name} 순서 변경', { name: space.name })}
                aria-describedby="workspace-reorder-help"
                aria-pressed={dragged === id}
                disabled={saving || ids.length < 2}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && active.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    void finish(true);
                    return;
                  }
                  if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault();
                    if (active.current === id) void finish();
                    else begin(id);
                    return;
                  }
                  if (active.current !== id) return;
                  const index = currentIds.current.indexOf(id);
                  const target =
                    event.key === 'ArrowUp'
                      ? index - 1
                      : event.key === 'ArrowDown'
                        ? index + 1
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? ids.length - 1
                            : null;
                  if (target !== null) {
                    event.preventDefault();
                    preview(moveWorkspace(currentIds.current, id, target));
                  }
                  if (event.key === 'Tab') void finish();
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0 || !begin(id)) return;
                  event.preventDefault();
                  const rect = rows.current.get(id)!.getBoundingClientRect();
                  pointer.current = {
                    id: event.pointerId,
                    y: event.clientY,
                    top: rect.top,
                    height: rect.height,
                    lastY: event.clientY,
                  };
                  list.current?.setPointerCapture(event.pointerId);
                }}
              >
                <span aria-hidden="true">⠿</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="workspace-sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
