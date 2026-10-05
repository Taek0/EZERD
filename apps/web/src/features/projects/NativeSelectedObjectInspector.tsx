import { nativeEditorCommandSchema } from '@ezerd/contracts';
import type { NativeDesignDocument, NodeLayout } from '@ezerd/model';
import { DomainColorPicker } from '../domains/DomainColorPicker.js';
import { PanelSection } from '../../shared/editor/panel.js';
import { NativeCanvasInputForm } from './NativeCanvasInputForm.js';
import type { ComponentProps } from 'react';
type NativeCanvasInputContext = ComponentProps<typeof NativeCanvasInputForm>['context'];
import { NativeEditorField } from './native-editor-form.js';
import { nativeCanvasMoveCommand } from './native-canvas-selection.js';
import { useI18n } from '../../shared/i18n/index.js';
export function nativeSelectedObjectCommands(
  document: NativeDesignDocument,
  node: NodeLayout,
  values: Record<string, string>,
  personalVersion?: number,
) {
  if (personalVersion !== undefined && values.personalVersion !== String(personalVersion))
    throw Error('native.personal-conflict');
  const patch = Object.fromEntries(
    (['x', 'y', 'width', 'height'] as const)
      .filter((field) => Number(values[field]) !== node[field])
      .map((field) => [field, Number(values[field])]),
  );
  const commands = Object.keys(patch).length
    ? [nativeCanvasMoveCommand(document, node, { x: node.x, y: node.y, ...patch })]
    : [];
  const note = document.notes.find((item) => item.id === node.objectId);
  if (note) {
    const notePatch = {
      ...(values.text !== note.text ? { text: values.text } : {}),
      ...(values.color !== (note.color ?? '#fff3c4') ? { color: values.color } : {}),
    };
    if (Object.keys(notePatch).length)
      commands.push(
        nativeEditorCommandSchema.parse({ type: 'patch_note', id: note.id, patch: notePatch }),
      );
  }
  return commands;
}

export function NativeSelectedObjectInspector({
  document,
  node,
  viewId,
  personalVersion,
  context,
}: {
  document: NativeDesignDocument;
  node: NodeLayout;
  viewId: string;
  personalVersion: number | undefined;
  context: NativeCanvasInputContext;
}) {
  const { t } = useI18n();
  const note = document.notes.find((item) => item.id === node.objectId),
    domain = document.domains.find((item) => item.id === node.objectId);
  if (!note && !domain) return null;
  return (
    <PanelSection title={t(note ? '메모' : '배치')} defaultOpen>
      <NativeCanvasInputForm
        context={{
          ...context,
          onSave: (commands, ...args) =>
            commands.length ? context.onSave(commands, ...args) : Promise.resolve(true),
        }}
        title={t(note ? '메모 속성' : '위치·크기')}
        draftKey={`canvas:object:${viewId}:${node.objectId}`}
        initial={{
          objectId: node.objectId,
          nodeId: node.id,
          viewId: node.viewId,
          x: String(node.x),
          y: String(node.y),
          width: String(node.width),
          height: String(node.height),
          text: note?.text ?? '',
          color: note?.color ?? '#fff3c4',
          personalVersion: String(personalVersion ?? ''),
        }}
        disabled={false}
        build={(values) => nativeSelectedObjectCommands(document, node, values, personalVersion)}
      >
        {(values, change) => (
          <>
            {note && (
              <>
                <NativeEditorField
                  label="메모 내용"
                  multiline
                  value={values.text ?? ''}
                  onChange={(value) => change('text', value)}
                />
                <DomainColorPicker
                  label={t('메모 색상')}
                  value={values.color ?? '#fff3c4'}
                  disabled={context.busy}
                  onChange={(value) => change('color', value)}
                  onReset={() => change('color', '#fff3c4')}
                />
              </>
            )}
            <div className="position-fields">
              {(['x', 'y', 'width', 'height'] as const).map((field) => (
                <NativeEditorField
                  key={field}
                  label={
                    field === 'width' ? '너비' : field === 'height' ? '높이' : field.toUpperCase()
                  }
                  type="number"
                  value={values[field] ?? ''}
                  onChange={(value) => change(field, value)}
                />
              ))}
            </div>
          </>
        )}
      </NativeCanvasInputForm>
    </PanelSection>
  );
}
