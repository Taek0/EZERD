import { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { addTableReference, updateNodeLayout, type NativeDesignDocument } from '@ezerd/model';
import { NativeERDCanvas } from '../src/features/projects/NativeERDCanvas.js';
import type { NativeEditorSave } from '../src/features/projects/native-editor-form.js';
import { ConfirmProvider } from '../src/components/ui/ConfirmProvider.js';
import { createNativePerformanceFixture } from '../src/shared/performance/native-fixture.js';
import '../src/components/ui/tailwind.css';
import '../src/styles/tokens.css';
import '../src/components/ui/ui.css';
import '../src/styles/styles.css';
import '../src/styles/editor-topbar.css';
import '../src/styles/canvas-viewport.css';
import '../src/styles/navigation-controls.css';
import '../src/styles/inspector.css';
import '../src/styles/editor-feedback.css';
import './performance.css';
import './ghost-drag.css';

if (location.origin !== 'http://127.0.0.1:4184')
  throw new Error('Use dedicated fixture origin http://127.0.0.1:4184');
const actor = crypto.randomUUID();
sessionStorage.setItem(
  'ezerd.sync.session',
  JSON.stringify({
    userId: actor,
    token: 'LOCAL-GHOST-FIXTURE',
    expiresAt: '2099-01-01T00:00:00Z',
  }),
);
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    location.href,
  );
  if (url.pathname === '/api' || url.pathname.startsWith('/api/'))
    return Response.json({ message: 'Ghost fixture blocks all API traffic' }, { status: 403 });
  return originalFetch(input, init);
};

// Keep computation in the real worker; delay only delivery of its completed result.
const OriginalWorker = window.Worker;
let delayWorker = false;
class FixtureWorker extends OriginalWorker {
  private timers = new Set<number>();
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    if (options?.name !== 'native-ghost') return;
    const delivered = new WeakSet<Event>();
    this.addEventListener('message', (event) => {
      if (!delayWorker || delivered.has(event)) return;
      event.stopImmediatePropagation();
      const timer = window.setTimeout(() => {
        this.timers.delete(timer);
        const copy = new MessageEvent('message', { data: event.data });
        delivered.add(copy);
        this.dispatchEvent(copy);
      }, 1000);
      this.timers.add(timer);
    });
  }
  override terminate() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    super.terminate();
  }
}
window.Worker = FixtureWorker;

function freshFixture() {
  const fixture = createNativePerformanceFixture(10, 5);
  fixture.snapshot.project.id = crypto.randomUUID();
  fixture.snapshot.project.name = 'Isolated ghost drag fixture';
  return fixture;
}
function GhostFixture() {
  const [fixture, setFixture] = useState(freshFixture);
  const current = useRef(fixture);
  const [epoch, setEpoch] = useState(0);
  const [saveCount, setSaveCount] = useState(0);
  const [pending, setPending] = useState(0);
  const held = useRef<Array<{ document: NativeDesignDocument; resolve: (ok: boolean) => void }>>(
    [],
  );
  const [selected, setSelected] = useState('');
  const [delay, setDelay] = useState(false);
  const [status, setStatus] = useState('ready');
  const publish = useCallback((next: typeof fixture) => {
    current.current = next;
    setFixture(next);
  }, []);
  const onSave = useCallback<NativeEditorSave>(
    async (commands) => {
      let next = current.current.document;
      for (const command of commands) {
        if (command.type === 'update_node_layout')
          next = updateNodeLayout(next, command.nodeId, command.patch);
        else if (command.type === 'add_table_reference') {
          next = addTableReference(next, command.tableId, command.viewId, command.placement);
          if (command.nodeId)
            next = {
              ...next,
              layout: {
                ...next.layout,
                nodes: next.layout.nodes.map((node) =>
                  node.objectId === command.tableId && node.viewId === command.viewId
                    ? { ...node, id: command.nodeId! }
                    : node,
                ),
              },
            };
        } else {
          setStatus(`unsupported: ${command.type}`);
          return false;
        }
      }
      publish({ ...current.current, document: next });
      setSaveCount((count) => count + 1);
      setStatus('optimistic; awaiting ACK');
      return new Promise<boolean>((resolve) => {
        held.current.push({ document: next, resolve });
        setPending(held.current.length);
      });
    },
    [publish],
  );
  const acknowledge = () => {
    const entry = held.current.shift();
    if (!entry) return;
    const previous = current.current;
    publish({
      ...previous,
      snapshot: {
        ...previous.snapshot,
        sequence: previous.snapshot.sequence + 1,
        project: { ...previous.snapshot.project, version: previous.snapshot.project.version + 1 },
        sourceDocument: entry.document,
        native: { status: 'available', document: entry.document, issues: [], migrationIssues: [] },
      },
    });
    setPending(held.current.length);
    setStatus('ACK applied');
    entry.resolve(true);
  };
  const reset = () => {
    for (const entry of held.current) entry.resolve(false);
    held.current = [];
    setPending(0);
    setSaveCount(0);
    setSelected('');
    setStatus('ready');
    publish(freshFixture());
    setEpoch((value) => value + 1);
  };
  return (
    <>
      <header className="perf-controls">
        <strong>Ghost drag · synthetic 10 tables</strong>
        <label>
          <input
            type="checkbox"
            checked={delay}
            onChange={(event) => {
              delayWorker = event.target.checked;
              setDelay(delayWorker);
            }}
          />{' '}
          Worker 결과 지연 (1000ms)
        </label>
        <button disabled={!pending} onClick={acknowledge}>
          ACK 반영
        </button>
        <button
          onClick={() => {
            const previous = current.current;
            const document = {
              ...previous.document,
              tables: previous.document.tables?.map((table, index) =>
                index === 0
                  ? {
                      ...table,
                      physical: { ...table.physical, name: `${table.physical.name}_changed` },
                    }
                  : table,
              ),
            };
            publish({ ...previous, document });
            setStatus('document changed');
          }}
        >
          문서 변경
        </button>
        <button onClick={reset}>초기화</button>
        <output aria-label="Ghost fixture status">
          saveCount={saveCount}; pending={pending}; selected={selected || 'none'}; {status}
        </output>
      </header>
      <details className="ghost-fixture-positions">
        <summary>현재 좌표</summary>
        <output aria-label="Current node positions">
          {fixture.document.layout.nodes
            .map((node) => `${node.id} (${node.objectId}): ${node.x},${node.y}`)
            .join(' | ')}
        </output>
      </details>
      <div className="ghost-fixture-canvas">
        <NativeERDCanvas
          key={epoch}
          {...fixture}
          userId={actor}
          editable
          busy={false}
          onSave={onSave}
          onReload={() => setStatus('reload requested')}
          mode="physical"
          {...(selected ? { selectedTableId: selected } : {})}
          onSelect={setSelected}
        />
      </div>
    </>
  );
}
const root = createRoot(document.getElementById('root')!);
root.render(
  <ConfirmProvider>
    <GhostFixture />
  </ConfirmProvider>,
);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    root.unmount();
    window.fetch = originalFetch;
    window.Worker = OriginalWorker;
  });
