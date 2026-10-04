import { useEffect, useState } from 'react';
import type { NativeDesignDocument } from '@ezerd/model';
import { nativeCanvasStyleCommands } from './native-canvas-style.js';
import {
  NativeEditorField,
  NativeEditorForm,
  type NativeEditorContext,
} from './native-editor-form.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import type { NativeCanvasStyleCommand } from '@ezerd/contracts';
registerTranslations({
  '카드 표시': 'Card appearance',
  '색상 초기화': 'Reset color',
  'NULL·필수 표시': 'Show NULL or required',
  '설명 표시': 'Show comments',
  '색상은 #RRGGBB 또는 빈 값으로 입력해 주세요.': 'Use #RRGGBB or leave the color empty.',
});
export function NativeCanvasStyleEditor({
  document,
  context,
  editable,
  selectedTableId,
  selectedDomainId,
  initialSelection,
}: {
  document: NativeDesignDocument;
  context?: NativeEditorContext;
  editable: boolean;
  selectedTableId?: string;
  selectedDomainId?: string;
  initialSelection?: string;
}) {
  const { t } = useI18n();
  const targets: {
    value: string;
    target: NativeCanvasStyleCommand['target'];
    name: string;
    color: string;
  }[] = [
    ...(document.tables ?? []).map((table) => ({
      value: `table:${table.id}`,
      target: { kind: 'table' as const, id: table.id },
      name: table.logical.name || table.physical.name || table.id,
      color: table.color ?? '',
    })),
    ...document.domains.map((domain) => ({
      value: `domain:${domain.id}`,
      target: { kind: 'domain' as const, id: domain.id },
      name: domain.name || domain.id,
      color: domain.color ?? '',
    })),
    ...document.notes
      .filter((note) => !document.views?.some((view) => view.id === note.viewId))
      .map((note) => ({
        value: `note:${note.id}`,
        target: { kind: 'note' as const, id: note.id },
        name: note.text.slice(0, 60) || note.id,
        color: note.color ?? '',
      })),
  ];
  const [selection, setSelection] = useState(
    initialSelection ??
      (selectedDomainId
        ? `domain:${selectedDomainId}`
        : selectedTableId
          ? `table:${selectedTableId}`
          : (targets[0]?.value ?? '')),
  );
  useEffect(() => {
    if (initialSelection) return;
    if (selectedDomainId) setSelection(`domain:${selectedDomainId}`);
    else if (selectedTableId) setSelection(`table:${selectedTableId}`);
  }, [selectedDomainId, selectedTableId, initialSelection]);
  const selected = targets.find((target) => target.value === selection),
    table = document.tables?.find(
      (table) => selected?.target.kind === 'table' && table.id === selected.target.id,
    );
  return (
    <details className="native-property-editor" open={initialSelection ? true : undefined}>
      <summary>{t('카드 표시')}</summary>
      {!editable || !context ? (
        <p>{t('조회 전용')}</p>
      ) : (
        <>
          <NativeEditorField
            label="대상"
            value={selection}
            disabled={context.busy}
            choices={targets.map((target) => ({ value: target.value, label: target.name }))}
            onChange={setSelection}
          />
          {selected && (
            <NativeEditorForm
              key={`${selection}:${context.snapshot.project.version}:${context.snapshot.sequence}:${context.snapshot.project.databaseRevision}`}
              context={context}
              draftKey={`canvas:style:${selection}`}
              title={selected.name}
              initial={{
                color: selected.color,
                showNullable: String(table?.canvasDisplay?.showNullable !== false),
                showComment: String(table?.canvasDisplay?.showComment !== false),
              }}
              build={(values, before) => {
                try {
                  return nativeCanvasStyleCommands(selected.target, values, before);
                } catch {
                  throw Error(t('색상은 #RRGGBB 또는 빈 값으로 입력해 주세요.'));
                }
              }}
            >
              {(values, change) => (
                <>
                  <NativeEditorField
                    label="색상"
                    value={values.color ?? ''}
                    onChange={(value) => change('color', value)}
                  />
                  <button type="button" onClick={() => change('color', '')}>
                    {t('색상 초기화')}
                  </button>
                  {table && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          checked={values.showNullable === 'true'}
                          onChange={(event) => change('showNullable', String(event.target.checked))}
                        />
                        {t('NULL·필수 표시')}
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={values.showComment === 'true'}
                          onChange={(event) => change('showComment', String(event.target.checked))}
                        />
                        {t('설명 표시')}
                      </label>
                    </>
                  )}
                </>
              )}
            </NativeEditorForm>
          )}
        </>
      )}
    </details>
  );
}
