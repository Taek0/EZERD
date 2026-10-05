import { useEffect, useRef, useState } from 'react';
import {
  planNativeClipboardCommand,
  nativeClipboardObjectIds,
  type ProjectDocumentState,
} from '@ezerd/contracts';
import {
  NativeEditorForm,
  NativeEditorField,
  type NativeEditorSave,
} from './native-editor-form.js';
import { AnimatedDetails, Button, Checkbox, Textarea } from '../../components/ui/index.js';
import { PanelSection } from '../../shared/editor/panel.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import type { DatabaseIssue } from '@ezerd/model';
import {
  copyNativeClipboard,
  readNativeClipboard,
  nativeClipboardCounts,
  nativeClipboardSharedSource,
  prepareNativeClipboardPaste,
  reviewedNativeClipboardCommand,
  reviewedNativeClipboardPaste,
  nativeClipboardReviewToken,
  nativeClipboardDraftFields,
  nativeClipboardDraftText,
} from './native-clipboard-helpers.js';

registerTranslations({
  '테이블 복사·붙여넣기': 'Copy and paste tables',
  '복사할 테이블': 'Tables to copy',
  '테이블 복사': 'Copy tables',
  '클립보드로 복사': 'Copy to clipboard',
  '복사할 내용': 'Content to copy',
  '붙여넣을 내용': 'Content to paste',
  '직접 복사하거나 붙여넣어 주세요.': 'Copy or paste the content manually.',
  '기기 클립보드에서 읽기': 'Read device clipboard',
  '복사되었습니다.': 'Copied.',
  '이동 대상이 선택되지 않은 외래 키는 복사하지 않습니다.':
    'Foreign keys with an unselected endpoint are omitted.',
  '새 ID와 이름 검토': 'Review new IDs and names',
  '붙여넣기 검토': 'Review paste',
  '검토한 내용을 저장합니다.': 'Save the reviewed content.',
  '붙여넣을 내용을 다시 검토해 주세요.': 'Review the paste content again.',
  '지원하는 native 테이블 형식을 넣어 주세요.': 'Enter supported native table content.',
  '복사·붙여넣기 내용이 크기 제한을 넘었습니다.': 'Copy or paste content exceeds the size limit.',
  '기존 타입·기본값·네임스페이스를 새 객체로 복사할 수 없습니다.':
    'Original legacy types, defaults or namespaces cannot be copied into new objects.',
  '프로젝트 DB와 프로필이 같아야 붙여넣을 수 있습니다.':
    'Paste requires the same database and profile.',
  '참조된 테이블·컬럼·ENUM을 모두 포함해 주세요.':
    'Include all referenced tables, columns and ENUMs.',
  '미검증 기능 또는 설계 진단을 해결해야 저장할 수 있습니다.':
    'Resolve unverified features or design issues before saving.',
  '새 ID 또는 대상 도메인을 확인해 주세요.': 'Review new IDs or the destination domain.',
  '모든 객체는 새 ID로 복제합니다. 다른 프로젝트의 객체에 자동 연결하지 않습니다.':
    'All objects receive fresh IDs. Objects in other projects are not bound automatically.',
  '출처 프로젝트': 'Source project',
  '출처 정보 없음': 'No source information',
  '붙여넣을 도메인': 'Destination domain',
  ENUM: 'ENUM',
  CHECK: 'CHECK',
  '객체 ID 변경': 'Object ID remapping',
  '한 번에 저장할 객체가 너무 많습니다. 나누어서 붙여넣어 주세요.':
    'Too many objects for one save. Paste in smaller groups.',
  원본: 'Source',
  복제: 'Copy',
});
export function nativeClipboardMessage(code: string) {
  if (code === 'clipboard.size-limit' || code === 'document.size-limit')
    return '복사·붙여넣기 내용이 크기 제한을 넘었습니다.';
  if (code === 'clipboard.legacy-copy-not-supported')
    return '기존 타입·기본값·네임스페이스를 새 객체로 복사할 수 없습니다.';
  if (code === 'clipboard.database-mismatch' || code === 'database.context-mismatch')
    return '프로젝트 DB와 프로필이 같아야 붙여넣을 수 있습니다.';
  if (code === 'clipboard.reference-missing')
    return '참조된 테이블·컬럼·ENUM을 모두 포함해 주세요.';
  if (code === 'clipboard.review-required') return '붙여넣을 내용을 다시 검토해 주세요.';
  if (code === 'clipboard.policy-blocked')
    return '미검증 기능 또는 설계 진단을 해결해야 저장할 수 있습니다.';
  if (
    [
      'clipboard.identity-collision',
      'clipboard.remap-invalid',
      'clipboard.destination-invalid',
    ].includes(code)
  )
    return '새 ID 또는 대상 도메인을 확인해 주세요.';
  return '지원하는 native 테이블 형식을 넣어 주세요.';
}
const errorCode = (error: unknown) =>
  error instanceof Error ? error.message : 'clipboard.format-invalid';
function diagnosticLabel(issue: DatabaseIssue) {
  if (issue.code === 'sync.change-limit')
    return '한 번에 저장할 객체가 너무 많습니다. 나누어서 붙여넣어 주세요.';
  if (issue.category === 'unsupported' || issue.category === 'environment')
    return '미검증 기능 또는 설계 진단을 해결해야 저장할 수 있습니다.';
  if (issue.code.includes('reference') || issue.code.startsWith('foreign-key'))
    return '참조된 테이블·컬럼·ENUM을 모두 포함해 주세요.';
  return '새 ID 또는 대상 도메인을 확인해 주세요.';
}

export function NativeClipboardMenu({
  snapshot,
  userId,
  editable,
  busy,
  onSave,
  selectedTableId,
  destinationDomainId = null,
}: {
  snapshot: ProjectDocumentState;
  userId?: string;
  editable: boolean;
  busy: boolean;
  onSave: NativeEditorSave;
  selectedTableId?: string;
  destinationDomainId?: string | null;
}) {
  const { t } = useI18n();
  const source = nativeClipboardSharedSource(snapshot);
  const [selected, setSelected] = useState<string[]>(selectedTableId ? [selectedTableId] : []);
  const [copied, setCopied] = useState<ReturnType<typeof copyNativeClipboard> | null>(null);
  const [notice, setNotice] = useState('');
  const scope = JSON.stringify([
    userId,
    snapshot.project.id,
    snapshot.project.version,
    snapshot.sequence,
    snapshot.project.databaseRevision,
  ]);
  const current = useRef(scope),
    alive = useRef(true);
  current.current = scope;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setCopied(null);
    setNotice('');
    setSelected(selectedTableId ? [selectedTableId] : []);
  }, [scope, selectedTableId]);
  const tableName = (id: string) => {
    const table = source.tables?.find((table) => table.id === id);
    return table?.logical.name || table?.physical.name || id;
  };
  const countLabels: Record<string, string> = {
    tables: '테이블',
    columns: '컬럼',
    keys: '키',
    tableRelations: '외래 키',
    indexes: '인덱스',
    checks: 'CHECK',
    enums: 'ENUM',
  };
  const counts = copied ? nativeClipboardCounts(copied.file) : null;
  return (
    <PanelSection className="native-property-editor" title={t('테이블 복사·붙여넣기')}>
      <fieldset>
        <legend>{t('복사할 테이블')}</legend>
        {(source.tables ?? []).map((table) => (
          <label key={table.id}>
            <Checkbox
              checked={selected.includes(table.id)}
              onChange={(event) => {
                setSelected((ids) =>
                  event.target.checked ? [...ids, table.id] : ids.filter((id) => id !== table.id),
                );
                setCopied(null);
              }}
            />
            {tableName(table.id)}
          </label>
        ))}
      </fieldset>
      <Button
        disabled={!selected.length}
        onClick={() => {
          try {
            setCopied(copyNativeClipboard(snapshot, selected));
            setNotice('직접 복사하거나 붙여넣어 주세요.');
          } catch (error) {
            setCopied(null);
            setNotice(nativeClipboardMessage(errorCode(error)));
          }
        }}
      >
        {t('테이블 복사')}
      </Button>
      {notice && <p role="status">{t(notice)}</p>}
      {copied && (
        <>
          <p>
            {Object.entries(counts!)
              .map(([key, count]) => `${t(countLabels[key] ?? key)} ${count}`)
              .join(' · ')}
          </p>
          {!!copied.omittedRelations.length && (
            <>
              <p>{t('이동 대상이 선택되지 않은 외래 키는 복사하지 않습니다.')}</p>
              <ul>
                {copied.omittedRelations.map((name, index) => (
                  <li key={index}>{name}</li>
                ))}
              </ul>
            </>
          )}
          <label>
            {t('복사할 내용')}
            <Textarea
              readOnly
              value={copied.text}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <Button
            onClick={() => {
              const text = copied.text,
                captured = scope;
              void (async () => {
                try {
                  if (!globalThis.navigator?.clipboard?.writeText) throw Error();
                  await navigator.clipboard.writeText(text);
                  if (alive.current && current.current === captured) setNotice('복사되었습니다.');
                } catch {
                  if (alive.current && current.current === captured)
                    setNotice('직접 복사하거나 붙여넣어 주세요.');
                }
              })();
            }}
          >
            {t('클립보드로 복사')}
          </Button>
        </>
      )}
      {userId && editable && snapshot.project.status === 'active' ? (
        <NativeClipboardPasteForm
          key={scope}
          snapshot={snapshot}
          userId={userId}
          busy={busy}
          onSave={onSave}
          destinationDomainId={destinationDomainId}
        />
      ) : (
        <p>{t('조회 전용')}</p>
      )}
    </PanelSection>
  );
}

function NativeClipboardPasteForm({
  snapshot,
  userId,
  busy,
  onSave,
  destinationDomainId,
}: {
  snapshot: ProjectDocumentState;
  userId: string;
  busy: boolean;
  onSave: NativeEditorSave;
  destinationDomainId: string | null;
}) {
  const { t } = useI18n(),
    alive = useRef(true);
  const [error, setError] = useState('');
  const [reviewedPlan, setReviewedPlan] = useState<ReturnType<
    typeof planNativeClipboardCommand
  > | null>(null);
  const inputVersion = useRef(0),
    canRead = useRef(!busy);
  canRead.current = !busy;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const source = nativeClipboardSharedSource(snapshot);
  const initial = {
    ...nativeClipboardDraftFields('', 'clipboard'),
    ...nativeClipboardDraftFields('', 'remap'),
    ...nativeClipboardDraftFields('', 'reviewClipboard'),
    ...nativeClipboardDraftFields('', 'reviewRemap'),
    domainId: destinationDomainId ?? '',
    x: '40',
    y: '40',
    review: '',
  };
  return (
    <NativeEditorForm
      context={{ userId, snapshot, busy, onSave }}
      title={t('붙여넣기 검토')}
      draftKey="canvas:clipboard:paste"
      initial={initial}
      build={(values) => {
        try {
          return [reviewedNativeClipboardCommand(snapshot, values)];
        } catch (error) {
          throw Error(t(nativeClipboardMessage(errorCode(error))));
        }
      }}
    >
      {(values, change) => {
        const text = nativeClipboardDraftText(values, 'clipboard');
        let file: ReturnType<typeof readNativeClipboard> | null = null,
          diagnostic = '';
        try {
          if (text) file = readNativeClipboard(text);
        } catch (error) {
          diagnostic = nativeClipboardMessage(errorCode(error));
        }
        let plan: ReturnType<typeof planNativeClipboardCommand> | null = null;
        let remappedIds: readonly string[] = [];
        if (file && values.review) {
          try {
            const reviewed = reviewedNativeClipboardPaste(snapshot, values);
            plan = reviewed.plan;
            remappedIds = reviewed.command.newIds;
          } catch (error) {
            diagnostic = nativeClipboardMessage(errorCode(error));
          }
        }
        const storeFields = (fields: Record<string, string>) =>
          Object.entries(fields).forEach(([key, value]) => {
            if (value !== values[key]) change(key, value);
          });
        const input = (text: string) => {
          try {
            inputVersion.current++;
            storeFields(nativeClipboardDraftFields(text, 'clipboard'));
            change('review', '');
            setReviewedPlan(null);
            setError('');
          } catch (error) {
            setError(nativeClipboardMessage(errorCode(error)));
          }
        };
        const invalidateReview = () => {
          inputVersion.current++;
          change('review', '');
          setReviewedPlan(null);
          setError('');
        };
        return (
          <>
            <label>
              {t('붙여넣을 내용')}
              <Textarea value={text} onChange={(event) => input(event.target.value)} />
            </label>
            <Button
              onClick={() => {
                const version = inputVersion.current;
                void (async () => {
                  try {
                    if (!globalThis.navigator?.clipboard?.readText) throw Error();
                    const text = await navigator.clipboard.readText();
                    if (alive.current && canRead.current && version === inputVersion.current)
                      input(text);
                  } catch {
                    if (alive.current && version === inputVersion.current)
                      setError('직접 복사하거나 붙여넣어 주세요.');
                  }
                })();
              }}
            >
              {t('기기 클립보드에서 읽기')}
            </Button>
            {(error || diagnostic) && <p role="alert">{t(error || diagnostic)}</p>}
            {file && (
              <>
                <p>
                  {file.sourceDatabase.kind} · {file.sourceDatabase.profileId}
                </p>
                <p>
                  {t('출처 프로젝트')}: {file.sourceProjectId ?? t('출처 정보 없음')}
                </p>
                <p>
                  {Object.entries(nativeClipboardCounts(file))
                    .map(
                      ([key, count]) =>
                        `${t(({ tables: '테이블', columns: '컬럼', keys: '키', tableRelations: '외래 키', indexes: '인덱스', checks: 'CHECK', enums: 'ENUM' } as Record<string, string>)[key] ?? key)} ${count}`,
                    )
                    .join(' · ')}
                </p>
                <ul>
                  {file.document.tables?.map((table) => (
                    <li key={table.id}>{table.logical.name || table.physical.name || table.id}</li>
                  ))}
                </ul>
              </>
            )}
            <NativeEditorField
              label="붙여넣을 도메인"
              value={values.domainId ?? ''}
              choices={[
                { value: '', label: t('미소속') },
                ...source.domains.map((domain) => ({
                  value: domain.id,
                  label: domain.name || domain.id,
                })),
              ]}
              onChange={(value) => {
                change('domainId', value);
                invalidateReview();
              }}
            />
            <NativeEditorField
              label="X"
              type="number"
              value={values.x ?? ''}
              onChange={(value) => {
                change('x', value);
                invalidateReview();
              }}
            />
            <NativeEditorField
              label="Y"
              type="number"
              value={values.y ?? ''}
              onChange={(value) => {
                change('y', value);
                invalidateReview();
              }}
            />
            <p>
              {t('모든 객체는 새 ID로 복제합니다. 다른 프로젝트의 객체에 자동 연결하지 않습니다.')}
            </p>
            <Button
              disabled={!file}
              onClick={() => {
                invalidateReview();
                try {
                  const result = prepareNativeClipboardPaste(
                    snapshot,
                    text,
                    values.domainId || null,
                    { x: Number(values.x), y: Number(values.y) },
                  );
                  setReviewedPlan(result.plan);
                  if (!result.plan.canApply) {
                    setError('미검증 기능 또는 설계 진단을 해결해야 저장할 수 있습니다.');
                    return;
                  }
                  const ids = JSON.stringify(result.command.newIds);
                  storeFields(nativeClipboardDraftFields(ids, 'remap'));
                  storeFields(nativeClipboardDraftFields(text, 'reviewClipboard'));
                  storeFields(nativeClipboardDraftFields(ids, 'reviewRemap'));
                  change(
                    'review',
                    nativeClipboardReviewToken(
                      snapshot,
                      values.domainId ?? '',
                      values.x ?? '',
                      values.y ?? '',
                    ),
                  );
                  setError('');
                } catch (error) {
                  setError(nativeClipboardMessage(errorCode(error)));
                }
              }}
            >
              {t('새 ID와 이름 검토')}
            </Button>
            {reviewedPlan && (
              <ul>
                {reviewedPlan.issues.slice(0, 100).map((issue, index) => {
                  const objects = [
                    ...(reviewedPlan.document.tables ?? []).map((item) => ({
                      id: item.id,
                      name: item.logical.name || item.physical.name,
                    })),
                    ...(reviewedPlan.document.columns ?? []).map((item) => ({
                      id: item.id,
                      name: item.logical.name || item.physical.name,
                    })),
                    ...(reviewedPlan.document.indexes ?? []),
                    ...(reviewedPlan.document.checks ?? []),
                    ...(reviewedPlan.document.enums ?? []),
                    ...(reviewedPlan.document.keys ?? []),
                  ];
                  return (
                    <li key={index}>
                      {objects.find((item) => item.id === issue.objectId)?.name ??
                        t('설계 확인 항목')}
                      : {t(diagnosticLabel(issue))}
                    </li>
                  );
                })}
              </ul>
            )}
            {plan && file && (
              <>
                <p>{t('검토한 내용을 저장합니다.')}</p>
                <ul>
                  {plan.ids.map((id) => {
                    const table = plan.document.tables?.find((table) => table.id === id);
                    return (
                      <li key={id}>
                        {table?.logical.name} · {table?.physical.name}: {id}
                      </li>
                    );
                  })}
                </ul>
                <AnimatedDetails>
                  <summary>{t('객체 ID 변경')}</summary>
                  <table>
                    <thead>
                      <tr>
                        <th>{t('원본')}</th>
                        <th>{t('복제')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nativeClipboardObjectIds(file).map((id, index) => (
                        <tr key={id}>
                          <td>{id}</td>
                          <td>{remappedIds[index]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AnimatedDetails>
              </>
            )}
          </>
        );
      }}
    </NativeEditorForm>
  );
}
