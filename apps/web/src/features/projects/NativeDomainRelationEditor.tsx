import { PanelSection } from '../../shared/editor/panel.js';
import { useEffect, useRef, useState } from 'react';
import {
  nativeDomainRelationCommandSchema,
  type NativeDomainRelationCommand,
} from '@ezerd/contracts';
import { requestFingerprint, type NativeDesignDocument } from '@ezerd/model';
import {
  NativeEditorField,
  NativeEditorForm,
  type NativeEditorContext,
} from './native-editor-form.js';
import { nativeDurableId } from './native-durable-queue.js';
import { loadNativeEditorDraft } from './native-editor-draft.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { Button, Checkbox } from '../../components/ui/index.js';
registerTranslations({
  '도메인 연결': 'Domain relationships',
  '연결 추가': 'Add relationship',
  '연결 수정': 'Edit relationship',
  '연결 삭제': 'Delete relationship',
  '도메인 관계 수정': 'Edit domain relationship',
  '출발 도메인': 'Source domain',
  '도착 도메인': 'Target domain',
  방향: 'Direction',
  단방향: 'One way',
  양방향: 'Both ways',
  '연결 삭제를 확인했습니다.': 'I reviewed this relationship deletion.',
  '연결할 도메인을 확인해 주세요.': 'Review the relationship domains.',
  '연결 삭제를 확인해 주세요.': 'Confirm the relationship deletion.',
});
export function nativeDomainRelationCommands(
  document: NativeDesignDocument,
  context: NativeEditorContext,
  action: string,
  id: string,
  values: Record<string, string>,
  before: Record<string, string>,
): NativeDomainRelationCommand[] {
  if (action === 'delete') {
    const expected = requestFingerprint({
      id,
      version: context.snapshot.project.version,
      sequence: context.snapshot.sequence,
      databaseRevision: context.snapshot.project.databaseRevision,
    });
    if (values.review !== expected) throw Error('canvas.domain-relation-review-required');
    if (!document.domainRelations.some((relation) => relation.id === id))
      throw Error('canvas.domain-relation-not-found');
    return [nativeDomainRelationCommandSchema.parse({ type: 'delete_domain_relation', id })];
  }
  if (
    !document.domains.some((domain) => domain.id === values.sourceDomainId) ||
    !document.domains.some((domain) => domain.id === values.targetDomainId) ||
    values.sourceDomainId === values.targetDomainId
  )
    throw Error('canvas.domain-relation-endpoint-missing');
  const fields = {
    name: values.name,
    description: values.description,
    direction: values.direction,
    sourceDomainId: values.sourceDomainId,
    targetDomainId: values.targetDomainId,
  };
  if (action === 'create')
    return [
      nativeDomainRelationCommandSchema.parse({
        type: 'add_domain_relation',
        value: { id: values.id, ...fields },
      }),
    ];
  const patch = Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => value !== before[key]),
  );
  return Object.keys(patch).length
    ? [nativeDomainRelationCommandSchema.parse({ type: 'patch_domain_relation', id, patch })]
    : [];
}
export function NativeDomainRelationEditor({
  document,
  context,
  editable,
  selectedId,
  initialAction,
  sourceDomainId,
}: {
  document: NativeDesignDocument;
  context?: NativeEditorContext;
  editable: boolean;
  selectedId?: string;
  initialAction?: 'create' | 'edit' | 'delete';
  sourceDomainId?: string;
}) {
  const { t } = useI18n(),
    [action, setAction] = useState(initialAction ?? (selectedId ? 'edit' : 'create')),
    [target, setTarget] = useState(selectedId ?? document.domainRelations[0]?.id ?? '');
  const [open, setOpen] = useState(!!selectedId || !!initialAction);
  const formHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && (selectedId || initialAction === 'create'))
      formHost.current?.querySelector<HTMLInputElement>('input:not([type="checkbox"])')?.focus();
  }, [open, selectedId, initialAction]);
  useEffect(() => {
    if (selectedId) {
      setTarget(selectedId);
      setAction(initialAction ?? 'edit');
      setOpen(true);
    }
  }, [selectedId, initialAction]);
  const relation = document.domainRelations.find((relation) => relation.id === target),
    choices = document.domains.map((domain) => ({
      value: domain.id,
      label: domain.name || domain.id,
    }));
  return (
    <PanelSection
      className="native-property-editor"
      title={t(
        action === 'create'
          ? '새 도메인 관계'
          : action === 'edit'
            ? '도메인 관계 수정'
            : '연결 삭제',
      )}
      open={open}
      onOpenChange={setOpen}
    >
      {!editable || !context ? (
        <>
          <p>{t('조회 전용')}</p>
          <ul>
            {document.domainRelations
              .filter((relation) => !selectedId || relation.id === selectedId)
              .map((relation) => (
                <li key={relation.id}>
                  {relation.name}:{' '}
                  {document.domains.find((domain) => domain.id === relation.sourceDomainId)?.name}{' '}
                  {relation.direction === 'both' ? '↔' : '→'}{' '}
                  {document.domains.find((domain) => domain.id === relation.targetDomainId)?.name}
                  <p className="native-domain-description">{relation.description || '—'}</p>
                </li>
              ))}
          </ul>
        </>
      ) : (
        <>
          {selectedId || initialAction ? (
            <div className="actions">
              {selectedId && (
                <>
                  <Button disabled={context.busy} onClick={() => setAction('edit')}>
                    {t('연결 수정')}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={context.busy}
                    onClick={() => setAction('delete')}
                  >
                    {t('연결 삭제')}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <NativeEditorField
              label="작업"
              value={action}
              disabled={context.busy}
              choices={[
                { value: 'create', label: t('연결 추가'), disabled: !document.domains.length },
                {
                  value: 'edit',
                  label: t('연결 수정'),
                  disabled: !document.domainRelations.length,
                },
                {
                  value: 'delete',
                  label: t('연결 삭제'),
                  disabled: !document.domainRelations.length,
                },
              ]}
              onChange={(value) => {
                if (value === 'create' || value === 'edit' || value === 'delete') setAction(value);
              }}
            />
          )}
          {action !== 'create' && !selectedId && (
            <NativeEditorField
              label="대상"
              value={target}
              disabled={context.busy}
              choices={document.domainRelations.map((relation) => ({
                value: relation.id,
                label: relation.name || relation.id,
              }))}
              onChange={setTarget}
            />
          )}
          {(action === 'create' ? document.domains.length > 0 : !!relation) && (
            <div ref={formHost}>
              <NativeDomainRelationForm
                key={`${action}:${target}:${context.snapshot.project.version}:${context.snapshot.sequence}:${context.snapshot.project.databaseRevision}`}
                document={document}
                context={context}
                action={action}
                id={target}
                choices={choices}
                {...(sourceDomainId ? { sourceDomainId } : {})}
              />
            </div>
          )}
        </>
      )}
    </PanelSection>
  );
}
function NativeDomainRelationForm({
  document,
  context,
  action,
  id,
  choices,
  sourceDomainId,
}: {
  document: NativeDesignDocument;
  context: NativeEditorContext;
  action: string;
  id: string;
  choices: { value: string; label: string }[];
  sourceDomainId?: string;
}) {
  const { t } = useI18n(),
    key =
      action === 'create'
        ? 'canvas:domain-relation:create'
        : `canvas:domain-relation:${action}:${id}`;
  const [seed] = useState(() => {
    try {
      return action === 'create'
        ? (loadNativeEditorDraft(context.userId, context.snapshot.project.id, key)?.values.id ??
            nativeDurableId())
        : id;
    } catch {
      return nativeDurableId();
    }
  });
  const relation =
    action === 'create'
      ? undefined
      : document.domainRelations.find((relation) => relation.id === id);
  const review = requestFingerprint({
    id,
    version: context.snapshot.project.version,
    sequence: context.snapshot.sequence,
    databaseRevision: context.snapshot.project.databaseRevision,
  });
  return (
    <NativeEditorForm
      context={context}
      title={t(action === 'create' ? '연결 추가' : action === 'edit' ? '연결 수정' : '연결 삭제')}
      draftKey={key}
      initial={{
        id: seed,
        name: relation?.name ?? '',
        description: relation?.description ?? '',
        direction: relation?.direction ?? 'forward',
        sourceDomainId: relation?.sourceDomainId ?? sourceDomainId ?? choices[0]?.value ?? '',
        targetDomainId:
          relation?.targetDomainId ??
          choices.find((item) => item.value !== (sourceDomainId ?? choices[0]?.value))?.value ??
          '',
        review: '',
      }}
      build={(values, before) => {
        try {
          return nativeDomainRelationCommands(document, context, action, id, values, before);
        } catch (error) {
          throw Error(
            t(
              error instanceof Error && error.message === 'canvas.domain-relation-review-required'
                ? '연결 삭제를 확인해 주세요.'
                : '연결할 도메인을 확인해 주세요.',
            ),
          );
        }
      }}
    >
      {(values, change) =>
        action === 'delete' ? (
          <>
            <p>{relation?.name}</p>
            <label>
              <Checkbox
                checked={values.review === review}
                onChange={(event) => change('review', event.target.checked ? review : '')}
              />
              {t('연결 삭제를 확인했습니다.')}
            </label>
          </>
        ) : (
          <>
            <NativeEditorField
              label="이름"
              value={values.name ?? ''}
              onChange={(value) => change('name', value)}
            />
            <NativeEditorField
              label="설명"
              value={values.description ?? ''}
              multiline
              onChange={(value) => change('description', value)}
            />
            <NativeEditorField
              label="출발 도메인"
              value={values.sourceDomainId ?? ''}
              choices={choices}
              onChange={(value) => change('sourceDomainId', value)}
            />
            <NativeEditorField
              label="도착 도메인"
              value={values.targetDomainId ?? ''}
              choices={choices}
              onChange={(value) => change('targetDomainId', value)}
            />
            <NativeEditorField
              label="방향"
              value={values.direction ?? 'forward'}
              choices={[
                { value: 'forward', label: t('단방향') },
                { value: 'both', label: t('양방향') },
              ]}
              onChange={(value) => change('direction', value)}
            />
          </>
        )
      }
    </NativeEditorForm>
  );
}
