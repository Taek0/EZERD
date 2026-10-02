import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLocale } from '../../shared/i18n/index.js';
import { NativeUpgradeButton, NativeUpgradeReview } from './NativeUpgradeButton.js';
import { ProjectTransferSummary } from './ProjectTransfer.js';
import {
  transferActor,
  transferProject,
  transferWorkspace,
  transferState,
  transferEnvelope,
} from './native-transfer-test-fixtures.js';

afterEach(() => setLocale('ko'));
describe('native transfer controls and explanations', () => {
  it.each(['ko', 'en'] as const)(
    'renders a disabled explicit control for readonly users in %s',
    (locale) => {
      setLocale(locale);
      const prepare = vi.fn(async () => true),
        completed = vi.fn();
      const html = renderToStaticMarkup(
        createElement(NativeUpgradeButton, {
          userId: transferActor,
          projectId: transferProject,
          workspaceId: transferWorkspace,
          canUpgrade: false,
          prepare,
          onUpgraded: completed,
        }),
      );
      expect(html).toContain('disabled=""');
      expect(html).toContain(
        locale === 'ko' ? 'native 설계로 업그레이드' : 'Upgrade to a native design',
      );
      expect(prepare).not.toHaveBeenCalled();
      expect(completed).not.toHaveBeenCalled();
    },
  );
  it.each(['mysql', 'sqlite'] as const)(
    'labels %s legacy preservation and context invalidation before apply',
    (kind) => {
      const snapshot = transferState(kind, 1);
      const plan = {
        userId: transferActor,
        projectId: transferProject,
        snapshot,
        assertCurrent: () => {},
        input: {
          operationId: transferActor,
          clientId: transferActor,
          expectedVersion: snapshot.project.version,
          expectedSequence: snapshot.sequence,
          expectedDatabaseRevision: snapshot.project.databaseRevision,
        },
      };
      const html = renderToStaticMarkup(createElement(NativeUpgradeReview, { plan }));
      expect(html).toContain(snapshot.project.databaseProfileId);
      expect(html).toContain('baseline');
      expect(html).toContain('legacy 원문으로 보존');
      expect(html).toContain('legacy.type-unresolved');
      expect(html).toContain('/columns/c/physical/type');
    },
  );
  it('counts native indexes and checks and labels the server policy gate without a v1 projection', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectTransferSummary, { file: transferEnvelope() }),
    );
    expect(html).toContain('JSON v2');
    expect(html).toContain('postgresql-18-v1');
    expect(html).toContain('<dt>INDEX</dt><dd>1</dd>');
    expect(html).toContain('<dt>CHECK</dt><dd>1</dd>');
    expect(html).toContain('서버 정책');
  });
  it('labels an unavailable native preview while retaining source backup information', () => {
    const file = transferEnvelope();
    file.native = { status: 'unavailable', code: 'document.native-preview-invalid' };
    expect(renderToStaticMarkup(createElement(ProjectTransferSummary, { file }))).toContain(
      'role="alert">document.native-preview-invalid',
    );
  });
});
