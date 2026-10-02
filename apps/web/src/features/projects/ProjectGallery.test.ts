import { afterEach, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLocale } from '../../shared/i18n/index.js';
import { ProjectGallery } from './ProjectGallery.js';

const render = (canEdit = true, needsWorkspace = false) =>
  renderToStaticMarkup(
    createElement(ProjectGallery, {
      workspaceId: 'space',
      needsWorkspace,
      onCreateWorkspace: () => {},
      projects: [],
      loading: false,
      busy: false,
      canEdit,
      canDelete: true,
      status: 'active',
      search: '',
      onSearch: () => {},
      onStatus: () => {},
      onCreate: async () => {},
      onEdit: async () => true,
      onOpen: () => {},
      onExport: () => {},
      onArchive: () => {},
      onDelete: () => {},
      onImported: () => {},
    }),
  );
afterEach(() => setLocale('ko'));
it.each([
  ['ko', '생성순', '프로젝트 메뉴'],
  ['en', 'Creation order', 'Project menu'],
] as const)('renders the creation default and single project menu in %s', (locale, sort, menu) => {
  setLocale(locale);
  const markup = render();
  expect(markup).toContain(`<span>${sort}</span>`);
  expect(markup).toContain(`aria-label="${menu}"`);
  expect(markup).toContain('⋯');
  expect(markup.split('<footer>')[1]).not.toContain('<button');
  expect(markup.match(/type="file"/g)).toHaveLength(1);
});
it('omits project creation and import controls for viewers', () => {
  const markup = render(false);
  expect(markup).not.toContain('aria-label="프로젝트 메뉴"');
  expect(markup).not.toContain('type="file"');
});
it.each([
  ['ko', '첫 워크스페이스를 만들어 보세요', '워크스페이스 만들기'],
  ['en', 'Create your first workspace', 'Create workspace'],
] as const)(
  'offers workspace creation only for users without a workspace in %s',
  (locale, title, action) => {
    setLocale(locale);
    const markup = render(false, true);
    expect(markup).toContain(title);
    expect(markup).toContain(`>${action}</span></button>`);
    expect(markup).not.toContain('type="file"');
    expect(render(false)).not.toContain('workspace-onboarding-title');
  },
);
