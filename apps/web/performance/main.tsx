import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '../src/features/canvas/Canvas.js';
import { ConfirmProvider } from '../src/components/ui/ConfirmProvider.js';
import { collector } from '../src/shared/performance/collector.js';
import { createPerformanceFixture, fixtureFingerprint } from '../src/shared/performance/fixture.js';
import { getLocale } from '../src/shared/i18n/index.js';
import '../src/components/ui/tailwind.css';
import '../src/styles/tokens.css';
import '../src/components/ui/ui.css';
import '../src/styles/styles.css';
import '../src/styles/inspector.css';
import '../src/styles/editor-feedback.css';
import '../src/styles/canvas-viewport.css';
import '../src/styles/editor-topbar.css';
import '../src/styles/navigation-controls.css';
import './performance.css';

declare const __PERF_COMMIT__: string;
declare const __PERF_DIRTY__: boolean;
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function PerformanceFixture() {
  const [count, setCount] = useState(10);
  const [columns, setColumns] = useState(5);
  const [epoch, setEpoch] = useState(0);
  const [doc, setDoc] = useState(() => createPerformanceFixture());
  const [phase, setPhase] = useState('loading');
  const [scenario, setScenario] = useState('PAN');
  const [collectSpans, setCollectSpans] = useState(true);
  const [output, setOutput] = useState('');
  const latest = useRef(doc);
  latest.current = doc;
  const area = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLOutputElement>(null);
  const run = useRef({
    armed: false,
    running: false,
    finishing: false,
    started: 0,
    raf: 0,
    timer: 0,
    lastFrame: 0,
    frames: [] as number[],
    events: {} as Record<string, number>,
    before: '',
    scenario: '',
    id: '',
  });
  const focus = useMemo(
    () => ({ viewId: 'perf', objectId: null, x: 450, y: 300, nonce: epoch + 1 }),
    [epoch],
  );
  const state = () => ({
    documentFingerprint: fixtureFingerprint(latest.current),
    firstNode: latest.current.layout.nodes[0],
    firstColumn: latest.current.columns?.[0]?.physical.name,
    cameraTransform: area.current?.querySelector<HTMLElement>('.canvas-world')?.style.transform,
    cards: area.current?.querySelectorAll('.table-node').length ?? 0,
    domElements: area.current?.querySelectorAll('*').length ?? 0,
  });

  useEffect(() => {
    let disposed = false;
    void (async () => {
      await document.fonts.ready;
      await frame();
      await frame();
      if (!disposed) setPhase('ready');
    })();
    return () => {
      disposed = true;
    };
  }, [epoch]);
  useEffect(
    () => () => {
      collector.cancel();
      cancelAnimationFrame(run.current.raf);
      clearTimeout(run.current.timer);
    },
    [],
  );

  async function finish(failure?: string) {
    const current = run.current;
    if (!current.running || current.finishing) return;
    current.finishing = true;
    const finishingId = current.id;
    clearTimeout(current.timer);
    // Let the final input's React update reach its next rendering opportunity.
    await frame();
    await frame();
    if (!current.running || current.id !== finishingId) return;
    cancelAnimationFrame(current.raf);
    const result = collector.stop();
    current.running = false;
    current.armed = false;
    const after = state();
    const sortedFrames = [...current.frames].sort((a, b) => a - b);
    setOutput(
      JSON.stringify(
        {
          ...result,
          runId: current.id,
          outcome: failure ? 'failed' : result.status,
          failure: failure ?? null,
          events: current.events,
          before: JSON.parse(current.before),
          after,
          documentUnchanged:
            JSON.parse(current.before).documentFingerprint === after.documentFingerprint,
          raf: {
            meaning: 'scheduling intervals, not input-to-present or GPU time',
            count: sortedFrames.length,
            p95Ms: sortedFrames[Math.ceil(sortedFrames.length * 0.95) - 1] ?? null,
          },
        },
        null,
        2,
      ),
    );
    setPhase('result');
  }

  useEffect(() => {
    const host = area.current!;
    const listener = (event: Event) => {
      const current = run.current;
      if (!current.armed || current.finishing) return;
      if (!current.running) {
        // Ignore idle pointer hover; arm starts on intentional editor input.
        if (['pointermove', 'pointerup', 'mousemove', 'mouseup'].includes(event.type)) return;
        current.before = JSON.stringify(state());
        current.running = true;
        current.started = performance.now();
        current.lastFrame = current.started;
        collector.start({
          commit: __PERF_COMMIT__,
          dirty: __PERF_DIRTY__,
          collectSpans,
          fixtureVersion: 1,
          count,
          columns,
          fixtureFingerprint: fixtureFingerprint(createPerformanceFixture(count, columns)),
          scenario: current.scenario,
          mode: 'browser-input',
          build: 'production-instrumented',
          locale: getLocale(),
          userAgent: navigator.userAgent,
          viewport: [innerWidth, innerHeight],
          dpr: devicePixelRatio,
          cache: 'warm page, no application cache invalidation',
          measurementLimit: 'handler entry through finish; includes automation gaps',
        });
        if (status.current) status.current.textContent = 'running';
        const tick = (now: number) => {
          if (!current.running) return;
          if (current.frames.length < 10000) current.frames.push(now - current.lastFrame);
          current.lastFrame = now;
          current.raf = requestAnimationFrame(tick);
        };
        current.raf = requestAnimationFrame(tick);
        current.timer = window.setTimeout(() => void finish('30 second run limit'), 30000);
      }
      current.events[event.type] = (current.events[event.type] ?? 0) + 1;
    };
    const types = [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'mousedown',
      'mousemove',
      'mouseup',
      'wheel',
      'keydown',
      'input',
      'click',
      'dblclick',
    ];
    types.forEach((type) =>
      host.addEventListener(type, listener, { capture: true, passive: true }),
    );
    const failed = () => void finish('page error or interrupted visibility');
    const visibility = () => {
      if (document.hidden) failed();
    };
    window.addEventListener('error', failed);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      types.forEach((type) => host.removeEventListener(type, listener, true));
      window.removeEventListener('error', failed);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [count, columns, epoch, collectSpans]);

  function reset() {
    collector.cancel();
    cancelAnimationFrame(run.current.raf);
    clearTimeout(run.current.timer);
    run.current.armed = false;
    run.current.running = false;
    run.current.finishing = false;
    setPhase('loading');
    setOutput('');
    setDoc(createPerformanceFixture(count, columns));
    setEpoch((n) => n + 1);
  }

  return (
    <>
      <header className="perf-controls">
        <strong>ERD performance fixture</strong>
        <label>
          <input
            type="checkbox"
            checked={collectSpans}
            disabled={phase === 'armed'}
            onChange={(e) => setCollectSpans(e.target.checked)}
          />
          Collect spans
        </label>
        <label>
          Tables{' '}
          <select
            aria-label="Fixture tables"
            value={count}
            disabled={phase === 'armed'}
            onChange={(e) => setCount(Number(e.target.value))}
          >
            {[10, 50, 100, 300].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          Columns{' '}
          <select
            aria-label="Fixture columns"
            value={columns}
            disabled={phase === 'armed'}
            onChange={(e) => setColumns(Number(e.target.value))}
          >
            {[5, 10, 30].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button onClick={reset}>Reset fixture</button>
        <select
          aria-label="Scenario"
          value={scenario}
          disabled={phase === 'armed'}
          onChange={(e) => setScenario(e.target.value)}
        >
          {['PAN', 'MOVE', 'EDIT'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button
          disabled={phase !== 'ready' && phase !== 'result'}
          onClick={() => {
            if (
              latest.current.tables?.length !== count ||
              latest.current.columns?.length !== count * columns
            ) {
              reset();
              return;
            }
            Object.assign(run.current, {
              armed: true,
              running: false,
              finishing: false,
              events: {},
              frames: [],
              scenario,
              id: crypto.randomUUID(),
            });
            setOutput('');
            setPhase('armed');
          }}
        >
          Arm measurement
        </button>
        <button disabled={phase !== 'armed'} onClick={() => void finish()}>
          Finish measurement
        </button>
        <output ref={status} aria-label="Measurement status">
          {phase}
        </output>
        <button
          disabled={!output}
          onClick={() => {
            const url = URL.createObjectURL(new Blob([output], { type: 'application/json' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `performance-${run.current.id}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Download JSON
        </button>
      </header>
      <div ref={area} className="perf-editor">
        <Canvas
          key={epoch}
          document={doc}
          onChange={setDoc}
          onPreviewChange={setDoc}
          readOnly={false}
          focusTarget={focus}
        />
      </div>
      {output && (
        <details className="perf-result" open>
          <summary>Measurement JSON</summary>
          <textarea aria-label="Measurement JSON" readOnly value={output} />
        </details>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <ConfirmProvider>
    <PerformanceFixture />
  </ConfirmProvider>,
);
