import { afterEach, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmProvider } from '../../components/ui/ConfirmProvider.js';
import { setLocale } from '../../shared/i18n/index.js';
import { WorkspacePanel } from './WorkspacePanel.js';
import type { Workspace } from './workspace-policy.js';
const space: Workspace = {
  id: 'space',
  name: 'Team name',
  role: 'viewer',
  status: 'active',
  createdAt: '',
  updatedAt: '',
};
const render = (selected: Workspace | undefined) =>
  renderToStaticMarkup(
    createElement(ConfirmProvider, {
      children: createElement(WorkspacePanel, {
        workspaces: selected ? [selected] : [],
        selected,
        onSelect: () => {},
        onRefresh: () => {},
      }),
    }),
  );
afterEach(() => setLocale('ko'));
it('renders workspace selection and viewer guidance in English and Korean', () => {
  setLocale('en');
  const english = render(space);
  expect(english).toContain('Team name');
  expect(english).toContain('New workspace');
  expect(english).toContain('Invitation inbox');
  expect(english).toContain('You have viewer access');
  setLocale('ko');
  expect(render(space)).toContain('뷰어 권한입니다');
});
it('explains empty and archived workspace states', () => {
  setLocale('en');
  expect(render(undefined)).toContain('Create your first workspace');
  expect(render({ ...space, status: 'archived' })).toContain('This workspace is archived');
});
