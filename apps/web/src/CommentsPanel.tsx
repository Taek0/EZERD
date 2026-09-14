import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DesignDocument } from '@ezerd/model';
import { notificationSchema, threadSchema, userSchema, type Thread, type Notification } from '@ezerd/contracts';
import { body, message, request } from './client.js';
import { pinAttachment, pinPosition, selectedMentions } from './comments-state.js';
import {
  Badge,
  Button,
  Checkbox,
  IconButton,
  Input,
  Textarea,
} from './components/ui/index.js';
import './comments.css';
type Member = {
  id: string;
  username: string;
};
export type CommentContext = {
  viewId: string;
  selectedObjectId: string | null;
  position: {
    x: number;
    y: number;
  };
};
export function CommentPins({ threads, document, viewId, onOpen }: {
  threads: Thread[];
  document: DesignDocument;
  viewId: string;
  onOpen: (thread: Thread) => void;
}) {
  return <>{threads.filter(t => t.viewId === viewId && !t.resolved).map((thread, index) => {
    const point = pinPosition(document, thread);
    if (point.missing)
      return null;
    return <IconButton
      key={thread.id}
      className="comment-pin"
      style={{ left: point.x, top: point.y }}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => {
        e.stopPropagation();
        onOpen(thread);
      }}
      aria-label={`댓글 ${index + 1}: ${thread.messages[0]?.body ?? ''}`}>
      {index + 1}
    </IconButton>;
  })}</>;
}
function Composer({ users, busy, label, onSend }: {
  users: Member[];
  busy: boolean;
  label: string;
  onSend: (text: string, mentions: string[]) => Promise<boolean>;
}) {
  const [text, setText] = useState(''), [mentions, setMentions] = useState<string[]>([]), [query, setQuery] = useState(''), [picking, setPicking] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await onSend(text.trim(), selectedMentions(mentions, users))) {
      setText('');
      setMentions([]);
      setPicking(false);
    }
  }
  return <form className="comment-composer" onSubmit={e => void submit(e)}>
    <label>
      {label}
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        maxLength={10000}
        required
        placeholder="검토 의견을 남겨 주세요"
        disabled={busy} />
    </label>
    <div className="mention-chips">
      {mentions.map(id => <Button
        type="button"
        key={id}
        onClick={() => setMentions(v => v.filter(i => i !== id))}
        aria-label={`${users.find(u => u.id === id)?.username ?? id} 멘션 제거`}>@{users.find(u => u.id === id)?.username ?? '사용자'} ×</Button>)}
    </div>
    <div className="comment-actions">
      <Button
        type="button"
        aria-expanded={picking}
        onClick={() => setPicking(v => !v)}>＠ 멘션</Button>
      <Button type="submit" variant="primary" className="primary" disabled={busy || !text.trim()}>
        {busy ? '등록 중…' : label}
      </Button>
    </div>
    {picking && <div className="mention-picker">
      <Input
        aria-label="멘션할 사용자 검색"
        placeholder="사용자 이름 검색"
        value={query}
        onChange={e => setQuery(e.target.value)} />
      {users.filter(u => u.username.includes(query)).map(u => <Button
        key={u.id}
        type="button"
        disabled={mentions.includes(u.id)}
        onClick={() => {
          setMentions(v => [...v, u.id]);
          setPicking(false);
        }}>@{u.username} <small>
          {u.id.slice(0, 8)}
        </small></Button>)}
      {!users.length && <p>사용자 목록을 불러와야 멘션할 수 있습니다.</p>}
    </div>}
  </form>;
}
export function CommentsPanel({ projectId, userId, document, context, activeThreadId, onThreads, onNavigate, onClose, dirty }: {
  projectId: string;
  userId: string;
  document: DesignDocument;
  context: CommentContext;
  activeThreadId: string | null;
  onThreads: (threads: Thread[]) => void;
  onNavigate: (thread: Thread) => void;
  onClose: () => void;
  dirty: boolean;
}) {
  const [threads, setThreads] = useState<Thread[]>([]), [users, setUsers] = useState<Member[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [showResolved, setShowResolved] = useState(false), [allViews, setAllViews] = useState(false), [blank, setBlank] = useState(false), [refresh, setRefresh] = useState(0);
  const mounted = useRef(true), mutation = useRef(false), threadRevision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const revision = threadRevision.current;
    void request<unknown[]>(`/api/projects/${projectId}/threads`, { signal: controller.signal }).then(values => {
      if (!controller.signal.aborted && threadRevision.current === revision) {
        const parsed = values.map(v => threadSchema.parse(v));
        setThreads(parsed);
        setError('');
      }
    }).catch(e => {
      if (!controller.signal.aborted)
        setError(message(e));
    });
    void request<unknown[]>('/api/users', { signal: controller.signal }).then(values => {
      if (!controller.signal.aborted)
        setUsers(values.map(v => userSchema.parse(v)));
    }).catch(e => {
      if (!controller.signal.aborted)
        setError(message(e));
    });
    return () => controller.abort();
  }, [projectId, refresh, activeThreadId]);
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
    if (!activeThreadId)
      return;
    const timer = window.setTimeout(() => window.document.getElementById(`thread-${activeThreadId}`)?.scrollIntoView({ block: 'nearest' }), 0);
    return () => clearTimeout(timer);
  }, [activeThreadId, showResolved, allViews, threads]);
  async function mutate(url: string, method: string, value: unknown): Promise<boolean> {
    if (mutation.current)
      return false;
    mutation.current = true;
    ++threadRevision.current;
    setBusy(true);
    setError('');
    try {
      const thread = threadSchema.parse(await request(url, body(method, value)));
      if (mounted.current) {
        setThreads(items => items.some(t => t.id === thread.id) ? items.map(t => t.id === thread.id ? thread : t) : [...items, thread]);
        onNavigate(thread);
      }
      return true;
    }
    catch (e) {
      if (mounted.current)
        setError(message(e));
      return false;
    }
    finally {
      ++threadRevision.current;
      mutation.current = false;
      if (mounted.current)
        setBusy(false);
    }
  }
  const visible = threads.filter(t => (allViews || t.viewId === context.viewId) && (showResolved || !t.resolved));
  return <aside className="comments-panel" aria-label="검토 대화">
    <div className="comment-panel-heading">
      <h2>검토 대화 <Badge variant="plain">
        {threads.filter(t => !t.resolved).length}
      </Badge></h2>
      <IconButton onClick={onClose} aria-label="검토 대화 닫기">×</IconButton>
    </div>
    <div className="comment-filters">
      <label><Checkbox
        checked={allViews}
        onChange={e => setAllViews(e.target.checked)} />모든 화면</label>
      <label><Checkbox
        checked={showResolved}
        onChange={e => setShowResolved(e.target.checked)} />해결됨 포함</label>
      <Button disabled={busy} onClick={() => setRefresh(v => v + 1)}>새로고침</Button>
    </div>
    {error && <p role="alert" className="notice error">
      {error}
    </p>}
    <div className="comment-thread-list">
      {visible.map(thread => <article
        key={thread.id}
        id={`thread-${thread.id}`}
        className={`comment-thread ${activeThreadId === thread.id ? 'active' : ''}`}>
        <div className="comment-thread-heading">
          <Button onClick={() => onNavigate(thread)}>
            {pinPosition(document, thread).missing ? '대상 삭제됨' : thread.objectId ? '연결된 객체로 이동 ↗' : '댓글 위치로 이동 ↗'}
          </Button>
          <Button disabled={busy} onClick={() => void mutate(`/api/threads/${thread.id}`, 'PATCH', { resolved: !thread.resolved })}>
            {thread.resolved ? '다시 열기' : '해결'}
          </Button>
        </div>
        {thread.messages.map(entry => <div className="comment-message" key={entry.id}>
          <div>
            <strong>
              {users.find(u => u.id === entry.authorId)?.username ?? '사용자'}
            </strong>
            <time dateTime={entry.createdAt}>
              {new Date(entry.createdAt).toLocaleString('ko-KR')}
            </time>
          </div>
          <p>
            {entry.body}
          </p>
          <div className="mention-chips">
            {entry.mentionIds.map(id => <Badge key={id}>@{users.find(u => u.id === id)?.username ?? '사용자'}</Badge>)}
          </div>
        </div>)}
        {activeThreadId === thread.id && <Composer
          key={thread.id}
          users={users}
          busy={busy}
          label="답글 등록"
          onSend={(text, mentionIds) => mutate(`/api/threads/${thread.id}/messages`, 'POST', { authorId: userId, body: text, mentionIds })} />}
      </article>)}
      {!visible.length && <p className="comment-empty">아직 대화가 없습니다. 캔버스의 객체나 빈 공간을 선택해 첫 의견을 남겨 보세요.</p>}
    </div>
    <div className="new-thread">
      <h3>새 댓글 핀</h3>
      <label><Checkbox
        checked={blank}
        onChange={e => setBlank(e.target.checked)} />빈 공간에 연결</label>
      <p>{blank || !context.selectedObjectId ? '선택한 캔버스 위치' : '선택한 객체'}에 댓글을 남깁니다.</p>
      {dirty && <p className="comment-save-hint">새 객체에 댓글을 연결하려면 먼저 설계를 저장해 주세요.</p>}
      <Composer
        users={users}
        busy={busy}
        label="댓글 등록"
        onSend={(text, mentionIds) => mutate(`/api/projects/${projectId}/threads`, 'POST', { authorId: userId, viewId: context.viewId, ...pinAttachment(document, context.viewId, blank ? null : context.selectedObjectId, context.position), body: text, mentionIds })} />
    </div>
  </aside>;
}
export function Notifications({ userId, onNavigate }: {
  userId: string;
  onNavigate: (notification: Notification) => Promise<boolean>;
}) {
  const [items, setItems] = useState<Notification[]>([]), [opened, setOpened] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const revision = useRef(0), lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const snapshot = revision.current;
    void request<unknown[]>(`/api/users/${userId}/notifications`, { signal: controller.signal }).then(values => {
      if (!controller.signal.aborted && snapshot === revision.current) {
        setItems(values.map(v => notificationSchema.parse(v)));
        setError('');
      }
    }).catch(e => {
      if (!controller.signal.aborted)
        setError(message(e));
    });
    return () => controller.abort();
  }, [userId, refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setRefresh(v => v + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  async function visit(item: Notification) {
    if (lock.current)
      return;
    lock.current = true;
    setBusy(true);
    ++revision.current;
    try {
      if (await onNavigate(item)) {
        const updated = notificationSchema.parse(await request(`/api/notifications/${item.id}`, body('PATCH', { read: true })));
        setItems(v => v.map(n => n.id === updated.id ? updated : n));
        setOpened(false);
      }
    }
    catch (e) {
      setError(message(e));
    }
    finally {
      ++revision.current;
      lock.current = false;
      setBusy(false);
    }
  }
  return <div className="notifications">
    <Button aria-expanded={opened} onClick={() => {
      setOpened(v => !v);
      setRefresh(v => v + 1);
    }}>알림 {items.filter(n => !n.read).length > 0 && <Badge variant="plain" className="notification-count">
      {items.filter(n => !n.read).length}
    </Badge>}</Button>
    {opened && <section className="notification-popover" aria-label="멘션 알림">
      <h2>멘션 알림</h2>
      {error && <p role="alert">
        {error}
      </p>}
      {!items.length && <p>새로운 멘션 알림이 없습니다.</p>}
      {items.map(item => <Button
        key={item.id}
        disabled={busy}
        className={item.read ? 'read' : 'unread'}
        onClick={() => void visit(item)}>
        <strong>
          {item.read ? '읽음' : '새 멘션'}
        </strong>
        <span>검토 대화로 이동 ↗</span>
        <time>
          {new Date(item.createdAt).toLocaleString('ko-KR')}
        </time>
      </Button>)}
    </section>}
  </div>;
}
