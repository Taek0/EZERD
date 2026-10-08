import {
  WorkspacePanel,
  type WorkspacePanelHandle,
} from '../features/workspaces/WorkspacePanel.js';
import { workspacePermissions, type Workspace } from '../features/workspaces/workspace-policy.js';
import { useI18n } from '../shared/i18n/index.js';
import { HelpDialog } from '../features/projects/HelpDialog.js';
import { LanguageDialog } from '../shared/i18n/LanguageDialog.js';
import '../shared/i18n/app-translations.js';
import { userColorStyle } from '../features/identity/user-color-style.js';
import { UserColorEditor } from '../features/identity/UserColorEditor.js';
import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  userSchema,
  projectSchema,
  threadSchema,
  type Thread,
  type Notification,
  type ProjectDDLExport,
} from '@ezerd/contracts';
import { ApiError, body, message, request } from '../shared/api/client.js';
import { Notifications } from '../features/comments/CommentsPanel.js';
import { useConfirm } from '../components/ui/ConfirmProvider.js';
import { LatestRequest } from '../features/comments/comments-state.js';
import type { SyncSession } from '../shared/api/session.js';
import { Avatar, Button, Dropdown, Input } from '../components/ui/index.js';
import '../styles/responsive-shell.css';
import { McpConnectionPanel } from '../features/mcp/McpConnectionPanel.js';
import { exportProjectFile } from '../features/projects/ProjectTransfer.js';
import { ProjectGallery, type GalleryHandle } from '../features/projects/ProjectGallery.js';
import {
  galleryProjectCreationInput,
  type GalleryProjectCreationOptions,
} from '../features/projects/project-create.js';
import { previewDatabaseChange } from '../features/projects/database-preview.js';
import {
  NativeGalleryConversion,
  type NativeGalleryConversionHandle,
} from '../features/projects/NativeGalleryConversion.js';
import {
  fetchGalleryDatabaseSnapshot,
  loadGalleryDatabaseConversion,
  loadGalleryProjectForOpen,
  galleryConversionMatchesInput,
  prepareGalleryDatabaseConversion,
  saveNativeGalleryName,
  type NativeGalleryConversionOptions,
} from '../features/projects/native-gallery-conversion.js';
import { loadProjectEntry, type ProjectEntry } from '../features/projects/project-entry.js';
import { NativeProjectView } from '../features/projects/NativeProjectView.js';
import { NativeBackgroundRefresh } from '../features/projects/native-background-refresh.js';
import { nativeEntryAfterAck } from '../features/projects/native-ack-entry.js';
import { NativeProjectActions } from '../features/projects/NativeProjectActions.js';
import { ProjectDDLDialog } from '../features/projects/ProjectDDLDialog.js';
import {
  assertNativeExportReady,
  fetchProjectDDL,
  confirmProjectDDLSnapshot,
  downloadProjectDDL,
} from '../features/projects/project-ddl-export.js';
import { exportVersionedProjectFile } from '../features/projects/project-versioned-export.js';
import { nativeEditorExportBlocked } from '../features/projects/native-export-state.js';

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
  databaseRevision?: number | undefined;
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
  const gallery = useRef<GalleryHandle>(null);
  const galleryConversion = useRef<NativeGalleryConversionHandle>(null);
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true);
  const [session, setSession] = useState<SyncSession | null>(null);
  const [editingColor, setEditingColor] = useState(false);
  const [editingMcp, setEditingMcp] = useState(false);
  const [registrationPin, setRegistrationPin] = useState('');
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
  const [refresh, setRefresh] = useState(0);
  const [nativeOpened, setNativeOpened] = useState<Extract<
    ProjectEntry,
    { kind: 'native' }
  > | null>(null);
  const nativeCurrent = useRef(nativeOpened);
  // Updated with each accepted snapshot, independently of deferred presentation renders.
  const activeProject = nativeOpened?.snapshot.project;
  const [ddlExport, setDDLExport] = useState<{
    actorId: string;
    result: ProjectDDLExport;
    onFocusIssue?: (id: string) => void;
  } | null>(null);
  const ddlCurrent = useRef(ddlExport);
  ddlCurrent.current = ddlExport;
  const currentExportIdentity = useRef({ userId: user?.id, projectId: activeProject?.id });
  currentExportIdentity.current = { userId: user?.id, projectId: activeProject?.id };
  const projectWorkspace = workspaces.find((space) => space.id === activeProject?.workspaceId);
  const permissions = workspacePermissions(activeProject ? projectWorkspace : selectedWorkspace);
  const galleryIdentity = useRef({
    userId: user?.id,
    workspaceId,
    canEdit: workspacePermissions(selectedWorkspace).edit,
  });
  galleryIdentity.current = {
    userId: user?.id,
    workspaceId,
    canEdit: workspacePermissions(selectedWorkspace).edit,
  };
  function galleryConversionOptions(projectId: string): NativeGalleryConversionOptions {
    if (!user) throw Error('database.change-scope-invalid');
    return {
      control: {
        scope: { userId: user.id, workspaceId, projectId },
        currentScope: () =>
          galleryIdentity.current.userId
            ? {
                userId: galleryIdentity.current.userId,
                workspaceId: galleryIdentity.current.workspaceId,
                projectId,
              }
            : null,
      },
      canEdit: () => galleryIdentity.current.canEdit,
    };
  }
  async function prepareProjectExport(projectId: string) {
    if (
      !user ||
      currentExportIdentity.current.userId !== user.id ||
      currentExportIdentity.current.projectId !== projectId
    )
      throw Error(t('프로젝트가 변경되었습니다. 최신 프로젝트에서 다시 내보내 주세요.'));
    try {
      if (nativeEditorExportBlocked(user.id, projectId))
        throw Error('project-export.unsaved-draft');
      await assertNativeExportReady(user.id, projectId);
    } catch {
      throw Error(t('보관된 미저장 입력 또는 미확인 저장 요청을 확인한 뒤 다시 내보내 주세요.'));
    }
  }
  async function openProjectDDL(
    projectId: string,
    revision: number,
    onFocusIssue?: (id: string) => void,
  ) {
    if (!user) return;
    await prepareProjectExport(projectId);
    const result = await fetchProjectDDL(projectId, revision);
    if (
      currentExportIdentity.current.userId !== user.id ||
      currentExportIdentity.current.projectId !== projectId
    )
      return;
    setDDLExport({ actorId: user.id, result, ...(onFocusIssue ? { onFocusIssue } : {}) });
  }
  const [nativeReview, setNativeReview] = useState<Thread | null>(null);
  const navigation = useRef(new LatestRequest());
  const nativeNavigationGeneration = useRef(0);
  const nativeRefreshIdentity = useRef('');
  nativeRefreshIdentity.current = JSON.stringify([user?.id, session?.token]);
  const nativeBackgroundRefresh = useRef<NativeBackgroundRefresh | null>(null);
  if (!nativeBackgroundRefresh.current) {
    nativeBackgroundRefresh.current = new NativeBackgroundRefresh({
      current: () =>
        nativeCurrent.current
          ? {
              identity: `${nativeRefreshIdentity.current}:${nativeNavigationGeneration.current}`,
              entry: nativeCurrent.current,
            }
          : null,
      apply: (entry) => {
        nativeCurrent.current = entry;
        startTransition(() => setNativeOpened(entry));
        setWorkspaceId(entry.snapshot.project.workspaceId);
      },
      error: (cause) => setError(message(cause)),
    });
  }
  function closeProject() {
    nativeNavigationGeneration.current++;
    nativeCurrent.current = null;
    setNativeOpened(null);
    setNativeReview(null);
  }
  function replaceEntry(entry: ProjectEntry) {
    closeProject();
    nativeCurrent.current = entry;
    setNativeOpened(entry);
    setWorkspaceId(entry.snapshot.project.workspaceId);
  }
  async function visitNotification(notification: Notification): Promise<boolean> {
    if (gallery.current && !(await gallery.current.flush())) return false;
    if (busy) return false;
    const sameProject = nativeCurrent.current?.snapshot.project.id === notification.projectId;
    const ticket = navigation.current.begin();
    setBusy(true);
    setError('');
    try {
      const [threadValues, projectValue] = await Promise.all([
        request<unknown[]>(`/api/projects/${notification.projectId}/threads`),
        sameProject ? Promise.resolve(null) : loadProjectEntry(notification.projectId),
      ]);
      if (!navigation.current.isCurrent(ticket)) return false;
      const thread = threadValues
        .map((v) => threadSchema.parse(v))
        .find((t) => t.id === notification.threadId);
      if (!thread) throw new Error(t('알림의 댓글을 찾을 수 없습니다.'));
      if (projectValue) {
        if (!navigation.current.isCurrent(ticket)) return false;
        replaceEntry(projectValue);
      }
      setNativeReview(thread);
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
            nativeCurrent.current &&
            !spaces.some(
              (space) => space.id === nativeCurrent.current?.snapshot.project.workspaceId,
            )
          ) {
            closeProject();
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
    if (!user || !session || nativeOpened || !workspaceId) {
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
  }, [user, session, nativeOpened, workspaceId, status, search, refresh]);
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
      const result = user
        ? await loadGalleryProjectForOpen(id, galleryConversionOptions(id))
        : { kind: 'open' as const, entry: await loadProjectEntry(id) };
      if (result.kind === 'recover') {
        if (navigation.current.isCurrent(ticket)) await galleryConversion.current?.recover(id);
        return;
      }
      const value = result.entry;
      if (!navigation.current.isCurrent(ticket)) return;
      if (!navigation.current.isCurrent(ticket)) return;
      replaceEntry(value);
    } catch (e) {
      if (navigation.current.isCurrent(ticket)) setError(message(e));
    } finally {
      if (navigation.current.isCurrent(ticket)) setBusy(false);
    }
  }
  async function createGalleryProject(
    name: string,
    databaseKind: 'postgresql' | 'mysql' | 'sqlite',
    options: GalleryProjectCreationOptions = { formatVersion: 2 },
  ) {
    if (!permissions.edit || !workspaceId) throw new Error(t('프로젝트를 만들 수 없습니다.'));
    const project = projectSchema.parse(
      await request(
        '/api/projects',
        body('POST', galleryProjectCreationInput(workspaceId, name, databaseKind, options)),
      ),
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
      if (patch.databaseKind) {
        const options = galleryConversionOptions(project.id);
        const snapshot = await fetchGalleryDatabaseSnapshot(options);
        if (snapshot.sourceDocument.schemaVersion === 2) {
          const pending = await loadGalleryDatabaseConversion(options);
          if (pending) {
            const confirmed = await galleryConversion.current?.recover(project.id);
            return confirmed === true && galleryConversionMatchesInput(pending, patch);
          }
          if (patch.databaseKind !== snapshot.project.databaseKind) {
            const plan = await prepareGalleryDatabaseConversion(
              snapshot,
              patch.databaseKind,
              patch.name,
              options,
            );
            return (await galleryConversion.current?.review(plan)) ?? false;
          }
          const renamed = await saveNativeGalleryName(snapshot, patch.name, options);
          setProjects((items) => items.map((item) => (item.id === renamed.id ? renamed : item)));
          setRefresh((v) => v + 1);
          return true;
        }
        await previewDatabaseChange(project, patch.databaseKind);
      }
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
  async function signOut() {
    if (gallery.current && !(await gallery.current.flush())) return;
    if (busy) return;
    setBusy(true);
    navigation.current.begin();
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
    closeProject();
    setSession(null);
    setUser(null);
    setUsername('');
    setRegistrationPin('');
    setWorkspaces([]);
    setWorkspacesLoaded(false);
    setWorkspaceId('');
    setProjects([]);
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
    if (workspaceSwitchPending.current || busy || (id === workspaceId && !nativeCurrent.current))
      return;
    workspaceSwitchPending.current = true;
    setBusy(true);
    setError('');
    const ticket = navigation.current.begin();
    try {
      if (!navigation.current.isCurrent(ticket)) return;
      closeProject();
      setWorkspaceId(id);
      setProjects([]);
      setSearch('');
      setStatus('active');
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
      nativeCurrent.current &&
      !(await confirm({
        title: t('갤러리로 이동할까요?'),
        description: t('현재 프로젝트를 닫고 프로젝트 갤러리로 이동합니다.'),
        confirmLabel: t('갤러리로 이동'),
      }))
    )
      return;
    navigation.current.begin();
    setBusy(false);
    closeProject();
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
    <div className={nativeOpened ? 'app-shell editor-shell' : 'app-shell'}>
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
      ) : nativeOpened ? (
        <NativeProjectView
          key={nativeOpened.snapshot.project.id}
          entry={nativeOpened}
          onLeave={() => void leave()}
          onReload={() => void nativeBackgroundRefresh.current?.refresh()}
          onAcknowledged={(ack) => {
            const current = nativeCurrent.current;
            if (
              !current ||
              current.snapshot.project.id !== nativeOpened.snapshot.project.id ||
              ack.actor.id !== user.id
            )
              return false;
            try {
              const next = nativeEntryAfterAck(current, ack);
              if (!next) return false;
              if (next !== current) {
                nativeCurrent.current = next;
                startTransition(() => setNativeOpened(next));
              }
              return true;
            } catch {
              // The write is already accepted; fall back to reconciliation without losing its ACK.
              return false;
            }
          }}
          busy={busy}
          userId={user.id}
          canEdit={permissions.edit}
          canPersonalEdit={permissions.personal}
          {...(projectWorkspace
            ? { workspaceStatus: projectWorkspace.status, workspaceRole: projectWorkspace.role }
            : {})}
          projectActions={(focus, png) => (
            <NativeProjectActions
              userId={user.id}
              projectId={nativeOpened.snapshot.project.id}
              png={png}
              onExportProject={async () => {
                await prepareProjectExport(nativeOpened.snapshot.project.id);
                await exportVersionedProjectFile(
                  nativeOpened.snapshot.project.id,
                  nativeOpened.snapshot.project.databaseRevision,
                );
              }}
              onExportDDL={() =>
                openProjectDDL(
                  nativeOpened.snapshot.project.id,
                  nativeOpened.snapshot.project.databaseRevision,
                  focus,
                )
              }
            />
          )}
          {...(nativeReview ? { focusedReview: nativeReview } : {})}
        />
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
      {user && session && workspaceId && (
        <NativeGalleryConversion
          key={`database-change:${user.id}:${workspaceId}`}
          ref={galleryConversion}
          userId={user.id}
          workspaceId={workspaceId}
          projects={projects}
          canEdit={workspacePermissions(selectedWorkspace).edit}
          onSaved={(project) => {
            setProjects((items) => items.map((item) => (item.id === project.id ? project : item)));
            setRefresh((value) => value + 1);
          }}
        />
      )}
      {user &&
        ddlExport?.actorId === user.id &&
        ddlExport.result.projectId === activeProject?.id && (
          <ProjectDDLDialog
            key={`ddl:${ddlExport.actorId}:${ddlExport.result.projectId}`}
            result={ddlExport.result}
            onClose={() => {
              ddlCurrent.current = null;
              setDDLExport(null);
            }}
            objectName={(id) => {
              const doc = nativeOpened?.document;
              const item =
                doc?.tables?.find((item) => item.id === id) ??
                doc?.columns?.find((item) => item.id === id);
              if (item) return item.physical.name || item.logical.name || id;
              const key = doc?.keys?.find((item) => item.id === id),
                relation = doc?.tableRelations?.find((item) => item.id === id),
                enumeration = doc?.enums?.find((item) => item.id === id);
              if (key) return key.name || t('키');
              if (relation) return relation.physical?.name || relation.logical.name || t('외래 키');
              if (enumeration) return enumeration.name || 'ENUM';
              if (doc?.schemaVersion === 2)
                return (
                  doc.indexes?.find((item) => item.id === id)?.name ||
                  doc.checks?.find((item) => item.id === id)?.name ||
                  id
                );
              return id;
            }}
            {...(ddlExport.onFocusIssue ? { onFocusIssue: ddlExport.onFocusIssue } : {})}
            onRegenerate={() =>
              openProjectDDL(
                ddlExport.result.projectId,
                ddlExport.result.database.revision,
                ddlExport.onFocusIssue,
              )
            }
            onDownload={async () => {
              const expected = ddlExport;
              await prepareProjectExport(expected.result.projectId);
              await confirmProjectDDLSnapshot(expected.result);
              if (
                ddlCurrent.current !== expected ||
                currentExportIdentity.current.userId !== expected.actorId ||
                currentExportIdentity.current.projectId !== expected.result.projectId
              )
                return;
              downloadProjectDDL(expected.result);
            }}
          />
        )}
    </div>
  );
}
