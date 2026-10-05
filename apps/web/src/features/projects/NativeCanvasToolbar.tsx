import { NativeDomainFilter, type NativeDomainFilterValue } from './NativeDomainFilter.js';
import { memo } from 'react';
import { Button, IconButton } from '../../components/ui/index.js';
import { registerTranslations, useI18n } from '../../shared/i18n/index.js';
registerTranslations({
  '전체 테이블': 'All tables',
  '도메인 맵': 'Domain map',
  '보기 선택': 'Choose view',
  '편집 도구': 'Editing tools',
  '보기와 내보내기': 'Views and export',
  '속성 패널': 'Inspector',
  '속성 패널 숨기기': 'Hide inspector',
  '속성 패널 열기': 'Show inspector',
  '커서 도구': 'Select tool',
  '손 도구': 'Hand tool',
  '캔버스 도구': 'Canvas tools',
  '손 도구 · 드래그로 화면 이동': 'Hand tool · drag to pan',
  '커서 도구 · 객체 선택과 이동': 'Select tool · select and move objects',
  '배율 100%로 초기화': 'Reset zoom to 100%',
  '＋ 테이블': '＋ Table',
  '＋ 도메인': '＋ Domain',
  '＋ 메모': '＋ Note',
});
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
  editable,
  noteEditable,
  disabled,
  mode,
  onMode,
  inspectorOpen,
  onToggleInspector,
}: {
  viewId: string;
  views: { id: string; name: string }[];
  onView: (id: string) => void;
  domains?: { id: string; name: string }[];
  filter?: NativeDomainFilterValue | null;
  onFilter?: ((value: NativeDomainFilterValue | null) => void) | undefined;
  onCreate?: ((kind: 'table' | 'domain' | 'enum') => void) | undefined;
  onNote: () => void;
  onTools?: (() => void) | undefined;
  editable: boolean;
  noteEditable: boolean;
  disabled: boolean;
  mode: 'physical' | 'logical';
  onMode?: ((mode: 'physical' | 'logical') => void) | undefined;
  inspectorOpen?: boolean | undefined;
  onToggleInspector?: (() => void) | undefined;
}) {
  const { t } = useI18n();
  return (
    <>
      <nav className="editor-path native-editor-path" aria-label={t('현재 위치')}>
        <span aria-hidden="true">/</span>
        <strong>{views.find((view) => view.id === viewId)?.name ?? t('전체 테이블')}</strong>
      </nav>
      <div className="canvas-toolbar native-canvas-toolbar">
        <div className="actions">
          {onCreate && (
            <div className="toolbar-group" role="group" aria-label={t('편집 도구')}>
              <Button
                disabled={!editable || disabled}
                onClick={() => onCreate(viewId === 'overview' ? 'domain' : 'table')}
              >
                {t(viewId === 'overview' ? '＋ 도메인' : '＋ 테이블')}
              </Button>
              <Button disabled={!noteEditable || disabled} onClick={onNote}>
                {t('＋ 메모')}
              </Button>
            </div>
          )}
          <div className="toolbar-group" role="group" aria-label={t('보기와 내보내기')}>
            <Button
              aria-pressed={viewId === '__tables__'}
              disabled={disabled}
              onClick={() => onView('__tables__')}
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
            {domains && onFilter && (
              <NativeDomainFilter
                domains={domains}
                value={filter ?? null}
                onChange={onFilter}
                disabled={disabled}
              />
            )}
            <select
              aria-label={t('화면')}
              value={viewId}
              disabled={disabled}
              onChange={(e) => onView(e.target.value)}
            >
              {views.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </select>
            {onCreate && (
              <Button onClick={() => onCreate('enum')} disabled={!editable || disabled}>
                ENUM
              </Button>
            )}
            {onTools && <Button onClick={onTools}>{t('공유')} / PNG</Button>}
          </div>
          {onMode && (
            <div className="toolbar-group" role="group" aria-label={t('모델 보기')}>
              <Button aria-pressed={mode === 'physical'} onClick={() => onMode('physical')}>
                {t('물리')}
              </Button>
              <Button aria-pressed={mode === 'logical'} onClick={() => onMode('logical')}>
                {t('논리')}
              </Button>
            </div>
          )}
          {onToggleInspector && (
            <IconButton
              aria-label={t(inspectorOpen ? '속성 패널 숨기기' : '속성 패널 열기')}
              aria-pressed={inspectorOpen}
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
    </>
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
      <IconButton aria-label={t('축소')} onClick={() => onZoom(1 / 1.2)}>
        −
      </IconButton>
      <Button aria-label={t('배율 100%로 초기화')} onClick={onReset}>
        {Math.round(zoom * 100)}%
      </Button>
      <IconButton aria-label={t('확대')} onClick={() => onZoom(1.2)}>
        ＋
      </IconButton>
      <IconButton aria-label={t('중앙으로')} onClick={onFit}>
        ⌖
      </IconButton>
    </div>
  );
}
