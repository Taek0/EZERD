import {
  Profiler,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ProfilerOnRenderCallback,
} from 'react';
import { createRoot } from 'react-dom/client';
import { TABLES_VIEW_ID } from '@ezerd/model';
import { Canvas } from '../src/features/canvas/Canvas.js';
import { NativeERDCanvas } from '../src/features/projects/NativeERDCanvas.js';
import { ConfirmProvider } from '../src/components/ui/ConfirmProvider.js';
import { createPerformanceFixture, fixtureFingerprint } from '../src/shared/performance/fixture.js';
import { createNativePerformanceFixture } from '../src/shared/performance/native-fixture.js';
import { collector } from '../src/shared/performance/collector.js';
import { comparisonControl } from './comparison-control.js';
import '../src/components/ui/tailwind.css';
import '../src/styles/tokens.css';
import '../src/components/ui/ui.css';
import '../src/styles/styles.css';
import '../src/styles/inspector.css';
import '../src/styles/editor-feedback.css';
import '../src/styles/canvas-viewport.css';
import '../src/styles/editor-topbar.css';
import '../src/styles/navigation-controls.css';
import './compare.css';

declare const __PERF_COMMIT__: string;
declare const __PERF_DIRTY__: boolean;
const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const noop = () => {};
const noSave = async () => false;
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    total: values.reduce((a, b) => a + b, 0),
    median: sorted[Math.ceil(sorted.length * 0.5) - 1] ?? 0,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
};
function Compare() {
  const [editor, setEditor] = useState('legacy');
  const [variant, setVariant] = useState('baseline');
  const [count, setCount] = useState(50);
  const [epoch, setEpoch] = useState(0);
  const [ready, setReady] = useState(false);
  const [output, setOutput] = useState('');
  const area = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLOutputElement>(null);
  const active = useRef(false);
  const real = useRef({ armed: false, wheels: 0, before: {} as ReturnType<typeof state> });
  const commits = useRef<
    { phase: string; actual: number; base: number; start: number; commit: number }[]
  >([]);
  const fixture = useMemo(() => {
    const legacy = createPerformanceFixture(count, 10);
    legacy.layout.viewports = [{ viewId: TABLES_VIEW_ID, x: 24, y: 24, zoom: 1 }];
    return { legacy, native: createNativePerformanceFixture(count, 10) };
  }, [count]);

  comparisonControl.variant = variant;
  const currentDoc = editor === 'legacy' ? fixture.legacy : fixture.native.document;
  const world = () =>
    area.current?.querySelector<HTMLElement>(
      editor === 'legacy' ? '.canvas-world' : '.native-erd-world',
    );
  const state = () => {
    const root = world();
    return {
      transform: root?.style.transform,
      elements: root?.querySelectorAll('*').length,
      paths: root?.querySelectorAll('path').length,
      textLength: root?.textContent?.length,
      fingerprint: fixtureFingerprint(currentDoc),
    };
  };
  const profile: ProfilerOnRenderCallback = (_id, phase, actual, base, start, commit) => {
    if (active.current) commits.current.push({ phase, actual, base, start, commit });
  };
  useEffect(() => {
    let alive = true;
    setReady(false);
    void (async () => {
      await document.fonts.ready;
      await frame();
      await frame();
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [editor, variant, count, epoch]);
  async function run() {
    if (active.current || !ready) return;
    const surface = area.current?.querySelector<HTMLElement>(
      editor === 'legacy' ? '.canvas-surface' : '.native-erd-surface',
    );
    if (!surface) throw Error('No canvas surface');
    active.current = true;
    if (status.current) status.current.textContent = 'warming';
    // Warm both camera update paths before measuring; same total displacement for each variant.
    const rect = surface.getBoundingClientRect();
    const wheel = (delta: number) =>
      surface.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX: delta,
          deltaY: 0,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }),
      );
    for (let i = 0; i < 8; i++) {
      wheel(i % 2 ? -4 : 4);
      await frame();
    }
    await frame();
    let idleLast = await frame();
    const idleIntervals: number[] = [];
    for (let i = 0; i < 20; i++) {
      const now = await frame();
      idleIntervals.push(now - idleLast);
      idleLast = now;
    }
    const before = state();
    const observations: Record<string, unknown>[] = [];
    const supported = PerformanceObserver.supportedEntryTypes;
    const observers: PerformanceObserver[] = [];
    for (const type of ['longtask', 'long-animation-frame']) {
      if (!supported.includes(type)) continue;
      const observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) observations.push(e.toJSON());
      });
      observer.observe({ type, buffered: false });
      observers.push(observer);
    }
    commits.current = [];
    collector.start({
      scenario: 'paced-pan-comparison',
      editor,
      variant,
      count,
      columns: 10,
      commit: __PERF_COMMIT__,
      dirty: __PERF_DIRTY__,
      build: 'production-react-profiling',
      input: 'synthetic-wheel-one-per-rAF',
      collectSpans: true,
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      userAgent: navigator.userAgent,
    });
    active.current = true;
    if (status.current) status.current.textContent = 'running';
    document
      .querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
        '.comparison-controls button,.comparison-controls select',
      )
      .forEach((el) => {
        el.disabled = true;
      });
    let last = await frame();
    const intervals: number[] = [];
    let midpoint: ReturnType<typeof state> | null = null;
    for (let i = 0; i < 120; i++) {
      wheel(i < 60 ? 4 : -4);
      const now = await frame();
      intervals.push(now - last);
      last = now;
      if (i === 59) midpoint = state();
    }
    await frame();
    await frame();
    active.current = false;
    const { samples: _functionSamples, ...measurement } = collector.stop();
    for (const observer of observers) {
      for (const e of observer.takeRecords()) observations.push(e.toJSON());
      observer.disconnect();
    }
    const after = state();
    const result = {
      measurement,
      before,
      midpoint,
      after,
      surface: { width: rect.width, height: rect.height },
      documentUnchanged: before.fingerprint === after.fingerprint,
      frames: stats(intervals),
      frameIntervals: intervals,
      idleFrames: stats(idleIntervals),
      over25: intervals.filter((t) => t > 25).length,
      over50: intervals.filter((t) => t > 50).length,
      react: stats(commits.current.map((c) => c.actual)),
      commits: commits.current,
      observations,
      supportedObservers: supported.filter((t) => t === 'longtask' || t === 'long-animation-frame'),
    };
    document
      .querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
        '.comparison-controls button,.comparison-controls select',
      )
      .forEach((el) => {
        el.disabled = false;
      });
    if (status.current) status.current.textContent = 'complete';
    setOutput(JSON.stringify(result, null, 2));
  }
  function armReal() {
    if (active.current) return;
    real.current = { armed: true, wheels: 0, before: state() };
    setOutput('');
    if (status.current) status.current.textContent = 'armed-real';
  }
  function captureRealWheel() {
    if (!real.current.armed) return;
    if (!active.current) {
      commits.current = [];
      real.current.before = state();
      collector.start({
        scenario: 'real-pan-smoke',
        editor,
        variant,
        count,
        commit: __PERF_COMMIT__,
        dirty: __PERF_DIRTY__,
        input: 'browser-wheel',
        build: 'production-react-profiling',
      });
      active.current = true;
      if (status.current) status.current.textContent = 'running-real';
    }
    real.current.wheels++;
  }
  async function finishReal() {
    if (!real.current.armed || !active.current) return;
    await frame();
    await frame();
    active.current = false;
    real.current.armed = false;
    const { samples: _samples, ...measurement } = collector.stop();
    const after = state();
    setOutput(
      JSON.stringify(
        {
          measurement,
          before: real.current.before,
          after,
          documentUnchanged: real.current.before.fingerprint === after.fingerprint,
          wheels: real.current.wheels,
          react: stats(commits.current.map((c) => c.actual)),
          commits: commits.current,
        },
        null,
        2,
      ),
    );
    if (status.current) status.current.textContent = 'complete-real';
  }
  return (
    <>
      <header className="comparison-controls">
        <strong>Canvas comparison · read-only · 10 columns/table</strong>
        <select
          aria-label="Editor"
          value={editor}
          onChange={(e) => {
            setEditor(e.target.value);
            setVariant('baseline');
            setOutput('');
          }}
        >
          <option value="legacy">Legacy v1</option>
          <option value="native">Native v2</option>
        </select>
        <select
          aria-label="Tables"
          value={count}
          onChange={(e) => {
            setCount(Number(e.target.value));
            setOutput('');
          }}
        >
          {[10, 50, 100, 300].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <select
          aria-label="Variant"
          value={variant}
          onChange={(e) => {
            setVariant(e.target.value);
            setOutput('');
          }}
        >
          {['baseline', 'memo-leaves', 'simple-cards', 'no-relations', 'flat-style'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <button disabled={!ready} onClick={() => setEpoch((e) => e + 1)}>
          Reset comparison
        </button>
        <button disabled={!ready} onClick={() => void run()}>
          Run paced pan
        </button>
        <button disabled={!ready} onClick={armReal}>
          Arm real pan
        </button>
        <button onClick={() => void finishReal()}>Finish real pan</button>
        <output ref={status} aria-label="Comparison status">
          {ready ? 'ready' : 'loading'}
        </output>
      </header>
      <p>
        Diagnostic production profiling build. Synthetic paced wheel; no API, persistence or
        collaboration. Leaf memo ignores callbacks only for this immutable read-only experiment.
      </p>
      <div ref={area} onWheelCapture={captureRealWheel} className={`comparison-editor ${variant}`}>
        <Profiler id="canvas" onRender={profile}>
          {editor === 'legacy' ? (
            <Canvas
              key={`${editor}-${variant}-${count}-${epoch}`}
              document={fixture.legacy}
              onChange={noop}
              readOnly={true}
            />
          ) : (
            <NativeERDCanvas
              key={`${editor}-${variant}-${count}-${epoch}`}
              {...fixture.native}
              editable={false}
              busy={false}
              onSave={noSave}
              onReload={noop}
              mode="physical"
              onSelect={noop}
            />
          )}
        </Profiler>
      </div>
      {output && (
        <details open>
          <summary>Comparison result</summary>
          <textarea aria-label="Comparison JSON" readOnly value={output} />
        </details>
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <ConfirmProvider>
    <Compare />
  </ConfirmProvider>,
);
