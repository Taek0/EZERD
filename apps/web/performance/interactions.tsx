import { useMemo, useRef, useState, useLayoutEffect, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { upsertRelationLayout } from '@ezerd/model';
import { nativeEditorCommandSchema } from '@ezerd/contracts';
import {
  NativeCanvasScene,
  type NativeSceneActions,
} from '../src/features/projects/NativeCanvasScene.js';
import { nativeCanvasScene, nativeCanvasWheel } from '../src/features/projects/NativeERDCanvas.js';
import {
  NativeCanvasInlineEditor,
  type NativeInlineTarget,
} from '../src/features/projects/NativeCanvasInlineEditor.js';
import { NativeRelationEditor } from '../src/features/projects/NativeRelationEditor.js';
import type { NativeEditorContext } from '../src/features/projects/native-editor-form.js';
import {
  nativeCanvasSvg,
  exportNativeCanvasPng,
} from '../src/features/projects/native-canvas-png.js';
import { createNativePerformanceFixture } from '../src/shared/performance/native-fixture.js';
import { ConfirmProvider } from '../src/components/ui/ConfirmProvider.js';
import '../src/components/ui/tailwind.css';
import '../src/styles/tokens.css';
import '../src/components/ui/ui.css';
import '../src/styles/styles.css';
function Demo() {
  const surface = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element && event.target.closest('.native-inline-editor')))
        event.preventDefault();
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const fixture = useMemo(() => createNativePerformanceFixture(10, 5), []);
  const [document, setDocument] = useState(fixture.document),
    [version, setVersion] = useState(0),
    [fail, setFail] = useState(false),
    [editable, setEditable] = useState(true);
  const [ledger, setLedger] = useState(''),
    [inline, setInline] = useState<NativeInlineTarget | null>(null),
    [relation, setRelation] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  const [camera, setCamera] = useState({ viewId: '__tables__', x: 24, y: 24, zoom: 1 });
  const [world, setWorld] = useState<HTMLDivElement | null>(null),
    [preview, setPreview] = useState('');
  const [undo, setUndo] = useState<(typeof document)[]>([]),
    [redo, setRedo] = useState<(typeof document)[]>([]);
  const current = useRef({ document, version, fail, editable });
  current.current = { document, version, fail, editable };
  const snapshot = useMemo(
    () => ({
      ...fixture.snapshot,
      project: { ...fixture.snapshot.project, id: '90000000-0000-4000-8000-000000000005', version },
      sequence: version,
      sourceDocument: document,
      native: { status: 'available' as const, document, issues: [], migrationIssues: [] },
    }),
    [document, version],
  );
  const context: NativeEditorContext = useMemo(
    () => ({
      userId: '90000000-0000-4000-8000-000000000006',
      snapshot,
      busy: !editable,
      onSave: async (commands, expected) => {
        const captured = current.current;
        if (
          captured.fail ||
          !captured.editable ||
          expected.version !== captured.version ||
          expected.sequence !== captured.version
        ) {
          setLedger(JSON.stringify({ status: 'rejected', commands, expected }));
          return false;
        }
        let next = captured.document;
        for (const raw of commands) {
          const command = nativeEditorCommandSchema.parse(raw);
          if (command.type === 'patch_table')
            next = {
              ...next,
              tables: next.tables!.map((t) =>
                t.id === command.id
                  ? {
                      ...t,
                      ...command.patch,
                      physical: { ...t.physical, ...command.patch.physical },
                      logical: { ...t.logical, ...command.patch.logical },
                    }
                  : t,
              ),
            };
          else if (command.type === 'patch_column')
            next = {
              ...next,
              columns: next.columns!.map((c) =>
                c.id === command.id
                  ? {
                      ...c,
                      ...command.patch,
                      physical: { ...c.physical, ...command.patch.physical },
                      logical: { ...c.logical, ...command.patch.logical },
                    }
                  : c,
              ),
            };
          else if (command.type === 'upsert_relation_layout')
            next = upsertRelationLayout(next, command.value);
          else if (command.type === 'delete_relation_layout')
            next = {
              ...next,
              layout: {
                ...next.layout,
                relations: next.layout.relations?.filter(
                  (r) => r.relationId !== command.relationId || r.viewId !== command.viewId,
                ),
              },
            };
          else throw Error('Unsupported demo command');
        }
        setUndo((history) => [...history, captured.document]);
        setRedo([]);
        setDocument(next);
        setVersion((v) => v + 1);
        setLedger(JSON.stringify({ status: 'accepted', commands, expected }));
        return true;
      },
    }),
    [snapshot, editable],
  );
  const scene = useMemo(() => nativeCanvasScene(document, '__tables__', 'physical'), [document]);
  const gesture = useRef<Parameters<typeof NativeCanvasScene>[0]['gesture']['current']>(null);
  const actions = useRef<NativeSceneActions>({
    zoom: camera.zoom,
    begin: () => {},
    preserve: () => {},
    savePlacement: async () => {},
  });
  useLayoutEffect(() => {
    actions.current.zoom = camera.zoom;
  });
  return (
    <>
      <header>
        <strong>Memory-only interaction lab · no HTTP/API/DB</strong>
        <label>
          <input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} />
          Fail save
        </label>
        <label>
          <input
            type="checkbox"
            checked={editable}
            onChange={(e) => setEditable(e.target.checked)}
          />
          Editable
        </label>
        <button onClick={() => setVersion((v) => v + 1)}>Advance revision</button>
        <button
          disabled={!undo.length}
          onClick={() => {
            setRedo((h) => [...h, document]);
            setDocument(undo.at(-1)!);
            setUndo((h) => h.slice(0, -1));
            setVersion((v) => v + 1);
          }}
        >
          Undo demo
        </button>
        <button
          disabled={!redo.length}
          onClick={() => {
            setUndo((h) => [...h, document]);
            setDocument(redo.at(-1)!);
            setRedo((h) => h.slice(0, -1));
            setVersion((v) => v + 1);
          }}
        >
          Redo demo
        </button>
        <button
          onClick={() =>
            setPreview(
              `data:image/svg+xml;charset=utf-8,${encodeURIComponent(nativeCanvasSvg(document, scene, 'physical').svg)}`,
            )
          }
        >
          Preview PNG source
        </button>
        <button
          onClick={() =>
            void exportNativeCanvasPng(document, scene, 'physical', 'native-interaction-test')
          }
        >
          Download PNG
        </button>
      </header>
      <p>
        Double-click a name or press F2. Click a relation to edit its path. Drafts use dedicated
        local test identities. Saves update this page's memory only.
      </p>
      <div
        ref={surface}
        className="native-erd-surface"
        style={{ height: 620 }}
        onWheel={(event) => {
          const r = event.currentTarget.getBoundingClientRect();
          setCamera((c) =>
            nativeCanvasWheel(
              c,
              event,
              { x: event.clientX - r.left, y: event.clientY - r.top },
              r.height,
            ),
          );
        }}
      >
        <div
          className="native-erd-world"
          ref={setWorld}
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
        >
          <NativeCanvasScene
            base={document}
            sharedSource={document}
            drawn={scene}
            effectiveView="__tables__"
            mode="physical"
            selectedNode={selected}
            selectedTableId={undefined}
            selectedDomainId={undefined}
            selectedDomainRelation={null}
            selectedRelationId={relation}
            draftObjectId={undefined}
            setSelectedNode={setSelected}
            setSelectedDomainRelation={() => {}}
            onSelect={(id) => setSelected(scene.nodes.find((n) => n.objectId === id)?.id ?? null)}
            onSelectDomain={undefined}
            gesture={gesture}
            actions={actions}
            onEdit={
              editable
                ? (target) => {
                    setRelation(null);
                    setInline(target);
                  }
                : undefined
            }
            onSelectRelation={(id) => {
              setInline(null);
              setRelation(id);
            }}
          />
        </div>
        {inline && (
          <NativeCanvasInlineEditor
            document={document}
            target={inline}
            context={context}
            onClose={() => setInline(null)}
          />
        )}
        {relation && (
          <NativeRelationEditor
            document={document}
            scene={scene}
            viewId="__tables__"
            relationId={relation}
            world={world}
            personalVersion={undefined}
            context={{
              ...context,
              affectsSharedDocument: true,
              onSave: (commands, exp, ref) =>
                context.onSave(
                  commands.map((c) => nativeEditorCommandSchema.parse(c)),
                  exp,
                  ref,
                ),
            }}
            onClose={() => setRelation(null)}
          />
        )}
      </div>
      <output aria-label="Demo revision">{version}</output>
      <textarea aria-label="Save ledger" readOnly value={ledger} />
      {preview && <img alt="PNG source preview" src={preview} style={{ maxWidth: '100%' }} />}
    </>
  );
}
createRoot(globalThis.document.getElementById('root')!).render(
  <ConfirmProvider>
    <Demo />
  </ConfirmProvider>,
);
