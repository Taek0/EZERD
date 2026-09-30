import { translate as t, useI18n, getLocale } from '../../shared/i18n/index.js';
import '../collaboration/translations.js';
import { userColorStyle } from '../identity/user-color-style.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DesignDocument } from '@ezerd/model';
import {
  notificationSchema,
  threadSchema,
  userSchema,
  type Thread,
  type Notification,
} from '@ezerd/contracts';
import { body, message, request } from '../../shared/api/client.js';
import { pinRequest, replyRequest } from './pin-request.js';
import { usePanelDismiss } from '../../shared/hooks/use-panel-dismiss.js';
import '../../styles/collaboration-panels.css';
import { pinAttachment, pinPosition, selectedMentions } from './comments-state.js';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  IconButton,
  Input,
  Textarea,
} from '../../components/ui/index.js';
import { useConfirm } from '../../components/ui/ConfirmProvider.js';
import './comments.css';
type Member = {
  id: string;
  username: string;
  color?: string;
};
export type CommentContext = {
  viewId: string;
  selectedObjectId: string | null;
  position: {
    x: number;
    y: number;
  };
};
export function CommentPins({
  threads,
  document,
  viewId,
  onOpen,
  memberColors = {},
}: {
  threads: Thread[];
  memberColors?: Record<string, string>;
  document: DesignDocument;
  viewId: string;
  onOpen: (thread: Thread) => void;
}) {
  useI18n();
  return (
    <>
      {threads
        .filter((t) => t.viewId === viewId && !t.resolved)
        .map((thread, index) => {
          const point = pinPosition(document, thread);
          if (point.missing) return null;
          return (
            <IconButton
              key={thread.id}
              className="comment-pin"
              style={{
                left: point.x,
                top: point.y,
                ...userColorStyle(memberColors[thread.messages[0]?.authorId ?? '']),
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(thread);
              }}
              aria-label={t('핀 {number}: {body}', {
                number: index + 1,
                body: thread.messages[0]?.body ?? '',
              })}
            >
              {index + 1}
            </IconButton>
          );
        })}
    </>
  );
}
function Composer({
  users,
  busy,
  label,
  onSend,
  focusNonce,
  authorName,
  authorColor,
}: {
  authorName: string;
  authorColor?: string | undefined;
  focusNonce?: number;
  users: Member[];
  busy: boolean;
  label: string;
  onSend: (text: string, mentions: string[]) => Promise<boolean>;
}) {
  useI18n();
  const composerRef = useRef<HTMLFormElement>(null);
  const composing = useRef(false),
    submitting = useRef(false);
  useEffect(() => {
    if (focusNonce !== undefined) composerRef.current?.querySelector('textarea')?.focus();
  }, [focusNonce]);
  const [text, setText] = useState(''),
    [mentions, setMentions] = useState<string[]>([]),
    [query, setQuery] = useState(''),
    [picking, setPicking] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || submitting.current || composing.current || !text.trim()) return;
    submitting.current = true;
    try {
      if (await onSend(text.trim(), selectedMentions(mentions, users))) {
        setText('');
        setMentions([]);
        setPicking(false);
      }
    } finally {
      submitting.current = false;
    }
  }
  return (
    <form
      ref={composerRef}
      className={`comment-composer ${text || picking ? 'has-draft' : ''}`}
      onSubmit={(e) => void submit(e)}
    >
      <div className="comment-composer-row">
        <Avatar size="xs" aria-hidden="true" style={userColorStyle(authorColor)}>
          {authorName.slice(0, 1)}
        </Avatar>
        <Textarea
          aria-label={label}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(e) => {
            if (
              e.key !== 'Enter' ||
              e.shiftKey ||
              composing.current ||
              e.nativeEvent.isComposing ||
              e.nativeEvent.keyCode === 229
            )
              return;
            e.preventDefault();
            if (!busy && !submitting.current && text.trim()) composerRef.current?.requestSubmit();
          }}
          maxLength={10000}
          required
          placeholder={label === t('핀 등록') ? t('핀 추가') : t('답글 추가')}
          disabled={busy}
        />
      </div>
      <div className="mention-chips">
        {mentions.map((id) => (
          <Button
            type="button"
            key={id}
            onClick={() => setMentions((v) => v.filter((i) => i !== id))}
            aria-label={t('{name} 멘션 제거', {
              name: users.find((u) => u.id === id)?.username ?? id,
            })}
          >
            @{users.find((u) => u.id === id)?.username ?? t('사용자')} ×
          </Button>
        ))}
      </div>
      <div className="comment-actions">
        <Button type="button" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
          {t('＠ 멘션')}
        </Button>
        <Button type="submit" variant="primary" className="primary" disabled={busy || !text.trim()}>
          {busy ? t('등록 중…') : label}
        </Button>
      </div>
      {picking && (
        <div className="mention-picker">
          <Input
            aria-label={t('멘션할 사용자 검색')}
            placeholder={t('사용자 이름 검색')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {users
            .filter((u) => u.username.includes(query))
            .map((u) => (
              <Button
                key={u.id}
                type="button"
                disabled={mentions.includes(u.id)}
                onClick={() => {
                  setMentions((v) => [...v, u.id]);
                  setPicking(false);
                }}
              >
                @{u.username} <small>{u.id.slice(0, 8)}</small>
              </Button>
            ))}
          {!users.length && <p>{t('사용자 목록을 불러와야 멘션할 수 있습니다.')}</p>}
        </div>
      )}
    </form>
  );
}
export function CommentsPanel({
  readOnly = false,
  workspaceId,
  projectId,
  userId,
  document,
  context,
  activeThreadId,
  onThreads,
  onNavigate,
  onClose,
  onCancelPinDraft,
  draftTarget,
  onMembers,
  currentUserColor,
}: {
  readOnly?: boolean;
  workspaceId: string;
  onMembers?: (members: Member[]) => void;
  currentUserColor?: string;
  draftTarget?: CommentContext & { nonce: number };
  projectId: string;
  userId: string;
  document: DesignDocument;
  context: CommentContext;
  activeThreadId: string | null;
  onThreads: (threads: Thread[]) => void;
  onNavigate: (thread: Thread) => void;
  onClose: () => void;
  onCancelPinDraft: () => void;
}) {
  useI18n();
  const [threads, setThreads] = useState<Thread[]>([]),
    [users, setUsers] = useState<Member[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [showResolved, setShowResolved] = useState(false),
    [allViews, setAllViews] = useState(true),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    onMembers?.(users);
  }, [users, onMembers]);
  const confirm = useConfirm();
  const draftContext = draftTarget?.viewId === context.viewId ? draftTarget : undefined;
  const mounted = useRef(true),
    mutation = useRef(false),
    threadRevision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const revision = threadRevision.current;
    void request<unknown[]>(`/api/projects/${projectId}/threads`, { signal: controller.signal })
      .then((values) => {
        if (!controller.signal.aborted && threadRevision.current === revision) {
          const parsed = values.map((v) => threadSchema.parse(v));
          setThreads(parsed);
          setError('');
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    void request<Array<{ userId: string; username: string; color: string }>>(
      `/api/workspaces/${workspaceId}/members`,
      { signal: controller.signal },
    )
      .then((values) => {
        if (!controller.signal.aborted)
          setUsers(values.map((v) => ({ id: v.userId, username: v.username, color: v.color })));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [projectId, workspaceId, refresh, activeThreadId, currentUserColor]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!mutation.current && !window.document.hidden) setRefresh((value) => value + 1);
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    onThreads(threads);
  }, [threads, onThreads]);
  useEffect(() => {
    if (activeThreadId) {
      setShowResolved(true);
      setAllViews(true);
    }
  }, [activeThreadId]);
  useEffect(() => {
    if (!activeThreadId) return;
    const timer = window.setTimeout(
      () =>
        window.document
          .getElementById(`thread-${activeThreadId}`)
          ?.scrollIntoView({ block: 'nearest' }),
      0,
    );
    return () => clearTimeout(timer);
  }, [activeThreadId, showResolved, allViews, threads]);
  async function mutate(
    url: string,
    method: string,
    value: unknown,
    navigate = true,
  ): Promise<boolean> {
    if (readOnly || mutation.current) return false;
    mutation.current = true;
    ++threadRevision.current;
    setBusy(true);
    setError('');
    try {
      const thread = threadSchema.parse(await request(url, body(method, value)));
      if (mounted.current) {
        setThreads((items) =>
          items.some((t) => t.id === thread.id)
            ? items.map((t) => (t.id === thread.id ? thread : t))
            : [...items, thread],
        );
        if (navigate) onNavigate(thread);
      }
      return true;
    } catch (e) {
      if (mounted.current) setError(message(e));
      return false;
    } finally {
      ++threadRevision.current;
      mutation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function deleteThread(thread: Thread) {
    if (readOnly || mutation.current) return;
    const accepted = await confirm({
      title: t('핀 삭제'),
      description: t('이 핀과 모든 답글을 삭제합니다. 삭제한 내용은 되돌릴 수 없습니다.'),
      confirmLabel: t('삭제'),
      destructive: true,
    });
    if (!accepted || !mounted.current || mutation.current) return;
    mutation.current = true;
    ++threadRevision.current;
    setBusy(true);
    setError('');
    try {
      await request(
        `/api/threads/${thread.id}`,
        body('DELETE', { expectedUpdatedAt: thread.updatedAt }),
      );
      if (mounted.current) {
        setThreads((items) => items.filter((item) => item.id !== thread.id));
        setRefresh((value) => value + 1);
      }
    } catch (e) {
      try {
        const latest = await request<unknown[]>(`/api/projects/${projectId}/threads`);
        if (mounted.current) setThreads(latest.map((value) => threadSchema.parse(value)));
      } catch {
        /* Keep the existing pins visible when refreshing also fails. */
      }
      if (mounted.current) setError(message(e));
    } finally {
      ++threadRevision.current;
      mutation.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }
  const visible = threads.filter(
    (t) => (allViews || t.viewId === context.viewId) && (showResolved || !t.resolved),
  );
  return (
    <aside className="comments-panel" aria-label={t('핀')}>
      <div className="comment-panel-heading">
        <h2>
          {t('핀')}
          <Badge variant="plain">{threads.filter((t) => !t.resolved).length}</Badge>
        </h2>
        <IconButton onClick={onClose} aria-label={t('핀 닫기')}>
          ×
        </IconButton>
      </div>
      <div className="comment-filters">
        <label>
          <Checkbox checked={allViews} onChange={(e) => setAllViews(e.target.checked)} />
          {t('프로젝트 전체 핀')}
        </label>
        <label>
          <Checkbox checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          {t('해결됨 포함')}
        </label>
        <Button disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
          {t('새로고침')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div className="comment-thread-list">
        {visible.map((thread) => (
          <article
            key={thread.id}
            id={`thread-${thread.id}`}
            className={`comment-thread ${activeThreadId === thread.id ? 'active' : ''}`}
          >
            <div className="comment-thread-heading">
              <Button onClick={() => onNavigate(thread)}>
                {pinPosition(document, thread).missing
                  ? t('대상 삭제됨')
                  : thread.objectId
                    ? t('연결된 객체로 이동 ↗')
                    : t('핀 위치로 이동 ↗')}
              </Button>
              <Button
                disabled={busy || readOnly}
                onClick={() =>
                  void mutate(
                    `/api/threads/${thread.id}`,
                    'PATCH',
                    { resolved: !thread.resolved },
                    false,
                  )
                }
              >
                {thread.resolved ? t('다시 열기') : t('해결')}
              </Button>
              <Button
                disabled={busy || readOnly}
                aria-label={t('핀 삭제')}
                onClick={() => void deleteThread(thread)}
              >
                {t('삭제')}
              </Button>
            </div>
            {thread.messages.map((entry, index) => (
              <div
                className={`comment-message ${index > 0 ? 'comment-reply' : 'comment-root'}`}
                key={entry.id}
              >
                <Avatar
                  size="xs"
                  aria-hidden="true"
                  style={userColorStyle(
                    entry.authorId === userId
                      ? currentUserColor
                      : users.find((u) => u.id === entry.authorId)?.color,
                  )}
                >
                  {(users.find((u) => u.id === entry.authorId)?.username ?? t('사용자')).slice(
                    0,
                    1,
                  )}
                </Avatar>
                <div className="comment-message-content">
                  <div className="comment-message-meta">
                    <strong>
                      {users.find((u) => u.id === entry.authorId)?.username ?? t('사용자')}
                    </strong>
                    <time
                      dateTime={entry.createdAt}
                      title={new Date(entry.createdAt).toLocaleString(
                        getLocale() === 'en' ? 'en-US' : 'ko-KR',
                      )}
                    >
                      {new Date(entry.createdAt).toLocaleDateString(
                        getLocale() === 'en' ? 'en-US' : 'ko-KR',
                        {
                          month: 'short',
                          day: 'numeric',
                        },
                      )}
                    </time>
                  </div>
                  <p>{entry.body}</p>
                  <div className="mention-chips">
                    {entry.mentionIds.map((id) => (
                      <Badge key={id}>
                        @{users.find((u) => u.id === id)?.username ?? t('사용자')}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {activeThreadId !== thread.id && (
              <Button className="thread-reply-open" onClick={() => onNavigate(thread)}>
                {t('답글 {count}개 · 답글 남기기', {
                  count: Math.max(0, thread.messages.length - 1),
                })}
              </Button>
            )}
            <div hidden={activeThreadId !== thread.id}>
              <Composer
                authorColor={currentUserColor}
                key={thread.id}
                users={users}
                authorName={users.find((u) => u.id === userId)?.username ?? t('나')}
                busy={busy || readOnly}
                label={t('답글 등록')}
                onSend={(text, mentionIds) =>
                  mutate(
                    `/api/threads/${thread.id}/messages`,
                    'POST',
                    replyRequest(text, mentionIds),
                  )
                }
              />
            </div>
          </article>
        ))}
        {!visible.length && (
          <p className="comment-empty">
            {t('아직 핀이 없습니다. 캔버스의 빈 공간에서 우클릭해 첫 핀을 남겨 보세요.')}
          </p>
        )}
      </div>
      {draftContext && !readOnly && (
        <div className="new-thread" aria-label={t('선택한 위치에 핀 작성')}>
          <Button type="button" disabled={busy} onClick={onCancelPinDraft}>
            {t('작성 취소')}
          </Button>
          <Composer
            authorColor={currentUserColor}
            key={draftContext.nonce}
            users={users}
            authorName={users.find((u) => u.id === userId)?.username ?? t('나')}
            busy={busy || readOnly}
            label={t('핀 등록')}
            focusNonce={draftContext.nonce}
            onSend={(text, mentionIds) =>
              mutate(
                `/api/projects/${projectId}/threads`,
                'POST',
                pinRequest(
                  {
                    viewId: draftContext.viewId,
                    ...pinAttachment(document, draftContext.viewId, null, draftContext.position),
                  },
                  text,
                  mentionIds,
                ),
              )
            }
          />
        </div>
      )}
    </aside>
  );
}
export function Notifications({
  userId,
  onNavigate,
}: {
  userId: string;
  onNavigate: (notification: Notification) => Promise<boolean>;
}) {
  useI18n();
  const [items, setItems] = useState<Notification[]>([]),
    [opened, setOpened] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const revision = useRef(0),
    lock = useRef(false);
  const notificationPanel = usePanelDismiss(() => setOpened(false), opened);
  useEffect(() => {
    const controller = new AbortController();
    const snapshot = revision.current;
    void request<unknown[]>(`/api/users/${userId}/notifications`, { signal: controller.signal })
      .then((values) => {
        if (!controller.signal.aborted && snapshot === revision.current) {
          setItems(values.map((v) => notificationSchema.parse(v)));
          setError('');
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [userId, refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setRefresh((v) => v + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  async function visit(item: Notification) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    ++revision.current;
    try {
      if (await onNavigate(item)) {
        const updated = notificationSchema.parse(
          await request(`/api/notifications/${item.id}`, body('PATCH', { read: true })),
        );
        setItems((v) => v.map((n) => (n.id === updated.id ? updated : n)));
        setOpened(false);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      ++revision.current;
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div
      className="notifications"
      ref={(element) => {
        notificationPanel.ref.current = element;
      }}
    >
      <Button
        className="notification-trigger"
        aria-label={t('알림')}
        title={t('알림')}
        aria-expanded={opened}
        onClick={() => {
          if (opened) notificationPanel.close();
          else setOpened(true);
          setRefresh((v) => v + 1);
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>
        {items.filter((n) => !n.read).length > 0 && (
          <Badge variant="plain" className="notification-count">
            {items.filter((n) => !n.read).length}
          </Badge>
        )}
      </Button>
      {opened && (
        <section
          data-closing={notificationPanel.closing}
          className="notification-popover"
          aria-label={t('멘션 알림')}
        >
          <h2>{t('멘션 알림')}</h2>
          {error && <p role="alert">{error}</p>}
          {!items.length && <p>{t('새로운 멘션 알림이 없습니다.')}</p>}
          {items.map((item) => (
            <Button
              key={item.id}
              disabled={busy}
              className={item.read ? 'read' : 'unread'}
              onClick={() => void visit(item)}
            >
              <strong>{item.read ? t('읽음') : t('새 멘션')}</strong>
              <span>{t('핀으로 이동 ↗')}</span>
              <time>
                {new Date(item.createdAt).toLocaleString(getLocale() === 'en' ? 'en-US' : 'ko-KR')}
              </time>
            </Button>
          ))}
        </section>
      )}
    </div>
  );
}
