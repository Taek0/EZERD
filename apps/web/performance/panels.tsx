import {
  addNativeColumn,
  updateNativeColumn,
  planNativeDeletion,
  deriveOperationChanges,
} from '@ezerd/model';
import { nativeSaveIntents } from '../src/features/projects/native-save-intents.js';
import { startTransition } from 'react';
import { nativeEntryAfterAck } from '../src/features/projects/native-ack-entry.js';
import { nativeSyncOperationResultSchema } from '@ezerd/contracts';
declare const __BUTTON_NAV_PROBE__: boolean;
declare const __BUTTON_MEMO_PROBE__: boolean;
import { enqueueNativeSave } from '../src/features/projects/native-save-intents.js';
import { projectDocumentStateSchema } from '@ezerd/contracts';
import { VisualLayerAudit } from './visual-layer-audit.js';
import { Profiler, useMemo, useRef, useState, type ProfilerOnRenderCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeProjectView } from '../src/features/projects/NativeProjectView.js';
import { ConfirmProvider } from '../src/components/ui/ConfirmProvider.js';
import { createNativePerformanceFixture } from '../src/shared/performance/native-fixture.js';
import { fixtureFingerprint } from '../src/shared/performance/fixture.js';
import { panelProfiles } from './panel-profiles.js';
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
declare const __PANEL_BASELINE__: boolean;
declare const __PANEL_INTERACTION_BASELINE__: boolean;
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
let controlledSave: ((url: URL, init?: RequestInit) => Promise<Response | null>) | null = null;
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    location.href,
  );
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);
  if (controlledSave) {
    const controlled = await controlledSave(url, init);
    if (controlled) return controlled;
  }
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
const actualSnapshot = new URLSearchParams(location.search).has('actual')
  ? projectDocumentStateSchema.parse(
      await originalFetch('/__diagnostic/snapshot.json').then((r) => {
        if (!r.ok) throw Error('Actual fixture unavailable');
        return r.json();
      }),
    )
  : null;
const frame = () =>
  new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cancelAnimationFrame(id);
      reject(Error('Animation frame unavailable: foreground frame metrics were not collected'));
    }, 2000);
    const id = requestAnimationFrame((time) => {
      clearTimeout(timeout);
      resolve(time);
    });
  });
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
  const [spacing, setSpacing] = useState(1);
  const [visibilityOff, setVisibilityOff] = useState(false);
  const [layerOff, setLayerOff] = useState(false);
  const [svgExtent, setSvgExtent] = useState(false);
  const [gridOff, setGridOff] = useState(false);
  const [count, setCount] = useState(50),
    [output, setOutput] = useState(''),
    [running, setRunning] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    active = useRef(false),
    commits = useRef<number[]>([]);
  const fixture = useMemo(() => {
    const imported = actualSnapshot ? structuredClone(actualSnapshot) : null;
    const f =
      imported?.native?.status === 'available'
        ? { document: imported.native.document, snapshot: imported }
        : createNativePerformanceFixture(count, 10);
    f.snapshot.project.id = project;
    f.snapshot.project.name = 'Panel transition fixture';
    const documents = new Set([
      f.document,
      f.snapshot.sourceDocument,
      ...(f.snapshot.native?.status === 'available' ? [f.snapshot.native.document] : []),
    ]);
    for (const document of documents) {
      document.layout.nodes = document.layout.nodes.map((node) => ({
        ...node,
        x: node.x * spacing,
        y: node.y * spacing,
      }));
    }
    return f;
  }, [count, spacing]);
  const [replayed, setReplayed] = useState<{ key: string; value: typeof fixture } | null>(null);
  const liveFixture = useRef({ key: `${count}:${spacing}`, value: fixture });
  if (liveFixture.current.key !== `${count}:${spacing}`)
    liveFixture.current = { key: `${count}:${spacing}`, value: fixture };
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
    // Let React commit and CSS register transitions before checking their state.
    await frame();
    await frame();
    // Off-screen descendants may have suspended animations; do not await them.
    const elements = [
      ...root.current!.querySelectorAll<HTMLElement>(
        '.native-editor-workspace,.native-editor-inspector,.comments-container,.native-scene-entry',
      ),
    ];
    const deadline = performance.now() + 1500;
    while (
      performance.now() < deadline &&
      elements.some((element) =>
        element
          .getAnimations()
          .some(
            (animation) =>
              animation.playState === 'running' &&
              animation.effect?.getComputedTiming().iterations !== Infinity,
          ),
      )
    )
      await frame();
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
      // Keep the other panel in the same state for every direction and repetition.
      button(kind === 'pins' ? '속성 패널 열기' : '핀 패널 숨기기')?.click();
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
      panelProfiles.samples = [];
      panelProfiles.active = true;
      active.current = true;
      collector.start({
        scenario: 'panel-transition',
        implementation: __PANEL_BASELINE__ ? 'original-1745501' : 'current',
        kind,
        open,
        count,
        columns: 10,
        commit: __PERF_COMMIT__,
        dirty: __PERF_DIRTY__,
        viewport: [innerWidth, innerHeight],
        userAgent: navigator.userAgent,
        dpr: devicePixelRatio,
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
      panelProfiles.active = false;
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
            subtrees: Object.fromEntries(
              [...new Set(panelProfiles.samples.map((s) => s.id))].map((id) => [
                id,
                stats(panelProfiles.samples.filter((s) => s.id === id).map((s) => s.actual)),
              ]),
            ),
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
  async function auditLocalFirst(draftInput = false) {
    if (running || actualSnapshot) return;
    if (nativeSaveIntents(actor, project).length) {
      setOutput(JSON.stringify({ error: 'Existing fixture queue: use a clean fixture session' }));
      return;
    }
    setRunning(true);
    setOutput('');
    setReplayed(null);
    liveFixture.current = { key: `${count}:${spacing}`, value: fixture };
    let serverDocument = structuredClone(fixture.document),
      sequence = fixture.snapshot.sequence;
    const gates: { release: () => void; id: string; startedAt: number; commands: unknown }[] = [],
      replies = new Map<string, unknown>();
    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const wait = async (check: () => boolean) => {
      const until = performance.now() + 10000;
      while (!check()) {
        if (performance.now() > until) throw Error('Timed out waiting for fixture state');
        await pause(25);
      }
    };
    const seen: string[] = [];
    let stopSampling = false;
    const columnId = fixture.document.columns![0]!.id;
    const rowText = (id: string) =>
      Array.from(root.current!.querySelectorAll<HTMLElement>('[data-column-id]')).find(
        (el) => el.getAttribute('data-column-id') === id,
      )?.textContent ?? '';
    const visibleName = (name: string) =>
      rowText(columnId).includes(name) ||
      Array.from(
        root.current!.querySelectorAll<HTMLElement>(`[data-column-id="${columnId}"] [aria-label]`),
      ).some((element) => element.getAttribute('aria-label') === name + ' 타입');
    const nameInput = () =>
      root.current!.querySelector<HTMLInputElement>(
        '.native-erd-node.table [data-inline-cell][aria-label="컬럼명"] input',
      );
    const typeName = (value: string) => {
      const input = nameInput();
      if (!input) throw Error('Missing active name input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const sample = () => {
      if (stopSampling) return;
      seen.push(visibleName('local_first_2') ? 'local_first_2' : 'other');
      setTimeout(sample, 20);
    };
    controlledSave = async (url, init) => {
      if (!url.pathname.startsWith(`/api/projects/${project}/native-sync/`)) return null;
      if (url.pathname.includes('/operations/')) {
        const id = url.pathname.split('/').at(-1)!;
        return replies.has(id)
          ? Response.json(replies.get(id))
          : Response.json({ message: 'not found' }, { status: 404 });
      }
      if (!url.pathname.endsWith('/commands') || init?.method !== 'POST') return null;
      const body = JSON.parse(String(init.body));
      if (replies.has(body.operationId)) return Response.json(replies.get(body.operationId));
      await new Promise<void>((resolve) =>
        gates.push({
          release: resolve,
          id: body.operationId,
          startedAt: performance.now(),
          commands: structuredClone(body.commands),
        }),
      );
      const previousDocument = serverDocument;
      for (const command of body.commands) {
        if (command.type === 'patch_column')
          serverDocument = updateNativeColumn(serverDocument, command.id, command.patch);
        else if (command.type === 'add_column')
          serverDocument = addNativeColumn(serverDocument, command.value);
        else if (command.type === 'delete_objects')
          serverDocument = planNativeDeletion(serverDocument, command.targets).document;
        else throw Error('Unsupported controlled fixture command');
      }
      sequence++;
      const ack = {
        protocolVersion: 2,
        database: {
          kind: serverDocument.database.kind,
          profileId: serverDocument.database.profileId,
        },
        databaseRevision: fixture.snapshot.project.databaseRevision,
        operationId: body.operationId,
        groupId: body.groupId,
        sequence,
        status: 'accepted',
        delta: {
          baseSequence: sequence - 1,
          projectVersion: fixture.snapshot.project.version + sequence - fixture.snapshot.sequence,
          changes: deriveOperationChanges(previousDocument, serverDocument),
        },
        actor: { id: actor, username: 'preview', color: '#06b6d4' },
        changedPaths: deriveOperationChanges(previousDocument, serverDocument).map(
          (change) => change.path,
        ),
        createdAt: new Date().toISOString(),
        nextBaseline: {
          baselineId: crypto.randomUUID(),
          baseSequence: sequence,
          baselineIssuedAt: new Date().toISOString(),
          databaseRevision: fixture.snapshot.project.databaseRevision,
        },
      };
      replies.set(body.operationId, ack);
      return Response.json(ack, { status: 201 });
    };
    try {
      await pause(400);
      const initialSequence = sequence;
      if (draftInput) {
        root
          .current!.querySelector<HTMLElement>(
            '.native-erd-node.table [data-inline-cell][aria-label="컬럼명"]',
          )!
          .click();
        await wait(() => !!nameInput());
      }
      const typedAt = performance.now();
      let first = '',
        second = '';
      if (draftInput) typeName('local_first_1');
      else
        first = enqueueNativeSave(actor, fixture.snapshot, [
          { type: 'patch_column', id: columnId, patch: { physical: { name: 'local_first_1' } } },
        ]);
      await wait(() => visibleName('local_first_1'));
      const previewMs = performance.now() - typedAt;
      const beforeTransmit = gates.length === 0;
      const beforeAck = liveFixture.current.value.snapshot.sequence === initialSequence;
      await wait(() => gates.length === 1);
      first ||= gates[0]!.id;
      const firstRequest = JSON.stringify(gates[0]!.commands);
      if (draftInput) {
        typeName('intermediate_value');
        await pause(100);
        typeName('local_first_2');
      } else
        second = enqueueNativeSave(actor, fixture.snapshot, [
          { type: 'patch_column', id: columnId, patch: { physical: { name: 'local_first_2' } } },
        ]);
      await wait(() => visibleName('local_first_2'));
      if (draftInput) await pause(800);
      const onlyFirstInFlight = gates.length === 1;
      sample();
      gates[0]!.release();
      await wait(() => gates.length === 2);
      await wait(() => liveFixture.current.value.snapshot.sequence === initialSequence + 1);
      second ||= gates[1]!.id;
      const afterEarlierAck = visibleName('local_first_2');
      gates[1]!.release();
      await wait(() => liveFixture.current.value.snapshot.sequence === initialSequence + 2);
      await pause(100);
      stopSampling = true;
      const originalIds = new Set(fixture.document.columns!.map((column) => column.id));
      const findAdded = () =>
        Array.from(root.current!.querySelectorAll<HTMLElement>('[data-column-id]'))
          .map((element) => element.getAttribute('data-column-id')!)
          .find((id) => !originalIds.has(id));
      const addButton = root.current!.querySelector<HTMLButtonElement>(
        '.native-erd-node.table button[aria-label="컬럼 추가"]',
      );
      if (!addButton) throw Error('Missing actual add-column button');
      addButton.click();
      await wait(() => !!findAdded());
      const addedId = findAdded()!;
      const addBeforeAck = liveFixture.current.value.snapshot.sequence === initialSequence + 2;
      await wait(() => gates.length === 3);
      gates[2]!.release();
      await wait(() => liveFixture.current.value.snapshot.sequence === initialSequence + 3);
      await pause(100);
      const addedExactlyOnce =
        root.current!.querySelectorAll(`[data-column-id="${addedId}"]`).length === 1;
      const attributeAt = performance.now();
      enqueueNativeSave(actor, liveFixture.current.value.snapshot, [
        { type: 'patch_column', id: addedId, patch: { physical: { comment: 'local_attribute' } } },
      ]);
      await wait(() => rowText(addedId).includes('local_attribute'));
      const attributePreviewMs = performance.now() - attributeAt;
      const attributeBeforeAck =
        liveFixture.current.value.snapshot.sequence === initialSequence + 3;
      await wait(() => gates.length === 4);
      gates[3]!.release();
      await wait(() => liveFixture.current.value.snapshot.sequence === initialSequence + 4);
      const deleteAt = performance.now();
      enqueueNativeSave(actor, liveFixture.current.value.snapshot, [
        { type: 'delete_objects', targets: [{ collection: 'columns', id: addedId }] },
      ]);
      await wait(() => !root.current!.querySelector(`[data-column-id="${addedId}"]`));
      const deletePreviewMs = performance.now() - deleteAt;
      const deleteBeforeAck = liveFixture.current.value.snapshot.sequence === initialSequence + 4;
      await wait(() => gates.length === 5);
      gates[4]!.release();
      await wait(() => liveFixture.current.value.snapshot.sequence === initialSequence + 5);
      await pause(100);
      setOutput(
        JSON.stringify(
          {
            scenario: draftInput ? 'autosave-local-input' : 'local-first-columns',
            previewMs,
            beforeTransmit,
            onlyFirstInFlight,
            firstRequestDelayMs: gates[0]!.startedAt - typedAt,
            firstRequestUnchanged: JSON.stringify(gates[0]!.commands) === firstRequest,
            secondContainsLatest:
              JSON.stringify(gates[1]!.commands).includes('local_first_2') &&
              !JSON.stringify(gates[1]!.commands).includes('intermediate_value'),
            commit: __PERF_COMMIT__,
            beforeAck,
            afterEarlierAck,
            neverReverted: seen.every((text) => text.includes('local_first_2')),
            addBeforeAck,
            addedExactlyOnce,
            attributePreviewMs,
            attributeBeforeAck,
            deletePreviewMs,
            deleteBeforeAck,
            deletedAfterAck: !root.current!.querySelector(`[data-column-id="${addedId}"]`),
            compactAcks: true,
            queueEmpty: nativeSaveIntents(actor, project).length === 0,
            sequence: liveFixture.current.value.snapshot.sequence,
            operationsDistinct: first !== second,
            serverWrites: 'mock only',
          },
          null,
          2,
        ),
      );
    } catch (error) {
      setOutput(JSON.stringify({ error: String(error), gates: gates.length, sequence }));
    } finally {
      stopSampling = true;
      for (const gate of gates) gate.release();
      controlledSave = null;
      setRunning(false);
    }
  }

  async function auditAckReplay() {
    if (running || actualSnapshot) return;
    setRunning(true);
    setOutput('');
    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const results: unknown[] = [];
    let current = { kind: 'native' as const, ...fixture, personalUnavailable: false };
    try {
      setReplayed(null);
      await pause(500);
      for (let repetition = 0; repetition < 4; repetition++) {
        const nextDocument = structuredClone(current.snapshot.sourceDocument);
        if (nextDocument.schemaVersion !== 2) throw Error('Native fixture required');
        const name = 'ack_bench_' + repetition;
        nextDocument.tables![0]!.physical.name = name;
        const raw = JSON.stringify({
          protocolVersion: 2,
          database: {
            kind: nextDocument.database.kind,
            profileId: nextDocument.database.profileId,
          },
          databaseRevision: current.snapshot.project.databaseRevision,
          operationId: crypto.randomUUID(),
          groupId: crypto.randomUUID(),
          sequence: current.snapshot.sequence + 1,
          status: 'accepted',
          document: nextDocument,
          actor: { id: actor, username: 'preview', color: '#06b6d4' },
          changedPaths: [`/tables/${nextDocument.tables![0]!.id}/physical/name`],
          createdAt: new Date().toISOString(),
          nextBaseline: {
            baselineId: crypto.randomUUID(),
            baseSequence: current.snapshot.sequence + 1,
            baselineIssuedAt: new Date().toISOString(),
            databaseRevision: current.snapshot.project.databaseRevision,
          },
        });
        commits.current = [];
        panelProfiles.samples = [];
        panelProfiles.active = true;
        active.current = true;
        collector.start({
          scenario: 'ack-replay',
          count,
          repetition,
          commit: __PERF_COMMIT__,
          dirty: __PERF_DIRTY__,
          viewport: [innerWidth, innerHeight],
        });
        const start = performance.now();
        const ack = nativeSyncOperationResultSchema.parse(JSON.parse(raw));
        const parseMs = performance.now() - start;
        const applyStart = performance.now();
        const next = nativeEntryAfterAck(current, ack);
        const applyMs = performance.now() - applyStart;
        if (!next?.document) throw Error('ACK not applied');
        current = { ...next, document: next.document };
        startTransition(() =>
          setReplayed({
            key: `${count}:${spacing}`,
            value: { snapshot: current.snapshot, document: current.document },
          }),
        );
        const deadline = performance.now() + 5000;
        do {
          await pause(50);
        } while (
          !root.current!.querySelector('.native-erd-node.table')?.textContent?.includes(name) &&
          performance.now() < deadline
        );
        await pause(250);
        active.current = false;
        panelProfiles.active = false;
        const { samples: _samples, ...measurement } = collector.stop();
        results.push({
          repetition,
          warmup: repetition === 0,
          parseMs,
          applyMs,
          react: stats(commits.current),
          measurement,
          subtrees: Object.fromEntries(
            [...new Set(panelProfiles.samples.map((s) => s.id))].map((id) => [
              id,
              stats(panelProfiles.samples.filter((s) => s.id === id).map((s) => s.actual)),
            ]),
          ),
          reflected: root
            .current!.querySelector('.native-erd-node.table')
            ?.textContent?.includes(name),
        });
      }
      setOutput(JSON.stringify({ results }, null, 2));
    } catch (error) {
      active.current = false;
      panelProfiles.active = false;
      collector.cancel();
      setOutput(JSON.stringify({ error: String(error), results }));
    } finally {
      setRunning(false);
    }
  }

  async function auditButtons() {
    if (running) return;
    setRunning(true);
    setOutput('');
    const results: unknown[] = [];
    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    try {
      await document.fonts.ready;
      button('핀 패널 숨기기')?.click();
      button('속성 패널 열기')?.click();
      root.current!.querySelector<HTMLElement>('.native-erd-node.table')!.click();
      await pause(500);
      for (const kind of ['pins', 'column', 'inspector', 'menu'] as const) {
        for (let repetition = 0; repetition < 4; repetition++) {
          const label = kind === 'pins' ? '핀 패널 열기' : '속성 패널 숨기기';
          const target =
            kind === 'menu'
              ? root.current!.querySelector<HTMLElement>('[data-column-id]')
              : kind === 'column'
                ? root.current!.querySelector<HTMLButtonElement>(
                    'button[aria-controls^="native-column-"]',
                  )
                : button(label);
          if (!target) throw Error('Missing ' + kind);
          const fingerprint = fixtureFingerprint(fixture.document);
          commits.current = [];
          panelProfiles.samples = [];
          panelProfiles.active = true;
          active.current = true;
          collector.start({
            scenario: 'button-audit',
            memoProbe: __BUTTON_MEMO_PROBE__,
            navigatorProbe: __BUTTON_NAV_PROBE__,
            kind,
            repetition,
            count,
            actual: !!actualSnapshot,
            commit: __PERF_COMMIT__,
            dirty: __PERF_DIRTY__,
            viewport: [innerWidth, innerHeight],
            dpr: devicePixelRatio,
            userAgent: navigator.userAgent,
          });
          const start = performance.now();
          let firstRaf: number | null = null,
            secondRaf: number | null = null;
          let secondFrame = 0;
          const firstFrame = requestAnimationFrame(() => {
            firstRaf = performance.now() - start;
            secondFrame = requestAnimationFrame(() => {
              secondRaf = performance.now() - start;
            });
          });
          if (kind === 'menu')
            target.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                button: 2,
                clientX: 300,
                clientY: 300,
              }),
            );
          else target.click();
          const dispatchMs = performance.now() - start;
          await pause(450);
          cancelAnimationFrame(firstFrame);
          cancelAnimationFrame(secondFrame);
          active.current = false;
          panelProfiles.active = false;
          const { samples: _samples, ...measurement } = collector.stop();
          results.push({
            kind,
            repetition,
            warmup: repetition === 0,
            dispatchMs,
            firstRaf,
            secondRaf,
            react: stats(commits.current),
            subtrees: Object.fromEntries(
              [...new Set(panelProfiles.samples.map((s) => s.id))].map((id) => [
                id,
                stats(panelProfiles.samples.filter((s) => s.id === id).map((s) => s.actual)),
              ]),
            ),
            measurement,
            documentUnchanged: fingerprint === fixtureFingerprint(fixture.document),
            targetReached:
              kind === 'menu'
                ? !!document.querySelector('[role=menu][aria-label="컬럼"]')
                : kind === 'column'
                  ? target.getAttribute('aria-expanded') === 'true'
                  : !!button(kind === 'pins' ? '핀 패널 숨기기' : '속성 패널 열기'),
          });
          if (kind === 'menu')
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          else if (kind === 'column') target.click();
          else button(kind === 'pins' ? '핀 패널 숨기기' : '속성 패널 열기')?.click();
          await pause(350);
        }
      }
      const storageTimes: number[] = [];
      for (let i = 0; i < 30; i++) {
        const memory = new Map<string, string>();
        const storage = {
          get length() {
            return memory.size;
          },
          key: (i: number) => [...memory.keys()][i] ?? null,
          getItem: (key: string) => memory.get(key) ?? null,
          setItem: (key: string, value: string) => {
            memory.set(key, value);
          },
          removeItem: (key: string) => {
            memory.delete(key);
          },
          clear: () => memory.clear(),
        } as Storage;
        const start = performance.now();
        enqueueNativeSave(
          '90000000-0000-4000-8000-000000000039',
          fixture.snapshot,
          [
            {
              type: 'patch_table',
              id: fixture.document.tables![0]!.id,
              patch: { physical: { name: 'benchmark_name' } },
            },
          ],
          undefined,
          undefined,
          storage,
        );
        storageTimes.push(performance.now() - start);
      }
      setOutput(
        JSON.stringify(
          {
            results,
            enqueueMemoryStorage: stats(storageTimes.slice(1)),
            note: 'Synthetic click; rAF callbacks are scheduling proxies, not measured pixel presentation. Memory storage excludes real persistence and network.',
          },
          null,
          2,
        ),
      );
    } catch (error) {
      active.current = false;
      panelProfiles.active = false;
      collector.cancel();
      setOutput(JSON.stringify({ error: String(error), results }));
    } finally {
      setRunning(false);
    }
  }

  async function runInteractions() {
    if (running) return;
    setRunning(true);
    setOutput('');
    const results: unknown[] = [];
    try {
      await document.fonts.ready;
      button('탐색 패널 열기')?.click();
      button('핀 패널 열기')?.click();
      button('속성 패널 열기')?.click();
      await settle();
      root.current!.querySelector<HTMLElement>('.native-erd-node.table')!.click();
      await settle();
      const fingerprint = fixtureFingerprint(fixture.document);
      for (const kind of ['navigator', 'pins', 'inspector', 'column'] as const) {
        for (let repetition = 0; repetition < 4; repetition++) {
          const intervals: number[] = [];
          commits.current = [];
          collector.start({
            scenario: 'panel-interactions',
            kind,
            repetition,
            count,
            columns: 10,
            commit: __PERF_COMMIT__,
            dirty: __PERF_DIRTY__,
            baseline: __PANEL_INTERACTION_BASELINE__,
            viewport: [innerWidth, innerHeight],
            dpr: devicePixelRatio,
            userAgent: navigator.userAgent,
          });
          active.current = true;
          let last = await frame();
          const tick = async () => {
            const now = await frame();
            intervals.push(now - last);
            last = now;
          };
          let targetReached = true;
          if (kind === 'column') {
            const row = root.current!.querySelector<HTMLButtonElement>(
              'button[aria-controls^="native-column-"]',
            );
            if (!row) throw Error('Missing column row');
            for (const open of [true, false]) {
              row.click();
              for (let i = 0; i < 30; i++) await tick();
              targetReached &&= row.getAttribute('aria-expanded') === String(open);
            }
          } else {
            const label =
              kind === 'pins'
                ? '핀 패널 너비 조절'
                : kind === 'inspector'
                  ? '속성 패널 너비'
                  : '탐색 패널 너비';
            const separator = root.current!.querySelector<HTMLElement>(
              `[role="separator"][aria-label="${label}"]`,
            )!;
            if (!separator) throw Error('Missing separator ' + label);
            const original = {
              set: separator.setPointerCapture,
              has: separator.hasPointerCapture,
              release: separator.releasePointerCapture,
            };
            // Synthetic pointer events have no browser-owned pointer. Limit the capture shim to this separator.
            separator.setPointerCapture = () => {};
            separator.hasPointerCapture = () => true;
            separator.releasePointerCapture = () => {};
            const initial = Number(separator.getAttribute('aria-valuenow'));
            const dispatch = (type: string, x: number) =>
              separator.dispatchEvent(
                new PointerEvent(type, {
                  bubbles: true,
                  pointerId: 91,
                  pointerType: 'mouse',
                  isPrimary: true,
                  button: 0,
                  buttons: type === 'pointerup' ? 0 : 1,
                  clientX: x,
                  clientY: 300,
                }),
              );
            try {
              dispatch('pointerdown', 800);
              for (let i = 0; i < 60; i++) {
                for (let j = 0; j < 4; j++)
                  dispatch(
                    'pointermove',
                    800 +
                      (kind !== 'navigator' ? -1 : 1) *
                        80 *
                        Math.sin((Math.PI * (i * 4 + j + 1)) / 240),
                  );
                await tick();
              }
              dispatch('pointerup', 800);
              await tick();
              await tick();
              targetReached =
                Math.abs(Number(separator.getAttribute('aria-valuenow')) - initial) < 1;
            } finally {
              dispatch('pointercancel', 800);
              separator.setPointerCapture = original.set;
              separator.hasPointerCapture = original.has;
              separator.releasePointerCapture = original.release;
            }
          }
          active.current = false;
          const { samples: _samples, ...measurement } = collector.stop();
          results.push({
            kind,
            repetition,
            warmup: repetition === 0,
            measurement,
            frames: stats(intervals),
            react: stats(commits.current),
            targetReached,
            documentUnchanged: fingerprint === fixtureFingerprint(fixture.document),
          });
          await settle();
        }
      }
      setOutput(JSON.stringify({ results }, null, 2));
    } catch (error) {
      active.current = false;
      collector.cancel();
      setOutput(JSON.stringify({ error: String(error), results }));
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <header className="panel-lab-controls">
        <strong>Full editor panel profiling · no server writes</strong>
        <button disabled={running || !!actualSnapshot} onClick={() => void auditLocalFirst(true)}>
          Audit local autosave input
        </button>
        <button disabled={running || !!actualSnapshot} onClick={() => void auditLocalFirst()}>
          Audit local-first columns
        </button>
        <button disabled={running || !!actualSnapshot} onClick={() => void auditAckReplay()}>
          Audit ACK replay
        </button>
        <button disabled={running} onClick={() => void auditButtons()}>
          Audit button latency
        </button>
        <label>
          Layout spacing{' '}
          <select
            aria-label="Layout spacing"
            value={spacing}
            disabled={running}
            onChange={(e) => setSpacing(Number(e.target.value))}
          >
            <option value="1">1x</option>
            <option value="4">4x</option>
            <option value="8">8x</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={visibilityOff}
            onChange={(e) => setVisibilityOff(e.target.checked)}
          />{' '}
          Disable card content visibility
        </label>
        <label>
          <input
            type="checkbox"
            checked={layerOff}
            onChange={(e) => setLayerOff(e.target.checked)}
          />{' '}
          Disable world promotion
        </label>
        <label>
          <input
            type="checkbox"
            checked={svgExtent}
            onChange={(e) => setSvgExtent(e.target.checked)}
          />{' '}
          Expand relation SVG viewport
        </label>
        <label>
          <input type="checkbox" checked={gridOff} onChange={(e) => setGridOff(e.target.checked)} />{' '}
          Disable dot grid
        </label>
        <style>
          {(gridOff ? '.native-erd-surface {background-image:none !important;}' : '') +
            (visibilityOff
              ? '.native-erd-node.table {content-visibility:visible !important;}'
              : '') +
            (layerOff ? '.native-erd-world {will-change:auto !important;}' : '') +
            (svgExtent
              ? '.native-erd-lines {width:100px !important;height:100px !important;}'
              : '')}
        </style>
        <select
          aria-label="Tables"
          value={count}
          disabled={running}
          onChange={(e) => setCount(Number(e.target.value))}
        >
          <option>36</option>
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
        <button disabled={running} onClick={() => void runInteractions()}>
          Measure resize and columns
        </button>
        <button
          disabled={!output || running}
          onClick={() => {
            const url = URL.createObjectURL(new Blob([output], { type: 'application/json' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `panel-interactions-${__PANEL_INTERACTION_BASELINE__ ? 'before' : 'after'}-${count}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Download panel JSON
        </button>
        <output aria-label="Panel status">
          {running ? 'running' : output ? 'complete' : 'ready'}
        </output>
      </header>
      <div ref={root} className="app-shell editor-shell panel-lab-shell">
        <ConfirmProvider>
          <Profiler id="workspace" onRender={profile}>
            <NativeProjectView
              key={`${count}:${spacing}`}
              entry={{
                kind: 'native',
                ...(replayed?.key === `${count}:${spacing}` ? replayed.value : fixture),
                personalUnavailable: false,
              }}
              userId={actor}
              canEdit
              canPersonalEdit
              onLeave={noop}
              onReload={noop}
              onAcknowledged={(ack) => {
                const next = nativeEntryAfterAck(
                  { kind: 'native', ...liveFixture.current.value, personalUnavailable: false },
                  ack,
                );
                if (!next?.document) return false;
                const value = { document: next.document, snapshot: next.snapshot };
                liveFixture.current = { key: `${count}:${spacing}`, value };
                startTransition(() => setReplayed({ key: `${count}:${spacing}`, value }));
                return true;
              }}
            />
          </Profiler>
        </ConfirmProvider>
      </div>
      <textarea aria-label="Panel JSON" readOnly value={output} />
      <VisualLayerAudit />
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Demo />);
