import CanvasTool from "./CanvasTool";
import SettingTool from "./SettingTool";
import TabTool from "./TabTool";

type Props = {
  onAddKey: () => void;
  onTogglePalette: () => void;
  isPaletteOpen: boolean;
  onResetCurrentMode: () => void;
  activeTool: string;
  setActiveTool: (tool: string) => void;
  isSettingsOpen?: boolean;
  onOpenSettings?: () => void;
  onCloseSettings?: () => void;
  showAlert?: (message: string) => void;
  onOpenNoteSetting?: () => void;
};

const ToolBar = ({
  onAddKey,
  onTogglePalette,
  isPaletteOpen,
  onResetCurrentMode,
  activeTool,
  setActiveTool,
  isSettingsOpen = false,
  onOpenSettings,
  onCloseSettings,
  showAlert,
  onOpenNoteSetting,
}: Props) => {
  return (
    <div
      className={`flex flex-row items-center w-full h-[60px] min-h-[60px] p-[10px] bg-[#1A191E] border-b border-b-[#2A2A31] ${
        isSettingsOpen ? "justify-end" : "justify-between"
      }`}
    >
      {!isSettingsOpen && <TabTool />}
      <div className="flex gap-[10px]">
        {!isSettingsOpen && (
          <CanvasTool
            onAddKey={onAddKey}
            onTogglePalette={onTogglePalette}
            isPaletteOpen={isPaletteOpen}
            onResetCurrentMode={onResetCurrentMode}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
          />
        )}
        <SettingTool
          isSettingsOpen={isSettingsOpen}
          onOpenSettings={onOpenSettings}
          onCloseSettings={onCloseSettings}
          showAlert={showAlert}
          onOpenNoteSetting={onOpenNoteSetting}
        />
      </div>
    </div>
  );
};

export default ToolBar;
