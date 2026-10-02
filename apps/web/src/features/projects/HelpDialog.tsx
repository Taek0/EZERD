import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
import '../../components/ui/confirm.css';

const guidance = [
  [
    '프로젝트 만들기',
    '＋ 또는 새 프로젝트 카드를 누르면 이름과 데이터베이스를 바로 편집할 수 있습니다. 이름을 비운 채 다른 작업을 하면 “새 프로젝트”로 저장되며, 같은 이름이 있으면 “새 프로젝트 1”, “새 프로젝트 2”처럼 번호가 붙습니다. 취소하면 작성 중인 새 카드는 사라집니다.',
  ],
  [
    '워크스페이스 이동',
    '상단 워크스페이스 이름을 눌러 공간을 전환하세요. 작성 중인 프로젝트는 저장한 뒤 이동합니다. 프로젝트 메뉴에서 수정, 내보내기, 보관을 할 수 있습니다.',
  ],
  [
    '캔버스 조작',
    '커서 도구로 항목을 선택하고 편집하세요. 손 도구로 드래그하거나 마우스 가운데 버튼을 누른 채 드래그하면 화면을 이동할 수 있습니다.',
  ],
  [
    '데이터베이스 종류',
    '프로젝트의 데이터베이스 종류는 분류 정보입니다. 현재 모델링 타입과 SQL 기능은 PostgreSQL을 기준으로 제공되며, MySQL 또는 SQLite를 선택해도 해당 엔진으로 자동 변환되지는 않습니다.',
  ],
] as const;
registerTranslations({
  도움말: 'Help',
  '프로젝트 만들기': 'Create a project',
  '워크스페이스 이동': 'Switch workspaces',
  '캔버스 조작': 'Navigate the canvas',
  '데이터베이스 종류': 'Database kind',
  [guidance[0][1]]:
    'Choose + or the New project card to edit its name and database. If you leave the name blank and start another action, it is saved as “새 프로젝트”, followed by “새 프로젝트 1”, “새 프로젝트 2”, and so on when the name is already used. Cancel removes the new draft card.',
  [guidance[1][1]]:
    'Choose the workspace name in the header to switch spaces. A project being edited is saved before switching. Use the project menu to edit, export, or archive a project.',
  [guidance[2][1]]:
    'Use the cursor tool to select and edit items. Drag with the hand tool, or hold the middle mouse button and drag, to pan the canvas.',
  [guidance[3][1]]:
    'The project database kind is classification metadata. Modeling types and SQL features currently target PostgreSQL. Choosing MySQL or SQLite does not automatically convert the design to that engine.',
});
export function HelpDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      returnFocus?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="confirmation-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId}>{t('도움말')}</h2>
      {guidance.map(([heading, description]) => (
        <p key={heading}>
          <strong>{t(heading)}</strong>
          <br />
          {t(description)}
        </p>
      ))}
      <div className="confirmation-dialog-actions">
        <Button onClick={onClose}>{t('닫기')}</Button>
      </div>
    </dialog>,
    document.body,
  );
}
