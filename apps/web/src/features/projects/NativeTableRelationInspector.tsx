import type { NativeDesignDocument, NativeTableRelation } from '@ezerd/model';
import { useEffect, useRef } from 'react';
import { Button } from '../../components/ui/index.js';
import { PanelSection } from '../../shared/editor/panel.js';
import { useI18n } from '../../shared/i18n/index.js';
import { NativeConstraintForm } from './native-editor-structure.js';
import type { NativeEditorContext } from './native-editor-form.js';

export function NativeTableRelationInspector({
  document,
  relation,
  context,
  onDelete,
  defaultOpen = true,
}: {
  document: NativeDesignDocument;
  relation: NativeTableRelation;
  context?: NativeEditorContext;
  onDelete?: () => void;
  defaultOpen?: boolean;
}) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (context && defaultOpen)
      host.current?.querySelector<HTMLInputElement>('input:not([type="checkbox"])')?.focus();
  }, [relation.id, !!context, defaultOpen]);
  const table = (id: string) =>
    document.tables?.find((item) => item.id === id)?.physical.name ||
    document.tables?.find((item) => item.id === id)?.logical.name ||
    id;
  const column = (id: string) =>
    document.columns?.find((item) => item.id === id)?.physical.name ||
    document.columns?.find((item) => item.id === id)?.logical.name ||
    id;
  const endpoint = (side: 'targetCardinality' | 'sourceCardinality') => {
    const value = relation.logical[side] ?? {
      min: side === 'sourceCardinality' ? 0 : relation.logical.required ? 1 : 0,
      max:
        side === 'sourceCardinality'
          ? relation.logical.cardinality === 'one-to-one'
            ? 1
            : 'many'
          : relation.logical.cardinality === 'many-to-many'
            ? 'many'
            : 1,
    };
    return `${value.min}..${value.max === 'many' ? 'N' : '1'}`;
  };
  return (
    <PanelSection
      title={`${table(relation.targetTableId)} (PK) → ${table(relation.sourceTableId)} (FK) · ${relation.logical.name}`}
      defaultOpen={defaultOpen}
    >
      <div className="table-relation-summary">
        {relation.physical ? (
          relation.physical.targetColumnIds.map((id, index) => (
            <span key={index}>
              {column(id)} → {column(relation.physical!.sourceColumnIds[index] ?? '')}
            </span>
          ))
        ) : (
          <span>{t('물리 FK 없음')}</span>
        )}
      </div>
      {context ? (
        <div ref={host}>
          <NativeConstraintForm
            key={`${relation.id}:${context.snapshot.project.version}:${context.snapshot.sequence}:${context.snapshot.project.databaseRevision}`}
            document={document}
            collection="tableRelations"
            id={relation.id}
            context={context}
          />
        </div>
      ) : (
        <>
          <strong>{relation.logical.name}</strong>
          <p className="native-domain-description">{relation.logical.description || '—'}</p>
          <dl className="native-options">
            <dt>{t('출발 끝점 (PK)')}</dt>
            <dd>{endpoint('targetCardinality')}</dd>
            <dt>{t('대상 끝점 (FK)')}</dt>
            <dd>{endpoint('sourceCardinality')}</dd>
            <dt>{t('관계 필수')}</dt>
            <dd>{t(relation.logical.required ? '필수' : '선택')}</dd>
          </dl>
          {relation.physical && (
            <p>
              {relation.physical.name} · ON DELETE {relation.physical.onDelete} · ON UPDATE{' '}
              {relation.physical.onUpdate}
            </p>
          )}
        </>
      )}
      {onDelete && (
        <Button variant="danger" disabled={context?.busy} onClick={onDelete}>
          {t('관계 삭제')}
        </Button>
      )}
    </PanelSection>
  );
}
