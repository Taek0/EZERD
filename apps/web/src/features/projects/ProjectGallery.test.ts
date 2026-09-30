import { afterEach, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLocale } from '../../shared/i18n/index.js';
import { ProjectGallery } from './ProjectGallery.js';

const render = (canEdit = true) =>
  renderToStaticMarkup(
    createElement(ProjectGallery, {
      workspaceId: 'space',
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
