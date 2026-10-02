import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TABLES_VIEW_ID } from '@ezerd/model';
import { NativeERDCanvas } from '../src/features/projects/NativeERDCanvas.js';
import { createNativePerformanceFixture } from '../src/shared/performance/native-fixture.js';
import { fixtureFingerprint } from '../src/shared/performance/fixture.js';
import { collector } from '../src/shared/performance/collector.js';
import { ConfirmProvider } from '../src/components/ui/ConfirmProvider.js';
import { getLocale } from '../src/shared/i18n/index.js';
import '../src/components/ui/tailwind.css';
import '../src/styles/tokens.css';
import '../src/components/ui/ui.css';
import '../src/styles/styles.css';
import './performance.css';

declare const __PERF_COMMIT__: string;
declare const __PERF_DIRTY__: boolean;
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
function NativeFixture() {
  const [count, setCount] = useState(10),
    [epoch, setEpoch] = useState(0);
  const fixture = useMemo(() => createNativePerformanceFixture(count, 10), [count, epoch]);
  const [phase, setPhase] = useState('loading'),
    [output, setOutput] = useState('');
  const area = useRef<HTMLDivElement>(null),
    status = useRef<HTMLOutputElement>(null);
  const run = useRef({
    armed: false,
    running: false,
    finishing: false,
    id: '',
    timer: 0,
    wheels: 0,
    before: '',
  });
  const state = () => ({
    documentFingerprint: fixtureFingerprint(fixture.document),
    cameraTransform: area.current?.querySelector<HTMLElement>('.native-erd-world')?.style.transform,
    cards: area.current?.querySelectorAll('.native-erd-node.table').length ?? 0,
    canvasViewId:
      area.current?.querySelector<HTMLSelectElement>('.native-erd-controls select')?.value ??
      TABLES_VIEW_ID,
  });
  useEffect(() => {
    let alive = true;
    setPhase('loading');
    collector.cancel();
    run.current.armed = false;
    run.current.running = false;
    clearTimeout(run.current.timer);
    void (async () => {
      await document.fonts.ready;
      await frame();
      await frame();
      if (alive) setPhase('ready');
    })();
    return () => {
      alive = false;
      collector.cancel();
      clearTimeout(run.current.timer);
      run.current.running = false;
    };
  }, [fixture]);
  async function finish(failure?: string) {
    const current = run.current;
    if (!current.running || current.finishing) return;
    current.finishing = true;
    const id = current.id;
    clearTimeout(current.timer);
    await frame();
    await frame();
    if (!current.running || current.id !== id) return;
    const measured = collector.stop(),
      after = state();
    current.running = false;
    current.armed = false;
    setOutput(
      JSON.stringify(
        {
          ...measured,
          runId: id,
          outcome: failure ? 'failed' : measured.status,
          failure: failure ?? null,
          events: { wheel: current.wheels },
          before: JSON.parse(current.before),
          after,
          documentUnchanged:
            JSON.parse(current.before).documentFingerprint === after.documentFingerprint,
        },
        null,
        2,
      ),
    );
    setPhase('result');
  }
  return (
    <>
      <header className="perf-controls">
        <strong>Native v2 · PostgreSQL · read-only</strong>
        <a href="./index.html">Legacy shared canvas</a>
        <select
          aria-label="Native fixture tables"
          value={count}
          disabled={phase === 'armed'}
          onChange={(e) => {
            setOutput('');
            setCount(Number(e.target.value));
          }}
        >
          {[10, 50, 100, 300].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <button
          disabled={phase === 'armed'}
          onClick={() => {
            setOutput('');
            setEpoch((n) => n + 1);
          }}
        >
          Reset native fixture
        </button>
        <button
          disabled={!['ready', 'result'].includes(phase)}
          onClick={() => {
            Object.assign(run.current, {
              armed: true,
              running: false,
              finishing: false,
              wheels: 0,
              id: crypto.randomUUID(),
            });
            setOutput('');
            setPhase('armed');
          }}
        >
          Arm native measurement
        </button>
        <button disabled={phase !== 'armed'} onClick={() => void finish()}>
          Finish native measurement
        </button>
        <output ref={status} aria-label="Native measurement status">
          {phase}
        </output>
      </header>
      <p>
        Shared native scene only. No API, DB, personal state, write or collaboration measurements.
      </p>
      <div
        ref={area}
        onWheelCapture={() => {
          const current = run.current;
          if (!current.armed || current.finishing) return;
          if (!current.running) {
            current.before = JSON.stringify(state());
            collector.start({
              commit: __PERF_COMMIT__,
              dirty: __PERF_DIRTY__,
              fixtureVersion: 2,
              editorKind: 'native-readonly',
              documentSchemaVersion: 2,
              databaseKind: 'postgresql',
              canvasViewId: state().canvasViewId,
              count,
              columns: 10,
              fixtureFingerprint: fixtureFingerprint(fixture.document),
              scenario: 'PAN_ZOOM',
              mode: 'browser-input',
              build: 'production-instrumented',
              locale: getLocale(),
              userAgent: navigator.userAgent,
              viewport: [innerWidth, innerHeight],
              dpr: devicePixelRatio,
            });
            current.running = true;
            if (status.current) status.current.textContent = 'running';
            current.timer = window.setTimeout(() => void finish('30 second limit'), 30000);
          }
          current.wheels++;
        }}
      >
        <NativeERDCanvas
          key={count + '-' + epoch}
          {...fixture}
          editable={false}
          busy={false}
          onSave={async () => false}
          onReload={() => setEpoch((n) => n + 1)}
          mode="physical"
          onSelect={() => {}}
        />
      </div>
      {output && (
        <details className="perf-result" open>
          <summary>Native measurement JSON</summary>
          <textarea aria-label="Native measurement JSON" readOnly value={output} />
        </details>
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <ConfirmProvider>
    <NativeFixture />
  </ConfirmProvider>,
);
