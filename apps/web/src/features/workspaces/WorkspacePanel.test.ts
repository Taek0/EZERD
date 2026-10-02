import { afterEach, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmProvider } from '../../components/ui/ConfirmProvider.js';
import { setLocale } from '../../shared/i18n/index.js';
import { WorkspacePanel, WorkspaceNotice } from './WorkspacePanel.js';
import type { Workspace } from './workspace-policy.js';
const space: Workspace = {
  id: 'space',
  name: 'Team name',
  role: 'viewer',
  status: 'active',
  createdAt: '',
  updatedAt: '',
};
const render = (selected: Workspace | undefined, disabled = false) =>
  renderToStaticMarkup(
    createElement(ConfirmProvider, {
      children: createElement(WorkspacePanel, {
        workspaces: selected ? [selected] : [],
        selected,
        disabled,
        onSelect: () => {},
        onRefresh: () => {},
      }),
    }),
  );
afterEach(() => setLocale('ko'));
it.each([
  ['en', 'Select workspace'],
  ['ko', '워크스페이스 선택'],
] as const)(
  'labels the closed workspace trigger in %s without translating user content',
  (locale, label) => {
    setLocale(locale);
    const markup = render(space);
    expect(markup).toContain('Team name');
    expect(markup).toContain(`aria-label="${label}"`);
    expect(markup).toContain('aria-haspopup="true"');
    expect(markup).toContain('aria-expanded="false"');
  },
);
it('disables the workspace trigger while navigation is pending', () => {
  expect(render(space, true)).toContain('disabled=""');
  expect(render(space)).not.toContain('disabled=""');
});
const notice = (selected: Workspace | undefined) =>
  renderToStaticMarkup(createElement(WorkspaceNotice, { selected }));
it.each([
  ['en', 'Create your first workspace', 'This workspace is archived', 'You have viewer access'],
  ['ko', '첫 워크스페이스를 만들어', '이 워크스페이스는 보관되어 있습니다', '뷰어 권한입니다'],
] as const)(
  'explains empty, archived and viewer states in %s',
  (locale, empty, archived, viewer) => {
    setLocale(locale);
    expect(notice(undefined)).toContain(empty);
    const archivedMarkup = notice({ ...space, status: 'archived' });
    expect(archivedMarkup).toContain(archived);
    expect(archivedMarkup).not.toContain(viewer);
    expect(notice(space)).toContain(viewer);
  },
);
it.each(['owner', 'editor'] as const)(
  'does not show restricted access guidance for an active %s',
  (role) => {
    expect(notice({ ...space, role })).toBe('');
  },
);
