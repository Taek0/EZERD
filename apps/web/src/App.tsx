import { userColorStyle } from './user-color-style.js';
import { UserColorEditor } from './UserColorEditor.js';
import { clampCommentsPanelWidth } from './comments-panel-size.js';
import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from 'react';
import { type DesignDocument, createEmptyDocument } from '@ezerd/model';
import { userSchema, projectSchema, projectDocumentSchema, designDocumentSchema, threadSchema, type Thread, type Notification } from '@ezerd/contracts';
import { ApiError, SaveGate, body, message, request, acknowledgeSave } from './client.js';
import { Canvas } from './Canvas.js';
import { CommentsPanel, CommentPins, Notifications, type CommentContext } from './CommentsPanel.js';
import { RenameDialog } from './components/ui/RenameDialog.js';
import { useConfirm } from './components/ui/ConfirmProvider.js';
import { LatestRequest } from './comments-state.js';
import { DocumentHistory, documentEditGroup, mergeHistoryViewports } from './document-history.js';
import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Input,
  TabButton,
} from './components/ui/index.js';

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
type OpenProject = {
  project: Project;
  document: DesignDocument;
};
const identityKey = 'ezerd.userId';
export function App() {
  const confirm = useConfirm();
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [draftTarget, setDraftTarget] = useState<(CommentContext & { nonce: number })>();
  const [user, setUser] = useState<User | null>(null), [checking, setChecking] = useState(true);
  const [editingColor,setEditingColor]=useState(false);
  const [registrationPin,setRegistrationPin]=useState('');
  const [members,setMembers]=useState<Array<{id:string;username:string;color?:string}>>([]);
  const [commentsPanelWidth,setCommentsPanelWidth]=useState(()=>{try{return clampCommentsPanelWidth(localStorage.getItem('ezerd.commentsPanelWidth'));}catch{return 340;}});
  function resizeCommentsPanel(width:number){const next=clampCommentsPanelWidth(width);setCommentsPanelWidth(next);try{localStorage.setItem('ezerd.commentsPanelWidth',String(next));}catch{}}
  const [username, setUsername] = useState(''), [editingName, setEditingName] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]), [search, setSearch] = useState(''), [status, setStatus] = useState<'active' | 'archived'>('active');
  const [projectName, setProjectName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState<OpenProject | null>(null), [revision, setRevision] = useState(0), [saved, setSaved] = useState(0);
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState(''), [conflict, setConflict] = useState(false), [refresh, setRefresh] = useState(0);
  const current = useRef(opened), rev = useRef(revision), saveLock = useRef(new SaveGate());
  const history = useRef<DocumentHistory<DesignDocument> | null>(null);
  current.current = opened;
  rev.current = revision;
  const dirty = revision !== saved;
  const [commentsOpen, setCommentsOpen] = useState(false), [threads, setThreads] = useState<Thread[]>([]);
  const [canvasContext, setCanvasContext] = useState<CommentContext>({ viewId: 'overview', selectedObjectId: null, position: { x: 120, y: 120 } });
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
    history.current = value ? new DocumentHistory(value.document) : null;
    current.current = value;
    rev.current = 0;
    setOpened(value);
    setRevision(0);
    setSaved(0);
  }
  function restoreHistory(direction: 'undo' | 'redo') {
    const value = current.current;
    if (!value || value.project.status === 'archived' || busy) return;
    const restored = history.current?.[direction]();
    if (restored) {
      const document = mergeHistoryViewports(restored, value.document);
      history.current?.replaceCurrent(document);
      applyDocument(document);
    }
  }
  useEffect(() => {
    const endGroup = () => history.current?.endGroup();
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      const editable = target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      if (editable || event.isComposing || event.defaultPrevented || document.querySelector('dialog[open], [aria-modal="true"]')) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === 'z' || key === 'y')) {
        if (!current.current || current.current.project.status === 'archived' || busy) return;
        event.preventDefault();
        restoreHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
      } else if (!event.repeat) endGroup();
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('pointerdown', endGroup, true);
    window.addEventListener('pointerup', endGroup);
    window.addEventListener('pointercancel', endGroup);
    window.addEventListener('focusout', endGroup);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('pointerdown', endGroup, true);
      window.removeEventListener('pointerup', endGroup);
      window.removeEventListener('pointercancel', endGroup);
      window.removeEventListener('focusout', endGroup);
    };
  });
  function focusThread(thread: Thread) {
    setDraftTarget(undefined);
    setCommentsOpen(true);
    setFocusTarget({ viewId: thread.viewId, objectId: thread.objectId, threadId: thread.id, x: thread.x, y: thread.y, nonce: Date.now() });
  }
  function resetReview() {
    setDraftTarget(undefined);
    setThreads([]);
    setFocusTarget(undefined);
    setCanvasContext({ viewId: 'overview', selectedObjectId: null, position: { x: 120, y: 120 } });
  }
  async function visitNotification(notification: Notification): Promise<boolean> {
    if (saving || busy)
      return false;
    const sameProject = current.current?.project.id === notification.projectId;
    if (!sameProject && dirty && !await confirm({ title: '프로젝트 이동', description: '저장하지 않은 변경을 버리고 알림의 프로젝트로 이동할까요?', confirmLabel: '이동', destructive: true }))
      return false;
    const ticket = navigation.current.begin();
    const startingRevision = rev.current;
    setBusy(true);
    setError('');
    try {
      const [threadValues, projectValue] = await Promise.all([
        request<unknown[]>(`/api/projects/${notification.projectId}/threads`),
        sameProject ? Promise.resolve(null) : request(`/api/projects/${notification.projectId}`),
      ]);
      if (!navigation.current.isCurrent(ticket))
        return false;
      const thread = threadValues.map(v => threadSchema.parse(v)).find(t => t.id === notification.threadId);
      if (!thread)
        throw new Error('알림의 댓글을 찾을 수 없습니다.');
      if (projectValue) {
        if (rev.current !== startingRevision && !await confirm({ title: '프로젝트 이동', description: '이동을 준비하는 동안 추가한 변경을 버리고 이동할까요?', confirmLabel: '이동', destructive: true }))
          return false;
        replaceProject(projectDocumentSchema.parse(projectValue));
        setRevision(0);
        setSaved(0);
        setSaveError('');
        setConflict(false);
        resetReview();
      }
      focusThread(thread);
      return true;
    }
    catch (e) {
      if (navigation.current.isCurrent(ticket))
        setError(message(e));
      return false;
    }
    finally {
      if (navigation.current.isCurrent(ticket))
        setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    let id: string | null = null;
    try {
      id = localStorage.getItem(identityKey);
    }
    catch { /* private browser storage may be unavailable */ }
    if (!id) {
      setChecking(false);
      return;
    }
    void request(`/api/users/${encodeURIComponent(id)}`).then(value => {
      if (live) {
        const restored = userSchema.parse(value);
        setUser(restored);
        setUsername(restored.username);
      }
    }).catch(e => {
      if (live)
        setError(message(e));
    }).finally(() => {
      if (live)
        setChecking(false);
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!user || opened)
      return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void request<unknown[]>(`/api/projects?status=${status}&search=${encodeURIComponent(search)}`, { signal: controller.signal }).then(values => {
      if (!controller.signal.aborted)
        setProjects(values.map(v => projectSchema.parse(v)));
    }).catch(e => {
      if (!controller.signal.aborted)
        setError(message(e));
    }).finally(() => {
      if (!controller.signal.aborted)
        setLoading(false);
    });
    return () => controller.abort();
  }, [user, opened, status, search, refresh]);
  useEffect(() => {
    if (!dirty && !saving)
      return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, saving]);
  async function identify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const value = userSchema.parse(await request(user ? `/api/users/${user.id}` : '/api/users', body(user ? 'PATCH' : 'POST', { username: username.trim(), ...(!user?{pin:registrationPin}:{}) })));
      setUser(value);
      setRegistrationPin('');
      setUsername(value.username);
      setEditingName(false);
      try {
        localStorage.setItem(identityKey, value.id);
      }
      catch {
        setError('이 브라우저에서는 이름을 기억할 수 없습니다. 다음 방문에 이름을 다시 설정해 주세요.');
      }
    }
    catch (e) {
      setError(message(e));
    }
    finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    const ticket = navigation.current.begin();
    setBusy(true);
    setError('');
    try {
      const value = projectDocumentSchema.parse(await request(`/api/projects/${id}`));
      if (!navigation.current.isCurrent(ticket))
        return;
      resetReview();
      replaceProject(value);
      setRevision(0);
      setSaved(0);
      setSaveError('');
      setConflict(false);
    }
    catch (e) {
      if (navigation.current.isCurrent(ticket))
        setError(message(e));
    }
    finally {
      if (navigation.current.isCurrent(ticket))
        setBusy(false);
    }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    const ticket = navigation.current.begin();
    setBusy(true);
    setError('');
    try {
      const project = projectSchema.parse(await request('/api/projects', body('POST', { name: projectName.trim() })));
      if (!navigation.current.isCurrent(ticket))
        return;
      setProjectName('');
      setSaveError('');
      setConflict(false);
      resetReview();
      replaceProject({ project, document: createEmptyDocument() });
      setRevision(0);
      setSaved(0);
    }
    catch (e) {
      if (navigation.current.isCurrent(ticket))
        setError(message(e));
    }
    finally {
      if (navigation.current.isCurrent(ticket))
        setBusy(false);
    }
  }
  async function changeProject(project: Project, patch: {
    name?: string;
    status?: 'active' | 'archived';
  }) {
    setBusy(true);
    setError('');
    try {
      await request(`/api/projects/${project.id}`, body('PATCH', { expectedVersion: project.version, ...patch }));
      setRefresh(v => v + 1);
      return true;
    }
    catch (e) {
      setError(message(e));
      if (patch.name !== undefined) throw e;
      return false;
    }
    finally {
      setBusy(false);
    }
  }
  async function deleteProject(project: Project) {
    if (busy || project.status !== 'archived') return;
    if (!await confirm({ title: '프로젝트 영구 삭제', description: `“${project.name}” 프로젝트를 삭제할까요? 도메인, 테이블, 관계, 핀과 답글 및 관련 알림이 함께 삭제되며 복원할 수 없습니다.`, confirmLabel: '영구 삭제', destructive: true })) return;
    setBusy(true);
    setError('');
    try {
      await request(`/api/projects/${project.id}`, body('DELETE', { expectedVersion: project.version }));
      setProjects(items => items.filter(item => item.id !== project.id));
      setRefresh(value => value + 1);
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  function applyDocument(document: DesignDocument) {
    if (!current.current) return;
    const next = { ...current.current, document };
    current.current = next;
    rev.current += 1;
    setOpened(next);
    setRevision(rev.current);
  }
  function edit(document: DesignDocument) {
    const previous = current.current?.document;
    if (!previous || document === previous) return;
    const group = documentEditGroup(previous, document);
    if (group === '@viewport') history.current?.replaceCurrent(document);
    else history.current?.record(document, group);
    applyDocument(document);
  }
  async function save() {
    const snapshot = current.current;
    if (busy || !snapshot || !saveLock.current.begin())
      return;
    history.current?.endGroup();
    setSaving(true);
    setSaveError('');
    const snapshotRevision = rev.current;
    try {
      const validation = designDocumentSchema.safeParse(snapshot.document);
      if (!validation.success)
        throw new Error('저장할 수 없는 입력이 있습니다. 이름·텍스트 길이와 위치·크기를 확인해 주세요. 문서가 너무 크면 텍스트나 항목을 줄여 주세요.');
      const result = projectDocumentSchema.parse(await request(`/api/projects/${snapshot.project.id}/document`, body('PUT', { expectedVersion: snapshot.project.version, document: snapshot.document })));
      const value = current.current;
      if (value?.project.id === result.project.id) {
        const acknowledged = acknowledgeSave({ document: value.document, revision: rev.current }, snapshotRevision, result);
        current.current = acknowledged;
        history.current?.replaceCurrent(acknowledged.document);
        setOpened(acknowledged);
        setSaved(snapshotRevision);
      }
    }
    catch (e) {
      setSaveError(message(e));
      setConflict(e instanceof ApiError && e.status === 409);
    }
    finally {
      saveLock.current.finish();
      setSaving(false);
    }
  }
  async function leave() {
    if (saving)
      return;
    if (dirty && !await confirm({ title: '갤러리로 이동', description: '저장하지 않은 변경을 버리고 갤러리로 이동할까요?', confirmLabel: '이동', destructive: true }))
      return;
    navigation.current.begin();
    setBusy(false);
    resetReview();
    replaceProject(null);
    setRevision(0);
    setSaved(0);
  }
  const userForm = <form className="identity-form" onSubmit={e => void identify(e)}>
    <label htmlFor="username">함께 사용할 이름</label>
    <Input
      id="username"
      value={username}
      onChange={e => setUsername(e.target.value)}
      maxLength={40}
      required
      autoComplete="nickname"
      autoFocus
      placeholder="예: 김설계" />
    {!user&&<><label htmlFor="registration-pin">사용자 PIN (숫자 4자리)</label><Input id="registration-pin" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} minLength={4} required autoComplete="new-password" value={registrationPin} onChange={e=>setRegistrationPin(e.target.value.replace(/[^0-9]/g,''))} placeholder="숫자 4자리"/></>}
    <p>{user?'이 이름으로 팀에 표시됩니다. 기존 PIN은 유지됩니다.':'이름과 PIN 조합으로 사용자를 구분합니다.'}</p>
    <div className="actions">
      <Button type="submit" variant="primary" className="primary" disabled={busy || !username.trim() || (!user&&!/^[0-9]{4}$/.test(registrationPin))}>
        {busy ? '저장 중…' : user ? '이름 저장' : '워크스페이스 시작하기 →'}
      </Button>
      {user && <Button type="button" onClick={() => setEditingName(false)}>취소</Button>}
    </div>
  </form>;
  return <div className={opened ? 'app-shell editor-shell' : 'app-shell'}>
    <a className="skip-link" href="#main">본문으로 이동</a>
    <header className="app-header">
      <Button
        className="brand"
        onClick={leave}
        disabled={saving}
        aria-label="EZERD 프로젝트 갤러리">EZERD<span>.</span>
      </Button>
      <span className="header-caption">A SHARED SPACE<br />FOR CLEAR THINKING.</span>
      {user && <Notifications userId={user.id} onNavigate={visitNotification} />}
      {user && <Dropdown label="사용자 메뉴" items={[{id:'rename',label:'이름 변경',onAction:()=>{setEditingColor(false);setEditingName(true);}},{id:'color',label:'색상 변경',onAction:()=>{setEditingName(false);setEditingColor(true);}}]} trigger={<Button
        className="user-button"
        aria-label={`${user.username}, 사용자 메뉴`}
        title={user.username}>
        <Avatar className="avatar" style={userColorStyle(user.color)}>
          {user.username.slice(0, 1)}
        </Avatar>
        <span className="user-name">
          {user.username}
        </span>
        <span aria-hidden="true">⌄</span>
      </Button>} />}
    </header>
    {editingColor&&user&&<UserColorEditor key={user.id} user={user} onSaved={setUser} onClose={()=>setEditingColor(false)}/>}
    {editingName && <section className="identity-popover" aria-label="이름 변경">
      {userForm}
    </section>}
    {error && <div className="notice error" role="alert">
      {error}
      <Button onClick={() => setRefresh(v => v + 1)}>다시 확인</Button>
    </div>}
    {checking ? <main id="main" className="gallery">
      <p role="status">워크스페이스를 여는 중…</p>
    </main> : !user ? <main id="main" className="welcome">
      <p className="eyebrow">01 / WELCOME TO EZERD</p>
      <h1>명확한 구조.<br />함께 만드는 설계<span>.</span>
      </h1>
      <p className="intro">큰 그림을 연결하고, 데이터의 흐름을 정리하세요.<br />이름 하나로 우리 팀의 설계를 시작합니다.</p>
      {userForm}
    </main> : opened ? <main id="main" className="editor">
      <div className="editor-heading">
        <div className="project-title">
          <Button onClick={leave} disabled={saving}>← 갤러리</Button>
          <div>
            <small>PROJECT / DOMAIN WORKSPACE</small>
            <h1>
              {opened.project.name}
            </h1>
          </div>
        </div>
        <div className="save-controls">
          <Button aria-label="실행 취소" title="실행 취소 (Ctrl+Z / ⌘Z)" disabled={busy || opened.project.status === 'archived' || !history.current?.canUndo} onClick={() => restoreHistory('undo')}>↶</Button>
          <Button aria-label="다시 실행" title="다시 실행 (Ctrl+Shift+Z / ⌘⇧Z)" disabled={busy || opened.project.status === 'archived' || !history.current?.canRedo} onClick={() => restoreHistory('redo')}>↷</Button>
          <Button aria-expanded={commentsOpen} onClick={() => { setDraftTarget(undefined); setCommentsOpen(v => !v); }}>핀</Button>
          <span role="status" className={saveError ? 'save-state failed' : 'save-state'}>
            {saving ? '◌ 저장 중' : conflict ? '! 저장 충돌' : saveError ? '! 저장 실패' : dirty ? '● 저장하지 않은 변경' : '✓ 저장 완료'}
          </span>
          <Button
            variant="primary"
            className="primary"
            disabled={busy || saving || !dirty || conflict || opened.project.status === 'archived'}
            onClick={() => void save()}>저장</Button>
        </div>
      </div>
      {opened.project.status === 'archived' && <div className="notice">보관한 프로젝트입니다. 갤러리에서 복원하면 편집할 수 있습니다.</div>}
      {saveError && <div className="notice error" role="alert">
        {saveError}
        {conflict ? <Button disabled={saving} onClick={async () => {
          if (await confirm({ title: '최신 내용 다시 열기', description: '내 변경을 버리고 최신 저장 내용을 다시 열까요?', confirmLabel: '다시 열기', destructive: true }))
            void open(opened.project.id);
        }}>최신 내용 다시 열기</Button> : <Button disabled={saving} onClick={() => void save()}>다시 저장</Button>}
      </div>}
      <div className="review-workspace">
        <Canvas
          key={opened.project.id}
          document={opened.document}
          onChange={edit}
          readOnly={opened.project.status === 'archived'}
          onContextChange={setCanvasContext}
          onCreatePin={context => {
            setCanvasContext(context);
            setFocusTarget(undefined);
            setDraftTarget({ ...context, selectedObjectId: null, nonce: Date.now() });
            setCommentsOpen(true);
          }}
          {...(focusTarget ? { focusTarget } : {})}
          pins={<CommentPins memberColors={Object.fromEntries([...members.map(member=>[member.id,member.color??'#4169e1']),[user.id,user.color]])}
            threads={threads}
            document={opened.document}
            viewId={canvasContext.viewId}
            onOpen={focusThread} />} />
        <div data-open={commentsOpen} aria-hidden={!commentsOpen} inert={!commentsOpen} className="comments-container" style={{'--comments-panel-width':commentsPanelWidth+'px'} as CSSProperties}>
          <CommentsPanel panelWidth={commentsPanelWidth} onPanelWidthChange={resizeCommentsPanel} onMembers={setMembers} currentUserColor={user.color}
            key={opened.project.id}
            projectId={opened.project.id}
            userId={user.id}
            document={opened.document}
            context={canvasContext}
            {...(draftTarget ? { draftTarget } : {})}
            activeThreadId={focusTarget?.threadId ?? null}
            onThreads={setThreads}
            onNavigate={focusThread}
            onClose={() => { setDraftTarget(undefined); setCommentsOpen(false); }}
            onCancelPinDraft={() => setDraftTarget(undefined)} />
        </div>
      </div>
    </main> : <main id="main" className="gallery">
      <div className="section-marker">01 / WORKSPACE<span />
      </div>
      <section className="gallery-hero">
        <div>
          <p className="eyebrow">도메인에서 시작하는 데이터 설계</p>
          <h1>우리 팀의 설계<span>.</span>
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
          <TabButton selected={status === 'active'} onClick={() => setStatus('active')}>진행 중</TabButton>
          <TabButton selected={status === 'archived'} onClick={() => setStatus('archived')}>보관함</TabButton>
        </div>
        <label className="search">
          <span>검색</span>
          <Input
            aria-label="프로젝트 검색"
            placeholder="프로젝트 이름 검색"
            value={search}
            onChange={e => setSearch(e.target.value)} />
        </label>
      </div>
      <form className="create-project" onSubmit={e => void create(e)}>
        <Input
          aria-label="새 프로젝트 이름"
          placeholder="새 프로젝트 이름"
          maxLength={120}
          value={projectName}
          onChange={e => setProjectName(e.target.value)}
          required />
        <Button type="submit" variant="primary" className="primary" disabled={busy || !projectName.trim()}>
          <span aria-hidden="true">＋</span>
          <span>프로젝트 만들기</span>
        </Button>
      </form>
      {loading ? <p role="status">프로젝트를 불러오는 중…</p> : <section className="project-grid" aria-label="프로젝트 목록">
        {projects.map((project, index) => <article className="project-card" key={project.id}>
          <div className="card-top">
            <span>
              {String(index + 1).padStart(2, '0')}
            </span>
            <Badge variant="plain" tone={project.status === 'active' ? 'blue' : 'neutral'} className="project-state">
              {project.status === 'active' ? '진행 중' : '보관됨'}
            </Badge>
          </div>
          <Button
            className="project-open"
            title={project.name}
            disabled={busy}
            onClick={() => void open(project.id)}>
            <h2>
              {project.name}
            </h2>
            <span aria-hidden="true">↗</span>
          </Button>
          <p>수정 {new Date(project.updatedAt).toLocaleDateString('ko-KR')}
          </p>
          <div className="card-actions">
            <Button disabled={busy} onClick={() => setRenamingProject(project)}>이름 수정</Button>
            <Button className={project.status === 'active' ? 'project-archive' : 'project-restore'} disabled={busy} onClick={async () => {
              if (project.status === 'archived' || await confirm({ title: '프로젝트 보관', description: `“${project.name}” 프로젝트를 보관할까요? 보관함에서 복원할 수 있습니다.`, confirmLabel: '보관' }))
                void changeProject(project, { status: project.status === 'active' ? 'archived' : 'active' });
            }}>
              {project.status === 'active' ? '보관' : '복원'}
            </Button>
            {project.status === 'archived' && <Button className="project-delete" variant="danger" disabled={busy} onClick={() => void deleteProject(project)}>삭제</Button>}
          </div>
        </article>)}
      </section>}
      {!loading && !projects.length && <div className="empty-gallery">
        <span aria-hidden="true">＋</span>
        <h2>
          {search ? '검색 결과가 없습니다' : status === 'archived' ? '보관한 프로젝트가 없습니다' : '첫 설계의 큰 그림을 그려 보세요'}
        </h2>
        <p>
          {search ? '다른 프로젝트 이름으로 검색해 주세요.' : '프로젝트를 만들면 도메인과 업무 관계를 정리할 수 있습니다.'}
        </p>
      </div>}
      <footer>
        <span>EZERD — TEAM WORKSPACE</span>
        <span>명확한 구조. 함께 만드는 설계.</span>
      </footer>
    </main>}
    {renamingProject && <RenameDialog
      title="프로젝트 이름 수정"
      label="프로젝트 이름"
      initialValue={renamingProject.name}
      maxLength={120}
      onCancel={() => setRenamingProject(null)}
      onSave={async name => { if (await changeProject(renamingProject, { name })) setRenamingProject(null); }} />}
  </div>;
}
