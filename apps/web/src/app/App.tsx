import {
  WorkspacePanel,
  type WorkspacePanelHandle,
} from '../features/workspaces/WorkspacePanel.js';
import { workspacePermissions, type Workspace } from '../features/workspaces/workspace-policy.js';
import { useI18n } from '../shared/i18n/index.js';
import { HelpDialog } from '../features/projects/HelpDialog.js';
import { LanguageDialog } from '../shared/i18n/LanguageDialog.js';
import '../shared/i18n/app-translations.js';
import { PinPanelResizer } from '../features/comments/PinPanelResizer.js';
import { userColorStyle } from '../features/identity/user-color-style.js';
import { UserColorEditor } from '../features/identity/UserColorEditor.js';
import { clampCommentsPanelWidth } from '../features/comments/comments-panel-size.js';
import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from 'react';
import {
  applyChanges,
  diffSharedDocument,
  type DesignDocument,
  mergeStoredPersonalState,
} from '@ezerd/model';
import {
  userSchema,
  projectSchema,
  projectDocumentSchema,
  personalStateSnapshotSchema,
  threadSchema,
  type Thread,
  type Notification,
} from '@ezerd/contracts';
import { ApiError, body, message, newId, request } from '../shared/api/client.js';
import { Canvas } from '../features/canvas/Canvas.js';
import {
  CommentsPanel,
  CommentPins,
  Notifications,
  type CommentContext,
} from '../features/comments/CommentsPanel.js';
import { useConfirm } from '../components/ui/ConfirmProvider.js';
import { LatestRequest } from '../features/comments/comments-state.js';
import {
  ProjectSyncRuntime,
  stableClientId,
  type SyncSession,
  type SyncSnapshot,
} from '../features/collaboration/sync-client.js';
import { SyncHistoryPanel } from '../features/collaboration/sync-history-panel.js';
import { Avatar, Badge, Button, Dropdown, Input } from '../components/ui/index.js';
import '../styles/responsive-shell.css';
import { McpConnectionPanel } from '../features/mcp/McpConnectionPanel.js';
import { exportProjectFile } from '../features/projects/ProjectTransfer.js';
import { ProjectGallery, type GalleryHandle } from '../features/projects/ProjectGallery.js';

type User = {
  id: string;
  username: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};
export type Project = {
  id: string;
  workspaceId: string;
  name: string;
  status: 'active' | 'archived';
  databaseKind?: 'postgresql' | 'mysql' | 'sqlite';
  preview?:
    | {
        tableCount: number;
        relationCount: number;
        tables: { name: string; columns: { name: string; type: string; primaryKey: boolean }[] }[];
      }
    | undefined;
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
async function loadProjectWithPersonal(id: string): Promise<OpenProject> {
  const [projectValue, personalValue] = await Promise.all([
    request(`/api/projects/${id}`),
    request(`/api/projects/${id}/personal-state`).catch(() => null),
  ]);
  const project = projectDocumentSchema.parse(projectValue);
  const personal = personalValue ? personalStateSnapshotSchema.parse(personalValue) : null;
  return {
    project: project.project,
    document: personal
      ? mergeStoredPersonalState(project.document, personal.state)
      : project.document,
  };
}
const identityKey = 'ezerd.userId';
export function cachedIdentitySession(
  raw: string | null,
  userId: string | null,
): SyncSession | null {
  if (!raw || !userId) return null;
  try {
    const value = JSON.parse(raw) as SyncSession & { userId?: string };
    return value.userId === userId &&
      typeof value.token === 'string' &&
      !!value.token &&
      typeof value.baselineIssuedAt === 'string' &&
      Date.parse(value.expiresAt) > Date.now()
      ? value
      : null;
  } catch {
    return null;
  }
}
export function sessionForIdentity(
  previousUserId: string | undefined,
  nextUserId: string,
  session: SyncSession | null,
) {
  return previousUserId === nextUserId && session && Date.parse(session.expiresAt) > Date.now()
    ? session
    : null;
}
export async function clearSignIn(
  revoke: () => Promise<unknown>,
  persistent: Pick<Storage, 'removeItem'>,
  tab: Pick<Storage, 'removeItem'>,
): Promise<'remote' | 'storage' | null> {
  let failure: 'remote' | 'storage' | null = null;
  try {
    await revoke();
  } catch {
    failure = 'remote';
  }
  for (const [storage, key] of [
    [persistent, identityKey],
    [tab, 'ezerd.sync.session'],
  ] as const) {
    try {
      storage.removeItem(key);
    } catch {
      failure = 'storage';
    }
  }
  return failure;
}
export function App() {
  const { t, locale } = useI18n();
  const [editingLanguage, setEditingLanguage] = useState(false);
  const [showingHelp, setShowingHelp] = useState(false);
  const confirm = useConfirm();
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [pathHost, setPathHost] = useState<HTMLDivElement | null>(null);
  const gallery = useRef<GalleryHandle>(null);
  const [draftTarget, setDraftTarget] = useState<CommentContext & { nonce: number }>();
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true);
  const [session, setSession] = useState<SyncSession | null>(null);
  const [editingColor, setEditingColor] = useState(false);
  const [editingMcp, setEditingMcp] = useState(false);
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
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);
  const workspacePanel = useRef<WorkspacePanelHandle>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const selectedWorkspace = workspaces.find((space) => space.id === workspaceId);
  const [projects, setProjects] = useState<Project[]>([]),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState<'active' | 'archived'>('active');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState<OpenProject | null>(null),
    [refresh, setRefresh] = useState(0);
  const projectWorkspace = workspaces.find((space) => space.id === opened?.project.workspaceId);
  const permissions = workspacePermissions(opened ? projectWorkspace : selectedWorkspace);
  const designReadOnly = !permissions.edit || opened?.project.status === 'archived';
  const personalReadOnly = !permissions.personal || opened?.project.status === 'archived';
  const [sync, setSync] = useState<SyncSnapshot | null>(null);
  const latestSync = useRef<SyncSnapshot | null>(null);
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
    latestSync.current = null;
    current.current = value;
    if (value) setWorkspaceId(value.project.workspaceId);
    setOpened(value);
  }
  function restoreHistory(direction: 'undo' | 'redo') {
    if (!current.current || designReadOnly || busy) return;
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
        if (!current.current || designReadOnly || busy) return;
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
    if (gallery.current && !(await gallery.current.flush())) return false;
    if (busy) return false;
    const sameProject = current.current?.project.id === notification.projectId;
    const ticket = navigation.current.begin();
    setBusy(true);
    setError('');
    try {
      const [threadValues, projectValue] = await Promise.all([
        request<unknown[]>(`/api/projects/${notification.projectId}/threads`),
        sameProject ? Promise.resolve(null) : loadProjectWithPersonal(notification.projectId),
      ]);
      if (!navigation.current.isCurrent(ticket)) return false;
      const thread = threadValues
        .map((v) => threadSchema.parse(v))
        .find((t) => t.id === notification.threadId);
      if (!thread) throw new Error(t('알림의 댓글을 찾을 수 없습니다.'));
      if (projectValue) {
        replaceProject(projectValue);
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
    let candidate: SyncSession | null = null;
    const clearCached = () =>
      clearSignIn(
        async () => {},
        { removeItem: (key) => localStorage.removeItem(key) },
        { removeItem: (key) => sessionStorage.removeItem(key) },
      );
    try {
      id = localStorage.getItem(identityKey);
      candidate = cachedIdentitySession(sessionStorage.getItem('ezerd.sync.session'), id);
    } catch {
      /* Private browser storage may be unavailable. */
    }
    if (!id || !candidate) {
      void clearCached();
      setChecking(false);
      return;
    }
    const validatedCandidate = candidate;
    void request(`/api/users/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${validatedCandidate.token}` },
    })
      .then((value) => {
        if (live) {
          const restored = userSchema.parse(value);
          setSession(validatedCandidate);
          setUser(restored);
          setUsername(restored.username);
        }
      })
      .catch(async (e) => {
        if (!live) return;
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          await clearCached();
          if (!live) return;
          setSession(null);
          setUser(null);
        }
        setError(message(e));
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!user || !session) return;
    const controller = new AbortController();
    const load = () =>
      void request<Workspace[]>('/api/workspaces', { signal: controller.signal })
        .then((spaces) => {
          if (controller.signal.aborted) return;
          setWorkspaces(spaces);
          setWorkspacesLoaded(true);
          setWorkspaceId((id) =>
            spaces.some((space) => space.id === id) ? id : (spaces[0]?.id ?? ''),
          );
          if (
            current.current &&
            !spaces.some((space) => space.id === current.current?.project.workspaceId)
          ) {
            replaceProject(null);
            resetReview();
            setError(t('워크스페이스 접근 권한이 변경되었습니다.'));
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted) setError(message(cause));
        });
    load();
    const timer = window.setInterval(load, 15000);
    window.addEventListener('focus', load);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [user?.id, session?.token, refresh]);
  useEffect(() => {
    if (!user || !session || opened || !workspaceId) {
      setProjects([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError((value) => (value === t('워크스페이스 접근 권한이 변경되었습니다.') ? value : ''));
    void request<unknown[]>(
      `/api/projects?workspaceId=${encodeURIComponent(workspaceId)}&status=${status}&search=${encodeURIComponent(search)}`,
      {
        signal: controller.signal,
      },
    )
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
  }, [user, session, opened, workspaceId, status, search, refresh]);
  useEffect(() => {
    if (!opened || !user || !session || !projectWorkspace || opened.project.status === 'archived')
      return;
    const projectId = opened.project.id;
    const instance = new ProjectSyncRuntime({
      projectId,
      userId: user.id,
      clientId: stableClientId(),
      session,
      initialDocument: opened.document,
      sharedReadOnly: designReadOnly,
      personalReadOnly,
      onWorkspaceAccessChange: (id) => {
        if (autosave.current.timer) clearTimeout(autosave.current.timer);
        autosave.current = { composing: false };
        setDraftTarget(undefined);
        setWorkspaces((spaces) => spaces.filter((space) => space.id !== id));
        setRefresh((value) => value + 1);
      },
      onChange: (snapshot) => {
        setSync(snapshot);
        latestSync.current = snapshot;
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
  }, [
    opened?.project.id,
    opened?.project.status,
    projectWorkspace?.role,
    projectWorkspace?.status,
    user?.id,
    session?.token,
  ]);
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
      let nextSession = sessionForIdentity(user?.id, value.id, session);
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
          sessionStorage.setItem(
            'ezerd.sync.session',
            JSON.stringify({ ...nextSession, userId: value.id }),
          );
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
          t('이 브라우저에서는 이름을 기억할 수 없습니다. 다음 방문에 이름을 다시 설정해 주세요.'),
        );
      }
    } catch (e) {
      setError(
        (!user || !session) && e instanceof ApiError && (e.status === 409 || e.status === 401)
          ? t('이미 사용중인 이름이거나 올바르지 않은 PIN 입니다')
          : message(e),
      );
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    const ticket = navigation.current.begin();
    setBusy(true);
    setError('');
    try {
      const value = await loadProjectWithPersonal(id);
      if (!navigation.current.isCurrent(ticket)) return;
      resetReview();
      replaceProject(value);
    } catch (e) {
      if (navigation.current.isCurrent(ticket)) setError(message(e));
    } finally {
      if (navigation.current.isCurrent(ticket)) setBusy(false);
    }
  }
  async function createGalleryProject(
    name: string,
    databaseKind: 'postgresql' | 'mysql' | 'sqlite',
  ) {
    if (!permissions.edit || !workspaceId) throw new Error(t('프로젝트를 만들 수 없습니다.'));
    const project = projectSchema.parse(
      await request('/api/projects', body('POST', { name, databaseKind, workspaceId })),
    );
    setProjects((items) => [project, ...items]);
    setRefresh((value) => value + 1);
  }
  async function changeProject(
    project: Project,
    patch: {
      name?: string;
      databaseKind?: 'postgresql' | 'mysql' | 'sqlite';
      status?: 'active' | 'archived';
    },
  ) {
    if (!permissions.edit) return false;
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
    if (!permissions.deleteProject || busy || project.status !== 'archived') return;
    if (
      !(await confirm({
        title: t('프로젝트 영구 삭제'),
        description: t(
          '“{name}” 프로젝트를 삭제할까요? 도메인, 테이블, 관계, 핀과 답글 및 관련 알림이 함께 삭제되며 복원할 수 없습니다.',
          { name: project.name },
        ),
        confirmLabel: t('영구 삭제'),
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
    if (personalReadOnly || draft.composing || !draft.document) return;
    if (draft.timer) clearTimeout(draft.timer);
    draft.timer = setTimeout(() => {
      void flushAutosave();
    }, 500);
  }
  async function flushAutosave() {
    const draft = autosave.current;
    if (personalReadOnly || draft.composing || !draft.document) return;
    if (draft.timer) clearTimeout(draft.timer);
    const document = draft.document;
    autosave.current = { composing: draft.composing };
    await runtime.current?.edit(document);
  }
  function previewEdit(document: DesignDocument) {
    if (personalReadOnly) return;
    const previous = current.current?.document;
    if (
      !previous ||
      document === previous ||
      (designReadOnly && diffSharedDocument(previous, document).length > 0)
    )
      return;
    const draft = autosave.current;
    draft.base ??= previous;
    draft.document = document;
    applyDocument(document);
  }
  function edit(document: DesignDocument) {
    if (personalReadOnly) return;
    const previous = current.current?.document;
    if (previous && designReadOnly && diffSharedDocument(previous, document).length > 0) return;
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
  async function signOut() {
    if (gallery.current && !(await gallery.current.flush())) return;
    if (busy) return;
    setBusy(true);
    navigation.current.begin();
    if (autosave.current.timer) clearTimeout(autosave.current.timer);
    autosave.current = { composing: false };
    runtime.current?.stop();
    setEditingName(false);
    setEditingColor(false);
    setEditingLanguage(false);
    setEditingMcp(false);
    const failure = await clearSignIn(
      () =>
        request('/api/sessions/logout', { ...body('POST', {}), signal: AbortSignal.timeout(5000) }),
      { removeItem: (key) => localStorage.removeItem(key) },
      { removeItem: (key) => sessionStorage.removeItem(key) },
    );
    replaceProject(null);
    resetReview();
    setSession(null);
    setUser(null);
    setUsername('');
    setRegistrationPin('');
    setWorkspaces([]);
    setWorkspacesLoaded(false);
    setWorkspaceId('');
    setProjects([]);
    setMembers([]);
    setCommentsOpen(false);
    setSearch('');
    setStatus('active');
    setBusy(false);
    setError(
      failure === 'remote'
        ? t('이 브라우저에서 로그아웃했습니다. 서버 세션 종료는 확인하지 못했습니다.')
        : failure === 'storage'
          ? t('브라우저의 로그인 정보를 지우지 못했습니다. 이 탭을 닫아 주세요.')
          : '',
    );
  }
  const workspaceSwitchPending = useRef(false);
  async function selectWorkspace(id: string) {
    if (gallery.current && !(await gallery.current.flush())) return;
    if (workspaceSwitchPending.current || busy || (id === workspaceId && !current.current)) return;
    workspaceSwitchPending.current = true;
    setBusy(true);
    setError('');
    const ticket = navigation.current.begin();
    try {
      await flushAutosave();
      await runtime.current?.prepareToLeave();
      if (!navigation.current.isCurrent(ticket)) return;
      resetReview();
      replaceProject(null);
      setWorkspaceId(id);
      setProjects([]);
      setSearch('');
      setStatus('active');
      setCommentsOpen(false);
    } catch (cause) {
      if (navigation.current.isCurrent(ticket)) setError(message(cause));
    } finally {
      workspaceSwitchPending.current = false;
      if (navigation.current.isCurrent(ticket)) setBusy(false);
    }
  }
  async function leave() {
    if (gallery.current && !(await gallery.current.flush())) return;
    if (
      current.current &&
      !(await confirm({
        title: t('갤러리로 이동할까요?'),
        description: t('현재 프로젝트를 닫고 프로젝트 갤러리로 이동합니다.'),
        confirmLabel: t('갤러리로 이동'),
      }))
    )
      return;
    await flushAutosave();
    navigation.current.begin();
    setBusy(false);
    resetReview();
    replaceProject(null);
  }
  async function restoreDeletion(operationId: string) {
    const value = current.current;
    if (!value || !session || historyAction || designReadOnly) return;
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
        throw new Error(outcome.result.reason ?? t('삭제 항목을 복원하지 못했습니다.'));
      setHistoryNotice(
        outcome.omittedRelations.length
          ? t(
              '삭제 항목을 새 객체로 복원했습니다. 현재 구조에서 유효하지 않은 관계·배치 {count}개는 제외했습니다: {items}',
              {
                count: outcome.omittedRelations.length,
                items: outcome.omittedRelations.join(', '),
              },
            )
          : t('삭제 항목을 새 객체로 복원했습니다.'),
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
    if (!instance || historyAction || (action === 'reapply' && designReadOnly)) return;
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
      <label htmlFor="username">{t('함께 사용할 이름')}</label>
      <Input
        id="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        maxLength={40}
        required
        autoComplete="nickname"
        autoFocus
        placeholder={t('예: 김설계')}
      />
      {(!user || !session) && (
        <>
          <label htmlFor="registration-pin">{t('사용자 PIN (숫자 4자리)')}</label>
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
            placeholder={t('숫자 4자리')}
          />
        </>
      )}
      <p>
        {user && !session
          ? t('동기화를 계속하려면 기존 PIN으로 로그인해 주세요.')
          : user
            ? t('이 이름으로 팀에 표시됩니다. 기존 PIN은 유지됩니다.')
            : t('이름과 PIN 조합으로 사용자를 구분합니다.')}
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
            ? t('확인 중…')
            : user && !session
              ? t('로그인 →')
              : user
                ? t('이름 저장')
                : t('워크스페이스 시작하기 →')}
        </Button>
        {user && (
          <Button type="button" onClick={() => setEditingName(false)}>
            {t('취소')}
          </Button>
        )}
      </div>
    </form>
  );
  return (
    <div className={opened ? 'app-shell editor-shell' : 'app-shell'}>
      <a className="skip-link" href="#main">
        {t('본문으로 이동')}
      </a>
      <header
        className="app-header"
        onPointerDownCapture={() => {
          void gallery.current?.flush();
        }}
        onFocusCapture={() => {
          void gallery.current?.flush();
        }}
      >
        <Button className="brand" onClick={leave} aria-label={t('EZERD 프로젝트 갤러리')}>
          EZERD<span>.</span>
        </Button>
        {user ? (
          <WorkspacePanel
            ref={workspacePanel}
            workspaces={workspaces}
            selected={selectedWorkspace}
            disabled={busy}
            onSelect={(id) => void selectWorkspace(id)}
            onRefresh={() => setRefresh((value) => value + 1)}
          />
        ) : (
          <span className="header-caption">
            A SHARED SPACE
            <br />
            FOR CLEAR THINKING.
          </span>
        )}
        {user && <Notifications userId={user.id} onNavigate={visitNotification} />}
        {user && (
          <Dropdown
            label={t('사용자 메뉴')}
            items={[
              {
                id: 'rename',
                label: t('이름 변경'),
                onAction: () => {
                  setEditingColor(false);
                  setEditingName(true);
                },
              },
              {
                id: 'color',
                label: t('색상 변경'),
                onAction: () => {
                  setEditingName(false);
                  setEditingColor(true);
                },
              },
              {
                id: 'language',
                label: t('언어 변경'),
                onAction: () => {
                  setEditingName(false);
                  setEditingColor(false);
                  setEditingMcp(false);
                  setEditingLanguage(true);
                },
              },
              {
                id: 'sign-out',
                label: t('로그아웃'),
                disabled: busy,
                onAction: () => {
                  void signOut();
                },
              },
              {
                id: 'mcp',
                label: t('MCP 연결'),
                onAction: () => {
                  setEditingName(false);
                  setEditingColor(false);
                  setEditingMcp(true);
                },
              },
              {
                id: 'help',
                label: t('도움말'),
                onAction: () => {
                  setEditingName(false);
                  setEditingColor(false);
                  setEditingMcp(false);
                  setShowingHelp(true);
                },
              },
            ]}
            trigger={
              <Button
                className="user-button"
                aria-label={t('{name}, 사용자 메뉴', { name: user.username })}
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
      {showingHelp && <HelpDialog onClose={() => setShowingHelp(false)} />}
      {editingLanguage && <LanguageDialog onClose={() => setEditingLanguage(false)} />}
      {editingColor && user && (
        <UserColorEditor
          key={user.id}
          user={user}
          onSaved={setUser}
          onClose={() => setEditingColor(false)}
        />
      )}
      {editingName && (
        <section className="identity-popover" aria-label={t('이름 변경')}>
          {userForm}
        </section>
      )}
      {editingMcp && user && session && <McpConnectionPanel onClose={() => setEditingMcp(false)} />}
      {error && (
        <div className="notice error" role="alert">
          {t(error)}
          <Button onClick={() => setRefresh((v) => v + 1)}>{t('다시 확인')}</Button>
        </div>
      )}
      {checking ? (
        <main id="main" className="gallery">
          <p role="status">{t('워크스페이스를 여는 중…')}</p>
        </main>
      ) : !user || !session ? (
        <main id="main" className="welcome">
          <p className="eyebrow">01 / WELCOME TO EZERD</p>
          <h1>
            {t('명확한 구조.')}
            <br />
            {t('함께 만드는 설계')}
            <span>.</span>
          </h1>
          <p className="intro">
            {t('큰 그림을 연결하고, 데이터의 흐름을 정리하세요.')}
            <br />
            {t('이름 하나로 우리 팀의 설계를 시작합니다.')}
          </p>
          {userForm}
        </main>
      ) : opened ? (
        <main id="main" className="editor" inert={workspaceSwitchPending.current}>
          <div className="editor-heading">
            <div className="project-title" role="group" aria-label={t('프로젝트 이동')}>
              <Button className="gallery-return" onClick={leave}>
                {t('← 갤러리')}
              </Button>
              <span className="navigation-divider" aria-hidden="true" />
              <h1 title={opened.project.name}>{opened.project.name}</h1>
              <div className="editor-path-host" ref={setPathHost} />
            </div>
            <div className="editor-toolbar-host" ref={setToolbarHost} />
            <div className="save-controls" role="group" aria-label={t('변경 기록과 동기화')}>
              <Button
                aria-label={t('실행 취소')}
                title={t('실행 취소 (Ctrl+Z / ⌘Z)')}
                disabled={busy || designReadOnly || !sync?.canUndo}
                onClick={() => restoreHistory('undo')}
              >
                ↶
              </Button>
              <Button
                aria-label={t('다시 실행')}
                title={t('다시 실행 (Ctrl+Shift+Z / ⌘⇧Z)')}
                disabled={busy || designReadOnly || !sync?.canRedo}
                onClick={() => restoreHistory('redo')}
              >
                ↷
              </Button>
              <span
                role="status"
                className={`save-state ${sync?.status === 'action-needed' ? 'failed' : ''}`}
              >
                {sync?.status === 'syncing'
                  ? t('◌ 동기화 중')
                  : sync?.status === 'offline'
                    ? t('○ 오프라인')
                    : sync?.status === 'action-needed'
                      ? t('! 확인 필요')
                      : t('✓ 동기화됨')}
              </span>
              <SyncHistoryPanel
                readOnly={designReadOnly}
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
          {projectWorkspace?.status === 'archived' && (
            <div className="notice">
              {t('이 워크스페이스는 보관되어 있습니다. 소유자가 복원하면 다시 편집할 수 있습니다.')}
            </div>
          )}
          {projectWorkspace?.status === 'active' && projectWorkspace.role === 'viewer' && (
            <div className="notice">
              {t('뷰어 권한입니다. 설계를 조회하고 핀과 댓글을 남길 수 있습니다.')}
            </div>
          )}
          {opened.project.status === 'archived' && (
            <div className="notice">
              {t('보관한 프로젝트입니다. 갤러리에서 복원하면 편집할 수 있습니다.')}
            </div>
          )}
          {(sync?.storageFailure || sync?.error) && (
            <div className="notice error" role="alert">
              {t(sync.storageFailure ?? sync.error ?? '')}
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
              onExportProject={async () => {
                await flushAutosave();
                await runtime.current?.prepareToLeave();
                if (latestSync.current?.pending.length || latestSync.current?.storageFailure)
                  throw new Error(t('변경 내용이 저장된 뒤 다시 내보내 주세요.'));
                await exportProjectFile(opened.project.id);
              }}
              toolbarHost={toolbarHost}
              pathHost={pathHost}
              panelToggle={
                <Button
                  className="panel-toggle"
                  aria-label={commentsOpen ? t('핀 패널 숨기기') : t('핀 패널 열기')}
                  title={commentsOpen ? t('핀 패널 숨기기') : t('핀 패널 열기')}
                  aria-pressed={commentsOpen}
                  onClick={() => {
                    setDraftTarget(undefined);
                    setCommentsOpen((v) => !v);
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <rect x="3" y="4" width="14" height="9" rx="2.5" />
                    <path d="M7 13v3.2L10.6 13" />
                  </svg>
                </Button>
              }
              onChange={edit}
              onPreviewChange={previewEdit}
              readOnly={designReadOnly}
              personalReadOnly={personalReadOnly}
              onContextChange={setCanvasContext}
              {...(!personalReadOnly
                ? {
                    onCreatePin: (context: CommentContext) => {
                      setCanvasContext(context);
                      setFocusTarget(undefined);
                      setDraftTarget({ ...context, selectedObjectId: null, nonce: Date.now() });
                      setCommentsOpen(true);
                    },
                  }
                : {})}
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
                readOnly={personalReadOnly}
                workspaceId={opened.project.workspaceId}
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
        <ProjectGallery
          key={workspaceId}
          ref={gallery}
          workspace={selectedWorkspace}
          workspaceId={workspaceId}
          needsWorkspace={workspacesLoaded && workspaces.length === 0}
          onCreateWorkspace={() => workspacePanel.current?.openCreate()}
          projects={projects}
          loading={loading}
          busy={busy}
          canEdit={permissions.edit}
          canDelete={permissions.deleteProject}
          status={status}
          search={search}
          onSearch={setSearch}
          onStatus={setStatus}
          onCreate={createGalleryProject}
          onEdit={changeProject}
          onOpen={(id) => void open(id)}
          onExport={async (project) => {
            setBusy(true);
            setError('');
            try {
              await exportProjectFile(project.id);
            } catch (cause) {
              setError(message(cause));
            } finally {
              setBusy(false);
            }
          }}
          onArchive={async (project) => {
            if (
              project.status === 'archived' ||
              (await confirm({
                title: t('프로젝트 보관'),
                description: t('“{name}” 프로젝트를 보관할까요? 보관함에서 복원할 수 있습니다.', {
                  name: project.name,
                }),
                confirmLabel: t('보관'),
              }))
            )
              await changeProject(project, {
                status: project.status === 'active' ? 'archived' : 'active',
              });
          }}
          onDelete={(project) => void deleteProject(project)}
          onImported={() => {
            setStatus('active');
            setSearch('');
            setError('');
            setRefresh((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
