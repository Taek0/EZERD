import { forwardRef, useImperativeHandle, useRef, useState, useLayoutEffect } from 'react';
import type { Project } from '../../app/App.js';
import { Button, Dropdown } from '../../components/ui/index.js';
import { useI18n, registerTranslations } from '../../shared/i18n/index.js';
import { message } from '../../shared/api/client.js';
import { ProjectImportButton } from './ProjectTransfer.js';
import { WorkspaceNotice } from '../workspaces/WorkspacePanel.js';
import type { Workspace } from '../workspaces/workspace-policy.js';
import './project-gallery.css';
import { sortProjects, type ProjectSort } from './project-gallery-order.js';

registerTranslations({
  '전체 프로젝트': 'All projects',
  '최근 수정순': 'Last updated',
  생성순: 'Creation order',
  '프로젝트 메뉴': 'Project menu',
  '새 프로젝트 생성': 'Create project',
  이름순: 'Name',
  '프로젝트 정렬': 'Sort projects',
  '프로젝트 수정': 'Edit project',
  '아이디어를 구조로, 함께 만드는 데이터 설계.':
    'Turn ideas into structures. Design data together.',
  '새 프로젝트': 'New project',
  '새로운 설계를 시작하세요': 'Start a new design',
  '데이터베이스 선택': 'Select database',
  '설계 미리보기': 'Design preview',
  '프로젝트를 열어 설계를 확인하세요': 'Open the project to explore its design',
  '아직 설계가 없습니다': 'No design yet',
  '미리보기 없음': 'No preview available',
  '첫 워크스페이스를 만들어 보세요': 'Create your first workspace',
  '프로젝트를 만들려면 워크스페이스가 필요합니다. 워크스페이스를 만들고 설계를 시작하세요.':
    'You need a workspace to create projects. Create one to start designing.',
  '테이블 {tables}개 · 관계 {relations}개': '{tables} tables · {relations} relations',
});
type DatabaseKind = 'postgresql' | 'mysql' | 'sqlite';
const databases: Record<DatabaseKind, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  sqlite: 'SQLite',
};
type Edit = { project?: Project | undefined; name: string; databaseKind: DatabaseKind };
export type GalleryHandle = { flush: () => Promise<boolean>; hasDraft: () => boolean };
type Props = {
  workspace?: Workspace | undefined;
  workspaceId: string;
  needsWorkspace?: boolean;
  onCreateWorkspace?: () => void;
  projects: Project[];
  loading: boolean;
  busy: boolean;
  canEdit: boolean;
  canDelete: boolean;
  status: 'active' | 'archived';
  search: string;
  onSearch: (value: string) => void;
  onStatus: (value: 'active' | 'archived') => void;
  onCreate: (name: string, databaseKind: DatabaseKind) => Promise<void>;
  onEdit: (
    project: Project,
    patch: { name: string; databaseKind: DatabaseKind },
  ) => Promise<boolean>;
  onOpen: (id: string) => void;
  onExport: (project: Project) => void;
  onArchive: (project: Project) => void;
  onDelete: (project: Project) => void;
  onImported: () => void;
};
export const ProjectGallery = forwardRef<GalleryHandle, Props>(function ProjectGallery(p, ref) {
  const { t, locale } = useI18n();
  const [edit, setEdit] = useState<Edit | null>(null);
  const current = useRef<Edit | null>(null);
  const pending = useRef<Promise<boolean> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<ProjectSort>('created');
  const input = useRef<HTMLInputElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ width: 0, transform: 'translateX(0)' });
  function update(value: Edit | null) {
    current.current = value;
    setEdit(value);
  }
  async function flush(): Promise<boolean> {
    if (pending.current) return pending.current;
    const value = current.current;
    if (!value) return true;
    setSaving(true);
    setError('');
    const operation = (async () => {
      try {
        if (value.project) {
          const name = value.name.trim() || value.project.name;
          if (
            name !== value.project.name ||
            value.databaseKind !== (value.project.databaseKind ?? 'postgresql')
          ) {
            if (!(await p.onEdit(value.project, { name, databaseKind: value.databaseKind })))
              return false;
          }
        } else await p.onCreate(value.name.trim(), value.databaseKind);
        update(null);
        return true;
      } catch (cause) {
        setError(message(cause));
        return false;
      } finally {
        setSaving(false);
      }
    })();
    pending.current = operation;
    void operation.then(() => {
      if (pending.current === operation) pending.current = null;
    });
    return operation;
  }
  useImperativeHandle(ref, () => ({ flush, hasDraft: () => !!current.current }));
  useLayoutEffect(() => {
    if (edit) input.current?.focus();
  }, [edit?.project?.id, !!edit]);
  useLayoutEffect(() => {
    const updateIndicator = () => {
      const selected = tabs.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (selected)
        setIndicator({
          width: selected.offsetWidth,
          transform: `translateX(${selected.offsetLeft}px)`,
        });
    };
    updateIndicator();
    const observer = new ResizeObserver(updateIndicator);
    if (tabs.current) observer.observe(tabs.current);
    return () => observer.disconnect();
  }, [p.status, locale]);
  async function act(action: () => void) {
    if (await flush()) action();
  }
  async function begin(project?: Project) {
    if (!p.canEdit || p.busy || saving || !(await flush())) return;
    if (!project) {
      p.onStatus('active');
      p.onSearch('');
    }
    setError('');
    update({
      project,
      name: project?.name ?? '',
      databaseKind: project?.databaseKind ?? 'postgresql',
    });
  }
  const sorted = sortProjects(p.projects, sort, locale);
  const disabled = p.busy || saving;
  function preview(project?: Project) {
    const summary = project?.preview;
    return (
      <div className="erd-preview" aria-label={t('설계 미리보기')}>
        {summary?.tables.length ? (
          summary.tables.map((table, index) => (
            <div className="erd-mini-table" key={index}>
              <b>{table.name}</b>
              {table.columns.map((column, i) => (
                <span key={i}>
                  {column.primaryKey ? '◇ ' : ''}
                  {column.name}
                  <i>{column.type}</i>
                </span>
              ))}
            </div>
          ))
        ) : (
          <span>{t(!project || summary ? '아직 설계가 없습니다' : '미리보기 없음')}</span>
        )}
      </div>
    );
  }
  function editor(value: Edit) {
    return (
      <article
        className={`erd-card editing-card ${!value.project ? 'card-enter' : ''}`}
        data-gallery-edit
      >
        {preview(value.project)}
        <form
          className="erd-copy"
          onSubmit={(event) => {
            event.preventDefault();
            void flush();
          }}
        >
          <input
            ref={input}
            className="inline-name"
            aria-label={t('프로젝트 이름')}
            placeholder={t('새 프로젝트 이름')}
            maxLength={120}
            value={value.name}
            disabled={saving}
            onChange={(event) => update({ ...value, name: event.target.value })}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
                if (event.key === 'Enter') event.preventDefault();
                return;
              }
              if (event.key === 'Escape' && !saving) {
                event.stopPropagation();
                update(null);
                setError('');
              }
            }}
          />
          <p className="erd-detail">{t('도메인에서 시작하는 데이터 설계')}</p>
          <div className="erd-footer">
            <Dropdown
              label={t('데이터베이스 선택')}
              trigger={
                <Button className="db-tag db-trigger" disabled={saving}>
                  {databases[value.databaseKind]} <span aria-hidden="true">⌄</span>
                </Button>
              }
              items={(Object.keys(databases) as DatabaseKind[]).map((kind) => ({
                id: kind,
                label: databases[kind],
                onAction: () => update({ ...current.current!, databaseKind: kind }),
              }))}
            />
            <div className="inline-actions">
              <Button
                type="button"
                disabled={saving}
                onClick={() => {
                  update(null);
                  setError('');
                }}
              >
                {t('취소')}
              </Button>
              <Button type="submit" disabled={saving}>
                {t('저장')}
              </Button>
            </div>
          </div>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
        </form>
      </article>
    );
  }
  return (
    <main
      id="main"
      className="gallery redesigned-gallery"
      onClickCapture={(event) => {
        const target = event.target as HTMLElement;
        if (current.current && !target.closest('[data-gallery-edit], .ui-dropdown-popover'))
          void flush();
      }}
    >
      <div className="section-marker">
        WORKSPACE
        <span />
      </div>
      <section className="gallery-hero">
        <div>
          <p className="eyebrow">{t('도메인에서 시작하는 데이터 설계')}</p>
          <h1>
            {p.workspace?.name ?? t('워크스페이스')} <span>.</span>
          </h1>
          <p>{t('아이디어를 구조로, 함께 만드는 데이터 설계.')}</p>
        </div>
      </section>
      {p.workspace && <WorkspaceNotice selected={p.workspace} />}
      {p.needsWorkspace && (
        <section className="workspace-onboarding" aria-labelledby="workspace-onboarding-title">
          <h2 id="workspace-onboarding-title">{t('첫 워크스페이스를 만들어 보세요')}</h2>
          <p>
            {t(
              '프로젝트를 만들려면 워크스페이스가 필요합니다. 워크스페이스를 만들고 설계를 시작하세요.',
            )}
          </p>
          <Button variant="primary" disabled={disabled} onClick={p.onCreateWorkspace}>
            {t('워크스페이스 만들기')}
          </Button>
        </section>
      )}
      <div className="erd-toolbar">
        <div ref={tabs} className="erd-tabs" role="group" aria-label={t('프로젝트 상태')}>
          <span className="erd-tab-indicator" style={indicator} />
          <button
            type="button"
            aria-pressed={p.status === 'active'}
            disabled={disabled}
            onClick={() => void act(() => p.onStatus('active'))}
          >
            {t('전체 프로젝트')}
          </button>
          <button
            type="button"
            aria-pressed={p.status === 'archived'}
            disabled={disabled}
            onClick={() => void act(() => p.onStatus('archived'))}
          >
            {t('보관함')}
          </button>
        </div>
        <div className="erd-toolbar-right">
          <label className="erd-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              aria-label={t('프로젝트 검색')}
              placeholder={t('프로젝트 검색')}
              value={p.search}
              onChange={(e) => {
                const value = e.target.value;
                void act(() => p.onSearch(value));
              }}
            />
          </label>
          <Dropdown
            label={t('프로젝트 정렬')}
            trigger={
              <Button className="erd-sort" disabled={disabled}>
                <span className="erd-sort-label">
                  {['생성순', '최근 수정순', '이름순'].map((label) => (
                    <span className="erd-sort-size" aria-hidden="true" key={label}>
                      {t(label)}
                    </span>
                  ))}
                  <span>
                    {t(
                      sort === 'created' ? '생성순' : sort === 'recent' ? '최근 수정순' : '이름순',
                    )}
                  </span>
                </span>{' '}
                <span aria-hidden="true">⌄</span>
              </Button>
            }
            items={[
              {
                id: 'created',
                label: t('생성순'),
                onAction: () => void act(() => setSort('created')),
              },
              {
                id: 'recent',
                label: t('최근 수정순'),
                onAction: () => void act(() => setSort('recent')),
              },
              { id: 'name', label: t('이름순'), onAction: () => void act(() => setSort('name')) },
            ]}
          />
          {p.canEdit && (
            <ProjectImportButton
              key={p.workspaceId}
              workspaceId={p.workspaceId}
              disabled={disabled}
              onImported={p.onImported}
              renderTrigger={(openImport, importDisabled) => (
                <Dropdown
                  label={t('프로젝트 메뉴')}
                  popoverClassName="erd-project-actions"
                  trigger={
                    <Button className="erd-add" aria-label={t('프로젝트 메뉴')} disabled={disabled}>
                      ⋯
                    </Button>
                  }
                  items={[
                    { id: 'create', label: t('새 프로젝트 생성'), onAction: () => void begin() },
                    {
                      id: 'import',
                      label: t('프로젝트 가져오기'),
                      disabled: importDisabled,
                      onAction: () => void act(openImport),
                    },
                  ]}
                />
              )}
            />
          )}
        </div>
      </div>
      {p.loading && <p role="status">{t('프로젝트를 불러오는 중…')}</p>}
      <section className="erd-grid" key={p.status} aria-label={t('프로젝트 목록')}>
        {sorted.map((project) =>
          edit?.project?.id === project.id ? (
            <div key={project.id}>{editor(edit)}</div>
          ) : (
            <article className="erd-card" key={project.id}>
              <button
                type="button"
                className="erd-card-open"
                disabled={disabled}
                onClick={() => void act(() => p.onOpen(project.id))}
                aria-label={project.name}
              >
                {preview(project)}
                <div className="erd-copy">
                  <h2>{project.name}</h2>
                  <p className="erd-detail">
                    {project.preview
                      ? t('테이블 {tables}개 · 관계 {relations}개', {
                          tables: project.preview.tableCount,
                          relations: project.preview.relationCount,
                        })
                      : t(project.status === 'archived' ? '보관됨' : '진행 중')}
                  </p>
                  <div className="erd-footer">
                    <span className="db-tag">
                      {databases[project.databaseKind ?? 'postgresql']}
                    </span>
                    <span>
                      {new Date(project.updatedAt).toLocaleDateString(
                        locale === 'en' ? 'en-US' : 'ko-KR',
                      )}
                    </span>
                  </div>
                </div>
              </button>
              <div className="erd-more">
                <Dropdown
                  label={t('프로젝트 수정')}
                  trigger={
                    <Button
                      className="erd-more-button"
                      disabled={disabled}
                      aria-label={`${project.name} ${t('메뉴')}`}
                    >
                      ⋯
                    </Button>
                  }
                  items={[
                    {
                      id: 'edit',
                      label: t('프로젝트 수정'),
                      disabled: !p.canEdit,
                      onAction: () => void begin(project),
                    },
                    {
                      id: 'export',
                      label: t('내보내기'),
                      onAction: () => void act(() => p.onExport(project)),
                    },
                    {
                      id: 'archive',
                      label: t(project.status === 'active' ? '보관' : '복원'),
                      disabled: !p.canEdit,
                      onAction: () => void act(() => p.onArchive(project)),
                    },
                    ...(project.status === 'archived'
                      ? [
                          {
                            id: 'delete',
                            label: t('삭제'),
                            disabled: !p.canDelete,
                            destructive: true,
                            onAction: () => void act(() => p.onDelete(project)),
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            </article>
          ),
        )}
        {edit && !edit.project && editor(edit)}
        {p.status === 'active' && p.canEdit && (
          <button
            type="button"
            className="erd-new-card"
            disabled={disabled}
            onClick={() => void begin()}
          >
            <span className="plus" aria-hidden="true">
              ＋
            </span>
            <strong>{t('새 프로젝트')}</strong>
            <small>{t('새로운 설계를 시작하세요')}</small>
          </button>
        )}
        {!p.loading &&
          !sorted.length &&
          !(edit && !edit.project) &&
          (p.search || p.status === 'archived') && (
            <p className="erd-empty">
              {t(p.search ? '검색 결과가 없습니다' : '보관한 프로젝트가 없습니다')}
            </p>
          )}
      </section>
      <footer>
        <span>EZERD — TEAM WORKSPACE</span>
      </footer>
    </main>
  );
});
