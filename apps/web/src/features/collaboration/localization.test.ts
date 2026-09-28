import { afterEach, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEmptyDocument } from '@ezerd/model';
import { setLocale } from '../../shared/i18n/index.js';
import { SyncHistoryContent } from './sync-history-panel.js';
import { describeChanges, describeDeletedValues } from './sync-history-labels.js';
import { ProjectImportButton } from '../projects/ProjectTransfer.js';
import { parseProjectTransfer } from '../projects/project-transfer.js';
import { McpConnectionPanel } from '../mcp/McpConnectionPanel.js';
import { UserColorEditor } from '../identity/UserColorEditor.js';

afterEach(() => setLocale('ko'));

it('renders auxiliary panels in English and switches back to Korean', () => {
  setLocale('en');
  expect(renderToStaticMarkup(createElement(SyncHistoryContent, { snapshot: null }))).toContain(
    'No unapplied edits.',
  );
  expect(
    renderToStaticMarkup(createElement(ProjectImportButton, { onImported: () => {} })),
  ).toContain('Import project');
  expect(renderToStaticMarkup(createElement(McpConnectionPanel, { onClose: () => {} }))).toContain(
    'MCP connection settings',
  );
  expect(
    renderToStaticMarkup(
      createElement(UserColorEditor, {
        user: { id: 'u', username: '한국어 이름', color: '#ffffff', createdAt: '', updatedAt: '' },
        onSaved: () => {},
        onClose: () => {},
      }),
    ),
  ).toContain('Change user color');
  setLocale('ko');
  expect(
    renderToStaticMarkup(createElement(ProjectImportButton, { onImported: () => {} })),
  ).toContain('프로젝트 가져오기');
});

it('localizes history labels while preserving user-authored names and descriptions', () => {
  const document = createEmptyDocument();
  const note = { id: 'n', viewId: 'overview', text: '사용자가 작성한 내용' };
  document.notes = [note];
  const change = { path: '/notes/n', before: note, after: null };
  setLocale('en');
  expect(describeChanges([change], document)).toEqual(['Note ‘사용자가 작성한 내용’ deleted']);
  expect(describeDeletedValues(change, document)).toContain('Description: 사용자가 작성한 내용');
  expect(describeChanges([{ path: '/notes/@move/n', before: 1, after: 0 }], document)).toEqual([
    'Note reordered',
  ]);
  expect(note.text).toBe('사용자가 작성한 내용');
});

it('reports project import validation in the selected language', () => {
  setLocale('en');
  expect(() => parseProjectTransfer('{')).toThrow('Select a valid JSON project file.');
  setLocale('ko');
  expect(() => parseProjectTransfer('{')).toThrow('올바른 JSON 프로젝트 파일을 선택해 주세요.');
});
