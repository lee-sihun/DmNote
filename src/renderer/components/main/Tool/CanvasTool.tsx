/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import MoveIcon from '@assets/svgs/move.svg';
import EraserIcon from '@assets/svgs/eraser.svg';
import LayerIcon from '@assets/svgs/layer.svg';
import PrimaryIcon from '@assets/svgs/primary.svg';
import BroomIcon from '@assets/svgs/broom.svg';
import FloatingTooltip from '../Modal/FloatingTooltip';
import { TooltipGroup } from '../Modal/TooltipGroup';
import ListPopup from '../Modal/ListPopup';

type SelectableTool = 'move' | 'eraser';
type AddItemType = 'key' | 'stat' | 'graph' | 'dial';

interface CanvasToolProps {
  onAddItem: (type: AddItemType) => void;
  onTogglePalette: () => void;
  isPaletteOpen: boolean;
  onResetCurrentMode: () => void;
  onResetCounters?: () => void;
  activeTool?: string;
  setActiveTool?: (tool: string) => void;
  primaryButtonRef?: React.RefObject<HTMLButtonElement>;
}

const CanvasTool = ({
  onAddItem,
  onTogglePalette,
  isPaletteOpen,
  onResetCurrentMode,
  onResetCounters,
  activeTool,
  setActiveTool,
  primaryButtonRef,
}: CanvasToolProps) => {
  const { t } = useTranslation();
  const [selectedTool, setSelectedTool] = useState<SelectableTool | null>(
    (activeTool as SelectableTool) || 'move',
  );
  const [isAddPopupOpen, setIsAddPopupOpen] = useState(false);
  const [isResetPopupOpen, setIsResetPopupOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const resetButtonRef = useRef<HTMLButtonElement | null>(null);

  // 상태 동기화
  useEffect(() => {
    if (activeTool === 'move' || activeTool === 'eraser') {
      setSelectedTool(activeTool as SelectableTool);
    }
  }, [activeTool]);

  const handleClick = (key: string) => {
    if (key === 'move' || key === 'eraser') {
      setSelectedTool(key as SelectableTool);
      setActiveTool?.(key);
      setIsAddPopupOpen(false);
      setIsResetPopupOpen(false);
      return;
    }
    if (key === 'layer') {
      setIsAddPopupOpen((prev) => !prev);
      setIsResetPopupOpen(false);
      return;
    }
    if (key === 'primary') {
      onTogglePalette();
      setIsAddPopupOpen(false);
      setIsResetPopupOpen(false);
      return;
    }
    if (key === 'broom') {
      setIsResetPopupOpen((prev) => !prev);
      setIsAddPopupOpen(false);
      return;
    }
  };

  const tools: {
    key: 'move' | 'eraser' | 'layer' | 'primary' | 'broom';
    icon: React.ReactNode;
    label: string;
    selected?: boolean;
  }[] = [
    {
      key: 'move',
      icon: <MoveIcon />,
      label: 'Move',
      selected: selectedTool === 'move',
    },
    {
      key: 'eraser',
      icon: <EraserIcon />,
      label: 'Eraser',
      selected: selectedTool === 'eraser',
    },
    // 액션 버튼 모음
    { key: 'layer', icon: <LayerIcon />, label: 'Add Key' },
    {
      key: 'primary',
      icon: <PrimaryIcon />,
      label: 'Palette',
      selected: isPaletteOpen,
    },
    { key: 'broom', icon: <BroomIcon />, label: 'Reset Current Tab' },
  ];

  return (
    <TooltipGroup>
      <div className="flex items-center h-[40px] p-[5px] bg-button-primary rounded-[7px] gap-[5px]">
        {tools.map((toolItem) => (
          <FloatingTooltip
            key={toolItem.key}
            content={
              toolItem.key === 'move'
                ? t('tooltip.move')
                : toolItem.key === 'eraser'
                ? t('tooltip.delete')
                : toolItem.key === 'layer'
                ? t('tooltip.add')
                : toolItem.key === 'primary'
                ? t('tooltip.palette')
                : t('tooltip.resetCurrentTab')
            }
          >
            <IconButton
              ref={
                toolItem.key === 'primary'
                  ? primaryButtonRef
                  : toolItem.key === 'layer'
                  ? (addButtonRef as unknown as React.Ref<HTMLButtonElement>)
                  : toolItem.key === 'broom'
                  ? (resetButtonRef as unknown as React.Ref<HTMLButtonElement>)
                  : undefined
              }
              icon={toolItem.icon}
              isSelected={!!toolItem.selected}
              selectedVariant={toolItem.key === 'primary' ? 'hover' : 'default'}
              onClick={() => handleClick(toolItem.key)}
              ariaLabel={toolItem.label}
            />
          </FloatingTooltip>
        ))}
      </div>
      <ListPopup
        open={isAddPopupOpen}
        referenceRef={addButtonRef as unknown as React.RefObject<HTMLElement>}
        onClose={() => setIsAddPopupOpen(false)}
        items={[
          { id: 'addKey', label: t('toolbar.addKey') },
          { id: 'addStat', label: t('toolbar.addStat') },
          { id: 'addGraph', label: t('toolbar.addGraph') },
          { id: 'addDial', label: t('toolbar.addDial') },
        ]}
        onSelect={(id) => {
          if (id === 'addKey') {
            onAddItem('key');
          } else if (id === 'addStat') {
            onAddItem('stat');
          } else if (id === 'addGraph') {
            onAddItem('graph');
          } else if (id === 'addDial') {
            onAddItem('dial');
          }
          setIsAddPopupOpen(false);
        }}
      />
      <ListPopup
        open={isResetPopupOpen}
        referenceRef={resetButtonRef as unknown as React.RefObject<HTMLElement>}
        onClose={() => setIsResetPopupOpen(false)}
        items={[
          { id: 'resetTab', label: t('toolbar.resetTab') },
          { id: 'resetCounters', label: t('toolbar.resetCounters') },
        ]}
        onSelect={(id) => {
          if (id === 'resetTab') {
            onResetCurrentMode();
          } else if (id === 'resetCounters') {
            onResetCounters?.();
          }
          setIsResetPopupOpen(false);
        }}
      />
    </TooltipGroup>
  );
};

interface IconButtonProps {
  ref?: React.Ref<HTMLButtonElement>;
  icon: React.ReactNode;
  isSelected?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  selectedVariant?: 'default' | 'hover';
}

const IconButton = React.forwardRef<
  HTMLButtonElement,
  Omit<IconButtonProps, 'ref'>
>(
  (
    {
      icon,
      isSelected = false,
      onClick,
      ariaLabel,
      selectedVariant = 'default',
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        aria-pressed={isSelected}
        className={`flex items-center justify-center h-[30px] w-[30px] rounded-[7px] transition-colors active:bg-button-active ${
          isSelected
            ? selectedVariant === 'hover'
              ? 'bg-button-hover'
              : 'bg-button-active'
            : 'bg-button-primary hover:bg-button-hover'
        }`}
        onClick={onClick}
      >
        {icon}
      </button>
    );
  },
);

IconButton.displayName = 'IconButton';

export default CanvasTool;
