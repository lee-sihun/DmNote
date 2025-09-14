import CanvasTool from "./CanvasTool";
import TabTool from "./TabTool";

type Props = {
  onAddKey: () => void;
  onTogglePalette: () => void;
  isPaletteOpen: boolean;
  onResetCurrentMode: () => void;
  activeTool: string;
  setActiveTool: (tool: string) => void;
};

const ToolBar = ({
  onAddKey,
  onTogglePalette,
  isPaletteOpen,
  onResetCurrentMode,
  activeTool,
  setActiveTool,
}: Props) => {
  return (
    <div className="flex flex-row items-center justify-between w-full h-[60px] min-h-[60px] p-[10px] bg-[#1A191E] border-b border-b-[#2A2A31]">
      <TabTool />
      <div className="flex gap">
        <CanvasTool
          onAddKey={onAddKey}
          onTogglePalette={onTogglePalette}
          isPaletteOpen={isPaletteOpen}
          onResetCurrentMode={onResetCurrentMode}
          activeTool={activeTool}
          setActiveTool={setActiveTool}
        />
      </div>
    </div>
  );
};

export default ToolBar;
