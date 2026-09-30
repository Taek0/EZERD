import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Input, Select, Badge } from '../../components/ui/index.js';
import { useConfirm } from '../../components/ui/ConfirmProvider.js';
import { body, message, request } from '../../shared/api/client.js';
import { useI18n } from '../../shared/i18n/index.js';
import { type Workspace, type WorkspaceRole } from './workspace-policy.js';
import './translations.js';
import './workspaces.css';

type Member = { userId: string; username: string; role: WorkspaceRole };
type Invitation = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  username: string;
  role: WorkspaceRole;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  expiresAt: string;
};
const roleLabels = { owner: '소유자', editor: '편집자', viewer: '뷰어' };
const statusLabels = {
  pending: '대기 중',
  accepted: '수락됨',
  declined: '거절됨',
  cancelled: '취소됨',
  expired: '만료됨',
};

export function WorkspacePanel({
  workspaces,
  selected,
  onSelect,
  onRefresh,
}: {
  workspaces: Workspace[];
  selected: Workspace | undefined;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const [mode, setMode] = useState<'create' | 'manage' | 'inbox' | null>(null);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('editor');
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inbox, setInbox] = useState<Invitation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void request<Invitation[]>('/api/workspace-invitations', { signal: controller.signal })
      .then(setInbox)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      });
    return () => controller.abort();
  }, [revision, mode]);
  useEffect(() => {
    const reload = () => setRevision((value) => value + 1);
    const timer = window.setInterval(reload, 15000);
    window.addEventListener('focus', reload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', reload);
    };
  }, []);
  useEffect(() => {
    if (mode === 'manage') setName(selected?.name ?? '');
    setMembers([]);
    setInvitations([]);
  }, [selected?.id, mode]);
  useEffect(() => {
    if (mode !== 'manage' || !selected) return;
    const controller = new AbortController();
    void Promise.all([
      request<Member[]>(`/api/workspaces/${selected.id}/members`, { signal: controller.signal }),
      selected.role === 'owner'
        ? request<Invitation[]>(`/api/workspaces/${selected.id}/invitations`, {
            signal: controller.signal,
          })
        : Promise.resolve([]),
    ])
      .then(([people, invites]) => {
        if (!controller.signal.aborted) {
          setMembers(people);
          setInvitations(invites);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      });
    return () => controller.abort();
  }, [selected?.id, selected?.role, mode, revision]);
  useEffect(() => {
    if (!mode) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, [mode]);
  async function mutate(
    url: string,
    method: string,
    value?: unknown,
    after?: (result: unknown) => void,
  ) {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await request(url, body(method, value ?? {}));
      after?.(result);
      setRevision((v) => v + 1);
      onRefresh();
      return true;
    } catch (cause) {
      setError(message(cause));
      return false;
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const pending = (invitation: Invitation) =>
    invitation.status === 'pending' && Date.parse(invitation.expiresAt) > Date.now();
  function invitationRow(invitation: Invitation, received: boolean) {
    const status =
      invitation.status === 'pending' && !pending(invitation) ? 'expired' : invitation.status;
    return (
      <li key={invitation.id} className="workspace-member">
        <div>
          <strong>{received ? invitation.workspaceName : invitation.username}</strong>
          <small>
            {t(roleLabels[invitation.role])} · {t(statusLabels[status])}
          </small>
          <small>
            {t('만료 {date}', {
              date: new Date(invitation.expiresAt).toLocaleString(
                locale === 'en' ? 'en-US' : 'ko-KR',
              ),
            })}
          </small>
        </div>
        {pending(invitation) && (
          <div className="workspace-row-actions">
            {received ? (
              <>
                <Button
                  disabled={busy}
                  variant="primary"
                  onClick={() =>
                    void mutate(`/api/workspace-invitations/${invitation.id}/accept`, 'POST')
                  }
                >
                  {t('수락')}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void mutate(`/api/workspace-invitations/${invitation.id}/decline`, 'POST')
                  }
                >
                  {t('거절')}
                </Button>
              </>
            ) : (
              <Button
                disabled={busy}
                onClick={() =>
                  void mutate(
                    `/api/workspaces/${invitation.workspaceId}/invitations/${invitation.id}/cancel`,
                    'POST',
                  )
                }
              >
                {t('초대 취소')}
              </Button>
            )}
          </div>
        )}
      </li>
    );
  }
  return (
    <section className="workspace-panel" aria-label={t('워크스페이스')}>
      <div className="workspace-selector">
        <label>
          <span>{t('워크스페이스')}</span>
          <Select
            aria-label={t('워크스페이스 선택')}
            value={selected?.id ?? ''}
            onValueChange={onSelect}
          >
            {!selected && <option value="">{t('워크스페이스 선택')}</option>}
            {workspaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name} · {t(roleLabels[space.role])}
                {space.status === 'archived' ? ` · ${t('보관됨')}` : ''}
              </option>
            ))}
          </Select>
        </label>
        <div className="workspace-row-actions">
          <Button
            onClick={() => {
              setName('');
              setError('');
              setMode('create');
            }}
          >
            {t('새 워크스페이스')}
          </Button>
          {selected && (
            <Button
              onClick={() => {
                setError('');
                setMode('manage');
              }}
            >
              {t('멤버 및 초대')}
            </Button>
          )}
          <Button
            onClick={() => {
              setError('');
              setMode('inbox');
            }}
          >
            {t('받은 초대')} <Badge variant="plain">{inbox.filter(pending).length}</Badge>
          </Button>
        </div>
      </div>
      {!selected && <p>{t('첫 워크스페이스를 만들어 설계를 시작하세요.')}</p>}
      {selected?.status === 'archived' && (
        <p className="notice">
          {t('이 워크스페이스는 보관되어 있습니다. 소유자가 복원하면 다시 편집할 수 있습니다.')}
        </p>
      )}
      {selected?.status === 'active' && selected.role === 'viewer' && (
        <p className="workspace-access-note">
          {t('뷰어 권한입니다. 설계를 조회하고 핀과 댓글을 남길 수 있습니다.')}
        </p>
      )}
      {error && !mode && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {mode &&
        createPortal(
          <dialog
            ref={dialog}
            className="workspace-dialog"
            aria-labelledby="workspace-dialog-title"
            onCancel={(event) => {
              event.preventDefault();
              if (!busy) setMode(null);
            }}
          >
            <div className="workspace-dialog-heading">
              <h2 id="workspace-dialog-title">
                {t(
                  mode === 'create'
                    ? '워크스페이스 만들기'
                    : mode === 'inbox'
                      ? '받은 초대'
                      : '워크스페이스 관리',
                )}
              </h2>
              <Button disabled={busy} onClick={() => setMode(null)}>
                {t('닫기')}
              </Button>
            </div>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            {mode === 'create' && (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (
                    await mutate('/api/workspaces', 'POST', { name: name.trim() }, (result) =>
                      onSelect((result as Workspace).id),
                    )
                  )
                    setMode(null);
                }}
              >
                <label>
                  {t('워크스페이스 이름')}
                  <Input
                    autoFocus
                    required
                    maxLength={64}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
                  {t('워크스페이스 만들기')}
                </Button>
              </form>
            )}
            {mode === 'inbox' && (
              <>
                <p>{t('초대를 받으면 이곳에서 수락할 수 있습니다.')}</p>
                <ul className="workspace-list">{inbox.map((item) => invitationRow(item, true))}</ul>
              </>
            )}
            {mode === 'manage' && selected && (
              <>
                {selected.role === 'owner' ? (
                  <form
                    className="workspace-name-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void mutate(`/api/workspaces/${selected.id}`, 'PATCH', { name: name.trim() });
                    }}
                  >
                    <label>
                      {t('워크스페이스 이름')}
                      <Input
                        required
                        maxLength={64}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                    <Button type="submit" disabled={busy || !name.trim()}>
                      {t('이름 저장')}
                    </Button>
                  </form>
                ) : (
                  <h3>{selected.name}</h3>
                )}
                <p className="workspace-access-note">
                  {t('마지막 소유자는 변경하거나 제거할 수 없습니다.')}
                </p>
                <ul className="workspace-list">
                  {members.map((member) => {
                    const lastOwner =
                      member.role === 'owner' &&
                      members.filter((item) => item.role === 'owner').length === 1;
                    return (
                      <li key={member.userId} className="workspace-member">
                        <strong>{member.username}</strong>
                        {selected.role === 'owner' ? (
                          <div className="workspace-row-actions">
                            <Select
                              aria-label={`${member.username} ${t('역할')}`}
                              value={member.role}
                              disabled={busy || lastOwner}
                              onValueChange={(next) =>
                                void mutate(
                                  `/api/workspaces/${selected.id}/members/${member.userId}`,
                                  'PATCH',
                                  { role: next },
                                )
                              }
                            >
                              {Object.entries(roleLabels).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {t(label)}
                                </option>
                              ))}
                            </Select>
                            <Button
                              disabled={busy || lastOwner}
                              onClick={async () => {
                                if (
                                  await confirm({
                                    title: t('멤버 제거'),
                                    description: t('이 멤버를 워크스페이스에서 제거할까요?'),
                                    confirmLabel: t('멤버 제거'),
                                    destructive: true,
                                  })
                                )
                                  void mutate(
                                    `/api/workspaces/${selected.id}/members/${member.userId}`,
                                    'DELETE',
                                  );
                              }}
                            >
                              {t('멤버 제거')}
                            </Button>
                          </div>
                        ) : (
                          <Badge variant="plain">{t(roleLabels[member.role])}</Badge>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {selected.role === 'owner' && (
                  <>
                    <form
                      className="workspace-invite-form"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (
                          await mutate(`/api/workspaces/${selected.id}/invitations`, 'POST', {
                            username: username.trim(),
                            role,
                          })
                        )
                          setUsername('');
                      }}
                    >
                      <h3>{t('사용자명으로 초대')}</h3>
                      <label>
                        {t('사용자명')}
                        <Input
                          required
                          maxLength={40}
                          value={username}
                          onChange={(event) => setUsername(event.target.value)}
                        />
                      </label>
                      <label>
                        {t('역할')}
                        <Select
                          value={role}
                          onValueChange={(value) => setRole(value as WorkspaceRole)}
                        >
                          {Object.entries(roleLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {t(label)}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <Button type="submit" variant="primary" disabled={busy || !username.trim()}>
                        {t('초대')}
                      </Button>
                    </form>
                    <h3>{t('초대 내역')}</h3>
                    <ul className="workspace-list">
                      {invitations.map((item) => invitationRow(item, false))}
                    </ul>
                    {!invitations.length && <p>{t('초대 내역이 없습니다.')}</p>}
                    <div className="workspace-danger-actions">
                      <Button
                        disabled={busy}
                        onClick={async () => {
                          if (
                            selected.status === 'archived' ||
                            (await confirm({
                              title: t('워크스페이스 보관'),
                              description: t(
                                '워크스페이스를 보관하면 모든 프로젝트와 댓글이 읽기 전용이 됩니다.',
                              ),
                              confirmLabel: t('보관'),
                            }))
                          )
                            void mutate(`/api/workspaces/${selected.id}`, 'PATCH', {
                              status: selected.status === 'active' ? 'archived' : 'active',
                            });
                        }}
                      >
                        {t(
                          selected.status === 'active' ? '워크스페이스 보관' : '워크스페이스 복원',
                        )}
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await confirm({
                              title: t('워크스페이스 삭제'),
                              description: t(
                                '빈 워크스페이스만 삭제할 수 있습니다. 삭제하면 복원할 수 없습니다.',
                              ),
                              confirmLabel: t('삭제'),
                              destructive: true,
                            })
                          )
                            if (await mutate(`/api/workspaces/${selected.id}`, 'DELETE'))
                              setMode(null);
                        }}
                      >
                        {t('워크스페이스 삭제')}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </dialog>,
          document.body,
        )}
    </section>
  );
}
