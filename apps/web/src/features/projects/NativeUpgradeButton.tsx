import { useEffect, useRef, useState } from 'react';
import type { ProjectDocumentState, NativeSyncOperationResult } from '@ezerd/contracts';
import { Button } from '../../components/ui/index.js';
import { message } from '../../shared/api/client.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import {
  prepareNativeUpgrade,
  applyNativeUpgrade,
  NativeUpgradeAttemptError,
  loadNativeUpgrade,
  reloadNativeUpgrade,
  type NativeUpgradePlan,
} from './native-upgrade.js';
import { getNativeDurableQueue } from './native-durable-queue.js';
registerTranslations({
  'native 설계로 업그레이드': 'Upgrade to a native design',
  '최신 저장 상태 확인': 'Review the latest saved state',
  '원문 보존을 확인하고 업그레이드': 'Upgrade after reviewing original value preservation',
  '같은 작업으로 결과 다시 확인': 'Check the result with the same operation',
  '최신 상태에서 다시 검토': 'Review again from the latest state',
  '형식 변경 후 이전 편집 문맥과 baseline을 다시 사용할 수 없습니다. 저장된 원문에서 새 설계를 읽습니다.':
    'After the format change, the previous editing context and baseline cannot be reused. The new design is read from the saved source.',
  'MySQL·SQLite에 저장된 기존 PG 표현과 알 수 없는 타입·기본값은 legacy 원문으로 보존됩니다. 자동 DB 변환이나 새 기능 사용 승인이 아닙니다.':
    'Existing PG representations saved under MySQL or SQLite, and unknown types/defaults, retain their original values as legacy data. This does not approve a database conversion or new features.',
  '저장된 작업을 복구했습니다. 같은 작업으로 결과를 다시 확인하세요.':
    'The saved operation was recovered. Check its result using the same operation.',
  '업그레이드 완료 · 설계 다시 읽기': 'Upgrade accepted · reload the design',
  진단: 'Diagnostics',
});
export function NativeUpgradeReview({ plan }: { plan: NativeUpgradePlan }) {
  const { t } = useI18n();
  const state = plan.snapshot;
  const diagnostics =
    state.native.status === 'available'
      ? [...state.native.migrationIssues, ...state.native.issues]
      : [];
  return (
    <section aria-label={t('native 설계로 업그레이드')}>
      <p>
        {state.project.name} · {state.project.databaseKind} · {state.project.databaseProfileId}
      </p>
      <p>
        {t(
          '형식 변경 후 이전 편집 문맥과 baseline을 다시 사용할 수 없습니다. 저장된 원문에서 새 설계를 읽습니다.',
        )}
      </p>
      <p>
        {t(
          'MySQL·SQLite에 저장된 기존 PG 표현과 알 수 없는 타입·기본값은 legacy 원문으로 보존됩니다. 자동 DB 변환이나 새 기능 사용 승인이 아닙니다.',
        )}
      </p>
      {diagnostics.length > 0 && (
        <details>
          <summary>
            {t('진단')} ({diagnostics.length})
          </summary>
          <ul>
            {diagnostics.map((item, i) => (
              <li key={i}>
                {item.objectId ?? '—'} · {item.path} · {item.code}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
/** The v1 project owns autosave completion and the native view transition. */
export function NativeUpgradeButton({
  userId,
  projectId,
  workspaceId,
  canUpgrade,
  prepare,
  onUpgraded,
  busy = false,
}: {
  userId: string;
  projectId: string;
  workspaceId: string;
  canUpgrade: boolean;
  prepare: () => Promise<boolean>;
  onUpgraded: (snapshot: ProjectDocumentState) => void | Promise<void>;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [plan, setPlan] = useState<NativeUpgradePlan | null>(null);
  const [working, setWorking] = useState(false),
    [loading, setLoading] = useState(true),
    [unknown, setUnknown] = useState(false),
    [error, setError] = useState('');
  const [receipt, setReceipt] = useState<{
    plan: NativeUpgradePlan;
    result: NativeSyncOperationResult;
  } | null>(null);
  const active = useRef(false),
    mounted = useRef(true);
  const live = useRef({ userId, projectId, workspaceId });
  live.current = { userId, projectId, workspaceId };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const options = () => ({
    control: {
      scope: { userId, projectId, workspaceId },
      currentScope: () => (mounted.current ? live.current : null),
    },
    canUpgrade,
    prepare,
  });
  const visiblePlan =
    plan?.userId === userId &&
    plan.projectId === projectId &&
    plan.snapshot.project.workspaceId === workspaceId
      ? plan
      : null;
  const stillHere = () =>
    mounted.current &&
    live.current.userId === userId &&
    live.current.projectId === projectId &&
    live.current.workspaceId === workspaceId;
  useEffect(() => {
    setPlan(null);
    setReceipt(null);
    setUnknown(false);
    setError('');
    setLoading(true);
    let cancelled = false;
    let lastState = '';
    let unsubscribe = () => {};
    const captured = options();
    const refresh = async () => {
      try {
        const recovered = await loadNativeUpgrade(captured);
        if (cancelled || active.current) return;
        if (recovered) {
          setPlan(recovered);
          setUnknown(true);
        } else if (lastState === 'empty') {
          setPlan(null);
          setUnknown(false);
        }
      } catch (cause) {
        if (!cancelled) setError(message(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    try {
      const queue = getNativeDurableQueue();
      unsubscribe = queue.subscribe(userId, projectId, () => {
        const state = queue.state(userId, projectId);
        if (state === lastState) return;
        lastState = state;
        if (!active.current) void refresh();
      });
      void refresh();
    } catch (cause) {
      setError(message(cause));
      setLoading(false);
    }
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId, projectId, workspaceId]);
  async function review() {
    if (active.current || loading || busy || !canUpgrade || unknown || receipt) return;
    active.current = true;
    setWorking(true);
    setError('');
    try {
      const next = await prepareNativeUpgrade(options());
      next.assertCurrent();
      if (stillHere()) {
        setPlan(next);
        setUnknown(false);
      }
    } catch (cause) {
      if (stillHere()) setError(message(cause));
    } finally {
      active.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  async function apply() {
    if (!visiblePlan || active.current || busy || (!unknown && !canUpgrade)) return;
    active.current = true;
    setWorking(true);
    setError('');
    try {
      const outcome = await applyNativeUpgrade(visiblePlan, options(), unknown);
      visiblePlan.assertCurrent();
      if (stillHere()) {
        setPlan(null);
        setUnknown(false);
        setReceipt({ plan: visiblePlan, result: outcome.result });
        if (outcome.snapshot) {
          await onUpgraded(outcome.snapshot);
          setReceipt(null);
        } else setError(outcome.reloadError);
      }
    } catch (cause) {
      if (stillHere()) {
        setError(message(cause));
        const recovered = await loadNativeUpgrade(options()).catch(() => null);
        if (!stillHere()) return;
        if (recovered) setPlan(recovered);
        setUnknown(
          Boolean(recovered) ||
            (cause instanceof NativeUpgradeAttemptError && cause.requestMayHaveApplied),
        );
      }
    } finally {
      active.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  async function reload() {
    if (!receipt || active.current || busy) return;
    active.current = true;
    setWorking(true);
    try {
      const snapshot = await reloadNativeUpgrade(receipt.plan, receipt.result, options());
      if (stillHere()) {
        await onUpgraded(snapshot);
        setReceipt(null);
        setError('');
      }
    } catch (cause) {
      if (stillHere()) setError(message(cause));
    } finally {
      active.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  const visibleReceipt =
    receipt?.plan.userId === userId &&
    receipt.plan.projectId === projectId &&
    receipt.plan.snapshot.project.workspaceId === workspaceId
      ? receipt
      : null;
  return (
    <div className="native-upgrade-control">
      {visibleReceipt ? (
        <Button disabled={working || busy} onClick={() => void reload()}>
          {t('업그레이드 완료 · 설계 다시 읽기')}
        </Button>
      ) : visiblePlan ? (
        <>
          <NativeUpgradeReview plan={visiblePlan} />
          {unknown && (
            <p role="status">
              {t('저장된 작업을 복구했습니다. 같은 작업으로 결과를 다시 확인하세요.')}
            </p>
          )}
          <Button
            disabled={loading || working || busy || (!unknown && !canUpgrade)}
            onClick={() => void apply()}
          >
            {t(unknown ? '같은 작업으로 결과 다시 확인' : '원문 보존을 확인하고 업그레이드')}
          </Button>
          <Button
            disabled={loading || working || busy || unknown || !canUpgrade}
            onClick={() => void review()}
          >
            {t('최신 상태에서 다시 검토')}
          </Button>
        </>
      ) : (
        <Button disabled={loading || working || busy || !canUpgrade} onClick={() => void review()}>
          {t('native 설계로 업그레이드')}
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
