import { useEffect, useRef, useState } from 'react';
import {
  nativeDomainCommandSchema,
  type NativeDomainCommand,
  type ProjectDocumentState,
} from '@ezerd/contracts';
import {
  addNativeDomain,
  updateNativeDomain,
  moveNativeTableDomain,
  planNativeDomainDeletion,
  requestFingerprint,
  type NativeDesignDocument,
  type NativeDomainDeletionPlan,
} from '@ezerd/model';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import {
  NativeEditorField,
  NativeEditorForm,
  type NativeEditorContext,
  type NativeEditorSave,
} from './native-editor-form.js';
import { loadNativeEditorDraft } from './native-editor-draft.js';
import { nativeDurableId } from './native-durable-queue.js';

registerTranslations({
  '도메인 관리': 'Manage domains',
  '도메인 생성': 'Create domain',
  '도메인 수정': 'Edit domain',
  '도메인 삭제': 'Delete domain',
  '테이블 소속 이동': 'Move table ownership',
  '선택한 도메인': 'Selected domain',
  '삭제 정책': 'Deletion policy',
  '비어 있는 도메인만 삭제': 'Delete only if empty',
  '테이블을 이동한 뒤 삭제': 'Move tables before deletion',
  '소속 테이블도 삭제': 'Delete owned tables too',
  '이동할 도메인': 'Destination domain',
  색상: 'Color',
  '색상 없음': 'No color',
  설명: 'Description',
  '생성 컬럼 연쇄 삭제': 'Cascade deletion to generated columns',
  '삭제 영향을 확인했습니다.': 'I reviewed the deletion impact.',
  '이동 영향을 확인했습니다.': 'I reviewed the move impact.',
  '이동할 테이블': 'Table to move',
  '삭제 영향': 'Deletion impact',
  '도메인이 없습니다.': 'There are no domains.',
  '도메인을 선택해 주세요.': 'Select a domain.',
  '이 도메인에 테이블이 있습니다. 이동 또는 삭제 정책을 선택해 주세요.':
    'This domain owns tables. Choose a move or deletion policy.',
  '도메인이나 이동 대상을 확인해 주세요.': 'Review the domain or destination.',
  '삭제 대상 컬럼을 사용하는 식이 남아 있습니다.':
    'Expressions still reference columns being deleted.',
  '이 삭제로 필요한 키 또는 생성 규칙이 사라집니다.':
    'This deletion removes a required key or generation rule.',
  '삭제 차단 항목': 'Deletion blockers',
  '삭제 영향을 확인한 뒤 저장해 주세요.': 'Review and confirm the deletion impact before saving.',
  '이동 영향을 확인한 뒤 저장해 주세요.': 'Review and confirm the move impact before saving.',
  '테이블의 타입·기본값·생성 규칙과 FK는 유지됩니다.':
    'Column types, defaults, generation rules and foreign keys are preserved.',
  '현재 화면에서 확인한 참조 정리 영향입니다.':
    'Reference cleanup shown here covers the current view.',
  배치: 'Placement',
  '화면 위치': 'Camera',
  '도메인 연결': 'Domain relationship',
  확인: 'Confirm',
});
export type NativeDomainAction = 'create' | 'edit' | 'delete' | 'move';
const scopeExpected = (snapshot: ProjectDocumentState) => ({
  version: snapshot.project.version,
  sequence: snapshot.sequence,
  databaseRevision: snapshot.project.databaseRevision,
});

export function nativeDomainReviewToken(
  snapshot: ProjectDocumentState,
  action: 'delete' | 'move',
  id: string,
  values: Record<string, string>,
) {
  return requestFingerprint({
    expected: scopeExpected(snapshot),
    action,
    id,
    policy: values.policy ?? '',
    targetDomainId: values.targetDomainId ?? '',
    cascade: values.cascade === 'true',
  });
}
function removalPolicy(values: Record<string, string>) {
  if (!['rejectNonempty', 'moveTables', 'deleteTables'].includes(values.policy ?? ''))
    throw new Error('domain.removal-policy-invalid');
  const command = nativeDomainCommandSchema.parse({
    type: 'delete_domain',
    id: 'preview',
    policy:
      values.policy === 'moveTables'
        ? { kind: 'moveTables', targetDomainId: values.targetDomainId || null }
        : values.policy === 'deleteTables'
          ? { kind: 'deleteTables', cascadeGeneratedColumns: values.cascade === 'true' }
          : { kind: 'rejectNonempty' },
  });
  if (command.type !== 'delete_domain') throw new Error('domain.removal-policy-invalid');
  return command.policy;
}
export function nativeDomainDeletionPreview(
  document: NativeDesignDocument,
  domainId: string,
  values: Record<string, string>,
): { plan: NativeDomainDeletionPlan | null; code: string | null } {
  try {
    const plan = planNativeDomainDeletion(document, domainId, removalPolicy(values));
    return { plan, code: plan.deletion?.blockers[0]?.code ?? null };
  } catch (error) {
    return {
      plan: null,
      code: error instanceof Error ? error.message : 'domain.removal-policy-invalid',
    };
  }
}
/** Preflight uses the same native model helpers as the server, without normalizing physical data. */
export function nativeDomainUICommands(
  document: NativeDesignDocument,
  snapshot: ProjectDocumentState,
  action: NativeDomainAction,
  id: string,
  values: Record<string, string>,
  before: Record<string, string>,
): NativeDomainCommand[] {
  let command: NativeDomainCommand;
  if (action === 'create') {
    command = nativeDomainCommandSchema.parse({
      type: 'add_domain',
      value: {
        id: values.id,
        name: values.name,
        description: values.description,
        ...(values.color ? { color: values.color } : {}),
      },
      nodeId: values.nodeId,
      placement: { x: Number(values.x), y: Number(values.y) },
    });
    if (command.type !== 'add_domain') return [];
    addNativeDomain(document, command.value, command.placement, {
      ...(command.nodeId ? { nodeId: command.nodeId } : {}),
    });
  } else if (action === 'edit') {
    const patch = {
      ...(values.name !== before.name ? { name: values.name } : {}),
      ...(values.description !== before.description ? { description: values.description } : {}),
      ...(values.color !== before.color ? { color: values.color || null } : {}),
    };
    if (!Object.keys(patch).length) return [];
    command = nativeDomainCommandSchema.parse({ type: 'patch_domain', id, patch });
    if (command.type !== 'patch_domain') return [];
    updateNativeDomain(document, id, command.patch);
  } else if (action === 'delete') {
    const preview = nativeDomainDeletionPreview(document, id, values);
    if (preview.code || !preview.plan)
      throw new Error(preview.code ?? 'domain.removal-policy-invalid');
    if (values.reviewToken !== nativeDomainReviewToken(snapshot, action, id, values))
      throw new Error('domain.review-required');
    command = nativeDomainCommandSchema.parse({
      type: 'delete_domain',
      id,
      policy: removalPolicy(values),
    });
  } else {
    const table = document.tables?.find((table) => table.id === id);
    if (!table) throw new Error('document.table-not-found');
    const target = values.targetDomainId || null;
    if (table.domainId === target) return [];
    moveNativeTableDomain(document, id, target);
    if (values.reviewToken !== nativeDomainReviewToken(snapshot, action, id, values))
      throw new Error('domain.move-review-required');
    command = nativeDomainCommandSchema.parse({
      type: 'move_table_domain',
      tableId: id,
      targetDomainId: target,
    });
  }
  return [command];
}

const domainLabel = (document: NativeDesignDocument, id: string | null) =>
  id === null
    ? '미소속'
    : id === '__tables__'
      ? '공유 캔버스'
      : id === 'overview'
        ? '도메인 개요'
        : document.domains.find((domain) => domain.id === id)?.name ||
          document.views?.find((view) => view.id === id)?.name ||
          id;
const tableLabel = (document: NativeDesignDocument, id: string) => {
  const table = document.tables?.find((table) => table.id === id);
  return table?.physical.name || table?.logical.name || id;
};
function objectLabel(document: NativeDesignDocument, collection: string, id: string): string {
  if (collection === 'tables') return tableLabel(document, id);
  if (collection === 'columns') {
    const column = document.columns?.find((column) => column.id === id);
    return column?.physical.name || column?.logical.name || id;
  }
  if (collection === 'tableRelations') {
    const relation = document.tableRelations?.find((relation) => relation.id === id);
    return relation?.physical?.name || relation?.logical.name || id;
  }
  if (collection === 'notes')
    return document.notes.find((note) => note.id === id)?.text.slice(0, 80) || id;
  if (collection === 'views') return document.views?.find((view) => view.id === id)?.name || id;
  for (const key of ['keys', 'indexes', 'checks', 'enums', 'domainRelations'] as const) {
    const item = document[key]?.find((item) => item.id === id);
    if (item) return item.name || id;
  }
  return id;
}
function canvasObjectLabel(document: NativeDesignDocument, id: string) {
  if (document.domains.some((domain) => domain.id === id)) return domainLabel(document, id);
  if (document.notes.some((note) => note.id === id)) return objectLabel(document, 'notes', id);
  return tableLabel(document, id);
}
function blockerText(code: string) {
  return code === 'domain.not-empty'
    ? '이 도메인에 테이블이 있습니다. 이동 또는 삭제 정책을 선택해 주세요.'
    : code === 'deletion.expression-dependent'
      ? '삭제 대상 컬럼을 사용하는 식이 남아 있습니다.'
      : code.startsWith('deletion.')
        ? '이 삭제로 필요한 키 또는 생성 규칙이 사라집니다.'
        : '도메인이나 이동 대상을 확인해 주세요.';
}

export function NativeDomainEditor({
  document,
  snapshot,
  userId,
  editable,
  busy,
  onSave,
  selectedDomainId,
  selectedTableId,
  onSelectDomain,
}: {
  document: NativeDesignDocument;
  snapshot: ProjectDocumentState;
  userId?: string;
  editable: boolean;
  busy: boolean;
  onSave: NativeEditorSave;
  selectedDomainId?: string;
  selectedTableId?: string;
  onSelectDomain?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [action, setAction] = useState<NativeDomainAction>(selectedDomainId ? 'edit' : 'create');
  const [targetDomain, setTargetDomain] = useState(
    selectedDomainId ?? document.domains[0]?.id ?? '',
  );
  const [targetTable, setTargetTable] = useState(selectedTableId ?? document.tables?.[0]?.id ?? '');
  const [open, setOpen] = useState(!!selectedDomainId);
  const editor = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    if (selectedDomainId) {
      setTargetDomain(selectedDomainId);
      setAction((current) => (current === 'delete' ? current : 'edit'));
      setOpen(true);
      editor.current?.querySelector('summary')?.focus();
      editor.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedDomainId]);
  useEffect(() => {
    if (selectedTableId) setTargetTable(selectedTableId);
  }, [selectedTableId]);
  const canWrite =
    !!userId &&
    editable &&
    snapshot.project.status === 'active' &&
    snapshot.sourceDocument.schemaVersion === 2;
  const target = document.domains.find((domain) => domain.id === targetDomain);
  const table = document.tables?.find((table) => table.id === targetTable);
  const formKey = `${userId}:${snapshot.project.id}:${action}:${action === 'move' ? targetTable : action === 'create' ? 'project' : targetDomain}:${snapshot.project.version}:${snapshot.sequence}:${snapshot.project.databaseRevision}`;
  return (
    <details
      className="native-property-editor"
      ref={editor}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      aria-label={t('도메인 관리')}
    >
      <summary>{t('도메인 관리')}</summary>
      {!canWrite ? (
        <>
          <p>{t('조회 전용')}</p>
          {!document.domains.length && <p>{t('도메인이 없습니다.')}</p>}
          <ul>
            {document.domains.map((domain) => (
              <li key={domain.id}>
                {domain.name}: {domain.description}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <NativeEditorField
            label="작업"
            value={action}
            disabled={busy}
            onChange={(value) => setAction(value as NativeDomainAction)}
            choices={[
              { value: 'create', label: t('도메인 생성') },
              { value: 'edit', label: t('도메인 수정'), disabled: !document.domains.length },
              { value: 'delete', label: t('도메인 삭제'), disabled: !document.domains.length },
              { value: 'move', label: t('테이블 소속 이동'), disabled: !document.tables?.length },
            ]}
          />
          {['edit', 'delete'].includes(action) && (
            <NativeEditorField
              label="선택한 도메인"
              value={targetDomain}
              disabled={busy}
              onChange={(id) => {
                setTargetDomain(id);
                onSelectDomain?.(id);
              }}
              choices={[
                { value: '', label: '—' },
                ...document.domains.map((domain) => ({
                  value: domain.id,
                  label: domain.name || domain.id,
                })),
              ]}
            />
          )}
          {action === 'move' && (
            <NativeEditorField
              label="이동할 테이블"
              value={targetTable}
              disabled={busy}
              onChange={setTargetTable}
              choices={[
                { value: '', label: '—' },
                ...(document.tables ?? []).map((table) => ({
                  value: table.id,
                  label: tableLabel(document, table.id),
                })),
              ]}
            />
          )}
          {action === 'create' || (action === 'move' ? table : target) ? (
            <NativeDomainForm
              key={formKey}
              document={document}
              action={action}
              id={action === 'move' ? targetTable : targetDomain}
              context={{ userId: userId!, snapshot, busy, onSave }}
            />
          ) : (
            <p>{t('도메인을 선택해 주세요.')}</p>
          )}
        </>
      )}
    </details>
  );
}

function NativeDomainForm({
  context,
  document,
  action,
  id,
}: {
  context: NativeEditorContext;
  document: NativeDesignDocument;
  action: NativeDomainAction;
  id: string;
}) {
  const { t } = useI18n();
  const key = action === 'create' ? 'create:domain:project' : `${action}:domain:${id}`;
  const [seeds] = useState(() => {
    try {
      const draft =
        action === 'create'
          ? loadNativeEditorDraft(context.userId, context.snapshot.project.id, key)
          : null;
      return {
        id: draft?.values.id ?? nativeDurableId(),
        nodeId: draft?.values.nodeId ?? nativeDurableId(),
      };
    } catch {
      return { id: nativeDurableId(), nodeId: nativeDurableId() };
    }
  });
  const domain = document.domains.find((domain) => domain.id === id);
  const table = document.tables?.find((table) => table.id === id);
  const initial = {
    id: action === 'create' ? seeds.id : id,
    nodeId: action === 'create' ? seeds.nodeId : '',
    name: domain?.name ?? '',
    description: domain?.description ?? '',
    color: domain?.color ?? '',
    x: '40',
    y: '40',
    policy: 'rejectNonempty',
    targetDomainId: action === 'move' ? (table?.domainId ?? '') : '',
    cascade: 'false',
    reviewToken: '',
  };
  const title = {
    create: '도메인 생성',
    edit: '도메인 수정',
    delete: '도메인 삭제',
    move: '테이블 소속 이동',
  }[action];
  return (
    <NativeEditorForm
      context={context}
      title={t(title)}
      draftKey={key}
      initial={initial}
      build={(values, before) => {
        try {
          return nativeDomainUICommands(document, context.snapshot, action, id, values, before);
        } catch (error) {
          const code = error instanceof Error ? error.message : '';
          throw new Error(
            t(
              code === 'domain.review-required'
                ? '삭제 영향을 확인한 뒤 저장해 주세요.'
                : code === 'domain.move-review-required'
                  ? '이동 영향을 확인한 뒤 저장해 주세요.'
                  : blockerText(code),
            ),
          );
        }
      }}
    >
      {(values, change) => {
        const preview =
          action === 'delete' ? nativeDomainDeletionPreview(document, id, values) : null;
        let move: NativeDesignDocument | null = null,
          moveCode: string | null = null;
        if (action === 'move') {
          try {
            move = moveNativeTableDomain(document, id, values.targetDomainId || null);
          } catch (error) {
            moveCode = error instanceof Error ? error.message : 'domain.target-not-found';
          }
        }
        const field = (key: string, label: string, multiline = false) => (
          <NativeEditorField
            label={label}
            value={values[key] ?? ''}
            multiline={multiline}
            onChange={(value) => change(key, value)}
          />
        );
        const targetChoices = [
          { value: '', label: t('미소속') },
          ...document.domains
            .filter((domain) => action !== 'delete' || domain.id !== id)
            .map((domain) => ({ value: domain.id, label: domain.name || domain.id })),
        ];
        const token = ['delete', 'move'].includes(action)
          ? nativeDomainReviewToken(context.snapshot, action as 'delete' | 'move', id, values)
          : '';
        return (
          <>
            {['create', 'edit'].includes(action) && (
              <>
                {field('name', '이름')}
                {field('description', '설명', true)}
                {field('color', '색상')}
                <small>{t('색상 없음')}: —</small>
              </>
            )}
            {action === 'create' && (
              <>
                <NativeEditorField
                  label="X"
                  type="number"
                  value={values.x ?? '40'}
                  onChange={(value) => change('x', value)}
                />
                <NativeEditorField
                  label="Y"
                  type="number"
                  value={values.y ?? '40'}
                  onChange={(value) => change('y', value)}
                />
              </>
            )}
            {action === 'delete' && (
              <>
                <NativeEditorField
                  label="삭제 정책"
                  value={values.policy ?? 'rejectNonempty'}
                  onChange={(value) => {
                    change('policy', value);
                    change('reviewToken', '');
                  }}
                  choices={[
                    { value: 'rejectNonempty', label: t('비어 있는 도메인만 삭제') },
                    { value: 'moveTables', label: t('테이블을 이동한 뒤 삭제') },
                    { value: 'deleteTables', label: t('소속 테이블도 삭제') },
                  ]}
                />
                {values.policy === 'moveTables' && (
                  <NativeEditorField
                    label="이동할 도메인"
                    value={values.targetDomainId ?? ''}
                    choices={targetChoices}
                    onChange={(value) => {
                      change('targetDomainId', value);
                      change('reviewToken', '');
                    }}
                  />
                )}
                {values.policy === 'deleteTables' && (
                  <label>
                    <input
                      type="checkbox"
                      checked={values.cascade === 'true'}
                      onChange={(event) => {
                        change('cascade', String(event.target.checked));
                        change('reviewToken', '');
                      }}
                    />
                    {t('생성 컬럼 연쇄 삭제')}
                  </label>
                )}
                <NativeDomainDeletionImpact document={document} domainId={id} values={values} />
                <label>
                  <input
                    type="checkbox"
                    checked={values.reviewToken === token}
                    disabled={!!preview?.code || !preview?.plan}
                    onChange={(event) => change('reviewToken', event.target.checked ? token : '')}
                  />
                  {t('삭제 영향을 확인했습니다.')}
                </label>
              </>
            )}
            {action === 'move' && (
              <>
                <NativeEditorField
                  label="이동할 도메인"
                  value={values.targetDomainId ?? ''}
                  choices={targetChoices}
                  onChange={(value) => {
                    change('targetDomainId', value);
                    change('reviewToken', '');
                  }}
                />
                <p>
                  {tableLabel(document, id)}: {t(domainLabel(document, table?.domainId ?? null))} →{' '}
                  {t(domainLabel(document, values.targetDomainId || null))}
                </p>
                <p>{t('테이블의 타입·기본값·생성 규칙과 FK는 유지됩니다.')}</p>
                {moveCode && <p role="alert">{t(blockerText(moveCode))}</p>}
                {move && (
                  <ul>
                    {document.layout.nodes
                      .filter(
                        (node) => !move!.layout.nodes.some((current) => current.id === node.id),
                      )
                      .map((node) => (
                        <li key={node.id}>
                          {t('배치')}: {canvasObjectLabel(document, node.objectId)} (
                          {t(domainLabel(document, node.viewId))})
                        </li>
                      ))}
                  </ul>
                )}
                {move && (
                  <ul>
                    {(document.layout.relations ?? [])
                      .filter(
                        (route) =>
                          !(move!.layout.relations ?? []).some(
                            (current) =>
                              current.relationId === route.relationId &&
                              current.viewId === route.viewId,
                          ),
                      )
                      .map((route) => (
                        <li key={`${route.viewId}:${route.relationId}`}>
                          {t('외래 키')}:{' '}
                          {objectLabel(document, 'tableRelations', route.relationId)} (
                          {t(domainLabel(document, route.viewId))})
                        </li>
                      ))}
                  </ul>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={values.reviewToken === token}
                    disabled={
                      !!moveCode || !move || table?.domainId === (values.targetDomainId || null)
                    }
                    onChange={(event) => change('reviewToken', event.target.checked ? token : '')}
                  />
                  {t('이동 영향을 확인했습니다.')}
                </label>
              </>
            )}
          </>
        );
      }}
    </NativeEditorForm>
  );
}

export function NativeDomainDeletionImpact({
  document,
  domainId,
  values,
}: {
  document: NativeDesignDocument;
  domainId: string;
  values: Record<string, string>;
}) {
  const { t } = useI18n();
  const { plan, code } = nativeDomainDeletionPreview(document, domainId, values);
  const names: Record<string, string> = {
    tables: '테이블',
    columns: '컬럼',
    keys: '키',
    tableRelations: '외래 키',
    indexes: '인덱스',
    checks: 'CHECK',
    enums: 'ENUM',
  };
  return (
    <section aria-label={t('삭제 영향')}>
      <h4>
        {t('삭제 영향')}: {domainLabel(document, domainId)}
      </h4>
      {code && <p role="alert">{t(blockerText(code))}</p>}
      <ul>
        {(document.tables ?? [])
          .filter((table) => table.domainId === domainId)
          .map((table) => (
            <li key={table.id}>
              {t('테이블')}: {tableLabel(document, table.id)}{' '}
              {values.policy === 'moveTables'
                ? `→ ${t(domainLabel(document, values.targetDomainId || null))}`
                : values.policy === 'deleteTables'
                  ? t('소속 테이블도 삭제')
                  : ''}
            </li>
          ))}
      </ul>
      {plan && (
        <>
          <ul>
            {plan.deletion?.removed.map((item) => (
              <li key={`${item.collection}:${item.id}`}>
                {t(names[item.collection] ?? item.collection)}:{' '}
                {objectLabel(document, item.collection, item.id)}
              </li>
            ))}
            {plan.removedDomainRelationIds.map((id) => (
              <li key={`dr:${id}`}>
                {t('도메인 연결')}: {objectLabel(document, 'domainRelations', id)}
              </li>
            ))}
            {plan.deletion?.cascadedColumnIds.map((id) => (
              <li key={`cascade:${id}`}>
                {t('생성 컬럼 연쇄 삭제')}: {objectLabel(document, 'columns', id)}
              </li>
            ))}
            {plan.removedNoteIds.map((id) => (
              <li key={`note:${id}`}>
                {t('메모')}: {objectLabel(document, 'notes', id)}
              </li>
            ))}
            {plan.removedViewIds.map((id) => (
              <li key={`view:${id}`}>
                {t('개인 화면')}: {objectLabel(document, 'views', id)}
              </li>
            ))}
            {plan.removedNodeIds.map((id) => {
              const node = document.layout.nodes.find((node) => node.id === id)!;
              return (
                <li key={`node:${id}`}>
                  {t('배치')}: {canvasObjectLabel(document, node.objectId)} (
                  {t(domainLabel(document, node.viewId))})
                </li>
              );
            })}
            {plan.removedViewportViewIds.map((id) => (
              <li key={`vp:${id}`}>
                {t('화면 위치')}: {t(domainLabel(document, id))}
              </li>
            ))}
            {plan.removedRelationLayouts.map((route) => (
              <li key={`route:${route.viewId}:${route.relationId}`}>
                {t('외래 키')}: {objectLabel(document, 'tableRelations', route.relationId)} (
                {t(domainLabel(document, route.viewId))})
              </li>
            ))}
          </ul>
          {!!plan.deletion?.blockers.length && (
            <>
              <h4>{t('삭제 차단 항목')}</h4>
              <ul>
                {plan.deletion.blockers.map((blocker, index) => (
                  <li key={index}>
                    {objectLabel(document, 'columns', blocker.objectId)}:{' '}
                    {t(blockerText(blocker.code))}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <p>{t('현재 화면에서 확인한 참조 정리 영향입니다.')}</p>
    </section>
  );
}
