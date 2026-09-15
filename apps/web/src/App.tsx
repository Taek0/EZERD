import { PinPanelResizer } from './PinPanelResizer.js';
import { userColorStyle } from './user-color-style.js';
import { UserColorEditor } from './UserColorEditor.js';
import { clampCommentsPanelWidth } from './comments-panel-size.js';
import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from 'react';
import {
  applyChanges,
  diffSharedDocument,
  type DesignDocument,
  createEmptyDocument,
} from '@ezerd/model';
import {
  userSchema,
  projectSchema,
  projectDocumentSchema,
  threadSchema,
  type Thread,
  type Notification,
} from '@ezerd/contracts';
import { body, message, newId, request } from './client.js';
import { Canvas } from './Canvas.js';
import { CommentsPanel, CommentPins, Notifications, type CommentContext } from './CommentsPanel.js';
import { RenameDialog } from './components/ui/RenameDialog.js';
import { useConfirm } from './components/ui/ConfirmProvider.js';
import { LatestRequest } from './comments-state.js';
import {
  ProjectSyncRuntime,
  stableClientId,
  type SyncSession,
  type SyncSnapshot,
} from './sync-client.js';
import { SyncHistoryPanel } from './sync-history-panel.js';
import { Avatar, Badge, Button, Dropdown, Input, TabButton } from './components/ui/index.js';
import './responsive-shell.css';

type User = {
  id: string;
  username: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};
export type Project = {
  id: string;
  name: string;
  status: 'active' | 'archived';
  version: number;
  createdAt: string;
  updatedAt: string;
};
export function rebaseAutosaveDraft(
  base: DesignDocument,
  draft: DesignDocument,
  server: DesignDocument,
) {
  return applyChanges(server, diffSharedDocument(base, draft));
}
export function autosaveDelay(textEditing: boolean, composing: boolean): 0 | 500 | null {
  return composing ? null : textEditing ? 500 : 0;
}
type OpenProject = {
  project: Project;
  document: DesignDocument;
};
const identityKey = 'ezerd.userId';
export function App() {
  const confirm = useConfirm();
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [draftTarget, setDraftTarget] = useState<CommentContext & { nonce: number }>();
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true);
  const [session, setSession] = useState<SyncSession | null>(null);
  const [editingColor, setEditingColor] = useState(false);
  const [registrationPin, setRegistrationPin] = useState('');
  const [members, setMembers] = useState<Array<{ id: string; username: string; color?: string }>>(
    [],
  );
  const [resizingComments, setResizingComments] = useState(false);
  const [commentsPanelWidth, setCommentsPanelWidth] = useState(() => {
    try {
      return clampCommentsPanelWidth(localStorage.getItem('ezerd.commentsPanelWidth'));
    } catch {
      return 340;
    }
  });
  function resizeCommentsPanel(width: number) {
    const next = clampCommentsPanelWidth(width);
    setCommentsPanelWidth(next);
    try {
      localStorage.setItem('ezerd.commentsPanelWidth', String(next));
    } catch {}
  }
  const [username, setUsername] = useState(''),
    [editingName, setEditingName] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState<'active' | 'archived'>('active');
  const [projectName, setProjectName] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState<OpenProject | null>(null),
    [refresh, setRefresh] = useState(0);
  const [sync, setSync] = useState<SyncSnapshot | null>(null);
  const [historyAction, setHistoryAction] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState('');
  const current = useRef(opened),
    runtime = useRef<ProjectSyncRuntime | null>(null);
  const autosave = useRef<{
    base?: DesignDocument;
    document?: DesignDocument;
    timer?: ReturnType<typeof setTimeout>;
    composing: boolean;
  }>({ composing: false });
  current.current = opened;
  const [commentsOpen, setCommentsOpen] = useState(false),
    [threads, setThreads] = useState<Thread[]>([]);
  const [canvasContext, setCanvasContext] = useState<CommentContext>({
    viewId: 'overview',
    selectedObjectId: null,
    position: { x: 120, y: 120 },
  });
  const [focusTarget, setFocusTarget] = useState<{
    viewId: string;
    objectId: string | null;
    threadId?: string;
    x: number;
    y: number;
    nonce: number;
  }>();
  const navigation = useRef(new LatestRequest());
  function replaceProject(value: OpenProject | null) {
    if (autosave.current.timer) clearTimeout(autosave.current.timer);
    autosave.current = { composing: false };
    runtime.current?.stop();
    runtime.current = null;
    setSync(null);
    current.current = value;
    setOpened(value);
  }
  function restoreHistory(direction: 'undo' | 'redo') {
    if (!current.current || current.current.project.status === 'archived' || busy) return;
    void runtime.current?.[direction]().catch((cause) => setError(message(cause)));
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      const editable =
        target instanceof Element &&
        !!target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        );
      if (
        editable ||
        event.isComposing ||
        event.defaultPrevented ||
        document.querySelector('dialog[open], [aria-modal="true"]')
      )
        return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === 'z' || key === 'y')) {
        if (!current.current || current.current.project.status === 'archived' || busy) return;
        event.preventDefault();
        restoreHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('keydown', keydown);
    };
  });
  function focusThread(thread: Thread) {
    setDraftTarget(undefined);
    setCommentsOpen(true);
    setFocusTarget({
      viewId: thread.viewId,
      objectId: thread.objectId,
      threadId: thread.id,
      x: thread.x,
      y: thread.y,
      nonce: Date.now(),
    });
  }
  function resetReview() {
    setDraftTarget(undefined);
    setThreads([]);
    setFocusTarget(undefined);
    setCanvasContext({ viewId: 'overview', selectedObjectId: null, position: { x: 120, y: 120 } });
  }
  async function visitNotification(notification: Notification): Promise<boolean> {
    if (busy) return false;
    const sameProject = current.current?.project.id === notification.projectId;
    const ticket = navigation.current.begin();
    setBusy(true);
    setError('');
    try {
      const [threadValues, projectValue] = await Promise.all([
        request<unknown[]>(`/api/projects/${notification.projectId}/threads`),
        sameProject ? Promise.resolve(null) : request(`/api/projects/${notification.projectId}`),
      ]);
      if (!navigation.current.isCurrent(ticket)) return false;
      const thread = threadValues
        .map((v) => threadSchema.parse(v))
        .find((t) => t.id === notification.threadId);
      if (!thread) throw new Error('알림의 댓글을 찾을 수 없습니다.');
      if (projectValue) {
        replaceProject(projectDocumentSchema.parse(projectValue));
        resetReview();
      }
      focusThread(thread);
      return true;
    } catch (e) {
      if (navigation.current.isCurrent(ticket)) setError(message(e));
      return false;
    } finally {
      if (navigation.current.isCurrent(ticket)) setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    let id: string | null = null;
    try {
      id = localStorage.getItem(identityKey);
      const storedSession = sessionStorage.getItem('ezerd.sync.session');
      if (storedSession) {
        const parsed = JSON.parse(storedSession) as SyncSession;
        if (Date.parse(parsed.expiresAt) > Date.now()) setSession(parsed);
      }
    } catch {
      /* private browser storage may be unavailable */
    }
    if (!id) {
      setChecking(false);
      return;
    }
    void request(`/api/users/${encodeURIComponent(id)}`)
      .then((value) => {
        if (live) {
          const restored = userSchema.parse(value);
          setUser(restored);
          setUsername(restored.username);
        }
      })
      .catch((e) => {
        if (live) setError(message(e));
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!user || opened) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void request<unknown[]>(`/api/projects?status=${status}&search=${encodeURIComponent(search)}`, {
      signal: controller.signal,
    })
      .then((values) => {
        if (!controller.signal.aborted) setProjects(values.map((v) => projectSchema.parse(v)));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [user, opened, status, search, refresh]);
  useEffect(() => {
    if (!opened || !user || !session || opened.project.status === 'archived') return;
    const projectId = opened.project.id;
    const instance = new ProjectSyncRuntime({
      projectId,
      userId: user.id,
      clientId: stableClientId(),
      session,
      initialDocument: opened.document,
      onChange: (snapshot) => {
        setSync(snapshot);
        const value = current.current;
        if (!value || value.project.id !== projectId) return;
        let document = snapshot.document;
        const draft = autosave.current;
        if (draft.base && draft.document) {
          try {
            document = rebaseAutosaveDraft(draft.base, draft.document, snapshot.document);
            draft.base = snapshot.document;
            draft.document = document;
          } catch {
            document = draft.document;
          }
        }
        const next = { ...value, document };
        current.current = next;
        setOpened(next);
      },
    });
    runtime.current = instance;
    void instance.start();
    return () => {
      instance.stop();
      if (runtime.current === instance) runtime.current = null;
    };
  }, [opened?.project.id, opened?.project.status, user?.id, session?.token]);
  async function identify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const value =
        user && session
          ? userSchema.parse(
              await request(`/api/users/${user.id}`, body('PATCH', { username: username.trim() })),
            )
          : (user ??
            userSchema.parse(
              await request(
                '/api/users',
                body('POST', { username: username.trim(), pin: registrationPin }),
              ),
            ));
      let nextSession = session;
      if (!nextSession) {
        const result = await request<{
          token: string;
          expiresAt: string;
          baselineIssuedAt: string;
        }>('/api/sessions', body('POST', { userId: value.id, pin: registrationPin }));
        nextSession = {
          token: result.token,
          expiresAt: result.expiresAt,
          baselineIssuedAt: result.baselineIssuedAt,
        };
        setSession(nextSession);
        try {
          sessionStorage.setItem('ezerd.sync.session', JSON.stringify(nextSession));
        } catch {
          /* Login remains valid in this tab. */
        }
      }
      setUser(value);
      setRegistrationPin('');
      setUsername(value.username);
      setEditingName(false);
      try {
        localStorage.setItem(identityKey, value.id);
      } catch {
        setError(
          '이 브라우저에서는 이름을 기억할 수 없습니다. 다음 방문에 이름을 다시 설정해 주세요.',
        );
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    const ticket = navigation.current.begin();
    setBusy(true);
    setError('');
    try {
      const value = projectDocumentSchema.parse(await request(`/api/projects/${id}`));
      if (!navigation.current.isCurrent(ticket)) return;
      resetReview();
      replaceProject(value);
    } catch (e) {
      if (navigation.current.isCurrent(ticket)) setError(message(e));
    } finally {
      if (navigation.current.isCurrent(ticket)) setBusy(false);
    }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    const ticket = navigation.current.begin();
    setBusy(true);
    setError('');
    try {
      const project = projectSchema.parse(
        await request('/api/projects', body('POST', { name: projectName.trim() })),
      );
      if (!navigation.current.isCurrent(ticket)) return;
      setProjectName('');
      resetReview();
      replaceProject({ project, document: createEmptyDocument() });
    } catch (e) {
      if (navigation.current.isCurrent(ticket)) setError(message(e));
    } finally {
      if (navigation.current.isCurrent(ticket)) setBusy(false);
    }
  }
  async function changeProject(
    project: Project,
    patch: {
      name?: string;
      status?: 'active' | 'archived';
    },
  ) {
    setBusy(true);
    setError('');
    try {
      await request(
        `/api/projects/${project.id}`,
        body('PATCH', { expectedVersion: project.version, ...patch }),
      );
      setRefresh((v) => v + 1);
      return true;
    } catch (e) {
      setError(message(e));
      if (patch.name !== undefined) throw e;
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function deleteProject(project: Project) {
    if (busy || project.status !== 'archived') return;
    if (
      !(await confirm({
        title: '프로젝트 영구 삭제',
        description: `“${project.name}” 프로젝트를 삭제할까요? 도메인, 테이블, 관계, 핀과 답글 및 관련 알림이 함께 삭제되며 복원할 수 없습니다.`,
        confirmLabel: '영구 삭제',
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    setError('');
    try {
      await request(
        `/api/projects/${project.id}`,
        body('DELETE', { expectedVersion: project.version }),
      );
      setProjects((items) => items.filter((item) => item.id !== project.id));
      setRefresh((value) => value + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function applyDocument(document: DesignDocument) {
    if (!current.current) return;
    const next = { ...current.current, document };
    current.current = next;
    setOpened(next);
  }
  function scheduleAutosave() {
    const draft = autosave.current;
    if (draft.composing || !draft.document) return;
    if (draft.timer) clearTimeout(draft.timer);
    draft.timer = setTimeout(() => {
      void flushAutosave();
    }, 500);
  }
  async function flushAutosave() {
    const draft = autosave.current;
    if (draft.composing || !draft.document) return;
    if (draft.timer) clearTimeout(draft.timer);
    const document = draft.document;
    autosave.current = { composing: draft.composing };
    await runtime.current?.edit(document);
  }
  function previewEdit(document: DesignDocument) {
    const previous = current.current?.document;
    if (!previous || document === previous) return;
    const draft = autosave.current;
    draft.base ??= previous;
    draft.document = document;
    applyDocument(document);
  }
  function edit(document: DesignDocument) {
    const previous = current.current?.document;
    if (!previous || (document === previous && autosave.current.document !== document)) return;
    if (document !== previous) applyDocument(document);
    const active = globalThis.document?.activeElement;
    const textEditing =
      active instanceof Element &&
      !!active.closest('input, textarea, [contenteditable]:not([contenteditable="false"])');
    const delay = autosaveDelay(textEditing, autosave.current.composing);
    if (delay !== 0) {
      const draft = autosave.current;
      draft.base ??= previous;
      draft.document = document;
      if (delay === 500) scheduleAutosave();
      return;
    }
    if (autosave.current.timer) clearTimeout(autosave.current.timer);
    autosave.current = { composing: false };
    void runtime.current?.edit(document);
  }
  async function leave() {
    await flushAutosave();
    navigation.current.begin();
    setBusy(false);
    resetReview();
    replaceProject(null);
  }
  async function restoreDeletion(operationId: string) {
    const value = current.current;
    if (!value || !session || historyAction) return;
    setHistoryAction(operationId);
    setHistoryNotice('');
    setError('');
    try {
      const outcome = await request<{
        result: { status: 'accepted' | 'rejected'; reason?: string };
        omittedRelations: string[];
      }>(`/api/projects/${value.project.id}/deletions/${operationId}/restore`, {
        ...body('POST', { operationId: newId(), groupId: newId(), clientId: stableClientId() }),
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (outcome.result.status !== 'accepted')
        throw new Error(outcome.result.reason ?? '삭제 항목을 복원하지 못했습니다.');
      setHistoryNotice(
        outcome.omittedRelations.length
          ? `삭제 항목을 새 객체로 복원했습니다. 현재 구조에서 유효하지 않은 관계·배치 ${outcome.omittedRelations.length}개는 제외했습니다: ${outcome.omittedRelations.join(', ')}`
          : '삭제 항목을 새 객체로 복원했습니다.',
      );
      await runtime.current?.refreshHistory();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setHistoryAction(null);
    }
  }
  async function resolvePendingEdit(action: 'reapply' | 'discard', operationId: string) {
    const instance = runtime.current;
    if (!instance || historyAction) return;
    setHistoryAction(operationId);
    setError('');
    try {
      if (action === 'reapply') await instance.reapply(operationId);
      else await instance.discard(operationId);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setHistoryAction(null);
    }
  }
  const userForm = (
    <form className="identity-form" onSubmit={(e) => void identify(e)}>
      <label htmlFor="username">함께 사용할 이름</label>
      <Input
        id="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        maxLength={40}
        required
        autoComplete="nickname"
        autoFocus
        placeholder="예: 김설계"
      />
      {(!user || !session) && (
        <>
          <label htmlFor="registration-pin">사용자 PIN (숫자 4자리)</label>
          <Input
            id="registration-pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            minLength={4}
            required
            autoComplete={user ? 'current-password' : 'new-password'}
            value={registrationPin}
            onChange={(e) => setRegistrationPin(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="숫자 4자리"
          />
        </>
      )}
      <p>
        {user && !session
          ? '동기화를 계속하려면 기존 PIN으로 로그인해 주세요.'
          : user
            ? '이 이름으로 팀에 표시됩니다. 기존 PIN은 유지됩니다.'
            : '이름과 PIN 조합으로 사용자를 구분합니다.'}
      </p>
      <div className="actions">
        <Button
          type="submit"
          variant="primary"
          className="primary"
          disabled={
            busy || !username.trim() || ((!user || !session) && !/^[0-9]{4}$/.test(registrationPin))
          }
        >
          {busy
            ? '확인 중…'
            : user && !session
              ? '로그인 →'
              : user
                ? '이름 저장'
                : '워크스페이스 시작하기 →'}
        </Button>
        {user && (
          <Button type="button" onClick={() => setEditingName(false)}>
            취소
          </Button>
        )}
      </div>
    </form>
  );
  return (
    <div className={opened ? 'app-shell editor-shell' : 'app-shell'}>
      <a className="skip-link" href="#main">
        본문으로 이동
      </a>
      <header className="app-header">
        <Button className="brand" onClick={leave} aria-label="EZERD 프로젝트 갤러리">
          EZERD<span>.</span>
        </Button>
        <span className="header-caption">
          A SHARED SPACE
          <br />
          FOR CLEAR THINKING.
        </span>
        {user && <Notifications userId={user.id} onNavigate={visitNotification} />}
        {user && (
          <Dropdown
            label="사용자 메뉴"
            items={[
              {
                id: 'rename',
                label: '이름 변경',
                onAction: () => {
                  setEditingColor(false);
                  setEditingName(true);
                },
              },
              {
                id: 'color',
                label: '색상 변경',
                onAction: () => {
                  setEditingName(false);
                  setEditingColor(true);
                },
              },
            ]}
            trigger={
              <Button
                className="user-button"
                aria-label={`${user.username}, 사용자 메뉴`}
                title={user.username}
              >
                <Avatar className="avatar" style={userColorStyle(user.color)}>
                  {user.username.slice(0, 1)}
                </Avatar>
                <span className="user-name">{user.username}</span>
                <span aria-hidden="true">⌄</span>
              </Button>
            }
          />
        )}
      </header>
      {editingColor && user && (
        <UserColorEditor
          key={user.id}
          user={user}
          onSaved={setUser}
          onClose={() => setEditingColor(false)}
        />
      )}
      {editingName && (
        <section className="identity-popover" aria-label="이름 변경">
          {userForm}
        </section>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
          <Button onClick={() => setRefresh((v) => v + 1)}>다시 확인</Button>
        </div>
      )}
      {checking ? (
        <main id="main" className="gallery">
          <p role="status">워크스페이스를 여는 중…</p>
        </main>
      ) : !user || !session ? (
        <main id="main" className="welcome">
          <p className="eyebrow">01 / WELCOME TO EZERD</p>
          <h1>
            명확한 구조.
            <br />
            함께 만드는 설계<span>.</span>
          </h1>
          <p className="intro">
            큰 그림을 연결하고, 데이터의 흐름을 정리하세요.
            <br />
            이름 하나로 우리 팀의 설계를 시작합니다.
          </p>
          {userForm}
        </main>
      ) : opened ? (
        <main id="main" className="editor">
          <div className="editor-heading">
            <div className="project-title">
              <Button onClick={leave}>← 갤러리</Button>
              <div>
                <small>PROJECT / DOMAIN WORKSPACE</small>
                <h1>{opened.project.name}</h1>
              </div>
            </div>
            <div className="save-controls">
              <Button
                aria-label="실행 취소"
                title="실행 취소 (Ctrl+Z / ⌘Z)"
                disabled={busy || opened.project.status === 'archived' || !sync?.canUndo}
                onClick={() => restoreHistory('undo')}
              >
                ↶
              </Button>
              <Button
                aria-label="다시 실행"
                title="다시 실행 (Ctrl+Shift+Z / ⌘⇧Z)"
                disabled={busy || opened.project.status === 'archived' || !sync?.canRedo}
                onClick={() => restoreHistory('redo')}
              >
                ↷
              </Button>
              <Button
                aria-expanded={commentsOpen}
                onClick={() => {
                  setDraftTarget(undefined);
                  setCommentsOpen((v) => !v);
                }}
              >
                핀
              </Button>
              <span
                role="status"
                className={`save-state ${sync?.status === 'action-needed' ? 'failed' : ''}`}
              >
                {sync?.status === 'syncing'
                  ? '◌ 동기화 중'
                  : sync?.status === 'offline'
                    ? '○ 오프라인'
                    : sync?.status === 'action-needed'
                      ? '! 확인 필요'
                      : '✓ 동기화됨'}
              </span>
              <SyncHistoryPanel
                snapshot={sync}
                activeOperationId={historyAction}
                notice={historyNotice}
                onRestore={(operationId) => {
                  void restoreDeletion(operationId);
                }}
                onReapply={(operationId) => {
                  void resolvePendingEdit('reapply', operationId);
                }}
                onDiscard={(operationId) => {
                  void resolvePendingEdit('discard', operationId);
                }}
              />
            </div>
          </div>
          {opened.project.status === 'archived' && (
            <div className="notice">
              보관한 프로젝트입니다. 갤러리에서 복원하면 편집할 수 있습니다.
            </div>
          )}
          {(sync?.storageFailure || sync?.error) && (
            <div className="notice error" role="alert">
              {sync.storageFailure ?? sync.error}
            </div>
          )}
          <div
            className="review-workspace"
            onCompositionStartCapture={() => {
              autosave.current.composing = true;
              if (autosave.current.timer) clearTimeout(autosave.current.timer);
            }}
            onCompositionEndCapture={() => {
              autosave.current.composing = false;
              queueMicrotask(scheduleAutosave);
            }}
            onBlurCapture={() => {
              queueMicrotask(() => {
                void flushAutosave();
              });
            }}
          >
            <Canvas
              key={opened.project.id}
              document={opened.document}
              onChange={edit}
              onPreviewChange={previewEdit}
              readOnly={opened.project.status === 'archived'}
              onContextChange={setCanvasContext}
              onCreatePin={(context) => {
                setCanvasContext(context);
                setFocusTarget(undefined);
                setDraftTarget({ ...context, selectedObjectId: null, nonce: Date.now() });
                setCommentsOpen(true);
              }}
              {...(focusTarget ? { focusTarget } : {})}
              pins={
                <CommentPins
                  memberColors={Object.fromEntries([
                    ...members.map((member) => [member.id, member.color ?? '#4169e1']),
                    [user.id, user.color],
                  ])}
                  threads={threads}
                  document={opened.document}
                  viewId={canvasContext.viewId}
                  onOpen={focusThread}
                />
              }
            />
            <div
              data-open={commentsOpen}
              data-resizing={resizingComments}
              aria-hidden={!commentsOpen}
              inert={!commentsOpen}
              className="comments-container"
              style={{ '--comments-panel-width': commentsPanelWidth + 'px' } as CSSProperties}
            >
              {commentsOpen && (
                <PinPanelResizer
                  width={commentsPanelWidth}
                  onWidthChange={resizeCommentsPanel}
                  onResizingChange={setResizingComments}
                />
              )}
              <CommentsPanel
                onMembers={setMembers}
                currentUserColor={user.color}
                key={opened.project.id}
                projectId={opened.project.id}
                userId={user.id}
                document={opened.document}
                context={canvasContext}
                {...(draftTarget ? { draftTarget } : {})}
                activeThreadId={focusTarget?.threadId ?? null}
                onThreads={setThreads}
                onNavigate={focusThread}
                onClose={() => {
                  setDraftTarget(undefined);
                  setCommentsOpen(false);
                }}
                onCancelPinDraft={() => setDraftTarget(undefined)}
              />
            </div>
          </div>
        </main>
      ) : (
        <main id="main" className="gallery">
          <div className="section-marker">
            01 / WORKSPACE
            <span />
          </div>
          <section className="gallery-hero">
            <div>
              <p className="eyebrow">도메인에서 시작하는 데이터 설계</p>
              <h1>
                우리 팀의 설계<span>.</span>
              </h1>
              <p>아이디어를 연결하고, 함께 구조를 만들어 가세요.</p>
            </div>
            <div className="hero-index">
              {String(projects.length).padStart(2, '0')}
              <small>PROJECTS</small>
            </div>
          </section>
          <div className="gallery-tools">
            <div className="tabs" aria-label="프로젝트 상태">
              <TabButton selected={status === 'active'} onClick={() => setStatus('active')}>
                진행 중
              </TabButton>
              <TabButton selected={status === 'archived'} onClick={() => setStatus('archived')}>
                보관함
              </TabButton>
            </div>
            <label className="search">
              <span>검색</span>
              <Input
                aria-label="프로젝트 검색"
                placeholder="프로젝트 이름 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          <form className="create-project" onSubmit={(e) => void create(e)}>
            <Input
              aria-label="새 프로젝트 이름"
              placeholder="새 프로젝트 이름"
              maxLength={120}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
            />
            <Button
              type="submit"
              variant="primary"
              className="primary"
              disabled={busy || !projectName.trim()}
            >
              <span aria-hidden="true">＋</span>
              <span>프로젝트 만들기</span>
            </Button>
          </form>
          {loading ? (
            <p role="status">프로젝트를 불러오는 중…</p>
          ) : (
            <section className="project-grid" aria-label="프로젝트 목록">
              {projects.map((project, index) => (
                <article className="project-card" key={project.id}>
                  <div className="card-top">
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <Badge
                      variant="plain"
                      tone={project.status === 'active' ? 'blue' : 'neutral'}
                      className="project-state"
                    >
                      {project.status === 'active' ? '진행 중' : '보관됨'}
                    </Badge>
                  </div>
                  <Button
                    className="project-open"
                    title={project.name}
                    disabled={busy}
                    onClick={() => void open(project.id)}
                  >
                    <h2>{project.name}</h2>
                    <span aria-hidden="true">↗</span>
                  </Button>
                  <p>수정 {new Date(project.updatedAt).toLocaleDateString('ko-KR')}</p>
                  <div className="card-actions">
                    <Button disabled={busy} onClick={() => setRenamingProject(project)}>
                      이름 수정
                    </Button>
                    <Button
                      className={
                        project.status === 'active' ? 'project-archive' : 'project-restore'
                      }
                      disabled={busy}
                      onClick={async () => {
                        if (
                          project.status === 'archived' ||
                          (await confirm({
                            title: '프로젝트 보관',
                            description: `“${project.name}” 프로젝트를 보관할까요? 보관함에서 복원할 수 있습니다.`,
                            confirmLabel: '보관',
                          }))
                        )
                          void changeProject(project, {
                            status: project.status === 'active' ? 'archived' : 'active',
                          });
                      }}
                    >
                      {project.status === 'active' ? '보관' : '복원'}
                    </Button>
                    {project.status === 'archived' && (
                      <Button
                        className="project-delete"
                        variant="danger"
                        disabled={busy}
                        onClick={() => void deleteProject(project)}
                      >
                        삭제
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </section>
          )}
          {!loading && !projects.length && (
            <div className="empty-gallery">
              <span aria-hidden="true">＋</span>
              <h2>
                {search
                  ? '검색 결과가 없습니다'
                  : status === 'archived'
                    ? '보관한 프로젝트가 없습니다'
                    : '첫 설계의 큰 그림을 그려 보세요'}
              </h2>
              <p>
                {search
                  ? '다른 프로젝트 이름으로 검색해 주세요.'
                  : '프로젝트를 만들면 도메인과 업무 관계를 정리할 수 있습니다.'}
              </p>
            </div>
          )}
          <footer>
            <span>EZERD — TEAM WORKSPACE</span>
            <span>명확한 구조. 함께 만드는 설계.</span>
          </footer>
        </main>
      )}
      {renamingProject && (
        <RenameDialog
          title="프로젝트 이름 수정"
          label="프로젝트 이름"
          initialValue={renamingProject.name}
          maxLength={120}
          onCancel={() => setRenamingProject(null)}
          onSave={async (name) => {
            if (await changeProject(renamingProject, { name })) setRenamingProject(null);
          }}
        />
      )}
    </div>
  );
}
