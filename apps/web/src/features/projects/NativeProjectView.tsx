import { NativeDomainRelationEditor } from './NativeDomainRelationEditor.js';
import { NativeHistoryControls } from './NativeHistoryControls.js';
import { CommentPins, CommentsPanel, type CommentContext } from '../comments/CommentsPanel.js';
import { PinPanelResizer } from '../comments/PinPanelResizer.js';
import type { CSSProperties } from 'react';
import type { NativeDesignDocument } from '@ezerd/model';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProjectEntry } from './project-entry.js';
import type { Thread } from '@ezerd/contracts';
import {
  getDatabaseProfile,
  nativeColumnTypeDisplay,
  nativeDefaultDisplay,
  nativeExpressionDisplay,
  nativeGenerationDisplay,
} from '@ezerd/model';
import { Button, IconButton, Input, Select, TabButton } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import './native-project-view.css';
import { PanelSection, PanelList, PanelRow, PanelListDetail } from '../../shared/editor/panel.js';
import { NativePropertyEditor } from './NativePropertyEditor.js';
import { NativeStructureEditor } from './native-editor-structure.js';
import { NativeERDCanvas } from './NativeERDCanvas.js';
import { NativeDomainEditor } from './NativeDomainEditor.js';
import { useNativeDurableState, useNativeExportBlocked } from './native-export-state.js';
import type { NativeEditorDraftRef } from './native-editor-draft.js';
import {
  loadNativePending,
  stageNativeSave,
  sendNativePending,
  recoverNativePending,
  cancelNativePending,
  type NativePendingSave,
  type NativeWebCommand,
  type NativeSaveExpected,
} from './native-save.js';
import { message, request } from '../../shared/api/client.js';
import { captureNativeActorApi } from './native-actor-api.js';
import { currentTransferUserId } from './project-transfer.js';
import { NativeDraftRecoveryPanel } from './NativeDraftRecoveryPanel.js';
import type { NativeDraftArchiveEntry } from './native-draft-archive.js';
import { nativeDraftRecoveryTarget } from './native-draft-recovery-target.js';
import { NativeAdvancedEditor } from './NativeAdvancedEditor.js';
import { nativeEditorPolicy } from './native-editor-policy.js';
import {
  clampInspectorWidth,
  inspectorBounds,
  inspectorLayoutWidth,
  readInspectorWidth,
  shouldStackInspector,
} from '../canvas/inspector-state.js';
import {
  nativeInspectorMatches,
  nativeInspectorOutline,
  nativeInspectorLocation,
  nativeInspectorSaveStatus,
  type NativeCanvasScope,
} from './native-inspector-state.js';
import { nativeTableCanvasRows } from './native-canvas-style.js';
import { NativeTableRelationInspector } from './NativeTableRelationInspector.js';
import { NativeEnumDialog } from './NativeEnumDialog.js';

registerTranslations({
  '◌ 저장 확인 중…': '◌ Confirming save…',
  '○ 오프라인': '○ Offline',
  '! 확인 필요': '! Action needed',
  '○ 보관된 입력': '○ Preserved input',
  '✓ 저장 기준 확인됨': '✓ Saved baseline confirmed',
  '설계 조회': 'Design overview',
  속성: 'Properties',
  도메인: 'Domains',
  도구: 'Tools',
  '속성 패널': 'Inspector',
  '속성 패널 너비': 'Inspector width',
  '조회 전용': 'Read only',
  '전체 도메인': 'All domains',
  '이름 없는 테이블': 'Untitled table',
  '테이블 검색': 'Search tables',
  '선택한 범위에 테이블이 없습니다.': 'There are no tables in this scope.',
  '개인 화면을 불러오지 못했습니다. 저장된 공유 설계를 표시합니다.':
    'Personal views could not be loaded. Showing the saved shared design.',
  'DB 설정과 저장된 설계의 종류가 다릅니다.':
    'The project database and the saved design do not match.',
  '설계의 구조 또는 크기를 확인해 주세요.': 'Check the design structure or size.',
  '기존 타입 또는 기본값을 확인해 주세요.': 'Review the original type or default value.',
  '설정이나 연결 대상을 확인해 주세요.': 'Review the settings or referenced objects.',
  '물리 설계를 완성해 주세요.': 'Complete the physical design.',
  '지원하지 않는 설정입니다.': 'This setting is not supported.',
  '설계 확인 항목': 'Design issues',
  '다시 불러오기': 'Reload',
  물리: 'Physical',
  논리: 'Logical',
  타입: 'Type',
  기본값: 'Default',
  생성: 'Generation',
  키: 'Keys',
  '외래 키': 'Foreign keys',
  인덱스: 'Indexes',
  컬럼: 'Columns',
  테이블: 'Tables',
  설명: 'Description',
  이름: 'Name',
  'DB 옵션': 'Database options',
  미소속: 'Unassigned',
  '← 갤러리': '← Gallery',
  필수: 'Required',
  '의미 타입': 'Semantic type',
  '타입 없음': 'Untyped',
  '추가 속성': 'Custom properties',
  공통: 'Common',
  리뷰: 'Review',
  '목표 DB 버전': 'Target DB version',
  '편집 가능': 'Editable',
  '저장 확인 중…': 'Confirming save…',
  '미확인 또는 미적용 저장 요청이 있습니다.': 'A save request is unconfirmed or unapplied.',
  '저장 결과 확인': 'Check save result',
  '요청 초기화': 'Reset request',
  수정: 'Edit',
  '저장이 거부되었습니다. 입력을 보관한 뒤 최신 설계를 확인해 주세요.':
    'Save was rejected. Keep your input and check the latest design.',
});

/** Native data and commands stay outside the v1 editor/runtime. */
export function NativeProjectView({
  entry,
  onLeave,
  onReload,
  busy = false,
  focusedReview,
  userId,
  canEdit = false,
  canPersonalEdit = canEdit,
  projectActions,
  workspaceStatus,
  workspaceRole,
}: {
  entry: Extract<ProjectEntry, { kind: 'native' }>;
  onLeave: () => void;
  onReload: () => void;
  busy?: boolean;
  focusedReview?: Thread;
  userId?: string;
  canEdit?: boolean;
  canPersonalEdit?: boolean;
  projectActions?: (
    focus: (id: string) => void,
    png?: { run: () => Promise<void>; disabled: boolean; busy: boolean },
  ) => ReactNode;
  workspaceStatus?: 'active' | 'archived';
  workspaceRole?: 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer';
}) {
  const { t } = useI18n();
  const { snapshot, document: doc } = entry;
  const profile = getDatabaseProfile({
    kind: snapshot.project.databaseKind,
    profileId: snapshot.project.databaseProfileId,
  });
  const [domain, setDomain] = useState('*');
  const [mode, setMode] = useState<'physical' | 'logical'>('physical');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(doc?.tables?.[0]?.id ?? null);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [selectedDomainRelation, setSelectedDomainRelation] = useState<string | null>(null);
  const [selectedTableRelation, setSelectedTableRelation] = useState<string | null>(null);
  const [domainRelationCreation, setDomainRelationCreation] = useState<string | null>(null);
  const [enumOpen, setEnumOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [editingConstraint, setEditingConstraint] = useState<string | null>(null);
  const [domainAction, setDomainAction] = useState<'move' | null>(null);
  const [pending, setPending] = useState<NativePendingSave | null>(null);
  const [operationState, setOperationState] = useState({ saving: false, pendingBlocked: !!userId });
  const { saving, pendingBlocked } = operationState;
  const setSaving = (value: boolean) =>
    setOperationState((current) => ({ ...current, saving: value }));
  const setPendingBlocked = (value: boolean) =>
    setOperationState((current) => ({ ...current, pendingBlocked: value }));
  const [saveError, setSaveError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draftRecoveryOpen, setDraftRecoveryOpen] = useState(false);
  const [recoveryEpoch, setRecoveryEpoch] = useState(0);
  const [recoveredInput, setRecoveredInput] = useState<{
    entry: NativeDraftArchiveEntry;
    generation: number;
  } | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(() => {
    try {
      return localStorage.getItem('ezerd.inspector') !== 'hidden';
    } catch {
      return true;
    }
  });
  const [inspectorTab, setInspectorTab] = useState<'properties' | 'tables' | 'domains' | 'tools'>(
    'properties',
  );
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try {
      return readInspectorWidth(localStorage.getItem('ezerd.inspectorWidth'));
    } catch {
      return 320;
    }
  });
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(inspectorLayoutWidth(1100));
  const [resizingInspector, setResizingInspector] = useState(false);
  const [canvasScope, setCanvasScope] = useState<NativeCanvasScope | null>(null);
  const [requestedView, setRequestedView] = useState<{ id: string; nonce: number } | null>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [pathHost, setPathHost] = useState<HTMLDivElement | null>(null);
  const [noteSelectionHost, setNoteSelectionHost] = useState<HTMLDivElement | null>(null);
  const [domainSelectionHost, setDomainSelectionHost] = useState<HTMLDivElement | null>(null);
  const [offline, setOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  useEffect(() => {
    const element = workspaceRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWorkspaceWidth(inspectorLayoutWidth(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [!!doc]);
  useEffect(() => {
    try {
      localStorage.setItem('ezerd.inspector', inspectorOpen ? 'visible' : 'hidden');
    } catch {
      /* Optional preference. */
    }
  }, [inspectorOpen]);
  useEffect(() => {
    try {
      localStorage.setItem('ezerd.inspectorWidth', String(inspectorWidth));
    } catch {
      /* Optional preference. */
    }
  }, [inspectorWidth]);
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const panelWidth = clampInspectorWidth(inspectorWidth, workspaceWidth),
    panelBounds = inspectorBounds(workspaceWidth),
    stackedInspector = shouldStackInspector(workspaceWidth);
  const draggingColumn = useRef<string | null>(null);
  const [columnDrag, setColumnDrag] = useState<string | null>(null);
  const [columnDrop, setColumnDrop] = useState<string | null>(null);
  const [canvasView, setCanvasView] = useState('__tables__');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsWidth, setCommentsWidth] = useState(320);
  const [commentsResizing, setCommentsResizing] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [members, setMembers] = useState<{ id: string; color?: string }[]>([]);
  const [pinMode, setPinMode] = useState(false);
  const [reviewContext, setReviewContext] = useState<CommentContext>({
    viewId: '__tables__',
    selectedObjectId: null,
    position: { x: 0, y: 0 },
  });
  const [reviewDocument, setReviewDocument] = useState<NativeDesignDocument | null>(doc);
  const [reviewFocus, setReviewFocus] = useState<(Thread & { nonce: number }) | null>(null);
  const [draftPin, setDraftPin] = useState<(CommentContext & { nonce: number }) | null>(null);
  function focusThread(thread: Thread) {
    setReviewFocus({ ...thread, nonce: Date.now() });
    setDraftPin(null);
    setPinMode(false);
    setCommentsOpen(true);
  }
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null);
  const [createRequest, setCreateRequest] = useState<{
    action: NonNullable<Parameters<typeof NativeStructureEditor>[0]['initialSelection']>['action'];
    target?: string;
    nonce: number;
    values?: Record<string, string>;
  } | null>(null);
  const [domainCreation, setDomainCreation] = useState(0);
  const resize = useRef<{ pointer: number; x: number; width: number } | null>(null);
  function toolbarCreate(kind: 'table' | 'domain' | 'enum' | 'column') {
    leaveRecoveredSelection();
    setInspectorOpen(true);
    setDomainAction(null);
    if (kind === 'enum') {
      setEnumOpen(true);
      return;
    }
    if (kind === 'domain') {
      setSelectedDomain(null);
      setDomainCreation((value) => value + 1);
      setInspectorTab('domains');
    } else {
      setCreateRequest((value) => ({ action: kind, nonce: (value?.nonce ?? 0) + 1 }));
      setInspectorTab('properties');
    }
  }
  function requestStructure(
    action: 'patch' | 'delete' | 'foreignKey' | 'column' | 'key' | 'enum',
    target: string,
    tableId?: string,
  ) {
    if (action === 'patch') {
      try {
        const [collection, id] = JSON.parse(target) as [string, string];
        if (collection === 'tableRelations') {
          requestAction('tableRelation', id);
          return;
        }
      } catch {
        /* A malformed target remains subject to the form's object lookup. */
      }
    }
    leaveRecoveredSelection();
    setInspectorOpen(true);
    setInspectorTab('properties');
    setSelectedDomain(null);
    setDomain('*');
    setSearch('');
    if (tableId) setSelected(tableId);
    setCreateRequest((previous) => ({ action, target, nonce: (previous?.nonce ?? 0) + 1 }));
  }
  function requestAction(action: string, target: string, values?: Record<string, string>) {
    if (action === 'enums') {
      setInspectorOpen(true);
      setInspectorTab('properties');
      setEnumOpen(true);
      return;
    }
    if (action === 'domainRelation') {
      if (!target && values?.sourceDomainId) {
        requestAction('createDomainRelation', values.sourceDomainId);
        return;
      }
      leaveRecoveredSelection();
      setInspectorOpen(true);
      setSelectedDomain(null);
      setSelected(null);
      setSelectedTableRelation(null);
      setSelectedDomainRelation(target);
      setDomainRelationCreation(null);
      setInspectorTab('domains');
      return;
    }
    if (action === 'tableRelation') {
      leaveRecoveredSelection();
      setInspectorOpen(true);
      setInspectorTab('properties');
      setSelectedTableRelation(target);
      setSelectedDomainRelation(null);
      setSelected(null);
      setSelectedDomain(null);
      setCreateRequest(null);
      return;
    }
    if (action === 'createDomainRelation') {
      leaveRecoveredSelection();
      setInspectorOpen(true);
      setInspectorTab('domains');
      setSelectedDomainRelation(null);
      setDomainRelationCreation(target);
      return;
    }
    if (action === 'tools') {
      setInspectorOpen(true);
      setInspectorTab('tools');
      return;
    }
    if (action === 'domain') {
      toolbarCreate('domain');
      return;
    }
    if (
      ![
        'table',
        'column',
        'key',
        'index',
        'check',
        'enum',
        'foreignKey',
        'patch',
        'delete',
      ].includes(action)
    )
      return;
    leaveRecoveredSelection();
    setInspectorOpen(true);
    setInspectorTab('properties');
    setSelectedDomain(null);
    if (values?.tableId) setSelected(values.tableId);
    setDomain('*');
    setSearch('');
    setCreateRequest((previous) => ({
      action: action as NonNullable<typeof createRequest>['action'],
      target,
      ...(values ? { values } : {}),
      nonce: (previous?.nonce ?? 0) + 1,
    }));
  }
  const durableState = useNativeDurableState(userId ?? '', snapshot.project.id);
  const dirty = useNativeExportBlocked(userId ?? '', snapshot.project.id);
  const queueBlocked = !!userId && durableState !== 'empty';
  const recoveryBusy = saving || busy || !!pending || pendingBlocked;
  const editorBusy = recoveryBusy || queueBlocked;
  const activeEditor = useRef('');
  const activeGeneration = useRef(0);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  const editorIdentity = JSON.stringify([userId, snapshot.project.id]);
  if (activeEditor.current !== editorIdentity) activeGeneration.current++;
  activeEditor.current = editorIdentity;
  const generation = activeGeneration.current;
  const currentEditor = () =>
    mounted.current &&
    activeEditor.current === editorIdentity &&
    activeGeneration.current === generation;
  const editable = !!userId && canEdit && snapshot.project.status === 'active' && !!doc;
  const activePermission = useRef(editable);
  activePermission.current = editable;
  const activeDocument = useRef(doc);
  activeDocument.current = doc;
  const activePersonalPermission = useRef(false);
  activePersonalPermission.current =
    !!userId && canPersonalEdit && snapshot.project.status === 'active' && !!doc;
  const recoveryActorCurrent = (actor: string) =>
    actor === userId && currentEditor() && currentTransferUserId() === actor;
  function canRecoverDraft(input: NativeDraftArchiveEntry) {
    if (!recoveryActorCurrent(input.userId) || input.projectId !== snapshot.project.id)
      return false;
    const target = nativeDraftRecoveryTarget(activeDocument.current, input);
    return (
      !!target && (target.personal ? activePersonalPermission.current : activePermission.current)
    );
  }
  function openRecoveredDraft(input: NativeDraftArchiveEntry) {
    if (!canRecoverDraft(input)) throw Error('native.draft-recovery-unavailable');
    const target = nativeDraftRecoveryTarget(activeDocument.current, input)!;
    setRecoveredInput({ entry: input, generation });
    setRecoveryEpoch((value) => value + 1);
    setDomain('*');
    setSearch('');
    const tableId = 'tableId' in target ? target.tableId : undefined;
    const table = activeDocument.current?.tables?.find((item) => item.id === tableId);
    setMode(table?.scope === 'logical' ? 'logical' : 'physical');
    setSelected(tableId ?? null);
    setEditingColumn('columnId' in target ? (target.columnId ?? null) : null);
    setSelectedDomain(target.kind === 'domain' ? (target.domainId ?? null) : null);
    setInspectorOpen(true);
    setInspectorTab(
      target.kind === 'canvas' ? 'tools' : target.kind === 'domain' ? 'domains' : 'properties',
    );
    setCreateRequest(null);
    setDomainCreation(0);
  }
  function leaveRecoveredSelection() {
    if (!recoveredInput) return;
    setRecoveredInput(null);
    setRecoveryEpoch((value) => value + 1);
  }
  const recovered =
    recoveredInput?.generation === generation &&
    recoveredInput.entry.userId === userId &&
    recoveredInput.entry.projectId === snapshot.project.id
      ? nativeDraftRecoveryTarget(doc, recoveredInput.entry)
      : null;
  const saveContext = JSON.stringify([
    snapshot.project.version,
    snapshot.sequence,
    snapshot.project.databaseRevision,
  ]);
  const activeSaveContext = useRef(saveContext);
  activeSaveContext.current = saveContext;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function loadPending() {
    if (!userId) return;
    setPendingBlocked(true);
    try {
      const loaded = await loadNativePending(userId, snapshot.project.id);
      if (!currentEditor()) return;
      setPending(loaded);
      setPendingBlocked(false);
      setSaveError('');
    } catch (error) {
      if (currentEditor()) setSaveError(message(error));
    }
  }
  useEffect(() => {
    let active = true;
    setPending(null);
    setPendingBlocked(!!userId);
    setSaveError('');
    setEditingColumn(null);
    setSelectedDomain(null);
    setRecoveredInput(null);
    setDraftRecoveryOpen(false);
    setSaving(false);
    savingRef.current = false;
    if (!userId) return;
    void loadNativePending(userId, snapshot.project.id)
      .then((loaded) => {
        if (!active || !currentEditor()) return;
        setPending(loaded);
        setPendingBlocked(false);
      })
      .catch((error) => {
        if (active && currentEditor()) setSaveError(message(error));
      });
    return () => {
      active = false;
    };
  }, [userId, snapshot.project.id]);
  async function save(
    commands: NativeWebCommand[],
    expected?: NativeSaveExpected,
    editorDraft?: NativeEditorDraftRef,
  ): Promise<boolean> {
    if (
      !editable ||
      !userId ||
      busy ||
      pendingBlocked ||
      queueBlocked ||
      pending ||
      savingRef.current
    )
      return false;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const actorApi = captureNativeActorApi(userId);
      const staged = await stageNativeSave(
        userId,
        snapshot,
        commands,
        localStorage,
        expected,
        editorDraft,
      );
      if (!currentEditor()) return false;
      setPending(staged);
      if (!activePermission.current || activeSaveContext.current !== saveContext) return false;
      const result = await sendNativePending(staged, localStorage, actorApi);
      if (!currentEditor()) return result.status === 'accepted';
      if (result.status === 'rejected') {
        setSaveError(t('저장이 거부되었습니다. 입력을 보관한 뒤 최신 설계를 확인해 주세요.'));
        return false;
      }
      setPending(null);
      onReload();
      return true;
    } catch (error) {
      if (currentEditor()) {
        setSaveError(message(error));
        try {
          const stored = await loadNativePending(userId, snapshot.project.id);
          if (currentEditor()) setPending(stored);
        } catch {
          if (currentEditor()) setPendingBlocked(true);
        }
      }
      return false;
    } finally {
      if (currentEditor()) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }
  async function recover() {
    if (!pending || pending.userId !== userId || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const result = await recoverNativePending(pending, snapshot, localStorage, request, editable);
      if (!currentEditor()) return;
      if (result.status === 'accepted') {
        setPending(null);
        onReload();
      } else setSaveError(t('저장이 거부되었습니다. 입력을 보관한 뒤 최신 설계를 확인해 주세요.'));
    } catch (error) {
      if (currentEditor()) setSaveError(message(error));
    } finally {
      if (currentEditor()) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }
  async function discardPending() {
    if (!userId || !pending || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await cancelNativePending(pending);
      const remaining = await loadNativePending(userId, snapshot.project.id);
      if (currentEditor()) {
        setPending(remaining);
        setPendingBlocked(false);
        setSaveError('');
        if (result.status === 'accepted') onReload();
      }
    } catch (error) {
      if (currentEditor()) {
        setSaveError(message(error));
        setPendingBlocked(true);
      }
    } finally {
      if (currentEditor()) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }
  const visible = (scope: string) => scope === 'both' || scope === mode;
  const outline = doc
    ? nativeInspectorOutline(doc, mode, canvasScope, canvasView)
    : { tables: [], relations: [] };
  const tables = outline.tables.filter(
    (table) =>
      visible(table.scope) &&
      (domain === '*' || (domain === '' ? table.domainId === null : table.domainId === domain)) &&
      nativeInspectorMatches(search, table.logical.name, table.physical.name),
  );
  const selectedTable = doc?.tables?.find((table) => table.id === selected && visible(table.scope));
  const selectedCanvasNode = canvasScope?.selectedNode ?? null;
  const selectedNote = (reviewDocument ?? doc)?.notes.find(
    (note) => note.id === canvasScope?.selectedObjectId,
  );
  const selectedRelation = doc?.tableRelations?.find(
    (relation) => relation.id === selectedTableRelation,
  );
  const selectedRows = doc && selectedTable ? nativeTableCanvasRows(doc, selectedTable, mode) : [];
  const tableName = (id: string) => {
    const table = doc?.tables?.find((table) => table.id === id);
    return (
      (mode === 'physical' ? table?.physical.name : table?.logical.name) ||
      table?.physical.name ||
      table?.logical.name ||
      t('이름 없는 테이블')
    );
  };
  const columnName = (id: string) =>
    (mode === 'physical'
      ? doc?.columns?.find((column) => column.id === id)?.physical.name
      : doc?.columns?.find((column) => column.id === id)?.logical.name) ||
    doc?.columns?.find((column) => column.id === id)?.physical.name ||
    doc?.columns?.find((column) => column.id === id)?.logical.name ||
    id;
  const matches = (...values: (string | undefined)[]) => nativeInspectorMatches(search, ...values);
  const filteredDomainRelations = (doc?.domainRelations ?? []).filter((relation) =>
    matches(
      relation.name,
      relation.description,
      doc?.domains.find((item) => item.id === relation.sourceDomainId)?.name,
      doc?.domains.find((item) => item.id === relation.targetDomainId)?.name,
    ),
  );
  const filteredTableRelations = outline.relations.filter((relation) =>
    matches(
      relation.logical.name,
      relation.logical.description,
      relation.physical?.name,
      tableName(relation.sourceTableId),
      tableName(relation.targetTableId),
    ),
  );
  const currentViewName = doc
    ? nativeInspectorLocation(
        doc,
        canvasView,
        canvasScope?.filter ?? null,
        t('전체 테이블'),
        t('도메인 맵'),
        t('미지정'),
        t('선택 없음'),
      )
    : t('전체 테이블');
  function openDomain(id: string) {
    leaveRecoveredSelection();
    setSearch('');
    setDomain('*');
    setSelectedDomain(null);
    setSelectedDomainRelation(null);
    setSelectedTableRelation(null);
    setSelected(null);
    setRequestedView((previous) => ({ id, nonce: (previous?.nonce ?? 0) + 1 }));
  }
  function receiveCanvasScope(scope: NativeCanvasScope) {
    setCanvasScope(scope);
    setCanvasView(scope.viewId);
    // Scope refreshes during saves/layout are not new picks; retain an explicitly opened relation.
    if (
      canvasScope &&
      scope.selectedObjectId === canvasScope.selectedObjectId &&
      scope.viewId === canvasScope.viewId &&
      (!scope.selectedObjectId ||
        scope.visibleObjectIds.includes(scope.selectedObjectId) ||
        doc?.tableRelations?.some((relation) => relation.id === scope.selectedObjectId) ||
        doc?.domainRelations.some((relation) => relation.id === scope.selectedObjectId))
    )
      return;
    const id =
      scope.selectedObjectId &&
      (scope.visibleObjectIds.includes(scope.selectedObjectId) ||
        doc?.tableRelations?.some((relation) => relation.id === scope.selectedObjectId) ||
        doc?.domainRelations.some((relation) => relation.id === scope.selectedObjectId))
        ? scope.selectedObjectId
        : null;
    if (id && (reviewDocument ?? doc)?.notes.some((note) => note.id === id)) {
      setSelected(null);
      setSelectedDomain(null);
      setSelectedTableRelation(null);
      setSelectedDomainRelation(null);
      setEditingColumn(null);
      setInspectorTab('properties');
      setInspectorOpen(true);
      return;
    }
    if (id && doc?.tableRelations?.some((relation) => relation.id === id)) {
      setSelectedTableRelation(id);
      setSelected(null);
      setSelectedDomain(null);
      setInspectorTab('properties');
      setInspectorOpen(true);
      return;
    }
    if (id && doc?.domainRelations.some((relation) => relation.id === id)) {
      setSelectedDomainRelation(id);
      setSelectedDomain(null);
      setSelected(null);
      setInspectorTab('domains');
      setInspectorOpen(true);
      return;
    }
    if (id && doc?.domains.some((domain) => domain.id === id)) {
      setSelectedDomain(id);
      setSelected(null);
      setSelectedTableRelation(null);
      setSelectedDomainRelation(null);
      return;
    }
    if (id && doc?.tables?.some((table) => table.id === id)) {
      setSelected(id);
      setSelectedDomain(null);
      setSelectedTableRelation(null);
      setSelectedDomainRelation(null);
      return;
    }
    if (!id) {
      setSelected(null);
      setSelectedDomain(null);
      setSelectedTableRelation(null);
      setSelectedDomainRelation(null);
      setEditingColumn(null);
    }
  }
  const saveStatus = nativeInspectorSaveStatus({
    offline,
    saving,
    initializing: pendingBlocked || busy,
    pending: !!pending,
    durable: userId ? durableState : 'empty',
    dirty,
    error: !!saveError || !doc,
  });
  const panelToggle = userId ? (
    <div className="toolbar-group panel-toggles" role="group" aria-label={t('협업과 속성 패널')}>
      <IconButton
        aria-label={t(commentsOpen ? '핀 패널 숨기기' : '핀 패널 열기')}
        tooltip={t(commentsOpen ? '핀 패널 숨기기' : '핀 패널 열기')}
        aria-pressed={commentsOpen}
        aria-expanded={commentsOpen}
        onClick={() => {
          setCommentsOpen((value) => !value);
          setPinMode(false);
          setDraftPin(null);
        }}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="3" y="4" width="14" height="9" rx="2.5" />
          <path d="M7 13v3.2L10.6 13" />
        </svg>
      </IconButton>
      <IconButton
        aria-label={t(pinMode ? '핀 추가 취소' : '핀 추가')}
        tooltip={t(pinMode ? '핀 추가 취소' : '핀 추가')}
        disabled={!canPersonalEdit || snapshot.project.status !== 'active'}
        aria-pressed={pinMode}
        onClick={() => setPinMode((value) => !value)}
      >
        ＋
      </IconButton>
    </div>
  ) : undefined;
  function focusIssue(id: string | null) {
    if (!doc || !id) return;
    leaveRecoveredSelection();
    setInspectorOpen(true);
    setInspectorTab(doc.domains.some((item) => item.id === id) ? 'domains' : 'properties');
    if (doc.domains.some((item) => item.id === id)) {
      setSelectedDomain(id);
      return;
    }
    const owner =
      doc.tables?.find((table) => table.id === id)?.id ??
      doc.columns?.find((column) => column.id === id)?.tableId ??
      doc.keys?.find((key) => key.id === id)?.tableId ??
      doc.indexes?.find((index) => index.id === id)?.tableId ??
      doc.checks?.find((check) => check.id === id)?.tableId ??
      doc.tableRelations?.find((relation) => relation.id === id)?.sourceTableId;
    if (owner) {
      setSelectedDomain(null);
      setSelected(owner);
      setDomain('*');
      setSearch('');
      setMode('physical');
    }
  }
  function reorderColumns(sourceId: string, targetId: string) {
    if (!editable || editorBusy || !selectedTable || sourceId === targetId) return;
    const ids = (doc?.columns ?? [])
      .filter((column) => column.tableId === selectedTable.id)
      .map((column) => column.id);
    const from = ids.indexOf(sourceId),
      to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    void save([{ type: 'reorder_columns', tableId: selectedTable.id, columnIds: ids }], {
      version: snapshot.project.version,
      sequence: snapshot.sequence,
      databaseRevision: snapshot.project.databaseRevision,
    });
  }
  const options = selectedTable?.physical.options;
  function moveInspectorColumn(id: string, step: number) {
    const index = selectedRows.findIndex((row) => row.column.id === id),
      target = selectedRows[index + step]?.column.id;
    if (target) reorderColumns(id, target);
  }
  useEffect(() => {
    if (focusedReview) {
      focusIssue(focusedReview.objectId);
      focusThread(focusedReview);
    }
  }, [focusedReview?.id]);
  return (
    <main id="main" className="editor native-project-view">
      {enumOpen && doc && (
        <NativeEnumDialog
          document={doc}
          {...(editable
            ? { context: { userId: userId!, snapshot, busy: editorBusy, onSave: save } }
            : {})}
          onClose={() => setEnumOpen(false)}
        />
      )}
      <div className="editor-heading">
        <div className="project-title" role="group" aria-label={t('프로젝트 이동')}>
          <Button className="gallery-return" onClick={onLeave}>
            {t('← 갤러리')}
          </Button>
          <span className="navigation-divider" aria-hidden="true" />
          <h1 title={snapshot.project.name}>{snapshot.project.name}</h1>
          <div className="editor-path-host" ref={setPathHost} />
        </div>
        <div className="editor-toolbar-host" ref={setToolbarHost} />
        <div className="save-controls" role="group" aria-label={t('변경 기록과 동기화')}>
          <span
            className={`save-state${saveStatus === 'attention' ? ' failed' : ''}`}
            role="status"
          >
            {t(
              saveStatus === 'saving'
                ? '◌ 저장 확인 중…'
                : saveStatus === 'offline'
                  ? '○ 오프라인'
                  : saveStatus === 'attention'
                    ? '! 확인 필요'
                    : saveStatus === 'draft'
                      ? '○ 보관된 입력'
                      : '✓ 저장 기준 확인됨',
            )}
          </span>
          {userId && (
            <NativeHistoryControls
              key={`history-controls:${userId}:${snapshot.project.id}`}
              userId={userId}
              snapshot={snapshot}
              disabled={!editable || editorBusy}
              onReload={onReload}
              onHistory={() => setHistoryOpen(true)}
              historyOpen={historyOpen}
              onCloseHistory={() => setHistoryOpen(false)}
            />
          )}
        </div>
      </div>
      <div className="native-project-status native-project-context">
        <span>
          {snapshot.project.databaseKind === 'postgresql'
            ? 'PostgreSQL'
            : snapshot.project.databaseKind === 'mysql'
              ? 'MySQL'
              : 'SQLite'}{' '}
          · {t('목표 DB 버전')}: {profile.targetVersion}
        </span>
        <span>{t(editable ? '편집 가능' : '조회 전용')}</span>
        {userId && (
          <Button onClick={() => setDraftRecoveryOpen((value) => !value)}>
            {t('보관된 입력 복구')}
          </Button>
        )}
        <Button onClick={onReload} disabled={busy}>
          {t('다시 불러오기')}
        </Button>
      </div>
      {workspaceStatus === 'archived' && (
        <div className="notice" role="status">
          {t('이 워크스페이스는 보관되어 있습니다. 소유자가 복원하면 다시 편집할 수 있습니다.')}
        </div>
      )}
      {workspaceStatus !== 'archived' &&
        (workspaceRole === 'viewer' || (!canEdit && canPersonalEdit)) && (
          <div className="notice" role="status">
            {t('뷰어 권한입니다. 설계를 조회하고 핀과 댓글을 남길 수 있습니다.')}
          </div>
        )}
      {snapshot.project.status === 'archived' && (
        <div className="notice" role="status">
          {t('보관한 프로젝트입니다. 갤러리에서 복원하면 편집할 수 있습니다.')}
        </div>
      )}
      {draftRecoveryOpen && userId && (
        <NativeDraftRecoveryPanel
          key={`draft-recovery:${userId}:${snapshot.project.id}:${generation}`}
          userId={userId}
          projectId={snapshot.project.id}
          currentExpected={{
            version: snapshot.project.version,
            sequence: snapshot.sequence,
            databaseRevision: snapshot.project.databaseRevision,
          }}
          isActorCurrent={recoveryActorCurrent}
          isObjectAvailable={(input) => !!nativeDraftRecoveryTarget(activeDocument.current, input)}
          canRecover={canRecoverDraft}
          onRecovered={openRecoveredDraft}
        />
      )}
      {saveError && (
        <p className="notice error" role="alert">
          {saveError}
        </p>
      )}
      {userId && (pendingBlocked || durableState === 'unknown') && (
        <Button disabled={saving} onClick={() => void loadPending()}>
          {t('저장 결과 확인')}
        </Button>
      )}
      {pending && (
        <div className="notice native-pending" role="status">
          <p>{t('미확인 또는 미적용 저장 요청이 있습니다.')}</p>
          <Button onClick={() => void recover()} disabled={saving}>
            {t(saving ? '저장 확인 중…' : '저장 결과 확인')}
          </Button>
          <Button disabled={saving} onClick={() => void discardPending()}>
            {t('요청 취소 확정')}
          </Button>
        </div>
      )}
      {!doc ? (
        <p className="notice error" role="alert">
          {t(
            snapshot.native.status === 'unavailable' &&
              snapshot.native.code === 'database.context-changed'
              ? 'DB 설정과 저장된 설계의 종류가 다릅니다.'
              : '설계의 구조 또는 크기를 확인해 주세요.',
          )}
        </p>
      ) : (
        <>
          {entry.personalUnavailable && (
            <p className="notice" role="status">
              {t('개인 화면을 불러오지 못했습니다. 저장된 공유 설계를 표시합니다.')}
            </p>
          )}
          <div className="review-workspace native-review-workspace">
            <div
              className={`native-editor-workspace${inspectorOpen ? '' : ' inspector-closed'}${stackedInspector ? ' inspector-stacked' : ''}`}
              ref={workspaceRef}
              data-resizing={resizingInspector}
              style={{
                gridTemplateColumns: stackedInspector
                  ? 'minmax(0,1fr)'
                  : inspectorOpen
                    ? `minmax(0,1fr) 6px ${panelWidth}px`
                    : 'minmax(0,1fr) 0px 0px',
              }}
            >
              <NativeERDCanvas
                key={`${userId ?? ''}:${snapshot.project.id}:recovery:${recoveryEpoch}`}
                document={doc}
                snapshot={snapshot}
                {...(userId ? { userId } : {})}
                editable={editable}
                personalEditable={
                  !!userId && canPersonalEdit && snapshot.project.status === 'active'
                }
                busy={editorBusy}
                recoveryBusy={recoveryBusy}
                onSave={save}
                onReload={onReload}
                {...{
                  onCanvasScopeChange: receiveCanvasScope,
                  toolbarHost,
                  pathHost,
                  panelToggle,
                  selectionHost: selectedNote ? noteSelectionHost : domainSelectionHost,
                  ...(editingColumn ? { selectedColumnId: editingColumn } : {}),
                  ...(requestedView ? { requestedView } : {}),
                }}
                {...(projectActions
                  ? {
                      renderExportActions: (png: {
                        run: () => Promise<void>;
                        disabled: boolean;
                        busy: boolean;
                      }) => projectActions(focusIssue, png),
                    }
                  : {})}
                pinMode={pinMode}
                reviewFocus={reviewFocus}
                onReviewContext={(context, source) => {
                  setReviewContext(context);
                  setReviewDocument(source);
                }}
                onCreatePin={(context) => {
                  if (!canPersonalEdit || !userId || snapshot.project.status !== 'active') return;
                  setReviewContext(context);
                  setDraftPin({ ...context, nonce: Date.now() });
                  setReviewFocus(null);
                  setPinMode(false);
                  setCommentsOpen(true);
                }}
                pins={
                  userId && reviewDocument ? (
                    <CommentPins
                      threads={threads}
                      document={reviewDocument}
                      viewId={reviewContext.viewId}
                      {...(reviewContext.visibleObjectIds
                        ? { visibleObjectIds: reviewContext.visibleObjectIds }
                        : {})}
                      memberColors={Object.fromEntries(
                        members.map((member) => [member.id, member.color ?? '#4169e1']),
                      )}
                      onOpen={focusThread}
                    />
                  ) : undefined
                }

                mode={mode}
                inspectorHost={toolsHost}
                inspectorOpen={inspectorOpen}
                onToggleInspector={() => setInspectorOpen((value) => !value)}
                onOpenTools={() => {
                  setInspectorOpen(true);
                  setInspectorTab('tools');
                }}
                onCreate={toolbarCreate}
                {...{ onRequestStructure: requestStructure, onRequestAction: requestAction }}
                onModeChange={setMode}
                onViewChange={(id) => {
                  setCanvasView(id);
                  setSelected(null);
                  setSelectedDomain(null);
                  setEditingColumn(null);
                  setEditingConstraint(null);
                  setCreateRequest(null);
                  setSearch('');
                  setDomain('*');
                  setInspectorTab(id === 'overview' ? 'domains' : 'properties');
                }}
                {...(selectedTable ? { selectedTableId: selectedTable.id } : {})}
                {...(selectedDomain ? { selectedDomainId: selectedDomain } : {})}
                {...(recovered?.kind === 'canvas'
                  ? { recoverySelection: recovered.selection }
                  : {})}
                onSelectDomain={(id) => {
                  leaveRecoveredSelection();
                  setSelectedDomain(id);
                  setInspectorOpen(true);
                  setInspectorTab('domains');
                  setDomainCreation(0);
                  setDomainAction(null);
                  setSelectedDomainRelation(null);
                }}
                onSelect={(tableId, columnId) => {
                  leaveRecoveredSelection();
                  setSelectedDomain(null);
                  setSelected(tableId);
                  setCreateRequest(null);
                  setEditingConstraint(null);
                  setInspectorOpen(true);
                  setInspectorTab('properties');
                  setEditingColumn(columnId ?? null);
                  setDomain('*');
                  setSearch('');
                }}
              />
              <div
                className="native-inspector-resize"
                role="separator"
                aria-label={t('속성 패널 너비')}
                aria-orientation="vertical"
                aria-valuenow={Math.round(panelWidth)}
                aria-valuemin={panelBounds.min}
                aria-valuemax={panelBounds.max}
                tabIndex={inspectorOpen && !stackedInspector ? 0 : -1}
                hidden={!inspectorOpen || stackedInspector}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  setResizingInspector(true);
                  event.currentTarget.setPointerCapture(event.pointerId);
                  resize.current = {
                    pointer: event.pointerId,
                    x: event.clientX,
                    width: panelWidth,
                  };
                }}
                onPointerMove={(event) => {
                  const active = resize.current;
                  if (active?.pointer !== event.pointerId) return;
                  setInspectorWidth(
                    clampInspectorWidth(active.width + active.x - event.clientX, workspaceWidth),
                  );
                }}
                onPointerUp={(event) => {
                  resize.current = null;
                  setResizingInspector(false);
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                  resize.current = null;
                  setResizingInspector(false);
                }}
                onLostPointerCapture={() => {
                  resize.current = null;
                  setResizingInspector(false);
                }}
                onKeyDown={(event) => {
                  const next =
                    event.key === 'Home'
                      ? panelBounds.min
                      : event.key === 'End'
                        ? panelBounds.max
                        : event.key === 'ArrowLeft'
                          ? panelWidth + (event.shiftKey ? 40 : 10)
                          : event.key === 'ArrowRight'
                            ? panelWidth - (event.shiftKey ? 40 : 10)
                            : null;
                  if (next !== null) {
                    event.preventDefault();
                    setInspectorWidth(clampInspectorWidth(next, workspaceWidth));
                  }
                }}
              />
              <aside
                className="native-editor-inspector inspector-shell inspector"
                aria-label={t('속성 패널')}
                id="native-canvas-inspector"
                inert={!inspectorOpen}
                aria-hidden={!inspectorOpen}
              >
                <div className="inspector-topbar">
                  <div className="inspector-place">
                    <span>
                      {canvasView === 'overview' || canvasView === '__tables__' ? 'VIEW' : 'DOMAIN'}
                    </span>
                    <strong title={currentViewName}>{currentViewName}</strong>
                  </div>
                  {(selectedTable ||
                    selectedDomain ||
                    selectedNote ||
                    selectedRelation ||
                    selectedDomainRelation) && (
                    <div className="inspector-selection">
                      <span className="selection-kind">
                        {t(
                          selectedNote
                            ? '메모'
                            : selectedRelation || selectedDomainRelation
                              ? '관계'
                              : selectedDomain
                                ? '도메인'
                                : '테이블',
                        )}
                      </span>
                      <strong>
                        {selectedNote
                          ? selectedNote.text.slice(0, 80) || t('메모')
                          : selectedRelation
                            ? selectedRelation.logical.name ||
                              selectedRelation.physical?.name ||
                              t('관계')
                            : selectedDomainRelation
                              ? doc.domainRelations.find(
                                  (relation) => relation.id === selectedDomainRelation,
                                )?.name
                              : selectedDomain
                                ? doc.domains.find((item) => item.id === selectedDomain)?.name
                                : tableName(selectedTable!.id)}
                      </strong>
                      <IconButton
                        aria-label={t('선택 해제')}
                        onClick={() => {
                          leaveRecoveredSelection();
                          setSelected(null);
                          setSelectedDomain(null);
                          setEditingColumn(null);
                          setSelectedDomainRelation(null);
                          setSelectedTableRelation(null);
                        }}
                      >
                        ×
                      </IconButton>
                    </div>
                  )}
                  <div className="inspector-tabs" role="group" aria-label={t('패널 보기 전환')}>
                    <TabButton
                      selected={inspectorTab === 'properties' || inspectorTab === 'domains'}
                      onClick={() =>
                        setInspectorTab(canvasView === 'overview' ? 'domains' : 'properties')
                      }
                    >
                      {t('속성')}
                    </TabButton>
                    <TabButton
                      selected={inspectorTab === 'tools'}
                      onClick={() => setInspectorTab('tools')}
                    >
                      {t('도구')}
                    </TabButton>
                    <TabButton
                      selected={inspectorTab === 'tables'}
                      onClick={() => setInspectorTab('tables')}
                    >
                      {t('목록')}{' '}
                      <span className="panel-count">
                        {canvasView === 'overview' ? doc.domains.length : tables.length}
                      </span>
                    </TabButton>
                  </div>
                </div>
                <div
                  className="native-inspector-panel"
                  role="tabpanel"
                  id={`${snapshot.project.id}-tools`}
                  aria-label={t('도구')}
                  hidden={inspectorTab !== 'tools'}
                  ref={setToolsHost}
                />
                <div
                  className="native-inspector-panel"
                  role="tabpanel"
                  id={`${snapshot.project.id}-domains`}
                  aria-label={t('도메인')}
                  hidden={inspectorTab !== 'domains'}
                >
                  {!selectedDomain && (
                    <>
                      <div className="panel-empty">
                        <strong>{t('도메인 맵')}</strong>
                        <p>
                          {t('카드를 선택하면 이름·설명·색상과 연결된 관계를 여기에서 편집합니다.')}
                        </p>
                      </div>
                      <div className="panel-summary">
                        <span>
                          {t('도메인')} {doc.domains.length}
                        </span>
                        <span>
                          {t('관계')} {doc.domainRelations.length}
                        </span>
                      </div>
                    </>
                  )}
                  <NativeDomainEditor
                    key={`domains:${userId ?? ''}:${snapshot.project.id}:recovery:${recoveryEpoch}:create:${domainCreation}:action:${domainAction ?? ''}`}
                    document={doc}
                    snapshot={snapshot}
                    {...(userId ? { userId } : {})}
                    editable={editable}
                    busy={editorBusy}
                    onSave={save}
                    {...(selectedDomain ? { selectedDomainId: selectedDomain } : {})}
                    {...(selectedTable ? { selectedTableId: selectedTable.id } : {})}
                    {...(recovered?.kind === 'domain'
                      ? { initialAction: recovered.action }
                      : domainCreation
                        ? { initialAction: 'create' as const }
                        : domainAction
                          ? { initialAction: domainAction }
                          : {})}
                    onSelectDomain={(id) => {
                      leaveRecoveredSelection();
                      setSelectedDomain(id);
                      setInspectorOpen(true);
                      setInspectorTab('domains');
                      setDomainCreation(0);
                    }}
                  />
                  <NativeDomainRelationEditor
                    key={`domain-relation:${selectedDomainRelation ?? ''}:create:${domainRelationCreation ?? ''}`}
                    document={doc}
                    editable={editable}
                    {...(selectedDomainRelation ? { selectedId: selectedDomainRelation } : {})}
                    {...(domainRelationCreation
                      ? { initialAction: 'create' as const, sourceDomainId: domainRelationCreation }
                      : {})}
                    {...(userId
                      ? { context: { userId, snapshot, busy: editorBusy, onSave: save } }
                      : {})}
                  />
                  <div
                    ref={setDomainSelectionHost}
                    className="native-selection-host"
                    data-node-id={selectedCanvasNode?.id}
                  />
                  {selectedDomain && (
                    <>
                      <div className="actions">
                        <Button onClick={() => openDomain(selectedDomain)}>
                          {t('도메인 열기')}
                        </Button>
                        <Button
                          disabled={!editable || editorBusy}
                          onClick={() => requestAction('createDomainRelation', selectedDomain)}
                        >
                          {t('+ 도메인 관계')}
                        </Button>
                      </div>
                      <PanelSection
                        title={t('연결된 도메인 관계')}
                        count={
                          doc.domainRelations.filter(
                            (relation) =>
                              relation.sourceDomainId === selectedDomain ||
                              relation.targetDomainId === selectedDomain,
                          ).length
                        }
                        defaultOpen
                      >
                        <PanelList empty={t('표시할 관계가 없습니다.')}>
                          {doc.domainRelations
                            .filter(
                              (relation) =>
                                relation.sourceDomainId === selectedDomain ||
                                relation.targetDomainId === selectedDomain,
                            )
                            .map((relation) => (
                              <PanelRow
                                key={relation.id}
                                title={relation.name}
                                meta={`${doc.domains.find((item) => item.id === relation.sourceDomainId)?.name ?? '?'} ${relation.direction === 'both' ? '↔' : '→'} ${doc.domains.find((item) => item.id === relation.targetDomainId)?.name ?? '?'}`}
                                active={selectedDomainRelation === relation.id}
                                onSelect={() => requestAction('domainRelation', relation.id)}
                              />
                            ))}
                        </PanelList>
                      </PanelSection>
                    </>
                  )}
                </div>
                <div className="native-project-content" aria-label={t('설계 조회')}>
                  <aside
                    className="native-table-nav native-inspector-panel"
                    role="tabpanel"
                    id={`${snapshot.project.id}-tables`}
                    aria-label={t('테이블')}
                    hidden={inspectorTab !== 'tables'}
                  >
                    <label>
                      {t('현재 화면 검색')}
                      <Input
                        aria-label={t('현재 화면 검색')}
                        placeholder={t(
                          canvasView === 'overview' ? '도메인·관계 검색' : '테이블·관계 검색',
                        )}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <Select aria-label={t('전체 도메인')} value={domain} onValueChange={setDomain}>
                      <option value="*">{t('전체 도메인')}</option>
                      <option value="">{t('미소속')}</option>
                      {doc.domains.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                    <div className="native-mode">
                      <Button
                        aria-pressed={mode === 'physical'}
                        onClick={() => setMode('physical')}
                      >
                        {t('물리')}
                      </Button>
                      <Button aria-pressed={mode === 'logical'} onClick={() => setMode('logical')}>
                        {t('논리')}
                      </Button>
                    </div>
                    <PanelSection
                      title={t(canvasView === 'overview' ? '도메인' : '테이블')}
                      defaultOpen
                      count={canvasView === 'overview' ? doc.domains.length : tables.length}
                    >
                      <PanelList
                        empty={t(
                          canvasView === 'overview'
                            ? '표시할 도메인이 없습니다.'
                            : '선택한 범위에 테이블이 없습니다.',
                        )}
                      >
                        {canvasView === 'overview'
                          ? doc.domains
                              .filter((item) => matches(item.name, item.description))
                              .map((item) => (
                                <PanelRow
                                  key={item.id}
                                  title={item.name}
                                  accent={item.color ?? '#8993a3'}
                                  active={selectedDomain === item.id}
                                  meta={t('관계 {count}개', {
                                    count: doc.domainRelations.filter(
                                      (relation) =>
                                        relation.sourceDomainId === item.id ||
                                        relation.targetDomainId === item.id,
                                    ).length,
                                  })}
                                  onSelect={() => {
                                    leaveRecoveredSelection();
                                    setSelectedDomain(item.id);
                                    setInspectorTab('domains');
                                  }}
                                  action={
                                    <Button
                                      disabled={editorBusy}
                                      onClick={() => openDomain(item.id)}
                                    >
                                      {t('열기')}
                                    </Button>
                                  }
                                />
                              ))
                          : tables.map((table) => (
                              <PanelRow
                                key={table.id}
                                title={tableName(table.id)}
                                active={selectedTable?.id === table.id}
                                accent={
                                  table.color ??
                                  doc.domains.find((item) => item.id === table.domainId)?.color ??
                                  '#8993a3'
                                }
                                meta={t('컬럼 {count}개', {
                                  count: (doc.columns ?? []).filter(
                                    (item) => item.tableId === table.id && visible(item.scope),
                                  ).length,
                                })}
                                badge={
                                  canvasView === '__tables__'
                                    ? (doc.domains.find((item) => item.id === table.domainId)
                                        ?.name ?? t('미지정'))
                                    : table.domainId === canvasView
                                      ? undefined
                                      : t('참조')
                                }
                                onSelect={() => {
                                  leaveRecoveredSelection();
                                  setSelected(table.id);
                                  setEditingColumn(null);
                                  setCreateRequest(null);
                                  setInspectorTab('properties');
                                  setSelectedDomain(null);
                                }}
                              />
                            ))}
                      </PanelList>
                    </PanelSection>
                    <PanelSection
                      title={t(canvasView === 'overview' ? '도메인 관계' : '테이블 관계')}
                      count={
                        canvasView === 'overview'
                          ? filteredDomainRelations.length
                          : filteredTableRelations.length
                      }
                      defaultOpen={canvasView === 'overview'}
                    >
                      <PanelList empty={t('표시할 관계가 없습니다.')}>
                        {canvasView === 'overview'
                          ? filteredDomainRelations.map((relation) => (
                              <PanelRow
                                key={relation.id}
                                title={relation.name}
                                meta={`${doc.domains.find((item) => item.id === relation.sourceDomainId)?.name ?? '?'} ${relation.direction === 'both' ? '↔' : '→'} ${doc.domains.find((item) => item.id === relation.targetDomainId)?.name ?? '?'}`}
                                onSelect={() => requestAction('domainRelation', relation.id)}
                              />
                            ))
                          : filteredTableRelations.map((relation) => (
                              <PanelRow
                                key={relation.id}
                                title={`${tableName(relation.targetTableId)} (PK) → ${tableName(relation.sourceTableId)} (FK)`}
                                meta={relation.physical?.name || relation.logical.name}
                                badge={relation.physical ? 'FK' : undefined}
                                onSelect={() =>
                                  requestStructure(
                                    'patch',
                                    JSON.stringify(['tableRelations', relation.id]),
                                    relation.sourceTableId,
                                  )
                                }
                              />
                            ))}
                      </PanelList>
                    </PanelSection>
                  </aside>
                  <section
                    className="native-table-detail native-inspector-panel"
                    role="tabpanel"
                    id={`${snapshot.project.id}-properties`}
                    aria-label={t('속성')}
                    hidden={inspectorTab !== 'properties'}
                    aria-live="polite"
                  >
                    {selectedNote && (
                      <div
                        ref={setNoteSelectionHost}
                        className="native-selection-host"
                        data-node-id={selectedCanvasNode?.id}
                        data-selection-kind="note"
                        data-object-id={selectedNote.id}
                      />
                    )}
                    {selectedRelation && (
                      <NativeTableRelationInspector
                        document={doc}
                        relation={selectedRelation}
                        {...(editable
                          ? {
                              context: {
                                userId: userId!,
                                snapshot,
                                busy: editorBusy,
                                onSave: save,
                              },
                              onDelete: () =>
                                requestStructure(
                                  'delete',
                                  JSON.stringify(['tableRelations', selectedRelation.id]),
                                  selectedRelation.sourceTableId,
                                ),
                            }
                          : {})}
                      />
                    )}
                    {editable && recovered?.kind === 'advanced' && selectedTable && (
                      <NativeAdvancedEditor
                        key={`advanced-recovery:${recoveryEpoch}`}
                        context={{ userId: userId!, snapshot, busy: editorBusy, onSave: save }}
                        document={doc}
                        table={selectedTable}
                        initialSelection={recovered.selection}
                      />
                    )}
                    {editable &&
                      recovered?.kind !== 'advanced' &&
                      (createRequest || recovered?.kind === 'structure') && (
                        <div
                          className="native-contextual-editor"
                          key={`structure:${createRequest?.nonce ?? 0}:${recoveryEpoch}`}
                        >
                          <NativeStructureEditor
                            focused
                            {...(createRequest?.values
                              ? { initialValues: createRequest.values }
                              : {})}
                            key={`${userId}:${snapshot.project.id}:recovery:${recoveryEpoch}:create:${createRequest?.nonce ?? 0}`}
                            context={{
                              userId: userId!,
                              snapshot,
                              busy: editorBusy,
                              onSave: save,
                            }}
                            document={doc}
                            {...(recovered?.kind === 'structure'
                              ? {
                                  initialSelection: recovered.selection,
                                  ...(recovered.tableId &&
                                  doc.tables?.find((table) => table.id === recovered.tableId)
                                    ? {
                                        table: doc.tables.find(
                                          (table) => table.id === recovered.tableId,
                                        )!,
                                      }
                                    : {}),
                                }
                              : createRequest
                                ? {
                                    initialSelection: {
                                      action: createRequest.action,
                                      target: createRequest.target ?? '',
                                    },
                                    ...(selectedTable ? { table: selectedTable } : {}),
                                  }
                                : selectedTable
                                  ? { table: selectedTable }
                                  : {})}
                          />
                          <Button
                            onClick={() => {
                              leaveRecoveredSelection();
                              setCreateRequest(null);
                            }}
                          >
                            {t('편집 닫기')}
                          </Button>
                        </div>
                      )}
                    {focusedReview && (
                      <section aria-label={t('리뷰')}>
                        <h3>{t('리뷰')}</h3>
                        {focusedReview.messages.map((item) => (
                          <p key={item.id}>{item.body}</p>
                        ))}
                      </section>
                    )}
                    {!selectedTable && !createRequest && !selectedNote && !selectedRelation && (
                      <>
                        <div className="panel-empty">
                          <strong>{currentViewName}</strong>
                          <p>
                            {t('테이블을 선택하면 이름·컬럼·연결된 관계를 여기에서 편집합니다.')}
                          </p>
                        </div>
                        <div className="panel-summary">
                          <span>
                            {t('테이블')} {outline.tables.length}
                          </span>
                          <span>
                            {t('관계')} {outline.relations.length}
                          </span>
                          <span>ENUM {(doc.enums ?? []).length}</span>
                        </div>
                        {editable && (
                          <NativeStructureEditor
                            focused
                            key={`new-table:${userId}:${snapshot.project.id}:${recoveryEpoch}`}
                            context={{ userId: userId!, snapshot, busy: editorBusy, onSave: save }}
                            document={doc}
                            initialSelection={{ action: 'table', target: '' }}
                          />
                        )}
                      </>
                    )}
                    {selectedTable && (
                      <>
                        <PanelSection title={t('기본 정보')} defaultOpen>
                          <p className="panel-note">
                            {t('도메인')}:{' '}
                            {doc.domains.find((item) => item.id === selectedTable.domainId)?.name ??
                              t('미지정')}
                          </p>
                          {editable && (
                            <Button
                              disabled={editorBusy}
                              onClick={() => {
                                leaveRecoveredSelection();
                                setSelectedDomain(null);
                                setDomainAction('move');
                                setInspectorTab('domains');
                              }}
                            >
                              {t('테이블 소속 이동')}
                            </Button>
                          )}
                          {editable ? (
                            <>
                              <NativePropertyEditor
                                key={`${userId}:${snapshot.project.id}:${selectedTable.id}:table:${snapshot.project.version}:${snapshot.sequence}:${snapshot.project.databaseRevision}:recovery:${recoveryEpoch}`}
                                table={selectedTable}
                                mode={mode}
                                userId={userId!}
                                snapshot={snapshot}
                                busy={editorBusy}
                                onSave={save}
                              />
                            </>
                          ) : (
                            <>
                              <strong>{tableName(selectedTable.id)}</strong>
                              <p>
                                {mode === 'physical'
                                  ? selectedTable.physical.comment
                                  : selectedTable.logical.definition}
                              </p>
                            </>
                          )}
                        </PanelSection>
                        <PanelSection
                          title={t('컬럼')}
                          count={
                            (doc.columns ?? []).filter(
                              (column) =>
                                column.tableId === selectedTable.id && visible(column.scope),
                            ).length
                          }
                          defaultOpen
                        >
                          <PanelList empty={t('컬럼이 없습니다.')}>
                            {(doc.columns ?? [])
                              .filter(
                                (column) =>
                                  column.tableId === selectedTable.id && visible(column.scope),
                              )
                              .map((column, index) => (
                                <Fragment key={column.id}>
                                  <PanelRow
                                    className={
                                      columnDrop === column.id
                                        ? 'table-column-drop'
                                        : columnDrag === column.id
                                          ? 'table-column-dragging'
                                          : ''
                                    }
                                    drag={{
                                      draggable: editable && !editorBusy,
                                      onDragStart: (event) => {
                                        draggingColumn.current = column.id;
                                        setColumnDrag(column.id);
                                        event.dataTransfer.effectAllowed = 'move';
                                        event.dataTransfer.setData('text/plain', column.id);
                                      },
                                      onDragOver: (event) => {
                                        if (editable && !editorBusy && draggingColumn.current) {
                                          event.preventDefault();
                                          event.dataTransfer.dropEffect = 'move';
                                          setColumnDrop(column.id);
                                        }
                                      },
                                      onDrop: (event) => {
                                        event.preventDefault();
                                        if (draggingColumn.current)
                                          reorderColumns(draggingColumn.current, column.id);
                                        draggingColumn.current = null;
                                        setColumnDrag(null);
                                        setColumnDrop(null);
                                      },
                                      onDragEnd: () => {
                                        draggingColumn.current = null;
                                        setColumnDrag(null);
                                        setColumnDrop(null);
                                      },
                                      onDragLeave: () => setColumnDrop(null),
                                    }}
                                    action={
                                      <button
                                        type="button"
                                        className="column-drag-handle"
                                        aria-label={t('컬럼 순서 변경')}
                                        title={t('드래그하거나 위/아래 방향키로 순서 변경')}
                                        disabled={!editable || editorBusy}
                                        onKeyDown={(event) => {
                                          const step =
                                            event.key === 'ArrowUp'
                                              ? -1
                                              : event.key === 'ArrowDown'
                                                ? 1
                                                : 0;
                                          if (!step) return;
                                          event.preventDefault();
                                          const peers = (doc.columns ?? []).filter(
                                            (item) => item.tableId === selectedTable.id,
                                          );
                                          const target =
                                            peers[
                                              peers.findIndex((item) => item.id === column.id) +
                                                step
                                            ];
                                          if (target) reorderColumns(column.id, target.id);
                                        }}
                                      >
                                        ⠿
                                      </button>
                                    }
                                    title={`${index + 1}. ${columnName(column.id)}`}
                                    meta={
                                      mode === 'physical'
                                        ? nativeColumnTypeDisplay(column.physical.type, doc.enums)
                                        : column.logical.semanticType
                                    }
                                    badge={
                                      selectedRows.find((row) => row.column.id === column.id)
                                        ?.keys || undefined
                                    }
                                    active={editingColumn === column.id}
                                    expanded={editingColumn === column.id}
                                    controls={`native-column-${column.id}`}
                                    onSelect={() => {
                                      leaveRecoveredSelection();
                                      setEditingColumn(
                                        editingColumn === column.id ? null : column.id,
                                      );
                                    }}
                                  />
                                  <PanelListDetail
                                    open={editingColumn === column.id}
                                    id={`native-column-${column.id}`}
                                  >
                                    {editable ? (
                                      <>
                                        <NativePropertyEditor
                                          key={`${column.id}:${snapshot.sequence}:${recoveryEpoch}`}
                                          table={selectedTable}
                                          column={column}
                                          mode={mode}
                                          userId={userId!}
                                          snapshot={snapshot}
                                          busy={editorBusy}
                                          onSave={save}
                                        />
                                        <div className="actions native-column-actions">
                                          <IconButton
                                            aria-label={t('컬럼 위로')}
                                            disabled={editorBusy || index === 0}
                                            onClick={() => moveInspectorColumn(column.id, -1)}
                                          >
                                            ↑
                                          </IconButton>
                                          <IconButton
                                            aria-label={t('컬럼 아래로')}
                                            disabled={
                                              editorBusy || index === selectedRows.length - 1
                                            }
                                            onClick={() => moveInspectorColumn(column.id, 1)}
                                          >
                                            ↓
                                          </IconButton>
                                          <Button
                                            variant="danger"
                                            disabled={editorBusy}
                                            onClick={() =>
                                              requestStructure(
                                                'delete',
                                                JSON.stringify(['columns', column.id]),
                                                selectedTable.id,
                                              )
                                            }
                                          >
                                            {t('컬럼 삭제')}
                                          </Button>
                                          <Button onClick={() => setEditingColumn(null)}>
                                            {t('편집 닫기')}
                                          </Button>
                                        </div>
                                      </>
                                    ) : (
                                      <p>
                                        {column.physical.comment ||
                                          column.logical.definition ||
                                          '—'}
                                      </p>
                                    )}
                                  </PanelListDetail>
                                </Fragment>
                              ))}
                          </PanelList>
                          {editable && (
                            <Button
                              disabled={editorBusy}
                              onClick={() =>
                                setCreateRequest((previous) => ({
                                  action: 'column',
                                  nonce: (previous?.nonce ?? 0) + 1,
                                }))
                              }
                            >
                              {t('컬럼 추가')} ›
                            </Button>
                          )}
                        </PanelSection>
                        <PanelSection
                          title={t('키 · PK / UNIQUE')}
                          count={
                            (doc.keys ?? []).filter((item) => item.tableId === selectedTable.id)
                              .length
                          }
                        >
                          <PanelList empty={t('키가 없습니다.')}>
                            {(doc.keys ?? [])
                              .filter(
                                (key) => key.tableId === selectedTable.id && visible(key.scope),
                              )
                              .map((key) => (
                                <Fragment key={key.id}>
                                  <PanelRow
                                    title={key.name || (key.kind === 'primary' ? 'PK' : 'UNIQUE')}
                                    meta={`${key.columnIds.map(columnName).join(', ')}${key.deferrable ? ` · DEFERRABLE ${key.deferrable.initially}` : ''}${key.nullsNotDistinct ? ' · NULLS NOT DISTINCT' : ''}`}
                                    badge={key.kind === 'primary' ? 'PK' : 'UNIQUE'}
                                    active={editingConstraint === key.id}
                                    expanded={editingConstraint === key.id}
                                    controls={`native-key-${key.id}`}
                                    onSelect={() =>
                                      setEditingConstraint(
                                        editingConstraint === key.id ? null : key.id,
                                      )
                                    }
                                  />
                                  <PanelListDetail
                                    id={`native-key-${key.id}`}
                                    open={editingConstraint === key.id}
                                  >
                                    {editable && (
                                      <>
                                        <NativeStructureEditor
                                          focused
                                          context={{
                                            userId: userId!,
                                            snapshot,
                                            busy: editorBusy,
                                            onSave: save,
                                          }}
                                          document={doc}
                                          table={selectedTable}
                                          initialSelection={{
                                            action: 'patch',
                                            target: JSON.stringify(['keys', key.id]),
                                          }}
                                        />
                                        <Button
                                          variant="danger"
                                          disabled={editorBusy}
                                          onClick={() =>
                                            requestStructure(
                                              'delete',
                                              JSON.stringify(['keys', key.id]),
                                              selectedTable.id,
                                            )
                                          }
                                        >
                                          {t('키 삭제')}
                                        </Button>
                                      </>
                                    )}
                                  </PanelListDetail>
                                </Fragment>
                              ))}
                          </PanelList>
                          {editable && (
                            <Button
                              disabled={
                                editorBusy ||
                                !(doc.columns ?? []).some(
                                  (item) =>
                                    item.tableId === selectedTable.id && item.scope !== 'logical',
                                )
                              }
                              onClick={() => requestStructure('key', '', selectedTable.id)}
                            >
                              {t('+ 키 추가')}
                            </Button>
                          )}
                        </PanelSection>
                        <PanelSection
                          title={t('테이블 관계')}
                          count={
                            (doc.tableRelations ?? []).filter(
                              (item) =>
                                item.sourceTableId === selectedTable.id ||
                                item.targetTableId === selectedTable.id,
                            ).length
                          }
                        >
                          <PanelList empty={t('표시할 관계가 없습니다.')}>
                            {(doc.tableRelations ?? [])
                              .filter(
                                (relation) =>
                                  visible(relation.scope) &&
                                  (relation.sourceTableId === selectedTable.id ||
                                    relation.targetTableId === selectedTable.id),
                              )
                              .map((relation) => (
                                <Fragment key={relation.id}>
                                  <PanelRow
                                    title={`${tableName(relation.targetTableId)} (PK) → ${tableName(relation.sourceTableId)} (FK)`}
                                    meta={`${relation.logical.name}${relation.physical ? ` · ${relation.physical.name}` : ''}`}
                                    badge={relation.physical ? 'FK' : undefined}
                                    active={editingConstraint === relation.id}
                                    expanded={editingConstraint === relation.id}
                                    controls={`native-related-${relation.id}`}
                                    onSelect={() =>
                                      setEditingConstraint(
                                        editingConstraint === relation.id ? null : relation.id,
                                      )
                                    }
                                  />
                                  <PanelListDetail
                                    id={`native-related-${relation.id}`}
                                    open={editingConstraint === relation.id}
                                  >
                                    <NativeTableRelationInspector
                                      document={doc}
                                      relation={relation}
                                      {...(editable
                                        ? {
                                            context: {
                                              userId: userId!,
                                              snapshot,
                                              busy: editorBusy,
                                              onSave: save,
                                            },
                                            onDelete: () =>
                                              requestStructure(
                                                'delete',
                                                JSON.stringify(['tableRelations', relation.id]),
                                                selectedTable.id,
                                              ),
                                          }
                                        : {})}
                                    />
                                  </PanelListDetail>
                                </Fragment>
                              ))}
                          </PanelList>
                          {editable && (
                            <Button
                              disabled={editorBusy}
                              onClick={() => requestStructure('foreignKey', '', selectedTable.id)}
                            >
                              {t('+ 테이블 관계 추가')}
                            </Button>
                          )}
                        </PanelSection>
                        {editable && recovered?.kind !== 'advanced' && (
                          <NativeAdvancedEditor
                            key={`advanced:${userId}:${snapshot.project.id}:${selectedTable.id}`}
                            context={{ userId: userId!, snapshot, busy: editorBusy, onSave: save }}
                            document={doc}
                            table={selectedTable}
                          />
                        )}
                        <PanelSection title={t('상세 설계 정보')}>
                          <p>
                            {mode === 'physical'
                              ? selectedTable.physical.comment
                              : selectedTable.logical.definition}
                          </p>
                          {mode === 'physical' && (
                            <dl className="native-options">
                              <dt>{t('DB 옵션')}</dt>
                              <dd>
                                {selectedTable.physical.namespace.kind === 'postgresSchema'
                                  ? selectedTable.physical.namespace.name || 'public'
                                  : selectedTable.physical.namespace.kind === 'legacyNamespace'
                                    ? selectedTable.physical.namespace.original
                                    : ''}
                                {options?.database === 'mysql'
                                  ? ` InnoDB ${options.charset ?? ''} ${options.collation ?? ''}`
                                  : options?.database === 'sqlite'
                                    ? `${options.strict ? ' STRICT' : ''}${options.withoutRowid ? ' WITHOUT ROWID' : ''}`
                                    : ''}
                              </dd>
                            </dl>
                          )}
                          <table>
                            <thead>
                              <tr>
                                <th>{t('컬럼')}</th>
                                <th>{mode === 'physical' ? t('타입') : t('의미 타입')}</th>
                                <th>{mode === 'physical' ? 'NULL' : t('필수')}</th>
                                {mode === 'physical' ? (
                                  <>
                                    <th>{t('기본값')}</th>
                                    <th>{t('생성')}</th>
                                    <th>{t('DB 옵션')}</th>
                                  </>
                                ) : null}
                                <th>{t('설명')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(doc.columns ?? [])
                                .filter(
                                  (column) =>
                                    column.tableId === selectedTable.id && visible(column.scope),
                                )
                                .map((column) => (
                                  <tr key={column.id} data-object-id={column.id}>
                                    <th scope="row">
                                      {mode === 'physical'
                                        ? column.physical.name || column.logical.name
                                        : column.logical.name || column.physical.name}
                                    </th>
                                    <td>
                                      {mode === 'physical'
                                        ? nativeColumnTypeDisplay(
                                            column.physical.type,
                                            doc.enums,
                                          ) || t('타입 없음')
                                        : column.logical.semanticType}
                                    </td>
                                    <td>
                                      {mode === 'physical'
                                        ? column.physical.nullable
                                          ? 'NULL'
                                          : 'NOT NULL'
                                        : column.logical.required
                                          ? '✓'
                                          : ''}
                                    </td>
                                    {mode === 'physical' ? (
                                      <>
                                        <td>
                                          {nativeDefaultDisplay(column.physical.defaultValue, doc)}
                                        </td>
                                        <td>
                                          {nativeGenerationDisplay(column.physical.generation, doc)}
                                        </td>
                                        <td>
                                          {column.physical.options.database === 'mysql'
                                            ? `${column.physical.options.charset ?? ''} ${column.physical.options.collation ?? ''}${column.physical.options.onUpdate ? ` ON UPDATE ${nativeExpressionDisplay(column.physical.options.onUpdate, doc)}` : ''}`
                                            : (column.physical.options.collation ?? '')}
                                        </td>
                                      </>
                                    ) : null}
                                    <td>
                                      {mode === 'physical'
                                        ? column.physical.comment
                                        : column.logical.definition}
                                      <details>
                                        <summary>{t('추가 속성')}</summary>
                                        {Object.entries(column.customProperties.common).map(
                                          ([key, value]) => (
                                            <p key={`common-${key}`}>
                                              {key}: {value}
                                            </p>
                                          ),
                                        )}
                                        {Object.entries(column.customProperties[mode]).map(
                                          ([key, value]) => (
                                            <p key={key}>
                                              {key}: {value}
                                            </p>
                                          ),
                                        )}
                                      </details>
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                          <details>
                            <summary>{t('추가 속성')}</summary>
                            {Object.entries(selectedTable.customProperties.common).map(
                              ([key, value]) => (
                                <p key={`common-${key}`}>
                                  {key}: {value}
                                </p>
                              ),
                            )}
                            {Object.entries(selectedTable.customProperties[mode]).map(
                              ([key, value]) => (
                                <p key={key}>
                                  {key}: {value}
                                </p>
                              ),
                            )}
                          </details>

                          <h3>{t('인덱스')}</h3>
                          <ul>
                            {(doc.indexes ?? [])
                              .filter(
                                (index) =>
                                  index.tableId === selectedTable.id && visible(index.scope),
                              )
                              .map((index) => (
                                <li key={index.id}>
                                  {index.unique ? 'UNIQUE ' : ''}
                                  {index.name} (
                                  {index.parts
                                    .map(
                                      (part) =>
                                        `${nativeExpressionDisplay(part.expression, doc)} ${part.direction.toUpperCase()}${part.prefixLength !== undefined ? ` (${part.prefixLength})` : ''}`,
                                    )
                                    .join(', ')}
                                  ) ·{' '}
                                  {index.options.database === 'postgresql'
                                    ? index.options.method
                                    : index.options.database === 'mysql'
                                      ? index.options.kind
                                      : 'SQLite'}
                                  {'predicate' in index.options && index.options.predicate
                                    ? ` WHERE ${nativeExpressionDisplay(index.options.predicate, doc)}`
                                    : ''}
                                  {index.options.database === 'postgresql' &&
                                  index.options.includeColumnIds?.length
                                    ? ` INCLUDE (${index.options.includeColumnIds.map(columnName).join(', ')})`
                                    : ''}
                                  {index.options.database === 'postgresql' &&
                                  index.options.nullsNotDistinct
                                    ? ' NULLS NOT DISTINCT'
                                    : ''}
                                  {index.options.database === 'mysql' && index.options.invisible
                                    ? ' INVISIBLE'
                                    : ''}
                                </li>
                              ))}
                          </ul>
                          <h3>CHECK</h3>
                          <ul>
                            {(doc.checks ?? [])
                              .filter(
                                (check) =>
                                  check.tableId === selectedTable.id && visible(check.scope),
                              )
                              .map((check) => (
                                <li key={check.id}>
                                  {check.name}: {nativeExpressionDisplay(check.expression, doc)}
                                </li>
                              ))}
                          </ul>
                          <h3>ENUM</h3>
                          <ul>
                            {(doc.enums ?? []).map((item) => (
                              <li key={item.id}>
                                {item.schema ? `${item.schema}.` : ''}
                                {item.name}:{' '}
                                {item.values.map((value) => JSON.stringify(value)).join(', ')}
                              </li>
                            ))}
                          </ul>
                        </PanelSection>
                      </>
                    )}
                    {editable && selectedTable && (
                      <Button
                        variant="danger"
                        disabled={editorBusy}
                        className="danger"
                        onClick={() =>
                          setCreateRequest((previous) => ({
                            action: 'delete',
                            target: JSON.stringify(['tables', selectedTable.id]),
                            nonce: (previous?.nonce ?? 0) + 1,
                          }))
                        }
                      >
                        {t('테이블 삭제')}
                      </Button>
                    )}
                    {snapshot.native.status === 'available' &&
                      snapshot.native.issues.length > 0 && (
                        <section className="native-issues" aria-label={t('설계 확인 항목')}>
                          <h3>{t('설계 확인 항목')}</h3>
                          <ul>
                            {snapshot.native.issues.map((issue, index) => (
                              <li key={`${issue.code}-${index}`}>
                                <button type="button" onClick={() => focusIssue(issue.objectId)}>
                                  {issue.objectId &&
                                  doc.tables?.some((table) => table.id === issue.objectId)
                                    ? `${tableName(issue.objectId)}: `
                                    : ''}
                                  {t(
                                    issue.code.startsWith('legacy.')
                                      ? '기존 타입 또는 기본값을 확인해 주세요.'
                                      : issue.category === 'incomplete'
                                        ? '물리 설계를 완성해 주세요.'
                                        : issue.category === 'unsupported'
                                          ? '지원하지 않는 설정입니다.'
                                          : '설정이나 연결 대상을 확인해 주세요.',
                                  )}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                  </section>
                </div>
              </aside>
            </div>
            {userId && reviewDocument && (
              <div
                data-open={commentsOpen}
                data-resizing={commentsResizing}
                aria-hidden={!commentsOpen}
                inert={!commentsOpen}
                className="comments-container"
                style={{ '--comments-panel-width': `${commentsWidth}px` } as CSSProperties}
              >
                {commentsOpen && (
                  <PinPanelResizer
                    width={commentsWidth}
                    onWidthChange={setCommentsWidth}
                    onResizingChange={setCommentsResizing}
                  />
                )}
                <CommentsPanel
                  key={`${userId}:${snapshot.project.id}`}
                  readOnly={!canPersonalEdit || snapshot.project.status !== 'active'}
                  workspaceId={snapshot.project.workspaceId}
                  projectId={snapshot.project.id}
                  userId={userId}
                  document={reviewDocument}
                  context={reviewContext}
                  activeThreadId={reviewFocus?.id ?? null}
                  onThreads={setThreads}
                  onMembers={setMembers}
                  onNavigate={focusThread}
                  onClose={() => {
                    setCommentsOpen(false);
                    setDraftPin(null);
                    setPinMode(false);
                  }}
                  onCancelPinDraft={() => setDraftPin(null)}
                  {...(draftPin ? { draftTarget: draftPin } : {})}
                />
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
