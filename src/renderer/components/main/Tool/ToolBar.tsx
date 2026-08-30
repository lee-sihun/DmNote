import { useEffect } from 'react';
import CanvasTool from './CanvasTool';
import SettingTool from './SettingTool';
import TabTool from './TabTool';
import Github from '@assets/svgs/github.svg';
import Bug from '@assets/svgs/code.svg';
import FaderIcon from './icons/FaderIcon';
import { TooltipGroup } from '../Modal/TooltipGroup';
import { useTranslation } from '@contexts/useTranslation';
import FloatingTooltip from '../Modal/FloatingTooltip';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useSingleFlightAction } from '@hooks/useSingleFlightAction';
import { useIconMotion } from '@hooks/useIconMotion';
import { appApi } from '@api/modules/appApi';
import { useModalLayerActive } from '../Modal/popupLayer';

interface ToolBarProps {
  onAddItem: (type: 'key' | 'stat' | 'graph' | 'knob' | 'sprite') => void;
  onTogglePalette: () => void;
  onClosePalette: () => void;
  isPaletteOpen: boolean;
  onResetCurrentMode: () => void;
  onResetCounters?: () => void;
  activeTool: string;
  setActiveTool: (tool: string) => void;
  isSettingsOpen?: boolean;
  onOpenSettings?: () => void;
  onCloseSettings?: () => void;
  showAlert?: (message: string) => void;
  onOpenNoteSetting?: () => void;
  primaryButtonRef?: React.RefObject<HTMLButtonElement>;
}

const ToolBar = ({
  onAddItem,
  onTogglePalette,
  onClosePalette,
  isPaletteOpen,
  onResetCurrentMode,
  onResetCounters,
  activeTool,
  setActiveTool,
  isSettingsOpen = false,
  onOpenSettings,
  onCloseSettings,
  showAlert,
  onOpenNoteSetting,
  primaryButtonRef,
}: ToolBarProps) => {
  const { t } = useTranslation();
  const modalLayerActive = useModalLayerActive();
  const { run: openExternal, pending: isOpeningExternal } =
    useSingleFlightAction((link: string) => appApi.openExternal(link));
  const handleExternal = (link: string) => {
    void openExternal(link).catch((error) =>
      console.error('Failed to open external link', error),
    );
  };

  // 툴바 포털로 열린 팔레트는 inert 루트 밖에 있으므로 함께 닫는다
  useEffect(() => {
    if (modalLayerActive && isPaletteOpen) onClosePalette();
  }, [isPaletteOpen, modalLayerActive, onClosePalette]);

  return (
    <div
      data-dmn-toolbar="true"
      data-dmn-modal-locked={modalLayerActive ? 'true' : undefined}
      aria-disabled={modalLayerActive || undefined}
      inert={modalLayerActive ? true : undefined}
      className="relative flex flex-row items-center w-full h-[60px] min-h-[60px] p-[10px] bg-app border-t border-line justify-between"
    >
      {isSettingsOpen ? (
        <TooltipGroup>
          <div className="flex gap-[8px]">
            <div className="flex items-center h-[40px] p-[5px] bg-fill-faint rounded-surface gap-[4px]">
              <FloatingTooltip content={t('tooltip.github')}>
                <button
                  onClick={() =>
                    handleExternal('https://github.com/DmNote-App/DmNote')
                  }
                  disabled={isOpeningExternal}
                  className="flex items-center justify-center w-[30px] h-[30px] rounded-md text-fg-muted hover:bg-fill hover:text-fg active:bg-fill-hover transition-colors duration-fast"
                >
                  <Github className="flex-shrink-0 mb-[3px]" />
                </button>
              </FloatingTooltip>
              <FloatingTooltip content={t('tooltip.issue')}>
                <button
                  onClick={() =>
                    handleExternal(
                      'https://github.com/DmNote-App/DmNote/issues',
                    )
                  }
                  disabled={isOpeningExternal}
                  className="flex items-center justify-center gap-[8px] h-[30px] px-[12px] rounded-md text-fg-muted hover:bg-fill hover:text-fg active:bg-fill-hover transition-colors duration-fast"
                >
                  <Bug className="flex-shrink-0" />
                  <p className="text-label truncate">Report</p>
                </button>
              </FloatingTooltip>
            </div>
          </div>
        </TooltipGroup>
      ) : (
        <TabTool />
      )}
      <div className="flex gap-[8px]">
        {!isSettingsOpen && (
          <CanvasTool
            onAddItem={onAddItem}
            onTogglePalette={onTogglePalette}
            isPaletteOpen={isPaletteOpen}
            onResetCurrentMode={onResetCurrentMode}
            onResetCounters={onResetCounters}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            primaryButtonRef={primaryButtonRef}
            interactionDisabled={modalLayerActive}
          />
        )}
        {!isSettingsOpen && (
          <TrackSettingButton onOpenNoteSetting={onOpenNoteSetting} t={t} />
        )}
        <SettingTool
          isSettingsOpen={isSettingsOpen}
          onOpenSettings={onOpenSettings}
          onCloseSettings={onCloseSettings}
          showAlert={showAlert}
          interactionDisabled={modalLayerActive}
          // onOpenNoteSetting={onOpenNoteSetting}
        />
      </div>

      {/* 모달 딤은 조상 opacity가 아니라 형제 오버레이가 소유한다. opacity < 1인
          조상은 backdrop root가 되어 안쪽 글래스 팝업의 블러를 죽이고, 페이드가
          끝나 opacity가 1에 닿는 순간 블러가 튀어 돌아온다.
          알파 합성은 backdrop 재필터를 만들지 않아 Windows 비용도 늘지 않는다.
          입력 차단은 그대로 inert가 맡는다.
          -top-px는 padding box 밖에 남는 border-t까지 덮는다 */}
      <div
        aria-hidden="true"
        data-dmn-modal-dim="true"
        className={`absolute inset-x-0 -top-px bottom-0 bg-app pointer-events-none transition-opacity duration-fast ${
          modalLayerActive ? 'opacity-60' : 'opacity-0'
        }`}
      />
    </div>
  );
};

const TrackSettingButton = ({
  onOpenNoteSetting,
  t,
}: {
  onOpenNoteSetting?: () => void;
  t: (key: string) => string;
}) => {
  const { noteEffect } = useSettingsStore();
  const { motionProps } = useIconMotion();

  if (!noteEffect) return null;

  return (
    <TooltipGroup>
      <div className="flex items-center h-[40px] p-[5px] bg-fill-faint rounded-surface">
        <FloatingTooltip content={t('tooltip.trackSettings') || '트랙 설정'}>
          <button
            type="button"
            onClick={onOpenNoteSetting}
            className="flex items-center justify-center h-[30px] w-[30px] rounded-md text-fg-muted hover:bg-fill hover:text-fg active:bg-fill-hover transition-colors duration-fast"
            {...motionProps}
          >
            <FaderIcon />
          </button>
        </FloatingTooltip>
      </div>
    </TooltipGroup>
  );
};

export default ToolBar;
