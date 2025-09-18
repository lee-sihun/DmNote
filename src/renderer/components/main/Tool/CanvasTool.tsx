import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import MoveIcon from "@assets/svgs/move.svg";
import EraserIcon from "@assets/svgs/eraser.svg";
import LayerIcon from "@assets/svgs/layer.svg";
import PrimaryIcon from "@assets/svgs/primary.svg";
import BroomIcon from "@assets/svgs/broom.svg";
import FloatingTooltip from "../modal/FloatingTooltip";
import { TooltipGroup } from "../modal/TooltipGroup";

type SelectableTool = "move" | "eraser";

type CanvasToolProps = {
  onAddKey: () => void;
  onTogglePalette: () => void;
  isPaletteOpen: boolean;
  onResetCurrentMode: () => void;
  activeTool?: string;
  setActiveTool?: (tool: string) => void;
  primaryButtonRef?: React.RefObject<HTMLButtonElement>;
};

const CanvasTool = ({
  onAddKey,
  onTogglePalette,
  isPaletteOpen,
  onResetCurrentMode,
  activeTool,
  setActiveTool,
  primaryButtonRef,
}: CanvasToolProps) => {
  const { t } = useTranslation();
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
    <TooltipGroup>
      <div className="flex items-center h-[40px] p-[5px] bg-button-primary rounded-[7px] gap-[5px]">
        {tools.map((toolItem) => (
          <FloatingTooltip
            key={toolItem.key}
            content={
              toolItem.key === "move"
                ? t("tooltip.move")
                : toolItem.key === "eraser"
                ? t("tooltip.eraser")
                : toolItem.key === "layer"
                ? t("tooltip.addKey")
                : toolItem.key === "primary"
                ? t("tooltip.palette")
                : t("tooltip.resetCurrentTab")
            }
          >
            <IconButton
              ref={toolItem.key === "primary" ? primaryButtonRef : undefined}
              icon={toolItem.icon}
              isSelected={!!toolItem.selected}
              selectedVariant={toolItem.key === "primary" ? "hover" : "default"}
              onClick={() => handleClick(toolItem.key)}
              ariaLabel={toolItem.label}
            />
          </FloatingTooltip>
        ))}
      </div>
    </TooltipGroup>
  );
};

interface IconButtonProps {
  ref?: React.Ref<HTMLButtonElement>;
  icon: React.ReactNode;
  isSelected?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  selectedVariant?: "default" | "hover";
}

const IconButton = React.forwardRef<
  HTMLButtonElement,
  Omit<IconButtonProps, "ref">
>(
  (
    {
      icon,
      isSelected = false,
      onClick,
      ariaLabel,
      selectedVariant = "default",
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        aria-pressed={isSelected}
        className={`flex items-center justify-center h-[30px] w-[30px] rounded-[7px] transition-colors active:bg-button-active ${
          isSelected
            ? selectedVariant === "hover"
              ? "bg-button-hover"
              : "bg-button-active"
            : "bg-button-primary hover:bg-button-hover"
        }`}
        onClick={onClick}
      >
        {icon}
      </button>
    );
  }
);

IconButton.displayName = "IconButton";

export default CanvasTool;
