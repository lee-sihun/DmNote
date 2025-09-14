import React, { useState, useEffect } from "react";
import { ReactComponent as MoveIcon } from "@assets/svgs/move.svg";
import { ReactComponent as EraserIcon } from "@assets/svgs/eraser.svg";
import { ReactComponent as LayerIcon } from "@assets/svgs/layer.svg";
import { ReactComponent as PrimaryIcon } from "@assets/svgs/primary.svg";
import { ReactComponent as BroomIcon } from "@assets/svgs/broom.svg";

type SelectableTool = "move" | "eraser";

type CanvasToolProps = {
  onAddKey: () => void;
  onTogglePalette: () => void;
  isPaletteOpen: boolean;
  onResetCurrentMode: () => void;
  activeTool?: string;
  setActiveTool?: (tool: string) => void;
};

const CanvasTool = ({
  onAddKey,
  onTogglePalette,
  isPaletteOpen,
  onResetCurrentMode,
  activeTool,
  setActiveTool,
}: CanvasToolProps) => {
  const [selectedTool, setSelectedTool] = useState<SelectableTool | null>(
    (activeTool as SelectableTool) || "move"
  );

  // 상태 동기화 
  useEffect(() => {
    if (activeTool === "move" || activeTool === "eraser") {
      setSelectedTool(activeTool as SelectableTool);
    }
  }, [activeTool]);

  const handleClick = (key: string) => {
    if (key === "move" || key === "eraser") {
      setSelectedTool(key as SelectableTool);
      setActiveTool?.(key);
      return;
    }
    if (key === "layer") {
      onAddKey();
      return;
    }
    if (key === "primary") {
      onTogglePalette();
      return;
    }
    if (key === "broom") {
      onResetCurrentMode();
      return;
    }
  };

  const tools: {
    key: "move" | "eraser" | "layer" | "primary" | "broom";
    icon: React.ReactNode;
    label: string;
    selected?: boolean;
  }[] = [
    {
      key: "move",
      icon: <MoveIcon />,
      label: "Move",
      selected: selectedTool === "move",
    },
    {
      key: "eraser",
      icon: <EraserIcon />,
      label: "Eraser",
      selected: selectedTool === "eraser",
    },
    // 액션 버튼 모음 
    { key: "layer", icon: <LayerIcon />, label: "Add Key" },
    {
      key: "primary",
      icon: <PrimaryIcon />,
      label: "Palette",
      selected: isPaletteOpen,
    },
    { key: "broom", icon: <BroomIcon />, label: "Reset Current Tab" },
  ];

  return (
    <div className="flex items-center h-[40px] p-[5px] bg-[#0E0E11] rounded-[7px] gap-[5px]">
      {tools.map((t) => (
        <IconButton
          key={t.key}
          icon={t.icon}
          isSelected={!!t.selected}
          selectedVariant={t.key === "primary" ? "hover" : "default"}
          onClick={() => handleClick(t.key)}
          ariaLabel={t.label}
        />
      ))}
    </div>
  );
};

interface IconButtonProps {
  icon: React.ReactNode;
  isSelected?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  selectedVariant?: "default" | "hover";
}

const IconButton = ({
  icon,
  isSelected = false,
  onClick,
  ariaLabel,
  selectedVariant = "default",
}: IconButtonProps) => {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      className={`flex items-center h-[30px] px-[8px] rounded-[7px] transition-colors active:bg-[#2A2A31] ${
        isSelected
          ? selectedVariant === "hover"
            ? "bg-[#1E1E22]"
            : "bg-[#2A2A31]"
          : "bg-[#0E0E11] hover:bg-[#1E1E22]"
      }`}
      onClick={onClick}
    >
      {icon}
    </button>
  );
};

export default CanvasTool;
