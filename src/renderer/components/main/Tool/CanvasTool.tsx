/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import MoveIcon from '@assets/svgs/move.svg';
import EraserIcon from '@assets/svgs/eraser.svg';
import BroomIcon from '@assets/svgs/broom.svg';
import LayerStackIcon from './icons/LayerStackIcon';
import PaletteIcon from './icons/PaletteIcon';
import IconMotion from './icons/IconMotion';
import FloatingTooltip from '../Modal/FloatingTooltip';
import { TooltipGroup } from '../Modal/TooltipGroup';
import ListPopup from '../Modal/ListPopup';
import { useIconMotion } from '@hooks/useIconMotion';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';

type SelectableTool = 'move' | 'eraser';
type AddItemType = 'key' | 'stat' | 'graph' | 'knob' | 'sprite';

interface CanvasToolProps {
  onAddItem: (type: AddItemType) => void;
  onTogglePalette: () => void;
  isPaletteOpen: boolean;
  onResetCurrentMode: () => void;
  onResetCounters?: () => void;
  activeTool?: string;
  setActiveTool?: (tool: string) => void;
  primaryButtonRef?: React.RefObject<HTMLButtonElement>;
  interactionDisabled?: boolean;
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
  interactionDisabled = false,
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

  // 포털 메뉴는 ToolBar의 inert 경계 밖에 있으므로 모달 진입 시 닫는다
  useEffect(() => {
    if (!interactionDisabled) return;
    setIsAddPopupOpen(false);
    setIsResetPopupOpen(false);
  }, [interactionDisabled]);

  const handleClick = (key: string) => {
    if (key === 'move' || key === 'eraser') {
      if (key === 'eraser') {
        useGridSelectionStore.getState().clearSelection();
      }
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
      icon: (
        <IconMotion motion="expand">
          <MoveIcon />
        </IconMotion>
      ),
      label: 'Move',
      selected: selectedTool === 'move',
    },
    {
      key: 'eraser',
      icon: (
        <IconMotion motion="wobble">
          <EraserIcon />
        </IconMotion>
      ),
      label: 'Eraser',
      selected: selectedTool === 'eraser',
    },
    // 액션 버튼 모음
    { key: 'layer', icon: <LayerStackIcon />, label: 'Add Key' },
    {
      key: 'primary',
      icon: <PaletteIcon />,
      label: 'Palette',
      selected: isPaletteOpen,
    },
    {
      key: 'broom',
      icon: (
        <IconMotion motion="sweep">
          <BroomIcon />
        </IconMotion>
      ),
      label: 'Reset Current Tab',
    },
  ];

  return (
    <TooltipGroup>
      <div className="flex items-center h-[40px] p-[5px] bg-fill-faint rounded-surface gap-[4px]">
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
        ariaLabel={t('common.more')}
        referenceRef={addButtonRef as unknown as React.RefObject<HTMLElement>}
        onClose={() => setIsAddPopupOpen(false)}
        items={[
          { id: 'addKey', label: t('toolbar.addKey') },
          { id: 'addStat', label: t('toolbar.addStat') },
          { id: 'addGraph', label: t('toolbar.addGraph') },
          { id: 'addKnob', label: t('toolbar.addKnob') },
          { id: 'addSprite', label: t('toolbar.addSprite') },
        ]}
        onSelect={(id) => {
          if (id === 'addKey') {
            onAddItem('key');
          } else if (id === 'addStat') {
            onAddItem('stat');
          } else if (id === 'addGraph') {
            onAddItem('graph');
          } else if (id === 'addKnob') {
            onAddItem('knob');
          } else if (id === 'addSprite') {
            onAddItem('sprite');
          }
          setIsAddPopupOpen(false);
        }}
      />
      <ListPopup
        open={isResetPopupOpen}
        ariaLabel={t('common.more')}
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
    const { motionProps } = useIconMotion();

    return (
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        aria-pressed={isSelected}
        className={`flex items-center justify-center h-[30px] w-[30px] rounded-md transition-colors duration-fast active:bg-fill-hover ${
          isSelected
            ? selectedVariant === 'hover'
              ? 'bg-fill text-fg'
              : 'bg-fill-hover text-fg'
            : 'text-fg-muted hover:bg-fill hover:text-fg'
        }`}
        onClick={onClick}
        {...motionProps}
      >
        {icon}
      </button>
    );
  },
);

IconButton.displayName = 'IconButton';

export default CanvasTool;
