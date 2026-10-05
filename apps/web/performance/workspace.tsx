import '../src/styles/inspector.css';
import '../src/styles/editor-feedback.css';
import { Button } from '../src/components/ui/index.js';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeProjectView } from '../src/features/projects/NativeProjectView.js';
import { createNativePerformanceFixture } from '../src/shared/performance/native-fixture.js';
import { ConfirmProvider } from '../src/components/ui/ConfirmProvider.js';
import '../src/components/ui/tailwind.css';
import '../src/styles/tokens.css';
import '../src/components/ui/ui.css';
import '../src/styles/styles.css';
import '../src/styles/editor-topbar.css';
import '../src/styles/canvas-viewport.css';
import '../src/styles/navigation-controls.css';
import './workspace.css';
const fixture = createNativePerformanceFixture(10, 5);
fixture.snapshot.project.id = '90000000-0000-4000-8000-000000000021';
fixture.snapshot.project.name = '원본 UI 복원 · 로컬 예제';
const doc = fixture.document;
doc.tables = doc.tables!.slice(0, 5);
const keep = new Set(doc.tables.map((table) => table.id));
doc.columns = doc.columns!.filter((column) => keep.has(column.tableId));
doc.keys = doc.keys!.filter((key) => keep.has(key.tableId));
doc.tableRelations = doc.tableRelations!.filter(
  (relation) => keep.has(relation.sourceTableId) && keep.has(relation.targetTableId),
);
doc.domains = [
  { id: 'perf', name: 'Shopping', description: '- user\n- cart\n- product', color: '#2f8cff' },
  { id: 'transactions', name: 'Transaction', description: '- payments', color: '#7f56d9' },
];
doc.tables.forEach((table, index) => {
  table.physical.name = ['user', 'cart', 'product', 'transaction', 'notification'][index]!;
  table.domainId = index < 3 ? 'perf' : 'transactions';
});
doc.layout.nodes = doc.layout.nodes.filter(
  (node) => keep.has(node.objectId) && node.viewId === '__tables__',
);
doc.layout.nodes.forEach((node, index) => {
  node.x = [70, 360, 610, 1150, 1150][index]!;
  node.y = [160, 580, 130, 160, 600][index]!;
  node.width = 410;
  node.height = 370;
});
doc.layout.nodes.push(
  {
    id: 'domain-shopping',
    objectId: 'perf',
    viewId: 'overview',
    x: 300,
    y: 220,
    width: 280,
    height: 220,
  },
  {
    id: 'domain-transaction',
    objectId: 'transactions',
    viewId: 'overview',
    x: 970,
    y: 320,
    width: 240,
    height: 210,
  },
);
const previewUser = '90000000-0000-4000-8000-000000000022';
const threadId = '90000000-0000-4000-8000-000000000023';
const stamp = '2026-10-06T00:00:00Z';
const review = {
  id: threadId,
  projectId: fixture.snapshot.project.id,
  viewId: 'overview',
  objectId: 'transactions',
  x: 0,
  y: 0,
  resolved: false,
  createdAt: stamp,
  updatedAt: stamp,
  messages: [
    {
      id: '90000000-0000-4000-8000-000000000024',
      threadId,
      authorId: previewUser,
      body: '알림 테이블을 추가해주세요',
      mentionIds: [],
      createdAt: stamp,
    },
  ],
};
// Only the dedicated fixture origin installs a synthetic actor. No API request leaves this page.
const interactive = location.hostname === '127.0.0.1' && location.port === '4177';
if (interactive) {
  sessionStorage.setItem(
    'ezerd.sync.session',
    JSON.stringify({
      userId: previewUser,
      token: 'LOCAL-FIXTURE-NOT-A-CREDENTIAL',
      expiresAt: '2099-01-01T00:00:00Z',
    }),
  );
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      location.href,
    );
    if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);
    if (init?.method && init.method !== 'GET')
      return Response.json({ message: 'Local preview does not save' }, { status: 403 });
    let value: unknown;
    if (url.pathname.endsWith('/threads')) value = [review];
    else if (url.pathname.endsWith('/members'))
      value = [{ userId: previewUser, username: 'preview', color: '#06b6d4' }];
    else if (url.pathname.endsWith('/personal-state'))
      value = {
        databaseRevision: 0,
        version: 0,
        projectVersion: 0,
        syncSequence: 0,
        state: { views: [], notes: [], nodes: [], viewports: [], relations: [] },
      };
    else if (url.pathname.endsWith('/native-history'))
      value = {
        protocolVersion: 2,
        projectId: fixture.snapshot.project.id,
        version: 0,
        sequence: 0,
        database: {
          kind: 'postgresql',
          profileId: doc.database.profileId,
          revision: 0,
        },
        history: [],
        nextSince: null,
      };
    else return Response.json({ message: 'Unsupported local preview API' }, { status: 403 });
    return Response.json(value);
  };
}
function MotionProbe() {
  const [report, setReport] = useState(''),
    [recording, setRecording] = useState(false);
  return (
    <details className="preview-motion-probe">
      <summary>로컬 예제 · 서버 저장 없음 · QA</summary>
      <Button
        disabled={recording}
        onClick={() => {
          setRecording(true);
          setReport('recording');
          const start = performance.now(),
            motions = new Map<string, unknown>(),
            widths: number[] = [];
          const sample = () => {
            widths.push(
              document.querySelector('.native-editor-inspector')?.getBoundingClientRect().width ??
                0,
            );
            for (const animation of document.getAnimations()) {
              const effect = animation.effect as KeyframeEffect | null;
              const name =
                animation instanceof CSSAnimation
                  ? animation.animationName
                  : animation instanceof CSSTransition
                    ? animation.transitionProperty
                    : 'WAAPI';
              motions.set(name + ':' + (effect?.target as HTMLElement)?.className, {
                name,
                target: (effect?.target as HTMLElement)?.className,
                duration: effect?.getTiming().duration,
              });
            }
            if (performance.now() - start < 2500) requestAnimationFrame(sample);
            else {
              setReport(
                JSON.stringify(
                  {
                    motions: [...motions.values()],
                    inspectorWidth: { min: Math.min(...widths), max: Math.max(...widths) },
                    frames: widths.length,
                  },
                  null,
                  2,
                ),
              );
              setRecording(false);
            }
          };
          requestAnimationFrame(sample);
        }}
      >
        모션 기록
      </Button>
      <textarea aria-label="Motion QA JSON" value={report} readOnly />
    </details>
  );
}
createRoot(document.getElementById('root')!).render(
  <ConfirmProvider>
    <div className="app-shell editor-shell" style={{ height: '100dvh', padding: 0 }}>
      <header className="app-header">
        <Button className="brand">
          EZERD<span>.</span>
        </Button>
        <span className="header-caption">
          A SHARED SPACE
          <br />
          FOR CLEAR THINKING.
        </span>
      </header>
      <MotionProbe />
      <NativeProjectView
        entry={{ kind: 'native', ...fixture, personalUnavailable: false }}
        {...(interactive ? { userId: previewUser, canEdit: true, canPersonalEdit: true } : {})}
        onLeave={() => {}}
        onReload={() => {}}
      />
    </div>
  </ConfirmProvider>,
);
