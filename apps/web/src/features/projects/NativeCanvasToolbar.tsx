import { NativeDomainFilter, type NativeDomainFilterValue } from './NativeDomainFilter.js';
import { memo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dropdown, IconButton } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';

registerTranslations({
  '더 보기': 'More',
  '전체 테이블': 'All tables',
  '도메인 맵': 'Domain map',
  '보기 선택': 'Choose view',
  '편집 도구': 'Editing tools',
  '보기와 내보내기': 'Views and export',
  '속성 패널 숨기기': 'Hide inspector',
  '속성 패널 열기': 'Show inspector',
  '커서 도구': 'Select tool',
  '손 도구': 'Hand tool',
  '캔버스 도구': 'Canvas tools',
  '배율 100%로 초기화': 'Reset zoom to 100%',
  '＋ 테이블': '＋ Table',
  '＋ 도메인': '＋ Domain',
  '＋ 메모': '＋ Note',
  '캔버스 작업': 'Canvas actions',
  '자동 배치': 'Automatic layout',
  '관계 경로 초기화': 'Reset relation routes',
  '프로젝트 내보내기': 'Export project',
  'DDL 내보내기': 'Export DDL',
  '고화질 PNG': 'High resolution PNG',
  공유: 'Share',
});

export interface NativeCanvasToolbarProps {
  pathHost?: HTMLElement | null | undefined;
  panelToggle?: ReactNode;
  exportControl?: ReactNode;
  viewId: string;
  views: { id: string; name: string }[];
  onView: (id: string) => void;
  domains?: { id: string; name: string; color?: string | null | undefined }[];
  filter?: NativeDomainFilterValue | null;
  onFilter?: ((value: NativeDomainFilterValue | null) => void) | undefined;
  onCreate?: ((kind: 'table' | 'domain' | 'enum') => void) | undefined;
  onNote: () => void;
  onTools?: (() => void) | undefined;
  onAutoLayout?: (() => void) | undefined;
  onResetRoutes?: (() => void) | undefined;
  onPaste?: (() => void) | undefined;
  onExportProject?: (() => void) | undefined;
  onExportDDL?: (() => void) | undefined;
  onExportPNG?: (() => void) | undefined;
  onOpenEnums?: (() => void) | undefined;
  exportBusy?: boolean;
  editable: boolean;
  noteEditable: boolean;
  disabled: boolean;
  mode: 'physical' | 'logical';
  onMode?: ((mode: 'physical' | 'logical') => void) | undefined;
  inspectorOpen?: boolean | undefined;
  onToggleInspector?: (() => void) | undefined;
}

export const NativeCanvasToolbar = memo(function NativeCanvasToolbar({
  viewId,
  views,
  onView,
  domains,
  filter,
  onFilter,
  onCreate,
  onNote,
  onTools,
  onAutoLayout,
  onResetRoutes,
  onPaste,
  onExportProject,
  onExportDDL,
  onExportPNG,
  onOpenEnums,
  exportBusy = false,
  editable,
  noteEditable,
  disabled,
  mode,
  onMode,
  inspectorOpen,
  onToggleInspector,
  exportControl,
  pathHost,
  panelToggle,
}: NativeCanvasToolbarProps) {
  const { t } = useI18n();
  const filteredNames = filter
    ? [
        ...(domains ?? [])
          .filter((domain) => filter.domainIds.includes(domain.id))
          .map((domain) => domain.name),
        ...(filter.unassigned ? [t('미지정')] : []),
      ]
    : [];
  const viewName =
    viewId === 'overview'
      ? t('도메인 맵')
      : (views.find((view) => view.id === viewId)?.name ??
        domains?.find((domain) => domain.id === viewId)?.name ??
        t('전체 테이블'));
  const currentPath =
    viewId === '__tables__' && filter
      ? `${viewName} · ${filteredNames.join(' · ') || t('선택 없음')}`
      : viewName;
  const writeBlocked = !editable || disabled;
  const path = (
    <nav className="editor-path native-editor-path" aria-label={t('현재 위치')}>
      <span className="path-sep" aria-hidden="true">
        /
      </span>
      <strong className="path-current" title={currentPath}>
        {currentPath}
      </strong>
    </nav>
  );
  const exports = [
    {
      id: 'project-export',
      label: t('프로젝트 내보내기'),
      disabled: disabled || exportBusy || !onExportProject,
      onAction: () => onExportProject?.(),
    },
    {
      id: 'ddl-export',
      label: t('DDL 내보내기'),
      disabled: disabled || exportBusy || !onExportDDL,
      onAction: () => onExportDDL?.(),
    },
    {
      id: 'png-export',
      label: t('고화질 PNG'),
      disabled: disabled || exportBusy || !onExportPNG,
      onAction: () => onExportPNG?.(),
    },
  ];
  return (
    <div className="canvas-toolbar native-canvas-toolbar" data-view-id={viewId}>
      {pathHost === undefined ? path : pathHost ? createPortal(path, pathHost) : null}
      <div className="actions">
        <div className="toolbar-group toolbar-create" role="group" aria-label={t('편집 도구')}>
          {onCreate && (
            <Button
              disabled={writeBlocked}
              onClick={() => onCreate(viewId === 'overview' ? 'domain' : 'table')}
            >
              {t(viewId === 'overview' ? '＋ 도메인' : '＋ 테이블')}
            </Button>
          )}
          <Button disabled={!noteEditable || disabled} onClick={onNote}>
            {t('＋ 메모')}
          </Button>
        </div>
        <span className="toolbar-divider" aria-hidden="true" />
        <div className="toolbar-group" role="group" aria-label={t('보기와 내보내기')}>
          <Button
            aria-pressed={viewId === '__tables__'}
            disabled={disabled}
            onClick={() => {
              onFilter?.(null);
              onView('__tables__');
            }}
          >
            {t('전체 테이블')}
          </Button>
          <Button
            aria-pressed={viewId === 'overview'}
            disabled={disabled}
            onClick={() => onView('overview')}
          >
            {t('도메인 맵')}
          </Button>
          {viewId === '__tables__' && domains && onFilter && (
            <NativeDomainFilter
              domains={domains}
              value={filter ?? null}
              onChange={onFilter}
              disabled={disabled}
            />
          )}
          {viewId === '__tables__' && filter && onFilter && (
            <Button disabled={disabled} onClick={() => onFilter(null)}>
              {t('필터 해제')}
            </Button>
          )}
          {views.some((view) => !['overview', '__tables__'].includes(view.id)) && (
            <Dropdown
              label={t('보기 선택')}
              trigger={
                <Button disabled={disabled} aria-label={t('보기 선택')}>
                  {t('보기 선택')} ▾
                </Button>
              }
              items={views.map((view) => ({
                id: view.id,
                label: view.name,
                disabled,
                onAction: () => onView(view.id),
              }))}
            />
          )}
          {(onOpenEnums || onCreate) && (
            <Button
              disabled={disabled || (!onOpenEnums && !editable)}
              onClick={() => (onOpenEnums ? onOpenEnums() : onCreate?.('enum'))}
            >
              ENUM
            </Button>
          )}
          {exportControl ??
            ((onExportProject || onExportDDL || onExportPNG) && (
              <Dropdown
                label={t('공유')}
                trigger={
                  <IconButton
                    aria-label={t('공유')}
                    title={t('공유')}
                    aria-busy={exportBusy}
                    disabled={disabled || exportBusy}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden="true"
                    >
                      <circle cx="18" cy="5" r="3" />
                      <circle cx="6" cy="12" r="3" />
                      <circle cx="18" cy="19" r="3" />
                      <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
                    </svg>
                  </IconButton>
                }
                items={exports}
              />
            ))}
        </div>
        <span className="toolbar-divider" aria-hidden="true" />
        <div className="toolbar-group" role="group" aria-label={t('캔버스 작업')}>
          {onAutoLayout && (
            <Button disabled={!noteEditable || disabled} onClick={onAutoLayout}>
              {t('자동 배치')}
            </Button>
          )}
          {(onCreate || onTools || onResetRoutes || onPaste) && (
            <Dropdown
              label={t('캔버스 작업')}
              trigger={
                <IconButton aria-label={t('더 보기')} title={t('더 보기')} disabled={disabled}>
                  ⋯
                </IconButton>
              }
              items={[
                ...(onCreate
                  ? [
                      {
                        id: 'create-table',
                        label: t('＋ 테이블'),
                        disabled: writeBlocked || viewId === 'overview',
                        onAction: () => onCreate('table'),
                      },
                      {
                        id: 'create-domain',
                        label: t('＋ 도메인'),
                        disabled: writeBlocked,
                        onAction: () => onCreate('domain'),
                      },
                      {
                        id: 'create-enum',
                        label: '＋ ENUM',
                        disabled: writeBlocked,
                        onAction: () => onCreate('enum'),
                      },
                    ]
                  : []),
                {
                  id: 'create-note',
                  label: t('＋ 메모'),
                  disabled: !noteEditable || disabled,
                  onAction: onNote,
                },
                ...(onPaste
                  ? [
                      {
                        id: 'paste',
                        label: t('붙여넣기'),
                        disabled: writeBlocked || viewId === 'overview',
                        onAction: onPaste,
                      },
                    ]
                  : []),
                ...(onAutoLayout
                  ? [
                      {
                        id: 'auto-layout',
                        label: t('자동 배치'),
                        disabled: !noteEditable || disabled,
                        onAction: onAutoLayout,
                      },
                    ]
                  : []),
                ...(onResetRoutes
                  ? [
                      {
                        id: 'reset-routes',
                        label: t('관계 경로 초기화'),
                        disabled: !noteEditable || disabled,
                        onAction: onResetRoutes,
                      },
                    ]
                  : []),
                ...(onTools ? [{ id: 'tools', label: t('도구'), onAction: onTools }] : []),
              ]}
            />
          )}
        </div>
        {onMode && (
          <div className="toolbar-group" role="group" aria-label={t('모델 보기')}>
            <Button
              disabled={disabled}
              aria-pressed={mode === 'physical'}
              onClick={() => onMode('physical')}
            >
              {t('물리')}
            </Button>
            <Button
              disabled={disabled}
              aria-pressed={mode === 'logical'}
              onClick={() => onMode('logical')}
            >
              {t('논리')}
            </Button>
          </div>
        )}
        <div
          className="toolbar-group panel-toggles"
          role="group"
          aria-label={t('협업과 속성 패널')}
        >
          {panelToggle}
          {onToggleInspector && (
            <IconButton
              className="inspector-toggle panel-toggle"
              aria-label={t(inspectorOpen ? '속성 패널 숨기기' : '속성 패널 열기')}
              title={t(inspectorOpen ? '속성 패널 숨기기' : '속성 패널 열기')}
              aria-pressed={inspectorOpen}
              aria-expanded={inspectorOpen}
              aria-controls="native-canvas-inspector"
              onClick={onToggleInspector}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <rect x="2" y="3" width="16" height="14" rx="3" stroke="currentColor" />
                <path d="M12 3v14" stroke="currentColor" />
              </svg>
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
});
export function NativeCameraControls({
  tool,
  onTool,
  zoom,
  onZoom,
  onReset,
  onFit,
}: {
  tool: 'select' | 'hand';
  onTool: (tool: 'select' | 'hand') => void;
  zoom: number;
  onZoom: (factor: number) => void;
  onReset: () => void;
  onFit: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="zoom-controls native-camera-controls"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="canvas-tool-picker" role="group" aria-label={t('캔버스 도구')}>
        <IconButton
          aria-label={t('커서 도구')}
          aria-keyshortcuts="V"
          tooltip={`${t('커서 도구')} (V)`}
          aria-pressed={tool === 'select'}
          onClick={() => onTool('select')}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="m4 2 12 8-6 1-3 6-3-15Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </IconButton>
        <IconButton
          aria-label={t('손 도구')}
          aria-keyshortcuts="H"
          tooltip={`${t('손 도구')} (H)`}
          aria-pressed={tool === 'hand'}
          onClick={() => onTool('hand')}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M6 10V5a1.3 1.3 0 0 1 2.6 0v4-6a1.3 1.3 0 0 1 2.6 0v6-5a1.3 1.3 0 0 1 2.6 0v5-3a1.3 1.3 0 0 1 2.6 0v6c0 4-2 6-5.5 6H9c-2 0-3-1-4-3L2 11c-1-2 1-3 2-1l2 2"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </IconButton>
      </div>
      <IconButton aria-label={t('축소')} tooltip={t('축소')} onClick={() => onZoom(1 / 1.2)}>
        −
      </IconButton>
      <Button aria-label={t('배율 100%로 초기화')} onClick={onReset}>
        {Math.round(zoom * 100)}%
      </Button>
      <IconButton aria-label={t('확대')} tooltip={t('확대')} onClick={() => onZoom(1.2)}>
        ＋
      </IconButton>
      <IconButton aria-label={t('중앙으로')} tooltip={t('중앙으로')} onClick={onFit}>
        ⌖
      </IconButton>
    </div>
  );
}
