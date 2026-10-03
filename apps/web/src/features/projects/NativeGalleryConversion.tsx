import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Project } from '@ezerd/contracts';
import { getDatabaseProfile, nativeColumnTypeDisplay, type NativeColumnType } from '@ezerd/model';
import { Button } from '../../components/ui/index.js';
import { message } from '../../shared/api/client.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import { getNativeDurableQueue } from './native-durable-queue.js';
import {
  galleryConversionDetails,
  loadGalleryDatabaseConversion,
  sendGalleryDatabaseConversion,
  stageGalleryDatabaseConversion,
  readGalleryDatabaseArchives,
  prepareGalleryDatabaseRelease,
  releaseGalleryDatabaseConversion,
  type GalleryDatabaseReleaseProof,
  type NativeGalleryConversionOptions,
  type NativeGalleryConversionPlan,
} from './native-gallery-conversion.js';
import type { GalleryConversionArchive } from './native-gallery-conversion-archive.js';
import './project-ddl.css';

registerTranslations({
  'DB 변경 검토': 'Review database change',
  '검토한 DB 변경 적용': 'Apply the reviewed database change',
  '미확인 DB 변경 복구': 'Recover unconfirmed database change',
  'DB 변경 결과 다시 확인': 'Check the database change result again',
  '갤러리로 돌아가기': 'Return to the gallery',
  'DB 변경과 영향받는 객체를 확인했습니다.': 'I reviewed the database change and affected objects.',
  '검증된 변환 범위만 적용합니다. 테이블의 DB 설정과 표시된 컬럼 타입이 함께 변경됩니다.':
    'Only verified conversions are applied. Table database settings and the listed column types change together.',
  '저장된 요청과 이름 입력을 보관하고 있습니다. 같은 요청으로 결과를 확인하세요.':
    'The saved request and name input are retained. Check the result with the same request.',
  '현재 설계는 이 DB로 변환할 수 없습니다. 아래 항목을 확인하고 다시 검토하세요.':
    'This design cannot be converted to this database. Review the items below and try again.',
  '빈 물리 설계의 DB 설정을 변경합니다.':
    'Change the database settings of an empty physical design.',
  'DB 변경이 확인된 뒤 프로젝트 이름을 별도로 저장합니다.':
    'The project name is saved separately after the database change is confirmed.',
  '표시된 MySQL 설정이 실제 서버 설정과 맞는지 확인하세요.':
    'Check that the displayed MySQL settings match the actual server configuration.',
  '영향받는 객체': 'Affected objects',
  '보관된 DB 변경 입력': 'Archived database change input',
  '원문 보관 후 요청 해제': 'Archive the original input and release the request',
  '최신 저장 상태에서 요청 해제 검토': 'Review request release against the latest saved state',
  '이 요청의 적용 여부는 확인되지 않았습니다. 새 변경이 적용될 수 없는 저장 상태임을 확인했습니다. 원문을 보관하고 현재 설계에서 다시 검토하세요.':
    'Whether this request was applied is unconfirmed. The saved state prevents it from applying a new change. Keep the original input and review the current design again.',
  '이전 DB 변경은 확인되었습니다. 이후 저장 내용 또는 권한이 바뀌어 이름 입력을 자동 적용하지 않고 원문을 보관했습니다. 현재 설계에서 다시 검토하세요.':
    'The earlier database change was confirmed. Saved changes or permissions have changed, so the name input was archived rather than applied automatically. Review the current design again.',
  '원문 보관과 요청 해제를 확인했습니다. 이름은 자동으로 덮어쓰지 않습니다.':
    'I confirm archiving the original input and releasing the request. The name will not be overwritten automatically.',
  '요청을 해제할 저장 근거를 확인하지 못했습니다. 원문을 보존하고 같은 요청으로 다시 확인하세요.':
    'The saved state did not prove that the request can be released. Retain the original input and check the same request again.',
  '기존 원문을 대상 DB의 표현으로 변환할 수 없습니다.':
    'The original value cannot be converted to the target database representation.',
  '대상 DB에서 이 기능의 변환이 아직 검증되지 않았습니다.':
    'Conversion of this feature has not been verified for the target database.',
  '기존 타입·기본값·스키마 원문을 먼저 확인해 주세요.':
    'Review the original types, defaults and schema first.',
  '저장 상태나 DB 설정이 변경되었습니다. 최신 상태에서 다시 검토해 주세요.':
    'The saved state or database settings changed. Review the latest state again.',
  '미저장 입력 또는 다른 미확인 요청을 먼저 확인해 주세요.':
    'Review unsaved input or another unconfirmed request first.',
  '현재 프로젝트를 편집할 권한이 없습니다.': 'You do not have permission to edit this project.',
  '결과를 확인하지 못했습니다. 저장된 요청을 보존했습니다. 다시 확인해 주세요.':
    'The result could not be verified. The saved request was retained. Check again.',
});
export function galleryConversionError(cause: unknown): string {
  const text = message(cause);
  if (/edit-required/.test(text)) return '현재 프로젝트를 편집할 권한이 없습니다.';
  if (/precondition-not-consumed/.test(text))
    return '요청을 해제할 저장 근거를 확인하지 못했습니다. 원문을 보존하고 같은 요청으로 다시 확인하세요.';
  if (/preview-changed|name-changed|context-invalid/.test(text))
    return '저장 상태나 DB 설정이 변경되었습니다. 최신 상태에서 다시 검토해 주세요.';
  if (/pending-exists|unsaved-draft|project-export.pending/.test(text))
    return '미저장 입력 또는 다른 미확인 요청을 먼저 확인해 주세요.';
  return '결과를 확인하지 못했습니다. 저장된 요청을 보존했습니다. 다시 확인해 주세요.';
}
const databaseLabel = (kind: string) =>
  kind === 'postgresql' ? 'PostgreSQL' : kind === 'mysql' ? 'MySQL' : 'SQLite';
export function NativeGalleryConversionReview({
  plan,
  recovered,
}: {
  plan: NativeGalleryConversionPlan;
  recovered: boolean;
}) {
  const { t } = useI18n(),
    local = galleryConversionDetails(plan);
  const doc = plan.snapshot.sourceDocument;
  const label = (id: string | null) => {
    const table = doc.tables?.find((item) => item.id === id);
    if (table) return table.physical.name || table.logical.name || t('테이블');
    const column = doc.columns?.find((item) => item.id === id);
    if (column) {
      const owner = doc.tables?.find((item) => item.id === column.tableId);
      return `${owner?.physical.name || owner?.logical.name || t('테이블')} · ${column.physical.name || column.logical.name || t('컬럼')}`;
    }
    return t('프로젝트');
  };
  const affected = [...new Set(local.sourceMap.map((item) => item.objectId))];
  const issues = [...(plan.preview.issues ?? [])];
  const mappingValue = (path: string, value: unknown): string => {
    if (path.endsWith('/type')) return nativeColumnTypeDisplay(value as NativeColumnType);
    const data = value as { kind?: string; name?: string; database?: string; engine?: string };
    if (path.endsWith('/namespace'))
      return data.kind === 'postgresSchema'
        ? (data.name ?? '')
        : data.kind === 'mysqlCurrentDatabase'
          ? t('현재 데이터베이스')
          : 'main';
    return [databaseLabel(data.database ?? ''), data.engine].filter(Boolean).join(' · ');
  };
  const describe = (code: string) =>
    code === 'mysql.environment-profile-assumed'
      ? t('표시된 MySQL 설정이 실제 서버 설정과 맞는지 확인하세요.')
      : code.includes('legacy')
        ? t('기존 타입·기본값·스키마 원문을 먼저 확인해 주세요.')
        : /unverified|not-ready|unsupported/.test(code)
          ? t('대상 DB에서 이 기능의 변환이 아직 검증되지 않았습니다.')
          : t('기존 원문을 대상 DB의 표현으로 변환할 수 없습니다.');
  return (
    <section>
      <p>
        {plan.snapshot.project.name} · {databaseLabel(plan.preview.current.kind)} →{' '}
        {databaseLabel(plan.preview.target.kind)}
      </p>
      {plan.preview.canChange && local.canApply && (
        <p>
          {local.hasPhysicalDesign
            ? t(
                '검증된 변환 범위만 적용합니다. 테이블의 DB 설정과 표시된 컬럼 타입이 함께 변경됩니다.',
              )
            : t('빈 물리 설계의 DB 설정을 변경합니다.')}
        </p>
      )}
      <p>
        {databaseLabel(plan.preview.current.kind)}{' '}
        {getDatabaseProfile(plan.preview.current).targetVersion}
        {' → '}
        {databaseLabel(plan.preview.target.kind)}{' '}
        {getDatabaseProfile(plan.preview.target).targetVersion}
      </p>
      {affected.length > 0 && (
        <>
          <h3>
            {t('영향받는 객체')} ({affected.length})
          </h3>
          <ul>
            {affected.map((id) => (
              <li key={id}>
                {label(id)}
                <ul>
                  {local.sourceMap
                    .filter((item) => item.objectId === id)
                    .map((item, index) => (
                      <li key={index}>
                        {item.path.endsWith('/type')
                          ? t('컬럼 타입')
                          : item.path.endsWith('/namespace')
                            ? t('스키마')
                            : t('테이블 옵션')}
                        {' · '}
                        {mappingValue(item.path, item.source)} →{' '}
                        {mappingValue(item.path, item.target)}
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
      {!plan.preview.canChange && (
        <p role="alert">
          {t('현재 설계는 이 DB로 변환할 수 없습니다. 아래 항목을 확인하고 다시 검토하세요.')}
        </p>
      )}
      {issues.length > 0 && (
        <ul>
          {issues.map((issue, index) => (
            <li key={index}>
              {label(issue.objectId)} · {describe(issue.code)}
            </li>
          ))}
        </ul>
      )}
      {plan.requestedName !== null && (
        <p>
          {t('DB 변경이 확인된 뒤 프로젝트 이름을 별도로 저장합니다.')} {plan.requestedName}
        </p>
      )}
      {recovered && (
        <>
          <p role="status">
            {t('저장된 요청과 이름 입력을 보관하고 있습니다. 같은 요청으로 결과를 확인하세요.')}
          </p>
          <details>
            <summary>{t('원문')}</summary>
            <pre>{JSON.stringify(plan, null, 2)}</pre>
          </details>
        </>
      )}
    </section>
  );
}
export interface NativeGalleryConversionHandle {
  review: (plan: NativeGalleryConversionPlan) => Promise<boolean>;
  recover: (projectId: string) => Promise<boolean>;
}
export function GalleryConversionArchiveView({ record }: { record: GalleryConversionArchive }) {
  const { t } = useI18n();
  return (
    <section>
      <p role="status">
        {t(
          record.outcome === 'accepted'
            ? '이전 DB 변경은 확인되었습니다. 이후 저장 내용 또는 권한이 바뀌어 이름 입력을 자동 적용하지 않고 원문을 보관했습니다. 현재 설계에서 다시 검토하세요.'
            : '이 요청의 적용 여부는 확인되지 않았습니다. 새 변경이 적용될 수 없는 저장 상태임을 확인했습니다. 원문을 보관하고 현재 설계에서 다시 검토하세요.',
        )}
      </p>
      <p>
        {record.fresh.project.name} · {databaseLabel(record.fresh.project.databaseKind)}
      </p>
      {record.plan.requestedName && (
        <p>
          {t('이름')} · {record.plan.requestedName}
        </p>
      )}
      <details>
        <summary>{t('원문')}</summary>
        <pre>{JSON.stringify(record, null, 2)}</pre>
      </details>
    </section>
  );
}
function GalleryArchiveDialog({
  record,
  onClose,
}: {
  record: GalleryConversionArchive;
  onClose: () => void;
}) {
  const { t } = useI18n(),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="project-ddl-dialog"
      aria-label={t('보관된 DB 변경 입력')}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2>{t('보관된 DB 변경 입력')}</h2>
      <GalleryConversionArchiveView record={record} />
      <Button onClick={onClose}>{t('닫기')}</Button>
    </dialog>
  );
}
interface Props {
  userId: string;
  workspaceId: string;
  projects: { id: string }[];
  canEdit: boolean;
  onSaved: (project: Project) => void;
}
export const NativeGalleryConversion = forwardRef<NativeGalleryConversionHandle, Props>(
  function NativeGalleryConversion(props, ref) {
    const { t } = useI18n();
    const live = useRef(props),
      mounted = useRef(true),
      workingRef = useRef(false);
    live.current = props;
    const [review, setReview] = useState<{
      plan: NativeGalleryConversionPlan;
      recovered: boolean;
    } | null>(null);
    const [pending, setPending] = useState<NativeGalleryConversionPlan[]>([]);
    const [archives, setArchives] = useState<GalleryConversionArchive[]>([]);
    const [viewArchive, setViewArchive] = useState<GalleryConversionArchive | null>(null);
    const [releaseProof, setReleaseProof] = useState<GalleryDatabaseReleaseProof | null>(null);
    const [working, setWorking] = useState(false),
      [checked, setChecked] = useState(false),
      [error, setError] = useState('');
    const resolver = useRef<((ok: boolean) => void) | null>(null);
    const dialog = useRef<HTMLDialogElement>(null);
    function options(projectId: string): NativeGalleryConversionOptions {
      const { userId, workspaceId } = props;
      return {
        control: {
          scope: { userId, workspaceId, projectId },
          currentScope: () =>
            mounted.current
              ? {
                  userId: live.current.userId,
                  workspaceId: live.current.workspaceId,
                  projectId,
                }
              : null,
        },
        canEdit: () => live.current.canEdit,
      };
    }
    function show(plan: NativeGalleryConversionPlan, recovered: boolean): Promise<boolean> {
      if (resolver.current || workingRef.current) return Promise.resolve(false);
      setReview({ plan, recovered });
      setViewArchive(null);
      setReleaseProof(null);
      setChecked(false);
      setError('');
      return new Promise((resolve) => {
        resolver.current = resolve;
      });
    }
    useImperativeHandle(ref, () => ({
      review: (plan) => show(plan, false),
      recover: async (projectId) => {
        const recovered = await loadGalleryDatabaseConversion(options(projectId));
        return recovered ? show(recovered, true) : false;
      },
    }));
    const identity = JSON.stringify([props.userId, props.workspaceId]);
    const projectIds = JSON.stringify(props.projects.map((item) => item.id));
    useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
        resolver.current?.(false);
        resolver.current = null;
      };
    }, []);
    useEffect(() => {
      resolver.current?.(false);
      resolver.current = null;
      setReview(null);
      setPending([]);
      setArchives([]);
      setViewArchive(null);
      setReleaseProof(null);
      setError('');
    }, [identity]);
    useEffect(() => {
      let cancelled = false;
      let latestRefresh = 0;
      const ids = JSON.parse(projectIds) as string[],
        unsubscribers: (() => void)[] = [];
      const refresh = async () => {
        const ticket = ++latestRefresh;
        try {
          const values = await Promise.all(
            ids.map(async (id) => ({
              plan: await loadGalleryDatabaseConversion(options(id)),
              archives: readGalleryDatabaseArchives(options(id)),
            })),
          );
          if (!cancelled && ticket === latestRefresh) {
            setPending(
              values
                .map((item) => item.plan)
                .filter((item): item is NativeGalleryConversionPlan => item !== null),
            );
            setArchives(values.flatMap((item) => item.archives));
          }
        } catch (cause) {
          if (!cancelled && ticket === latestRefresh) setError(galleryConversionError(cause));
        }
      };
      try {
        const queue = getNativeDurableQueue();
        for (const id of ids) {
          let last = queue.state(props.userId, id);
          unsubscribers.push(
            queue.subscribe(props.userId, id, () => {
              const next = queue.state(props.userId, id);
              if (last !== next) {
                last = next;
                void refresh();
              }
            }),
          );
        }
        void refresh();
      } catch (cause) {
        setError(galleryConversionError(cause));
      }
      return () => {
        cancelled = true;
        unsubscribers.forEach((unsubscribe) => unsubscribe());
      };
    }, [identity, projectIds, props.canEdit]);
    useEffect(() => {
      if (review) dialog.current?.showModal();
      return () => dialog.current?.close();
    }, [!!review]);
    function close(ok = false) {
      if (workingRef.current) return;
      setReview(null);
      resolver.current?.(ok);
      resolver.current = null;
    }
    async function apply() {
      if (!review || workingRef.current || (!review.recovered && (!props.canEdit || !checked)))
        return;
      const captured = review,
        scope = identity;
      workingRef.current = true;
      setWorking(true);
      setError('');
      try {
        const opts = options(captured.plan.projectId);
        if (!captured.recovered) await stageGalleryDatabaseConversion(captured.plan, opts);
        const outcome = await sendGalleryDatabaseConversion(captured.plan, opts);
        if (
          mounted.current &&
          JSON.stringify([live.current.userId, live.current.workspaceId]) === scope
        ) {
          live.current.onSaved(outcome.project);
          setPending((items) => items.filter((item) => item.projectId !== captured.plan.projectId));
          workingRef.current = false;
          close(outcome.completed);
          if (outcome.archive) {
            setViewArchive(outcome.archive);
          }
        }
      } catch (cause) {
        if (
          mounted.current &&
          JSON.stringify([live.current.userId, live.current.workspaceId]) === scope
        ) {
          setError(galleryConversionError(cause));
          const recovered = await loadGalleryDatabaseConversion(
            options(captured.plan.projectId),
          ).catch(() => null);
          if (
            recovered &&
            mounted.current &&
            JSON.stringify([live.current.userId, live.current.workspaceId]) === scope
          ) {
            setReview({ plan: recovered, recovered: true });
            setPending((items) => [
              ...items.filter((item) => item.projectId !== recovered.projectId),
              recovered,
            ]);
          }
        }
      } finally {
        workingRef.current = false;
        if (mounted.current) setWorking(false);
      }
    }
    async function proveRelease() {
      if (!review?.recovered || workingRef.current) return;
      const captured = review,
        scope = identity;
      workingRef.current = true;
      setWorking(true);
      setError('');
      setReleaseProof(null);
      try {
        const proof = await prepareGalleryDatabaseRelease(
          captured.plan,
          options(captured.plan.projectId),
        );
        if (
          mounted.current &&
          JSON.stringify([live.current.userId, live.current.workspaceId]) === scope
        ) {
          setReleaseProof(proof);
          setChecked(false);
        }
      } catch (cause) {
        if (
          mounted.current &&
          JSON.stringify([live.current.userId, live.current.workspaceId]) === scope
        )
          setError(galleryConversionError(cause));
      } finally {
        workingRef.current = false;
        if (mounted.current) setWorking(false);
      }
    }
    async function release() {
      if (!releaseProof || !checked || workingRef.current) return;
      const proof = releaseProof,
        scope = identity;
      workingRef.current = true;
      setWorking(true);
      setError('');
      try {
        const outcome = await releaseGalleryDatabaseConversion(
          proof,
          options(proof.plan.projectId),
        );
        if (
          mounted.current &&
          JSON.stringify([live.current.userId, live.current.workspaceId]) === scope
        ) {
          live.current.onSaved(outcome.project);
          setPending((items) => items.filter((item) => item.projectId !== proof.plan.projectId));
          workingRef.current = false;
          close(false);
          setViewArchive(outcome.archive);
          setReleaseProof(null);
        }
      } catch (cause) {
        if (
          mounted.current &&
          JSON.stringify([live.current.userId, live.current.workspaceId]) === scope
        )
          setError(galleryConversionError(cause));
      } finally {
        workingRef.current = false;
        if (mounted.current) setWorking(false);
      }
    }
    const local = review && galleryConversionDetails(review.plan);
    return (
      <>
        {pending.map((plan) => (
          <Button key={plan.projectId} disabled={working} onClick={() => void show(plan, true)}>
            {t('미확인 DB 변경 복구')} · {plan.snapshot.project.name}
          </Button>
        ))}
        {archives.map((record) => (
          <Button
            key={`${record.plan.input.operationId}:${record.outcome}`}
            disabled={working || !!review}
            onClick={() => setViewArchive(record)}
          >
            {t('보관된 DB 변경 입력')} · {record.plan.snapshot.project.name}
          </Button>
        ))}
        {viewArchive && (
          <GalleryArchiveDialog record={viewArchive} onClose={() => setViewArchive(null)} />
        )}
        {!review && error && <p role="alert">{t(error)}</p>}
        {review && (
          <dialog
            ref={dialog}
            className="project-ddl-dialog"
            aria-labelledby="native-gallery-conversion-title"
            onCancel={(event) => {
              event.preventDefault();
              close();
            }}
          >
            <h2 id="native-gallery-conversion-title">{t('DB 변경 검토')}</h2>
            <NativeGalleryConversionReview plan={review.plan} recovered={review.recovered} />
            {!review.recovered && (
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={working}
                  onChange={(event) => setChecked(event.target.checked)}
                />{' '}
                {t('DB 변경과 영향받는 객체를 확인했습니다.')}
              </label>
            )}
            {error && <p role="alert">{t(error)}</p>}
            {releaseProof && (
              <>
                <p role="status">
                  {t(
                    releaseProof.ack
                      ? '이전 DB 변경은 확인되었습니다. 이후 저장 내용 또는 권한이 바뀌어 이름 입력을 자동 적용하지 않고 원문을 보관했습니다. 현재 설계에서 다시 검토하세요.'
                      : '이 요청의 적용 여부는 확인되지 않았습니다. 새 변경이 적용될 수 없는 저장 상태임을 확인했습니다. 원문을 보관하고 현재 설계에서 다시 검토하세요.',
                  )}
                </p>
                <p>
                  {releaseProof.fresh.project.name} ·{' '}
                  {databaseLabel(releaseProof.fresh.project.databaseKind)}
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={working}
                    onChange={(event) => setChecked(event.target.checked)}
                  />{' '}
                  {t('원문 보관과 요청 해제를 확인했습니다. 이름은 자동으로 덮어쓰지 않습니다.')}
                </label>
              </>
            )}
            <div className="dialog-actions">
              <Button
                disabled={
                  working ||
                  (!review.recovered &&
                    (!props.canEdit ||
                      !checked ||
                      !review.plan.preview.canChange ||
                      !local?.canApply ||
                      !local.engineVerified))
                }
                onClick={() => void apply()}
              >
                {t(review.recovered ? 'DB 변경 결과 다시 확인' : '검토한 DB 변경 적용')}
              </Button>
              <Button disabled={working} onClick={() => close()}>
                {t('갤러리로 돌아가기')}
              </Button>
              {review.recovered && (
                <Button disabled={working} onClick={() => void proveRelease()}>
                  {t('최신 저장 상태에서 요청 해제 검토')}
                </Button>
              )}
              {releaseProof && (
                <Button disabled={working || !checked} onClick={() => void release()}>
                  {t('원문 보관 후 요청 해제')}
                </Button>
              )}
            </div>
          </dialog>
        )}
      </>
    );
  },
);
