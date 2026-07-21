import CanvasTool from './CanvasTool';
import SettingTool from './SettingTool';
import TabTool from './TabTool';
import Github from '@assets/svgs/github.svg';
import Bug from '@assets/svgs/code.svg';
import NoteIcon from '@assets/svgs/note.svg';
import { TooltipGroup } from '../Modal/TooltipGroup';
import { useTranslation } from '@contexts/useTranslation';
import FloatingTooltip from '../Modal/FloatingTooltip';
import { useSettingsStore } from '@stores/useSettingsStore';

interface ToolBarProps {
  onAddItem: (type: 'key' | 'stat' | 'graph' | 'knob') => void;
  onTogglePalette: () => void;
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
  const handleClick = (link: string) => {
    window.api.app.openExternal(link);
  };

  return (
    <div
      className={`flex flex-row items-center w-full h-[60px] min-h-[60px] p-[10px] bg-app border-t border-line justify-between`}
    >
      {isSettingsOpen ? (
        <TooltipGroup>
          <div className="flex gap-[8px]">
            <div className="flex items-center h-[40px] p-[5px] bg-fill rounded-surface gap-[4px]">
              <FloatingTooltip content={t('tooltip.github')}>
                <button
                  onClick={() =>
                    handleClick('https://github.com/DmNote-App/DmNote')
                  }
                  className="flex items-center justify-center w-[30px] h-[30px] rounded-md text-fg-muted hover:bg-fill hover:text-fg active:bg-fill-hover transition-colors duration-fast"
                >
                  <Github className="flex-shrink-0 mb-[3px]" />
                </button>
              </FloatingTooltip>
              <FloatingTooltip content={t('tooltip.issue')}>
                <button
                  onClick={() =>
                    handleClick('https://github.com/DmNote-App/DmNote/issues')
                  }
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
          // onOpenNoteSetting={onOpenNoteSetting}
        />
      </div>
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

  if (!noteEffect) return null;

  return (
    <TooltipGroup>
      <div className="flex items-center h-[40px] p-[5px] bg-fill rounded-surface">
        <FloatingTooltip content={t('tooltip.trackSettings') || '트랙 설정'}>
          <button
            type="button"
            onClick={onOpenNoteSetting}
            className="flex items-center justify-center h-[30px] w-[30px] rounded-md text-fg-muted hover:bg-fill hover:text-fg active:bg-fill-hover transition-colors duration-fast"
          >
            <NoteIcon />
          </button>
        </FloatingTooltip>
      </div>
    </TooltipGroup>
  );
};

export default ToolBar;
