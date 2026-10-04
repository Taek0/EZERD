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
    'Native 설계는 PostgreSQL·MySQL·SQLite별 타입과 검증된 기능을 제공합니다. DDL 내보내기는 선택한 DB의 프로젝트 전체 물리 설계를 SQL로 만듭니다. DB 변경은 미리보기 후 적용할 때 최신 상태를 다시 검증하며, 지원이 확인된 범위만 변환합니다. 미지원 항목이나 의미 손실이 있는 변경은 차단됩니다. 구버전 설계에서 native 기능을 사용하려면 명시적으로 업그레이드해야 하며, 변환할 수 없는 원문은 진단과 함께 보존됩니다.',
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
    'Native designs provide database-specific types and verified features for PostgreSQL, MySQL and SQLite. DDL export creates SQL for the entire physical design in the selected database. Database changes are previewed and revalidated against the latest state when applied, and only verified conversions are supported. Unsupported items or changes that lose meaning are blocked. Legacy designs require an explicit upgrade to use native features; originals that cannot be converted are preserved with diagnostics.',
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
