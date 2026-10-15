import { startTransition, useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { projectDocumentStateSchema, type NativeSyncOperationResult } from '@ezerd/contracts';
import {
  applyChanges,
  deriveOperationChanges,
  inverseChanges,
  updateNodeLayout,
  upsertRelationLayout,
  type NativeDesignDocument,
} from '@ezerd/model';
import { NativeProjectView } from '../src/features/projects/NativeProjectView.js';
import { nativeEntryAfterAck } from '../src/features/projects/native-ack-entry.js';
import type { ProjectEntry } from '../src/features/projects/project-entry.js';
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
import './panels.css';

const actor = '90000000-0000-4000-8000-000000000031';
const project = crypto.randomUUID();
if (location.hostname !== '127.0.0.1' || location.port !== '4180')
  throw Error('Use dedicated fixture origin 127.0.0.1:4180');
sessionStorage.setItem(
  'ezerd.sync.session',
  JSON.stringify({
    userId: actor,
    token: 'LOCAL-RELATION-FIXTURE',
    expiresAt: '2099-01-01T00:00:00Z',
  }),
);

const originalFetch = window.fetch.bind(window);
const actual = new URLSearchParams(location.search).has('actual')
  ? projectDocumentStateSchema.parse(
      await originalFetch('/__diagnostic/snapshot.json').then((response) => {
        if (!response.ok) throw Error('Actual fixture unavailable');
        return response.json();
      }),
    )
  : null;
const initial =
  actual?.native.status === 'available'
    ? { document: actual.native.document, snapshot: actual }
    : createNativePerformanceFixture(50, 10);
initial.snapshot.project.id = project;
initial.snapshot.project.name = 'Relation arrangement fixture';
if (initial.snapshot.sourceDocument.schemaVersion !== 2) throw Error('Native snapshot required');
let serverDocument: NativeDesignDocument = structuredClone(
  initial.snapshot.sourceDocument,
) as NativeDesignDocument;
let currentSnapshot = initial.snapshot;
let serverSequence = initial.snapshot.sequence;
let serverVersion = initial.snapshot.project.version;
let saveDelayMs = 0;
const results = new Map<string, NativeSyncOperationResult>();
const changesByOperation = new Map<string, ReturnType<typeof deriveOperationChanges>>();
const clientIds = new Map<string, string>();
const response = (value: unknown, status = 200) => Response.json(value, { status });
const database = () => ({
  kind: serverDocument.database.kind,
  profileId: serverDocument.database.profileId,
});
function accept(
  operationId: string,
  groupId: string,
  clientId: string,
  next: NativeDesignDocument,
) {
  const changes = deriveOperationChanges(serverDocument, next);
  serverDocument = next;
  serverSequence++;
  serverVersion++;
  const createdAt = new Date().toISOString();
  const result: NativeSyncOperationResult = {
    protocolVersion: 2,
    database: database(),
    databaseRevision: initial.snapshot.project.databaseRevision,
    operationId,
    groupId,
    sequence: serverSequence,
    status: 'accepted',
    document: structuredClone(serverDocument),
    delta: { baseSequence: serverSequence - 1, projectVersion: serverVersion, changes },
    actor: { id: actor, username: 'fixture', color: '#06b6d4' },
    changedPaths: changes.map((change) => change.path),
    createdAt,
    nextBaseline: {
      baselineId: crypto.randomUUID(),
      baseSequence: serverSequence,
      baselineIssuedAt: createdAt,
      databaseRevision: initial.snapshot.project.databaseRevision,
    },
  };
  results.set(operationId, result);
  changesByOperation.set(operationId, changes);
  clientIds.set(operationId, clientId);
  return result;
}

window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    location.href,
  );
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);
  const method = init?.method ?? 'GET';
  const prefix = `/api/projects/${project}`;
  if (!url.pathname.startsWith(prefix)) return response({ message: 'Fixture project only' }, 404);
  if (url.pathname.endsWith('/members'))
    return response([{ userId: actor, username: 'fixture', color: '#06b6d4' }]);
  if (url.pathname.endsWith('/threads')) return response([]);
  if (url.pathname.endsWith('/document-state')) return response(currentSnapshot);
  if (url.pathname.endsWith('/native-sync/baseline'))
    return response({
      protocolVersion: 2,
      projectVersion: serverVersion,
      sequence: serverSequence,
      baselineId: crypto.randomUUID(),
      baselineIssuedAt: new Date().toISOString(),
      database: database(),
      databaseRevision: initial.snapshot.project.databaseRevision,
      document: serverDocument,
    });
  if (url.pathname.includes('/native-sync/operations/')) {
    const id = url.pathname.split('/').at(-1)!;
    return results.has(id) ? response(results.get(id)) : response({ message: 'not found' }, 404);
  }
  if (url.pathname.endsWith('/native-sync/commands') && method === 'POST') {
    const request = JSON.parse(String(init?.body)) as {
      operationId: string;
      groupId: string;
      clientId: string;
      commands: Array<Record<string, unknown>>;
    };
    if (results.has(request.operationId)) return response(results.get(request.operationId));
    if (saveDelayMs) await new Promise((resolve) => setTimeout(resolve, saveDelayMs));
    if (results.has(request.operationId)) return response(results.get(request.operationId));
    let next = serverDocument;
    for (const command of request.commands) {
      if (command.type === 'batch_upsert_relation_layouts')
        for (const route of command.routes as Array<Record<string, unknown>>)
          next = upsertRelationLayout(next, {
            ...route,
            viewId: command.viewId,
          } as NonNullable<NativeDesignDocument['layout']['relations']>[number]);
      else if (command.type === 'update_node_layout')
        next = updateNodeLayout(
          next,
          command.nodeId as string,
          command.patch as { x?: number; y?: number },
        );
      else return response({ code: 'fixture.command-unsupported' }, 400);
    }
    return response(accept(request.operationId, request.groupId, request.clientId, next), 201);
  }
  if (url.pathname.endsWith('/native-sync/cancel') && method === 'POST') {
    const input = JSON.parse(String(init?.body)) as {
      request: { operationId: string; groupId: string };
    };
    const old = results.get(input.request.operationId);
    if (old) return response({ outcome: 'recorded', result: old });
    const createdAt = new Date().toISOString();
    const result: NativeSyncOperationResult = {
      protocolVersion: 2,
      operationId: input.request.operationId,
      groupId: input.request.groupId,
      sequence: serverSequence,
      status: 'rejected',
      reason: 'operation.cancelled',
      reasonCode: 'operation.cancelled',
      database: database(),
      databaseRevision: initial.snapshot.project.databaseRevision,
      actor: { id: actor, username: 'fixture', color: '#06b6d4' },
      changedPaths: [],
      createdAt,
      nextBaseline: {
        baselineId: crypto.randomUUID(),
        baseSequence: serverSequence,
        baselineIssuedAt: createdAt,
        databaseRevision: initial.snapshot.project.databaseRevision,
      },
    };
    results.set(result.operationId, result);
    return response({ outcome: 'cancelled', result });
  }
  if (url.pathname.endsWith('/native-history'))
    return response({
      protocolVersion: 2,
      projectId: project,
      version: serverVersion,
      sequence: serverSequence,
      database: { ...database(), revision: initial.snapshot.project.databaseRevision },
      history: [...results.values()]
        .filter((result) => result.status === 'accepted')
        .sort((a, b) => a.sequence - b.sequence)
        .filter((result) => result.sequence > Number(url.searchParams.get('since') ?? 0))
        .slice(0, 25)
        .map((result) => ({
          operationId: result.operationId,
          sequence: result.sequence,
          clientId: clientIds.get(result.operationId),
          kind: 'online',
          format: 'native',
          result,
          changes: changesByOperation.get(result.operationId),
        })),
      nextSince: null,
    });
  const undo = url.pathname.match(/\/native-history\/([^/]+)\/undo$/);
  if (undo && method === 'POST') {
    const request = JSON.parse(String(init?.body)) as {
      operationId: string;
      groupId: string;
      clientId: string;
    };
    const prior = results.get(request.operationId);
    if (prior)
      return response({
        result: prior,
        command: 'undo',
        sourceOperationId: undo[1],
        identityMap: [],
      });
    const changes = changesByOperation.get(undo[1]!);
    if (!changes) return response({ code: 'history.source-not-found' }, 404);
    const next = applyChanges(serverDocument, inverseChanges(changes));
    return response({
      result: accept(request.operationId, request.groupId, request.clientId, next),
      command: 'undo',
      sourceOperationId: undo[1],
      identityMap: [],
    });
  }
  return response({ message: 'Unsupported fixture API', path: url.pathname }, 403);
};

function LabDelayButton() {
  const [delayed, setDelayed] = useState(false);
  return (
    <button
      onClick={() => {
        saveDelayMs = delayed ? 0 : 2000;
        setDelayed(!delayed);
      }}
    >
      Save delay: {delayed ? '2 s' : 'off'}
    </button>
  );
}

function Demo() {
  const [entry, setEntry] = useState<Extract<ProjectEntry, { kind: 'native' }>>({
    kind: 'native',
    ...initial,
  } as Extract<ProjectEntry, { kind: 'native' }>);
  const currentEntry = useRef(entry);
  const [status, setStatus] = useState('ready');
  const onReload = useCallback(() => {
    const latest = [...results.values()]
      .filter((result) => result.status === 'accepted')
      .sort((a, b) => b.sequence - a.sequence)[0];
    const next = latest && nativeEntryAfterAck(currentEntry.current, latest);
    if (next) {
      currentEntry.current = next;
      currentSnapshot = next.snapshot;
      startTransition(() => setEntry(next));
    }
    setStatus('reloaded');
  }, []);
  const onAcknowledged = useCallback((ack: NativeSyncOperationResult) => {
    const next = nativeEntryAfterAck(currentEntry.current, ack);
    if (!next) return false;
    currentEntry.current = next;
    currentSnapshot = next.snapshot;
    startTransition(() => setEntry(next));
    setStatus(`${ack.status} · ${ack.sequence} · ${ack.changedPaths.length} paths`);
    return true;
  }, []);
  const onLeave = useCallback(() => setStatus('leave requested'), []);
  return (
    <>
      <header className="panel-lab-controls">
        <strong>Relation arrangement lab</strong>
        <span>{actual ? 'Actual snapshot' : 'Generated 50-table fixture'}</span>
        <span>{initial.document.tableRelations?.length ?? 0} relations</span>
        <LabDelayButton />
        <output aria-label="Relation fixture status">{status}</output>
      </header>
      <div className="app-shell editor-shell panel-lab-shell">
        <ConfirmProvider>
          <NativeProjectView
            entry={entry}
            userId={actor}
            canEdit
            onLeave={onLeave}
            onReload={onReload}
            onAcknowledged={onAcknowledged}
          />
        </ConfirmProvider>
      </div>
    </>
  );
}
const root = createRoot(document.getElementById('root')!);
root.render(<Demo />);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    root.unmount();
    window.fetch = originalFetch;
  });
