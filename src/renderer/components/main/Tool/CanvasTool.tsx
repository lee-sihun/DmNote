import React, { useState } from "react";
import { ReactComponent as MoveIcon } from "@assets/svgs/move.svg";
import { ReactComponent as EraserIcon } from "@assets/svgs/eraser.svg";
import { ReactComponent as LayerIcon } from "@assets/svgs/layer.svg";
import { ReactComponent as PrimaryIcon } from "@assets/svgs/primary.svg";
import { ReactComponent as BroomIcon } from "@assets/svgs/broom.svg";

type ToolKey = "move" | "eraser" | "layer" | "primary" | "broom";

const CanvasTool = () => {
  const [selectedTool, setSelectedTool] = useState<ToolKey | null>("move");

  const tools: { key: ToolKey; icon: React.ReactNode; label: string }[] = [
    { key: "move", icon: <MoveIcon />, label: "Move" },
    { key: "eraser", icon: <EraserIcon />, label: "Eraser" },
    { key: "layer", icon: <LayerIcon />, label: "Layer" },
    { key: "primary", icon: <PrimaryIcon />, label: "Primary" },
    { key: "broom", icon: <BroomIcon />, label: "Broom" },
  ];

  return (
    <div className="flex items-center h-[40px] p-[5px] bg-[#0E0E11] rounded-[7px] gap-[5px]">
      {tools.map((t) => (
        <IconButton
          key={t.key}
          icon={t.icon}
          isSelected={selectedTool === t.key}
          onClick={() => setSelectedTool(t.key)}
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
}

const IconButton = ({
  icon,
  isSelected = false,
  onClick,
  ariaLabel,
}: IconButtonProps) => {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      className={`flex items-center h-[30px] px-[8px] rounded-[7px] transition-colors ${
        isSelected ? "bg-[#2A2A31]" : "bg-[#0E0E11] hover:bg-[#1E1E22]"
      }`}
      onClick={onClick}
    >
      {icon}
    </button>
  );
};

export default CanvasTool;
