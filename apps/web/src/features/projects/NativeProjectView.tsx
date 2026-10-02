import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProjectEntry } from './project-entry.js';
import type { Thread } from '@ezerd/contracts';
import {
  getDatabaseProfile,
  nativeColumnTypeDisplay,
  nativeDefaultDisplay,
  nativeExpressionDisplay,
  nativeGenerationDisplay,
} from '@ezerd/model';
import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import './native-project-view.css';
import { NativePropertyEditor } from './NativePropertyEditor.js';
import { NativeStructureEditor } from './native-editor-structure.js';
import { NativeERDCanvas } from './NativeERDCanvas.js';
import { NativeDomainEditor } from './NativeDomainEditor.js';
import { useNativeDurableState } from './native-export-state.js';
import { NativeHistoryDialog } from './NativeHistoryDialog.js';
import type { NativeEditorDraftRef } from './native-editor-draft.js';
import {
  loadNativePending,
  stageNativeSave,
  sendNativePending,
  recoverNativePending,
  discardNativePending,
  type NativePendingSave,
  type NativeWebCommand,
  type NativeSaveExpected,
} from './native-save.js';
import { message, request } from '../../shared/api/client.js';

registerTranslations({
  '설계 조회': 'Design overview',
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
  projectActions,
}: {
  entry: Extract<ProjectEntry, { kind: 'native' }>;
  onLeave: () => void;
  onReload: () => void;
  busy?: boolean;
  focusedReview?: Thread;
  userId?: string;
  canEdit?: boolean;
  projectActions?: (focus: (id: string) => void) => ReactNode;
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
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [pending, setPending] = useState<NativePendingSave | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingBlocked, setPendingBlocked] = useState(!!userId);
  const [saveError, setSaveError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const durableState = useNativeDurableState(userId ?? '', snapshot.project.id);
  const queueBlocked = !!userId && durableState !== 'empty';
  const editorBusy = saving || busy || !!pending || pendingBlocked || queueBlocked;
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
      const result = await sendNativePending(staged);
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
      await discardNativePending(userId, snapshot.project.id, pending.request.operationId);
      const remaining = await loadNativePending(userId, snapshot.project.id);
      if (currentEditor()) {
        setPending(remaining);
        setPendingBlocked(false);
        setSaveError('');
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
  const tables = (doc?.tables ?? []).filter(
    (table) =>
      visible(table.scope) &&
      (domain === '*' || (domain === '' ? table.domainId === null : table.domainId === domain)) &&
      `${table.logical.name} ${table.physical.name}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const selectedTable = tables.find((table) => table.id === selected) ?? tables[0];
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
    doc?.columns?.find((column) => column.id === id)?.physical.name ||
    doc?.columns?.find((column) => column.id === id)?.logical.name ||
    id;
  function focusIssue(id: string | null) {
    if (!doc || !id) return;
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
  const options = selectedTable?.physical.options;
  useEffect(() => {
    if (focusedReview) focusIssue(focusedReview.objectId);
  }, [focusedReview?.id]);
  return (
    <main id="main" className="editor native-project-view">
      <div className="editor-heading">
        <div className="project-title">
          <Button className="gallery-return" onClick={onLeave}>
            {t('← 갤러리')}
          </Button>
          <h1>{snapshot.project.name}</h1>
        </div>
        <div className="native-project-status">
          <span>
            {snapshot.project.databaseKind === 'postgresql'
              ? 'PostgreSQL'
              : snapshot.project.databaseKind === 'mysql'
                ? 'MySQL'
                : 'SQLite'}
          </span>
          <span>
            {t('목표 DB 버전')}: {profile.targetVersion}
          </span>
          <span>{t(editable ? '편집 가능' : '조회 전용')}</span>
          {projectActions?.(focusIssue)}
          {userId && (
            <Button onClick={() => setHistoryOpen(true)} disabled={saving || busy}>
              {t('설계 이력')}
            </Button>
          )}
          <Button onClick={onReload} disabled={busy}>
            {t('다시 불러오기')}
          </Button>
        </div>
      </div>
      {historyOpen && userId && (
        <NativeHistoryDialog
          key={`history:${userId}:${snapshot.project.id}`}
          userId={userId}
          snapshot={snapshot}
          canEdit={editable}
          onClose={() => setHistoryOpen(false)}
          onReload={onReload}
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
            {t('요청 초기화')}
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
          <NativeERDCanvas
            key={`${userId ?? ''}:${snapshot.project.id}`}
            document={doc}
            snapshot={snapshot}
            {...(userId ? { userId } : {})}
            editable={editable}
            busy={editorBusy}
            onSave={save}
            onReload={onReload}
            mode={mode}
            {...(selectedTable ? { selectedTableId: selectedTable.id } : {})}
            {...(selectedDomain ? { selectedDomainId: selectedDomain } : {})}
            onSelectDomain={setSelectedDomain}
            onSelect={(tableId, columnId) => {
              setSelectedDomain(null);
              setSelected(tableId);
              setEditingColumn(columnId ?? null);
              setDomain('*');
              setSearch('');
            }}
          />
          <NativeDomainEditor
            key={`domains:${userId ?? ''}:${snapshot.project.id}`}
            document={doc}
            snapshot={snapshot}
            {...(userId ? { userId } : {})}
            editable={editable}
            busy={editorBusy}
            onSave={save}
            {...(selectedDomain ? { selectedDomainId: selectedDomain } : {})}
            {...(selectedTable ? { selectedTableId: selectedTable.id } : {})}
            onSelectDomain={setSelectedDomain}
          />
          <div className="native-project-content" aria-label={t('설계 조회')}>
            <aside className="native-table-nav">
              <label>
                {t('테이블 검색')}
                <input value={search} onChange={(event) => setSearch(event.target.value)} />
              </label>
              <select
                aria-label={t('전체 도메인')}
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
              >
                <option value="*">{t('전체 도메인')}</option>
                <option value="">{t('미소속')}</option>
                {doc.domains.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <div className="native-mode">
                <Button aria-pressed={mode === 'physical'} onClick={() => setMode('physical')}>
                  {t('물리')}
                </Button>
                <Button aria-pressed={mode === 'logical'} onClick={() => setMode('logical')}>
                  {t('논리')}
                </Button>
              </div>
              <ul>
                {tables.map((table) => (
                  <li key={table.id}>
                    <button
                      type="button"
                      data-object-id={table.id}
                      aria-current={selectedTable?.id === table.id ? 'true' : undefined}
                      onClick={() => {
                        setSelected(table.id);
                        setSelectedDomain(null);
                      }}
                    >
                      {tableName(table.id)}
                    </button>
                  </li>
                ))}
              </ul>
              {!tables.length && <p>{t('선택한 범위에 테이블이 없습니다.')}</p>}
            </aside>
            <section className="native-table-detail" aria-live="polite">
              {editable && (
                <NativeStructureEditor
                  key={`${userId}:${snapshot.project.id}`}
                  context={{
                    userId: userId!,
                    snapshot,
                    busy: editorBusy,
                    onSave: save,
                  }}
                  document={doc}
                  {...(selectedTable ? { table: selectedTable } : {})}
                />
              )}
              {focusedReview && (
                <section aria-label={t('리뷰')}>
                  <h3>{t('리뷰')}</h3>
                  {focusedReview.messages.map((item) => (
                    <p key={item.id}>{item.body}</p>
                  ))}
                </section>
              )}
              {selectedTable && (
                <>
                  <h2>{tableName(selectedTable.id)}</h2>
                  {editable && (
                    <>
                      <label>
                        {t('속성 편집')}
                        <select
                          value={editingColumn ?? ''}
                          onChange={(event) => setEditingColumn(event.target.value || null)}
                        >
                          <option value="">{t('테이블')}</option>
                          {(doc.columns ?? [])
                            .filter((column) => column.tableId === selectedTable.id)
                            .map((column) => (
                              <option key={column.id} value={column.id}>
                                {column.physical.name || column.logical.name || column.id}
                              </option>
                            ))}
                        </select>
                      </label>
                      <NativePropertyEditor
                        key={`${userId}:${snapshot.project.id}:${selectedTable.id}:${editingColumn ?? ''}:${snapshot.project.version}:${snapshot.sequence}:${snapshot.project.databaseRevision}`}
                        table={selectedTable}
                        userId={userId!}
                        snapshot={snapshot}
                        {...(editingColumn &&
                        doc.columns?.find(
                          (column) =>
                            column.id === editingColumn && column.tableId === selectedTable.id,
                        )
                          ? {
                              column: doc.columns.find(
                                (column) =>
                                  column.id === editingColumn &&
                                  column.tableId === selectedTable.id,
                              )!,
                            }
                          : {})}
                        busy={editorBusy}
                        onSave={save}
                      />
                    </>
                  )}
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
                          (column) => column.tableId === selectedTable.id && visible(column.scope),
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
                                ? nativeColumnTypeDisplay(column.physical.type, doc.enums) ||
                                  t('타입 없음')
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
                                <td>{nativeDefaultDisplay(column.physical.defaultValue, doc)}</td>
                                <td>{nativeGenerationDisplay(column.physical.generation, doc)}</td>
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
                    {Object.entries(selectedTable.customProperties.common).map(([key, value]) => (
                      <p key={`common-${key}`}>
                        {key}: {value}
                      </p>
                    ))}
                    {Object.entries(selectedTable.customProperties[mode]).map(([key, value]) => (
                      <p key={key}>
                        {key}: {value}
                      </p>
                    ))}
                  </details>
                  <h3>{t('키')}</h3>
                  <ul>
                    {(doc.keys ?? [])
                      .filter((key) => key.tableId === selectedTable.id && visible(key.scope))
                      .map((key) => (
                        <li key={key.id}>
                          {key.kind === 'primary' ? 'PK' : 'UNIQUE'} {key.name} (
                          {key.columnIds.map(columnName).join(', ')})
                          {key.deferrable ? ` DEFERRABLE ${key.deferrable.initially}` : ''}
                          {key.nullsNotDistinct ? ' NULLS NOT DISTINCT' : ''}
                        </li>
                      ))}
                  </ul>
                  <h3>{t('외래 키')}</h3>
                  <ul>
                    {(doc.tableRelations ?? [])
                      .filter(
                        (relation) =>
                          visible(relation.scope) &&
                          (relation.sourceTableId === selectedTable.id ||
                            relation.targetTableId === selectedTable.id),
                      )
                      .map((relation) => (
                        <li key={relation.id}>
                          {tableName(relation.sourceTableId)} → {tableName(relation.targetTableId)}
                          {mode === 'physical' && relation.physical
                            ? `: ${relation.physical.name} (${relation.physical.sourceColumnIds.map(columnName).join(', ')}) → (${relation.physical.targetColumnIds.map(columnName).join(', ')}) · DELETE ${relation.physical.onDelete} · UPDATE ${relation.physical.onUpdate}`
                            : ` ${relation.logical.name}`}
                          {relation.deferrable
                            ? ` DEFERRABLE ${relation.deferrable.initially}`
                            : ''}
                        </li>
                      ))}
                  </ul>
                  <h3>{t('인덱스')}</h3>
                  <ul>
                    {(doc.indexes ?? [])
                      .filter((index) => index.tableId === selectedTable.id && visible(index.scope))
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
                          {index.options.database === 'postgresql' && index.options.nullsNotDistinct
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
                      .filter((check) => check.tableId === selectedTable.id && visible(check.scope))
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
                        {item.name}: {item.values.map((value) => JSON.stringify(value)).join(', ')}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {snapshot.native.status === 'available' && snapshot.native.issues.length > 0 && (
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
        </>
      )}
    </main>
  );
}
