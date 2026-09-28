import { translate as tr, useI18n } from '../../shared/i18n/index.js';
import '../canvas/translations.js';
import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { type DesignDocument, createForeignKeyFromPrimaryKey } from '@ezerd/model';
import { newId } from '../../shared/api/client.js';
import { Button, Input, Select } from '../../components/ui/index.js';
import { PanelNote } from '../../shared/editor/panel.js';
import { applyForeignKeyDraft, type CardinalityChoice } from './foreign-key-draft.js';
import './foreign-key-dialog.css';
export function ForeignKeyDialog({
  document: doc,
  sourceColumnId,
  targetTableId,
  onChange,
  onClose,
}: {
  document: DesignDocument;
  sourceColumnId: string;
  targetTableId: string;
  onChange: (d: DesignDocument) => void;
  onClose: () => void;
}) {
  useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const source = doc.columns?.find((c) => c.id === sourceColumnId);
  const sourceTable = doc.tables?.find((t) => t.id === source?.tableId),
    target = doc.tables?.find((t) => t.id === targetTableId);
  const keys = (doc.keys ?? []).filter(
    (k) =>
      k.tableId === source?.tableId &&
      k.kind === 'primary' &&
      k.scope !== 'logical' &&
      k.columnIds.includes(sourceColumnId),
  );
  const [keyId, setKeyId] = useState(keys[0]?.id ?? ''),
    [error, setError] = useState('');
  const [primaryCardinality, setPrimaryCardinality] = useState<'0..1' | '1'>('1');
  const [foreignCardinality, setForeignCardinality] = useState<CardinalityChoice>('0..N');
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const defaults = useRef<Record<string, string>>({});
  const [uniqueKeyId] = useState(newId);
  const key = keys.find((k) => k.id === keyId);
  const [relationId] = useState(newId),
    [columnIds] = useState(() =>
      Array.from({ length: Math.max(0, ...keys.map((k) => k.columnIds.length)) }, () => newId()),
    );
  let preview: DesignDocument | undefined;
  let previewError = '';
  if (sourceTable && target && key)
    try {
      preview = createForeignKeyFromPrimaryKey(doc, {
        primaryTableId: sourceTable.id,
        foreignTableId: target.id,
        primaryKeyId: key.id,
        relationId,
        columnIds: columnIds.slice(0, key.columnIds.length),
      });
    } catch (e) {
      previewError = e instanceof Error ? tr(e.message) : tr('관계를 생성할 수 없습니다.');
    }
  const names =
    key?.columnIds.map((id, index) => {
      const draftKey = `${key.id}:${id}`;
      const generated = preview?.columns?.find((c) => c.id === columnIds[index])?.physical.name;
      if (generated && defaults.current[draftKey] === undefined)
        defaults.current[draftKey] = generated;
      return draftNames[draftKey] ?? defaults.current[draftKey] ?? '';
    }) ?? [];
  let finalPreview: DesignDocument | undefined;
  if (preview) {
    try {
      finalPreview = applyForeignKeyDraft(
        preview,
        relationId,
        names,
        primaryCardinality,
        foreignCardinality,
        uniqueKeyId,
      );
    } catch (e) {
      previewError = e instanceof Error ? tr(e.message) : tr('관계를 생성할 수 없습니다.');
    }
  }
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="table-fk-dialog"
      aria-labelledby="fk-dialog-title"
      onCancel={onClose}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <h2 id="fk-dialog-title">{tr('PK → FK 관계 만들기')}</h2>
      <p>
        {sourceTable?.physical.name || tr('출발 테이블')} →{' '}
        {target?.physical.name || tr('도착 테이블')}
      </p>
      <label>
        {tr('출발 PK')}
        <Select
          aria-label={tr('출발 PK')}
          value={keyId}
          onValueChange={(value) => {
            setKeyId(value);
            setError('');
          }}
        >
          {!keys.length && <option value="">{tr('참조 가능한 PK 없음')}</option>}
          {keys.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name ||
                k.columnIds
                  .map((id) => doc.columns?.find((c) => c.id === id)?.physical.name)
                  .join(', ')}
            </option>
          ))}
        </Select>
      </label>
      <PanelNote>
        {tr(
          '도착 테이블에 아래 FK 컬럼을 자동으로 추가합니다. 복합 PK는 순서대로 연결하며, 같은 이름이 있으면 새 이름으로 만듭니다.',
        )}
      </PanelNote>
      <div className="table-fk-pairs">
        {key?.columnIds.map((id, index) => {
          const primary = doc.columns?.find((c) => c.id === id),
            foreign = preview?.columns?.find((c) => c.id === columnIds[index]);
          return (
            <div key={id}>
              <span>
                {primary?.physical.name || tr('이름 없는 컬럼')}
                <small>{primary?.physical.type.name.toUpperCase()}</small>
              </span>
              <span aria-hidden="true">→</span>
              <span>
                <Input
                  aria-label={tr('새 FK 컬럼 이름 {index}', { index: index + 1 })}
                  value={names[index] ?? ''}
                  maxLength={120}
                  onChange={(e) => {
                    setDraftNames((current) => ({
                      ...current,
                      [`${key.id}:${id}`]: e.target.value,
                    }));
                    setError('');
                  }}
                />
                <small>
                  {foreign?.physical.type.name.toUpperCase()} {tr(' · 자동 추가')}
                </small>
              </span>
            </div>
          );
        })}
      </div>
      <div className="fk-cardinality-controls">
        <label>
          {tr('PK 쪽 대응관계')}
          <Select
            aria-label={tr('PK 쪽 대응관계')}
            value={primaryCardinality}
            onValueChange={(value) => setPrimaryCardinality(value as '0..1' | '1')}
          >
            <option value="0..1">{tr('0..1 · 없거나 하나')}</option>
            <option value="1">{tr('1 · 정확히 하나')}</option>
          </Select>
        </label>
        <label>
          {tr('FK 쪽 대응관계')}
          <Select
            aria-label={tr('FK 쪽 대응관계')}
            value={foreignCardinality}
            onValueChange={(value) => setForeignCardinality(value as CardinalityChoice)}
          >
            <option value="0..1">{tr('0..1 · 없거나 하나')}</option>
            <option value="1">{tr('1 · 정확히 하나')}</option>
            <option value="0..N">{tr('0..N · 없거나 여러 개')}</option>
            <option value="1..N">{tr('1..N · 하나 이상')}</option>
          </Select>
        </label>
      </div>
      <PanelNote>
        {tr('PK 쪽')}{' '}
        {primaryCardinality === '0..1'
          ? tr('0..1은 FK 컬럼에 NULL을 허용합니다.')
          : tr('1은 FK 컬럼을 NOT NULL로 만듭니다.')}
        {(foreignCardinality === '0..1' || foreignCardinality === '1') &&
          tr(' FK 쪽 최대 1을 보장하도록 새 FK 컬럼 묶음에 UNIQUE 키를 추가합니다.')}
        {foreignCardinality.startsWith('1') &&
          tr(' FK 쪽 최소 1은 모델에 기록되며 FK 제약만으로 강제되지 않습니다.')}
      </PanelNote>
      {(error || previewError || !keys.length) && (
        <p role="alert" className="table-error">
          {tr(error || previewError || '출발 테이블에 PK를 먼저 정의하세요.')}
        </p>
      )}
      <div className="table-actions">
        <Button onClick={onClose}>{tr('취소')}</Button>
        <Button
          variant="primary"
          disabled={!finalPreview}
          onClick={() => {
            try {
              if (finalPreview) {
                onChange(finalPreview);
                onClose();
              }
            } catch (e) {
              setError(e instanceof Error ? tr(e.message) : tr('관계를 생성할 수 없습니다.'));
            }
          }}
        >
          {tr('컬럼 추가 및 관계 생성')}
        </Button>
      </div>
    </dialog>,
    document.body,
  );
}
