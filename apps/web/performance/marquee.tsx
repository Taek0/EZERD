import { Profiler, useMemo, useRef, useState, type ProfilerOnRenderCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeProjectView } from '../src/features/projects/NativeProjectView.js';
import { ConfirmProvider } from '../src/components/ui/ConfirmProvider.js';
import { createNativePerformanceFixture } from '../src/shared/performance/native-fixture.js';
import { fixtureFingerprint } from '../src/shared/performance/fixture.js';
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
declare const __MARQUEE_BASELINE__: boolean;
declare const __PERF_COMMIT__: string;
const actor = '90000000-0000-4000-8000-000000000031',
  project = '90000000-0000-4000-8000-000000000032';
if (location.hostname !== '127.0.0.1' || !['4180', '4181'].includes(location.port))
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
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    total: values.reduce((a, b) => a + b, 0),
    p50: sorted[Math.floor(sorted.length / 2)] ?? 0,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
};
function Demo() {
  const [count, setCount] = useState(50),
    [running, setRunning] = useState(false),
    [output, setOutput] = useState(''),
    [progress, setProgress] = useState('ready');
  const root = useRef<HTMLDivElement>(null),
    active = useRef(false),
    commits = useRef<number[]>([]);
  const fixture = useMemo(() => {
    const f = createNativePerformanceFixture(count, 10);
    f.snapshot.project.id = project;
    return f;
  }, [count]);
  const profile: ProfilerOnRenderCallback = (_id, _phase, duration) => {
    if (active.current) commits.current.push(duration);
  };
  async function run() {
    if (running) return;
    setRunning(true);
    setOutput('');
    const samples: unknown[] = [];
    const surface = root.current!.querySelector<HTMLElement>('.native-erd-surface')!;
    // Synthetic pointer events have no browser active pointer. Shim capture only in this fixture.
    const originalSet = surface.setPointerCapture,
      originalHas = surface.hasPointerCapture,
      originalRelease = surface.releasePointerCapture;
    let captured = false;
    surface.setPointerCapture = () => {
      captured = true;
    };
    surface.hasPointerCapture = () => captured;
    surface.releasePointerCapture = () => {
      captured = false;
    };
    const send = (type: string, x: number, y: number) =>
      surface.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 71,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: x,
          clientY: y,
        }),
      );
    try {
      await document.fonts.ready;
      for (const scenario of ['stable', 'sweep'] as const) {
        for (let repeat = 0; repeat < 4; repeat++) {
          setProgress(`${count} ${scenario} ${repeat === 0 ? 'warmup' : repeat + '/3'}`);
          await frame();
          await frame();
          // Keep panel geometry and camera identical and let scene entrance animations finish.
          await new Promise((resolve) => setTimeout(resolve, 400));
          const bounds = surface.getBoundingClientRect();
          const camera =
            root.current!.querySelector<HTMLElement>('.native-erd-world')!.style.transform;
          const fingerprint = fixtureFingerprint(fixture.document);
          const start = { x: bounds.left + 4, y: bounds.top + 4 };
          const end = {
            x: bounds.left + Math.min(bounds.width - 20, 900),
            y: bounds.top + Math.min(bounds.height - 70, 600),
          };
          const selected = () =>
            [...surface.querySelectorAll<HTMLElement>('.native-erd-node[data-selected="true"]')]
              .map((el) => el.dataset.objectId)
              .sort();
          send('pointerdown', start.x, start.y);
          send('pointermove', end.x, end.y);
          await frame();
          await frame();
          const selectionBefore = selected();
          commits.current = [];
          active.current = true;
          const intervals: number[] = [];
          const observedSelections = new Set<string>();
          let previous = await frame();
          for (let step = 0; step < 60; step++) {
            for (let burst = 0; burst < 4; burst++) {
              const ratio =
                scenario === 'stable' ? 1 : 0.15 + (0.85 * ((step * 4 + burst) % 120)) / 119;
              send(
                'pointermove',
                start.x +
                  (end.x - start.x) * ratio +
                  (scenario === 'stable' ? ((step + burst) % 4) * 0.1 : 0),
                start.y + (end.y - start.y) * ratio,
              );
            }
            const now = await frame();
            intervals.push(now - previous);
            observedSelections.add(JSON.stringify(selected()));
            previous = now;
          }
          send('pointerup', end.x, end.y);
          // Include both rAF-scheduled React commits and final release work in trailing intervals.
          for (let i = 0; i < 3; i++) {
            const now = await frame();
            intervals.push(now - previous);
            observedSelections.add(JSON.stringify(selected()));
            previous = now;
          }
          active.current = false;
          samples.push({
            scenario,
            repeat,
            warmup: repeat === 0,
            count,
            columns: 10,
            events: 240,
            frames: stats(intervals),
            intervals,
            react: stats(commits.current),
            commits: commits.current,
            selectionBefore,
            observedSelections: [...observedSelections],
            selectionAfter: selected(),
            boxHidden:
              !surface.querySelector<HTMLElement>('.canvas-selection-box') ||
              surface.querySelector<HTMLElement>('.canvas-selection-box')!.hidden,
            cameraUnchanged:
              camera ===
              root.current!.querySelector<HTMLElement>('.native-erd-world')!.style.transform,
            documentUnchanged: fingerprint === fixtureFingerprint(fixture.document),
          });
        }
      }
      setOutput(
        JSON.stringify(
          {
            implementation: __MARQUEE_BASELINE__ ? 'before-a27b0de' : 'after-9e942c4',
            harnessCommit: __PERF_COMMIT__,
            viewport: [innerWidth, innerHeight],
            dpr: devicePixelRatio,
            userAgent: navigator.userAgent,
            method:
              'synthetic pointer events; capture shim; 4 moves per frame; production React profiling; 60 frames plus 3 settling frames',
            samples,
          },
          null,
          2,
        ),
      );
      setProgress('complete');
    } catch (error) {
      setOutput(JSON.stringify({ error: String(error) }));
      setProgress('failed');
    } finally {
      active.current = false;
      surface.setPointerCapture = originalSet;
      surface.hasPointerCapture = originalHas;
      surface.releasePointerCapture = originalRelease;
      setRunning(false);
    }
  }
  return (
    <>
      <header className="panel-lab-controls">
        <strong>Marquee · {__MARQUEE_BASELINE__ ? 'before' : 'after'} · no writes</strong>
        <select
          aria-label="Tables"
          value={count}
          disabled={running}
          onChange={(e) => {
            setOutput('');
            setProgress('ready');
            setCount(Number(e.target.value));
          }}
        >
          <option>50</option>
          <option>100</option>
        </select>
        <button disabled={running} onClick={() => void run()}>
          Measure marquee suite
        </button>
        <button
          disabled={!output || running}
          onClick={() => {
            const url = URL.createObjectURL(new Blob([output], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `marquee-${__MARQUEE_BASELINE__ ? 'before' : 'after'}-${count}.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Download measurement JSON
        </button>
        <output aria-label="Marquee status">{progress}</output>
      </header>
      <div ref={root} className="app-shell editor-shell panel-lab-shell">
        <ConfirmProvider>
          <Profiler id="workspace" onRender={profile}>
            <NativeProjectView
              key={count}
              entry={{ kind: 'native', ...fixture }}
              userId={actor}
              canEdit
              onLeave={() => {}}
              onReload={() => {}}
            />
          </Profiler>
        </ConfirmProvider>
      </div>
      <textarea
        aria-label="Marquee JSON"
        value={output}
        readOnly
        style={{ width: '100%', height: 80 }}
      />
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Demo />);
