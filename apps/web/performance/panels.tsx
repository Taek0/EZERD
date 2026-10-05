import { Profiler, useMemo, useRef, useState, type ProfilerOnRenderCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeProjectView } from '../src/features/projects/NativeProjectView.js';
import { ConfirmProvider } from '../src/components/ui/ConfirmProvider.js';
import { createNativePerformanceFixture } from '../src/shared/performance/native-fixture.js';
import { fixtureFingerprint } from '../src/shared/performance/fixture.js';
import { collector } from '../src/shared/performance/collector.js';
import '../src/components/ui/tailwind.css';
import '../src/styles/tokens.css';
import '../src/components/ui/ui.css';
import '../src/styles/styles.css';
import '../src/styles/editor-topbar.css';
import '../src/styles/canvas-viewport.css';
import '../src/styles/navigation-controls.css';
import '../src/styles/inspector.css';
import '../src/styles/editor-feedback.css';
import './panels.css';
declare const __PERF_COMMIT__: string;
declare const __PERF_DIRTY__: boolean;
const actor = '90000000-0000-4000-8000-000000000031',
  project = '90000000-0000-4000-8000-000000000032';
if (location.hostname !== '127.0.0.1' || location.port !== '4180')
  throw Error('Use dedicated fixture origin 127.0.0.1:4180');
sessionStorage.setItem(
  'ezerd.sync.session',
  JSON.stringify({
    userId: actor,
    token: 'LOCAL-PANEL-FIXTURE',
    expiresAt: '2099-01-01T00:00:00Z',
  }),
);
localStorage.setItem('ezerd.inspector', 'visible');
localStorage.setItem('ezerd.inspectorWidth', '320');
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    location.href,
  );
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);
  if (init?.method && init.method !== 'GET')
    return Response.json({ message: 'Writes disabled in panel fixture' }, { status: 403 });
  if (url.pathname.endsWith('/threads')) return Response.json([]);
  if (url.pathname.endsWith('/members'))
    return Response.json([{ userId: actor, username: 'preview', color: '#06b6d4' }]);
  if (url.pathname.endsWith('/personal-state'))
    return Response.json({
      databaseRevision: 0,
      version: 0,
      projectVersion: 0,
      syncSequence: 0,
      state: { views: [], notes: [], nodes: [], viewports: [], relations: [] },
    });
  if (url.pathname.endsWith('/native-history'))
    return Response.json({
      protocolVersion: 2,
      projectId: project,
      version: 0,
      sequence: 0,
      database: { kind: 'postgresql', profileId: 'postgresql-18-v1', revision: 0 },
      history: [],
      nextSince: null,
    });
  return Response.json({ message: 'Unsupported fixture API' }, { status: 403 });
};
const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const noop = () => {};
const stats = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  return {
    count: v.length,
    total: values.reduce((a, b) => a + b, 0),
    median: v[Math.ceil(v.length * 0.5) - 1] ?? 0,
    p95: v[Math.ceil(v.length * 0.95) - 1] ?? 0,
    max: v.at(-1) ?? 0,
  };
};
function Demo() {
  const [count, setCount] = useState(50),
    [output, setOutput] = useState(''),
    [running, setRunning] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    active = useRef(false),
    commits = useRef<number[]>([]);
  const fixture = useMemo(() => {
    const f = createNativePerformanceFixture(count, 10);
    f.snapshot.project.id = project;
    f.snapshot.project.name = 'Panel transition fixture';
    return f;
  }, [count]);
  const profile: ProfilerOnRenderCallback = (_id, _phase, actual) => {
    if (active.current) commits.current.push(actual);
  };
  const button = (label: string) =>
    Array.from(root.current!.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.getAttribute('aria-label') === label,
    );
  const panelState = () => {
    const r = root.current!;
    const rect = (selector: string) => {
      const e = r.querySelector<HTMLElement>(selector);
      return e
        ? {
            width: e.getBoundingClientRect().width,
            height: e.getBoundingClientRect().height,
            hidden: e.getAttribute('aria-hidden'),
          }
        : null;
    };
    return {
      workspace: rect('.native-editor-workspace'),
      inspector: rect('.native-editor-inspector'),
      pins: rect('.comments-container'),
      canvas: rect('.native-erd-surface'),
      transform: r.querySelector<HTMLElement>('.native-erd-world')?.style.transform,
    };
  };
  async function settle() {
    await Promise.all(
      root
        .current!.getAnimations({ subtree: true })
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
    await frame();
    await frame();
  }
  async function run(kind: 'pins' | 'inspector', open: boolean) {
    if (running) return;
    setRunning(true);
    setOutput('');
    const labels =
      kind === 'pins' ? ['핀 패널 열기', '핀 패널 숨기기'] : ['속성 패널 열기', '속성 패널 숨기기'];
    const wanted = labels[open ? 0 : 1]!;
    try {
      await document.fonts.ready;
      await settle();
      if (!button(wanted)) {
        button(labels[open ? 1 : 0]!)?.click();
        await settle();
      }
      const target = button(wanted);
      if (!target) throw Error('Missing panel toggle');
      const before = panelState(),
        fingerprint = fixtureFingerprint(fixture.document);
      const events: { type: string; property: string; target: string; at: number }[] = [];
      const pending = new Set<string>();
      const start = performance.now();
      const transition = (event: Event) => {
        const e = event as TransitionEvent;
        const el = e.target;
        if (
          !(el instanceof Element) ||
          !el.matches('.native-editor-workspace,.native-editor-inspector,.comments-container')
        )
          return;
        const key = el.className + e.propertyName;
        events.push({
          type: e.type,
          property: e.propertyName,
          target: el.className,
          at: performance.now() - start,
        });
        if (e.type === 'transitionrun') pending.add(key);
        else pending.delete(key);
      };
      for (const name of ['transitionrun', 'transitionend', 'transitioncancel'])
        root.current!.addEventListener(name, transition);
      commits.current = [];
      active.current = true;
      collector.start({
        scenario: 'panel-transition',
        kind,
        open,
        count,
        columns: 10,
        commit: __PERF_COMMIT__,
        dirty: __PERF_DIRTY__,
        viewport: [innerWidth, innerHeight],
        collectSpans: true,
      });
      let last = await frame();
      const intervals: number[] = [];
      const actionStart = performance.now();
      target.click();
      do {
        const now = await frame();
        intervals.push(now - last);
        last = now;
      } while (
        performance.now() - actionStart < 240 ||
        (pending.size > 0 && performance.now() - actionStart < 5000)
      );
      await frame();
      await frame();
      active.current = false;
      const { samples: _samples, ...measurement } = collector.stop();
      for (const name of ['transitionrun', 'transitionend', 'transitioncancel'])
        root.current!.removeEventListener(name, transition);
      const after = panelState();
      const expected = kind === 'pins' ? after.pins : after.inspector;
      setOutput(
        JSON.stringify(
          {
            measurement,
            before,
            after,
            events,
            frames: stats(intervals),
            intervals,
            react: stats(commits.current),
            over25: intervals.filter((t) => t > 25).length,
            documentUnchanged: fingerprint === fixtureFingerprint(fixture.document),
            targetReached: expected?.hidden === String(!open),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      active.current = false;
      collector.cancel();
      setOutput(JSON.stringify({ error: String(error) }));
    } finally {
      setRunning(false);
    }
  }
  return (
    <>
      <header className="panel-lab-controls">
        <strong>Full editor panel profiling · no server writes</strong>
        <select
          aria-label="Tables"
          value={count}
          disabled={running}
          onChange={(e) => setCount(Number(e.target.value))}
        >
          <option>50</option>
          <option>100</option>
        </select>
        <button
          disabled={running}
          onClick={() =>
            root.current?.querySelector<HTMLElement>('.native-erd-node.table')?.click()
          }
        >
          Select first table
        </button>
        {(['pins', 'inspector'] as const).flatMap((kind) =>
          [true, false].map((open) => (
            <button key={kind + open} disabled={running} onClick={() => void run(kind, open)}>
              Measure {kind} {open ? 'open' : 'close'}
            </button>
          )),
        )}
        <output aria-label="Panel status">
          {running ? 'running' : output ? 'complete' : 'ready'}
        </output>
      </header>
      <div ref={root} className="app-shell editor-shell panel-lab-shell">
        <ConfirmProvider>
          <Profiler id="workspace" onRender={profile}>
            <NativeProjectView
              key={count}
              entry={{ kind: 'native', ...fixture, personalUnavailable: false }}
              userId={actor}
              canEdit
              canPersonalEdit
              onLeave={noop}
              onReload={noop}
            />
          </Profiler>
        </ConfirmProvider>
      </div>
      <textarea aria-label="Panel JSON" readOnly value={output} />
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Demo />);
