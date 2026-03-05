import React, { memo, useMemo, useCallback, useRef, useEffect } from 'react';
import { getKeySignal } from '@stores/signals/keySignals';
import { getKeyCounterSignal } from '@stores/signals/keyCounterSignals';
import { useSignals } from '@preact/signals-react/runtime';
import { isMac } from '@utils/core/platform';
import { useDraggable } from '@hooks/Grid';
import { getKeyInfoByGlobalKey } from '@utils/core/KeyMaps';
import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
} from '@src/types/keys';
import { useSmartGuidesElements } from '@hooks/Grid';
import { useSmartGuidesStore } from '@stores/useSmartGuidesStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useGridSelectionStore } from '@stores/useGridSelectionStore';
import { resolveImageSource } from '@utils/core/imageSource';
import { warmupImageSource } from '@utils/core/imageWarmup';
import CountDisplay from '@components/overlay/counters/CountDisplay';
import {
  calculateBounds,
  calculateSnapPoints,
  calculateGroupBounds,
} from '@utils/grid/smartGuides';

interface KeyPosition {
  hidden?: boolean;
  dx: number;
  dy: number;
  width: number;
  height?: number;
  activeImage?: string;
  inactiveImage?: string;
  activeTransparent?: boolean;
  idleTransparent?: boolean;
  className?: string;
  backgroundColor?: string;
  activeBackgroundColor?: string;
  borderColor?: string;
  activeBorderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  fontSize?: number;
  fontColor?: string;
  activeFontColor?: string;
  fontFamily?: string;
  idleImageFit?: string;
  activeImageFit?: string;
  imageFit?: string;
  useInlineStyles?: boolean;
  displayText?: string;
  fontWeight?: number;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  fontStrikethrough?: boolean;
  counter?: any;
  zIndex?: number;
}

interface SelectedElement {
  id: string;
  type?: string;
  index?: number;
}

interface DraggableKeyProps {
  index: number;
  elementId?: string;
  position: KeyPosition;
  keyName: string;
  onPositionChange: (index: number, dx: number, dy: number) => void;
  onClick?: (e: React.MouseEvent) => void;
  onCtrlClick?: (e: React.MouseEvent) => void;
  onShiftClick?: (e: React.MouseEvent) => void;
  isSelected?: boolean;
  selectedElements?: SelectedElement[];
  onMultiDrag?: (dx: number, dy: number) => void;
  onMultiDragStart?: () => void;
  onMultiDragEnd?: () => void;
  activeTool?: string;
  onEraserClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  setReferenceRef?: (node: HTMLElement | null) => void;
  zoom?: number;
  panX?: number;
  panY?: number;
  zIndex?: number;
  isViewportTransforming?: boolean;
  counterEnabled?: boolean;
  counterPreviewValue?: number;
  counterValueSignal?: { value: number };
}

interface KeyProps {
  keyName: string;
  globalKey: string;
  position: KeyPosition;
  mode?: string;
  counterEnabled?: boolean;
}

export default function DraggableKey({
  index,
  elementId,
  position,
  keyName,
  onPositionChange,
  onClick,
  onCtrlClick,
  onShiftClick,
  isSelected = false,
  selectedElements = [],
  onMultiDrag,
  onMultiDragStart,
  onMultiDragEnd,
  activeTool,
  onEraserClick,
  onContextMenu,
  setReferenceRef,
  zoom = 1,
  panX = 0,
  panY = 0,
  zIndex = 0,
  isViewportTransforming = false,
  counterEnabled = false,
  counterPreviewValue = 0,
  counterValueSignal,
}: DraggableKeyProps) {
  if (position?.hidden) return null;
  useSignals();

  const macOS = isMac();
  const { displayName } = getKeyInfoByGlobalKey(keyName);
  const {
    dx,
    dy,
    width,
    height = 60,
    activeImage: _activeImage,
    inactiveImage,
    className,
    backgroundColor,
    borderColor,
    borderWidth,
    borderRadius,
    fontSize,
    fontColor,
    fontFamily,
    idleImageFit,
    imageFit,
    useInlineStyles,
    displayText,
    fontWeight,
    fontItalic,
    fontUnderline,
    fontStrikethrough,
    counter,
  } = position;

  const labelText = displayText || displayName;
  const inactiveImageSrc = resolveImageSource(inactiveImage);

  const counterSettings = normalizeCounterSettings(
    counter ?? createDefaultCounterSettings(),
  );

  const showInsideCounter =
    counterEnabled &&
    counterSettings.enabled &&
    counterSettings.placement === 'inside';

  const { getOtherElements } = useSmartGuidesElements();

  const gridSnapSize = useSettingsStore(
    (state: any) => state.gridSettings?.gridSnapSize || 5,
  );

  const isDraggingOrResizing = useGridSelectionStore(
    (state: any) => state.isDraggingOrResizing,
  );

  const multiDragRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    lastSnappedDeltaX: number;
    lastSnappedDeltaY: number;
  }>({ isDragging: false, startX: 0, startY: 0, lastSnappedDeltaX: 0, lastSnappedDeltaY: 0 });
  const nodeRef = useRef<HTMLElement | null>(null);
  const effectiveElementId = elementId || `key-${index}`;

  const isSelectionMode = isSelected;

  const draggable = useDraggable({
    gridSize: gridSnapSize,
    initialX: dx,
    initialY: dy,
    onPositionChange: (newDx: number, newDy: number) => {
      if (!isSelectionMode) {
        onPositionChange(index, newDx, newDy);
      }
    },
    zoom,
    panX,
    panY,
    elementId: effectiveElementId,
    elementWidth: width || 60,
    elementHeight: height || 60,
    getOtherElements,
    disabled: isSelectionMode,
  });

  const handleSelectionDragMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!isSelectionMode || e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      useSmartGuidesStore.getState().clearGuides();

      useGridSelectionStore.getState().setDraggingOrResizing(true);

      onMultiDragStart?.();

      const startDx = dx;
      const startDy = dy;
      const currentWidth = width || 60;
      const currentHeight = height || 60;
      const currentElementId = effectiveElementId;

      multiDragRef.current = {
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        lastSnappedDeltaX: 0,
        lastSnappedDeltaY: 0,
      };

      let rafId: number | null = null;
      let dragEnded = false;
      const smartGuidesStore = useSmartGuidesStore.getState();

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!multiDragRef.current.isDragging || dragEnded) return;

        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;

          if (dragEnded) return;

          const currentZoom = zoom;
          const rawDeltaX =
            (moveEvent.clientX - multiDragRef.current.startX) / currentZoom;
          const rawDeltaY =
            (moveEvent.clientY - multiDragRef.current.startY) / currentZoom;

          const newX = startDx + rawDeltaX;
          const newY = startDy + rawDeltaY;

          const gridSettings = useSettingsStore.getState().gridSettings;
          const alignmentGuidesEnabled =
            gridSettings?.alignmentGuides !== false;
          const spacingGuidesEnabled = gridSettings?.spacingGuides !== false;

          const otherElements = getOtherElements(currentElementId);

          const nonSelectedElements = otherElements.filter(
            (el: any) => !selectedElements.some((sel) => sel.id === el.id),
          );

          const draggedBounds = calculateBounds(
            newX,
            newY,
            currentWidth,
            currentHeight,
            currentElementId,
          );

          let groupBounds: any = null;
          if (selectedElements.length > 1) {
            const selectedBoundsArray = selectedElements
              .map((sel) => {
                if (
                  sel.id === currentElementId ||
                  (sel.type === 'key' && sel.index === index)
                ) {
                  return draggedBounds;
                }
                const found = otherElements.find((el: any) => el.id === sel.id);
                if (found) {
                  return calculateBounds(
                    found.left + rawDeltaX,
                    found.top + rawDeltaY,
                    found.width,
                    found.height,
                    found.id,
                  );
                }
                return null;
              })
              .filter(Boolean);
            groupBounds = calculateGroupBounds(selectedBoundsArray);
          }

          const snapTargetBounds =
            selectedElements.length > 1 && groupBounds
              ? groupBounds
              : draggedBounds;

          const snapResult = alignmentGuidesEnabled
            ? calculateSnapPoints(
                snapTargetBounds,
                nonSelectedElements,
                undefined,
                {
                  groupBounds,
                  disableSpacing: !spacingGuidesEnabled,
                },
              )
            : null;

          let finalX: number;
          let finalY: number;

          if (snapResult?.didSnapX) {
            if (selectedElements.length > 1 && groupBounds) {
              const groupSnapDeltaX = snapResult.snappedX - groupBounds.left;
              finalX = newX + groupSnapDeltaX;
            } else {
              finalX = snapResult.snappedX;
            }
          } else {
            const snapSize = gridSettings?.gridSnapSize || 5;
            finalX = Math.round(newX / snapSize) * snapSize;
          }

          if (snapResult?.didSnapY) {
            if (selectedElements.length > 1 && groupBounds) {
              const groupSnapDeltaY = snapResult.snappedY - groupBounds.top;
              finalY = newY + groupSnapDeltaY;
            } else {
              finalY = snapResult.snappedY;
            }
          } else {
            const snapSize = gridSettings?.gridSnapSize || 5;
            finalY = Math.round(newY / snapSize) * snapSize;
          }

          const snappedDeltaX = Math.round(finalX - startDx);
          const snappedDeltaY = Math.round(finalY - startDy);

          if (snapResult && (snapResult.didSnapX || snapResult.didSnapY)) {
            const displayBounds =
              selectedElements.length > 1 && groupBounds
                ? calculateBounds(
                    groupBounds.left +
                      (snapResult.didSnapX
                        ? snapResult.snappedX - groupBounds.left
                        : 0),
                    groupBounds.top +
                      (snapResult.didSnapY
                        ? snapResult.snappedY - groupBounds.top
                        : 0),
                    groupBounds.width,
                    groupBounds.height,
                    'group',
                  )
                : calculateBounds(
                    finalX,
                    finalY,
                    currentWidth,
                    currentHeight,
                    currentElementId,
                  );
            smartGuidesStore.setDraggedBounds(displayBounds);
            smartGuidesStore.setActiveGuides(snapResult.guides);

            if (
              spacingGuidesEnabled &&
              snapResult.spacingGuides &&
              snapResult.spacingGuides.length > 0
            ) {
              smartGuidesStore.setSpacingGuides(snapResult.spacingGuides);
            } else {
              smartGuidesStore.setSpacingGuides([]);
            }
          } else {
            smartGuidesStore.clearGuides();
          }

          const moveDeltaX =
            snappedDeltaX - multiDragRef.current.lastSnappedDeltaX;
          const moveDeltaY =
            snappedDeltaY - multiDragRef.current.lastSnappedDeltaY;

          if (moveDeltaX !== 0 || moveDeltaY !== 0) {
            multiDragRef.current.lastSnappedDeltaX = snappedDeltaX;
            multiDragRef.current.lastSnappedDeltaY = snappedDeltaY;
            onMultiDrag?.(moveDeltaX, moveDeltaY);
          }
        });
      };

      const handleMouseUp = () => {
        dragEnded = true;
        multiDragRef.current.isDragging = false;

        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }

        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('blur', handleMouseUp);
        useSmartGuidesStore.getState().clearGuides();
        useGridSelectionStore.getState().setDraggingOrResizing(false);
        onMultiDragEnd?.();
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('blur', handleMouseUp);
    },
    [
      isSelectionMode,
      zoom,
      onMultiDrag,
      onMultiDragStart,
      onMultiDragEnd,
      dx,
      dy,
      width,
      height,
      index,
      getOtherElements,
      selectedElements,
    ],
  );

  const handleClick = (e: React.MouseEvent) => {
    const isPrimaryModifierPressed = macOS ? e.metaKey : e.ctrlKey;
    const isShiftPressed = e.shiftKey;

    if (isSelectionMode && isPrimaryModifierPressed && onCtrlClick) {
      e.stopPropagation();
      onCtrlClick(e);
      return;
    }

    if (isSelectionMode) {
      e.stopPropagation();
      return;
    }

    if (activeTool === 'eraser') {
      onEraserClick?.();
      return;
    }

    if (!draggable.wasMoved) {
      if (isShiftPressed && onShiftClick) {
        e.stopPropagation();
        onShiftClick(e);
        return;
      }
      if (isPrimaryModifierPressed && onCtrlClick) {
        e.stopPropagation();
        onCtrlClick(e);
        return;
      }
      if (onClick) {
        onClick(e);
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu?.(e);
  };

  const renderDx = draggable.dx;
  const renderDy = draggable.dy;

  const useInline = useInlineStyles === true;
  const shouldPromoteTransformLayer =
    isDraggingOrResizing || isViewportTransforming;

  const keyStyle = useMemo(
    () => ({
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(calc(${renderDx}px + var(--key-offset-x, 0px)), calc(${renderDy}px + var(--key-offset-y, 0px)))`,
      backgroundColor:
        useInline && backgroundColor
          ? backgroundColor
          : `var(--key-bg, ${
              inactiveImageSrc
                ? 'transparent'
                : backgroundColor || 'rgba(46, 46, 47, 0.9)'
            })`,
      borderRadius:
        useInline && borderRadius != null
          ? `${borderRadius}px`
          : `var(--key-radius, ${
              borderRadius != null ? `${borderRadius}px` : '10px'
            })`,
      border:
        useInline && (borderColor || borderWidth != null)
          ? `${borderWidth ?? 3}px solid ${
              borderColor || 'rgba(113, 113, 113, 0.9)'
            }`
          : `var(--key-border, ${borderWidth ?? 3}px solid ${
              borderColor || 'rgba(113, 113, 113, 0.9)'
            })`,
      overflow: 'hidden' as const,
      willChange: shouldPromoteTransformLayer ? 'transform' : 'auto',
      contain: 'layout style paint',
      imageRendering: 'auto' as const,
      isolation: 'isolate' as const,
      boxSizing: 'border-box' as const,
      zIndex: position.zIndex ?? zIndex,
    }),
    [
      renderDx,
      renderDy,
      width,
      height,
      inactiveImageSrc,
      zIndex,
      position.zIndex,
      useInline,
      backgroundColor,
      borderColor,
      borderWidth,
      borderRadius,
      shouldPromoteTransformLayer,
    ],
  );

  const effectiveImageFit = idleImageFit || imageFit || 'cover';
  const imageStyle = useMemo(
    () => ({
      width: '100%',
      height: '100%',
      objectFit: effectiveImageFit as React.CSSProperties['objectFit'],
      display: 'block' as const,
      pointerEvents: 'none' as const,
      userSelect: 'none' as const,
    }),
    [effectiveImageFit],
  );

  const textStyle = useMemo(() => {
    const textDecorations: string[] = [];
    if (fontUnderline) textDecorations.push('underline');
    if (fontStrikethrough) textDecorations.push('line-through');

    return {
      willChange: 'auto',
      contain: 'layout style paint',
      color:
        useInline && fontColor
          ? fontColor
          : `var(--key-text-color, ${fontColor || 'rgba(121, 121, 121, 0.9)'})`,
      fontSize: fontSize ? `${fontSize}px` : undefined,
      fontFamily: fontFamily
        ? `"${fontFamily}", "SUIT-Regular", sans-serif`
        : undefined,
      fontWeight: fontWeight ?? 700,
      fontStyle: fontItalic ? 'italic' : 'normal',
      textDecoration:
        textDecorations.length > 0 ? textDecorations.join(' ') : 'none',
    };
  }, [
    useInline,
    fontColor,
    fontSize,
    fontFamily,
    fontWeight,
    fontItalic,
    fontUnderline,
    fontStrikethrough,
  ]);

  const counterFillColor = counterSettings.fill.idle;
  const counterStrokeColor = counterSettings.stroke.idle;
  const contentGap = Number.isFinite(counterSettings.gap)
    ? counterSettings.gap
    : 6;

  const renderInsideCounterPreview = () => {
    if (!showInsideCounter) {
      return null;
    }

    const displayValue =
      (counterValueSignal?.value ?? counterPreviewValue ?? 0) | 0;

    const counterElement = (
      <CountDisplay
        key="counter"
        count={displayValue}
        fillColor={counterFillColor}
        strokeColor={counterStrokeColor}
        active={false}
        fontSize={counterSettings.fontSize}
        fontFamily={counterSettings.fontFamily}
        fontWeight={counterSettings.fontWeight}
        fontItalic={counterSettings.fontItalic}
        fontUnderline={counterSettings.fontUnderline}
        fontStrikethrough={counterSettings.fontStrikethrough}
        animationEnabled={counterSettings.animation.enabled}
        animationBezier={counterSettings.animation.bezier}
        animationScale={counterSettings.animation.scale}
        animationDurationMs={counterSettings.animation.durationMs}
      />
    );

    const nameElement = (
      <span
        key="label"
        className="font-bold text-[14px] pointer-events-none select-none leading-none text-safe-inline"
        style={textStyle}
      >
        {labelText}
      </span>
    );

    const isHorizontal =
      counterSettings.align === 'left' || counterSettings.align === 'right';

    const elements = isHorizontal
      ? counterSettings.align === 'left'
        ? [counterElement, nameElement]
        : [nameElement, counterElement]
      : counterSettings.align === 'top'
        ? [counterElement, nameElement]
        : [nameElement, counterElement];

    const alignMode = counterSettings.alignMode || 'center';
    const isBetween = alignMode === 'between';
    const containerClass = `flex ${
      isHorizontal ? '' : 'flex-col'
    } w-full h-full items-center pointer-events-none select-none`;

    return (
      <div
        className={containerClass}
        style={{
          justifyContent: isBetween ? 'space-between' : 'center',
          padding: isBetween
            ? isHorizontal
              ? `0 ${contentGap}px`
              : `${contentGap}px 0`
            : '0px',
          gap: isBetween ? '0px' : `${contentGap}px`,
        }}
      >
        {elements}
      </div>
    );
  };

  const attachRef = (node: HTMLElement | null) => {
    if (!isSelectionMode) {
      draggable.ref(node);
    }
    nodeRef.current = node;
    if (typeof setReferenceRef === 'function') setReferenceRef(node);
  };

  return (
    <div
      ref={attachRef}
      className={`absolute cursor-pointer ${
        draggable && draggable.wasMoved ? '' : ''
      } ${className || ''}`}
      style={keyStyle}
      data-state="inactive"
      data-editing={isDraggingOrResizing ? 'true' : undefined}
      data-key-element="true"
      onClick={handleClick}
      onMouseDown={isSelectionMode ? handleSelectionDragMouseDown : undefined}
      onContextMenu={handleContextMenu}
      onDragStart={(e) => e.preventDefault()}
    >
      {inactiveImageSrc ? (
        <img
          src={inactiveImageSrc}
          alt=""
          style={imageStyle}
          draggable={false}
        />
      ) : showInsideCounter ? (
        renderInsideCounterPreview()
      ) : (
        <div
          className="flex items-center justify-center h-full font-bold text-safe-inline"
          style={textStyle}
        >
          {labelText}
        </div>
      )}
    </div>
  );
}

export const Key = memo(
  ({ keyName, globalKey, position, mode, counterEnabled = false }: KeyProps) => {
    useSignals();
    const selectorKey = globalKey || keyName;
    const active = getKeySignal(selectorKey).value;
    const {
      dx,
      dy,
      width,
      height = 60,
      activeImage,
      inactiveImage,
      activeTransparent = false,
      idleTransparent = false,
      className,
      backgroundColor,
      activeBackgroundColor,
      borderColor,
      activeBorderColor,
      borderWidth,
      borderRadius,
      fontSize,
      fontColor,
      fontFamily,
      activeFontColor,
      idleImageFit,
      activeImageFit,
      imageFit,
      useInlineStyles,
      displayText,
      fontWeight,
      fontItalic,
      fontUnderline,
      fontStrikethrough,
    } = position;

    const labelText = displayText || keyName;

    const useInline = useInlineStyles === true;

    const stateBackgroundColor = active
      ? (activeBackgroundColor ?? backgroundColor)
      : backgroundColor;
    const stateBorderColor = active
      ? (activeBorderColor ?? borderColor)
      : borderColor;
    const stateFontColor = active ? (activeFontColor ?? fontColor) : fontColor;

    const inactiveImageSrc = resolveImageSource(inactiveImage);
    const activeImageSrc = resolveImageSource(activeImage);

    useEffect(() => {
      warmupImageSource(inactiveImageSrc);
      warmupImageSource(activeImageSrc);
    }, [inactiveImageSrc, activeImageSrc]);

    const isTransparent = active ? activeTransparent : idleTransparent;

    if (isTransparent) {
      return null;
    }

    const currentImageSrc =
      (active && activeImageSrc ? activeImageSrc : inactiveImageSrc) || null;
    const hasCurrentImage = !!currentImageSrc;
    const isUsingActiveImage = active && !!activeImageSrc;
    const effectiveImageFit = isUsingActiveImage
      ? activeImageFit || imageFit || 'cover'
      : idleImageFit || imageFit || 'cover';

    const keyStyle = useMemo(() => {
      const defaultBgColor = hasCurrentImage
        ? 'transparent'
        : active
          ? 'rgba(121, 121, 121, 0.9)'
          : 'rgba(46, 46, 47, 0.9)';

      const defaultBorderColor = active
        ? 'rgba(255, 255, 255, 0.9)'
        : 'rgba(113, 113, 113, 0.9)';

      const defaultTextColor =
        active && !activeImageSrc ? '#FFFFFF' : 'rgba(121, 121, 121, 0.9)';

      return {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate3d(calc(${dx}px + var(--key-offset-x, 0px)), calc(${dy}px + var(--key-offset-y, 0px)), 0)`,
        backgroundColor:
          useInline && stateBackgroundColor
            ? stateBackgroundColor
            : `var(--key-bg, ${stateBackgroundColor || defaultBgColor})`,
        borderRadius:
          useInline && borderRadius != null
            ? `${borderRadius}px`
            : `var(--key-radius, ${
                borderRadius != null ? `${borderRadius}px` : '10px'
              })`,
        border:
          useInline && (stateBorderColor || borderWidth != null)
            ? `${borderWidth ?? 3}px solid ${
                stateBorderColor || defaultBorderColor
              }`
            : `var(--key-border, ${borderWidth ?? 3}px solid ${
                stateBorderColor || defaultBorderColor
              })`,
        color:
          useInline && stateFontColor
            ? stateFontColor
            : `var(--key-text-color, ${stateFontColor || defaultTextColor})`,
        fontSize: fontSize ? `${fontSize}px` : undefined,
        overflow: 'hidden' as const,
        willChange: active ? 'transform, background-color' : 'transform',
        backfaceVisibility: 'hidden' as const,
        transformStyle: 'preserve-3d' as const,
        contain: 'layout style paint',
        imageRendering: 'auto' as const,
        isolation: 'isolate' as const,
        boxSizing: 'border-box' as const,
        zIndex: position.zIndex,
      };
    }, [
      active,
      hasCurrentImage,
      activeImageSrc,
      dx,
      dy,
      width,
      height,
      position.zIndex,
      useInline,
      backgroundColor,
      activeBackgroundColor,
      borderColor,
      activeBorderColor,
      borderWidth,
      borderRadius,
      fontSize,
      fontColor,
      activeFontColor,
    ]);

    const fallbackImageDimmed = active && !activeImageSrc && !!inactiveImageSrc;
    const imageStyle = useMemo(
      () => ({
        width: '100%',
        height: '100%',
        objectFit: effectiveImageFit as React.CSSProperties['objectFit'],
        display: 'block' as const,
        pointerEvents: 'none' as const,
        userSelect: 'none' as const,
        position: 'relative' as const,
        zIndex: 0,
        filter: fallbackImageDimmed ? 'brightness(0.62)' : 'none',
      }),
      [effectiveImageFit, fallbackImageDimmed],
    );

    const textStyle = useMemo(() => {
      const textDecorations: string[] = [];
      if (fontUnderline) textDecorations.push('underline');
      if (fontStrikethrough) textDecorations.push('line-through');

      return {
        willChange: 'auto',
        contain: 'layout style paint',
        fontSize: fontSize ? `${fontSize}px` : undefined,
        fontFamily: fontFamily
          ? `"${fontFamily}", "SUIT-Regular", sans-serif`
          : undefined,
        fontWeight: fontWeight ?? 700,
        fontStyle: fontItalic ? 'italic' : 'normal',
        textDecoration:
          textDecorations.length > 0 ? textDecorations.join(' ') : 'none',
      };
    }, [
      fontSize,
      fontFamily,
      fontWeight,
      fontItalic,
      fontUnderline,
      fontStrikethrough,
    ]);

    const counterSettings = normalizeCounterSettings(
      position?.counter ?? createDefaultCounterSettings(),
    );
    const showInsideCounter =
      counterEnabled &&
      counterSettings.enabled &&
      counterSettings.placement === 'inside';

    let counterSignal: any;
    if (showInsideCounter) {
      counterSignal = getKeyCounterSignal(mode ?? '', globalKey);
    }

    const counterValue = counterSignal?.value ?? 0;

    const showText = !hasCurrentImage;

    const counterFillColor = active
      ? counterSettings.fill.active
      : counterSettings.fill.idle;
    const counterStrokeColor = active
      ? counterSettings.stroke.active
      : counterSettings.stroke.idle;

    const contentGap = Number.isFinite(counterSettings.gap)
      ? counterSettings.gap
      : 6;

    const renderInsideLayout = () => {
      if (!showInsideCounter) {
        return null;
      }

      const displayValue = counterValue || 0;

      const counterElement = (
        <CountDisplay
          key="counter"
          count={displayValue}
          fillColor={counterFillColor}
          strokeColor={counterStrokeColor}
          active={active}
          fontSize={counterSettings.fontSize}
          fontFamily={counterSettings.fontFamily}
          fontWeight={counterSettings.fontWeight}
          fontItalic={counterSettings.fontItalic}
          fontUnderline={counterSettings.fontUnderline}
          fontStrikethrough={counterSettings.fontStrikethrough}
          animationEnabled={counterSettings.animation.enabled}
          animationBezier={counterSettings.animation.bezier}
          animationScale={counterSettings.animation.scale}
          animationDurationMs={counterSettings.animation.durationMs}
        />
      );

      const nameElement = (
        <span
          key="label"
          className="font-bold text-[14px] pointer-events-none select-none leading-none text-safe-inline"
          style={textStyle}
        >
          {labelText}
        </span>
      );

      const isHorizontal =
        counterSettings.align === 'left' || counterSettings.align === 'right';

      const elements = isHorizontal
        ? counterSettings.align === 'left'
          ? [counterElement, nameElement]
          : [nameElement, counterElement]
        : counterSettings.align === 'top'
          ? [counterElement, nameElement]
          : [nameElement, counterElement];

      const alignMode = counterSettings.alignMode || 'center';
      const isBetween = alignMode === 'between';
      const containerClass = `flex ${
        isHorizontal ? '' : 'flex-col'
      } w-full h-full items-center pointer-events-none select-none`;

      return (
        <div
          className={containerClass}
          style={{
            justifyContent: isBetween ? 'space-between' : 'center',
            padding: isBetween
              ? isHorizontal
                ? `0 ${contentGap}px`
                : `${contentGap}px 0`
              : '0px',
            gap: isBetween ? '0px' : `${contentGap}px`,
          }}
        >
          {elements}
        </div>
      );
    };

    return (
      <div
        className={`absolute ${className || ''}`}
        style={keyStyle}
        data-state={active ? 'active' : 'inactive'}
      >
        {hasCurrentImage ? (
          <img
            src={currentImageSrc || ''}
            alt=""
            style={imageStyle}
            draggable={false}
          />
        ) : showText ? (
          showInsideCounter ? (
            renderInsideLayout()
          ) : (
            <div
              className="flex items-center justify-center h-full font-bold text-safe-inline"
              style={textStyle}
            >
              {labelText}
            </div>
          )
        ) : null}
      </div>
    );
  },
  (prevProps: KeyProps, nextProps: KeyProps) => {
    return (
      prevProps.keyName === nextProps.keyName &&
      prevProps.mode === nextProps.mode &&
      prevProps.counterEnabled === nextProps.counterEnabled &&
      prevProps.position.dx === nextProps.position.dx &&
      prevProps.position.dy === nextProps.position.dy &&
      prevProps.position.width === nextProps.position.width &&
      prevProps.position.height === nextProps.position.height &&
      prevProps.position.activeImage === nextProps.position.activeImage &&
      prevProps.position.inactiveImage === nextProps.position.inactiveImage &&
      prevProps.position.activeTransparent ===
        nextProps.position.activeTransparent &&
      prevProps.position.idleTransparent ===
        nextProps.position.idleTransparent &&
      prevProps.position.zIndex === nextProps.position.zIndex &&
      prevProps.position.className === nextProps.position.className &&
      prevProps.position.backgroundColor ===
        nextProps.position.backgroundColor &&
      prevProps.position.activeBackgroundColor ===
        nextProps.position.activeBackgroundColor &&
      prevProps.position.borderColor === nextProps.position.borderColor &&
      prevProps.position.activeBorderColor ===
        nextProps.position.activeBorderColor &&
      prevProps.position.borderWidth === nextProps.position.borderWidth &&
      prevProps.position.borderRadius === nextProps.position.borderRadius &&
      prevProps.position.fontSize === nextProps.position.fontSize &&
      prevProps.position.fontColor === nextProps.position.fontColor &&
      prevProps.position.fontFamily === nextProps.position.fontFamily &&
      prevProps.position.activeFontColor ===
        nextProps.position.activeFontColor &&
      prevProps.position.idleImageFit === nextProps.position.idleImageFit &&
      prevProps.position.activeImageFit === nextProps.position.activeImageFit &&
      prevProps.position.imageFit === nextProps.position.imageFit &&
      prevProps.position.useInlineStyles ===
        nextProps.position.useInlineStyles &&
      prevProps.position.displayText === nextProps.position.displayText &&
      prevProps.position.fontWeight === nextProps.position.fontWeight &&
      prevProps.position.fontItalic === nextProps.position.fontItalic &&
      prevProps.position.fontUnderline === nextProps.position.fontUnderline &&
      prevProps.position.fontStrikethrough ===
        nextProps.position.fontStrikethrough &&
      prevProps.position.counter?.enabled ===
        nextProps.position.counter?.enabled &&
      prevProps.position.counter?.placement ===
        nextProps.position.counter?.placement &&
      prevProps.position.counter?.align === nextProps.position.counter?.align &&
      (prevProps.position.counter?.alignMode ?? 'center') ===
        (nextProps.position.counter?.alignMode ?? 'center') &&
      prevProps.position.counter?.fill?.idle ===
        nextProps.position.counter?.fill?.idle &&
      prevProps.position.counter?.fill?.active ===
        nextProps.position.counter?.fill?.active &&
      prevProps.position.counter?.stroke?.idle ===
        nextProps.position.counter?.stroke?.idle &&
      prevProps.position.counter?.stroke?.active ===
        nextProps.position.counter?.stroke?.active &&
      (prevProps.position.counter?.gap ?? 6) ===
        (nextProps.position.counter?.gap ?? 6) &&
      (prevProps.position.counter?.fontSize ?? 16) ===
        (nextProps.position.counter?.fontSize ?? 16) &&
      (prevProps.position.counter?.fontWeight ?? 400) ===
        (nextProps.position.counter?.fontWeight ?? 400) &&
      (prevProps.position.counter?.fontFamily ?? null) ===
        (nextProps.position.counter?.fontFamily ?? null) &&
      (prevProps.position.counter?.fontItalic ?? false) ===
        (nextProps.position.counter?.fontItalic ?? false) &&
      (prevProps.position.counter?.fontUnderline ?? false) ===
        (nextProps.position.counter?.fontUnderline ?? false) &&
      (prevProps.position.counter?.fontStrikethrough ?? false) ===
        (nextProps.position.counter?.fontStrikethrough ?? false) &&
      (prevProps.position.counter?.animation?.enabled ?? true) ===
        (nextProps.position.counter?.animation?.enabled ?? true) &&
      (prevProps.position.counter?.animation?.durationMs ?? 300) ===
        (nextProps.position.counter?.animation?.durationMs ?? 300) &&
      (prevProps.position.counter?.animation?.scale ?? 1.1) ===
        (nextProps.position.counter?.animation?.scale ?? 1.1) &&
      (prevProps.position.counter?.animation?.bezier?.[0] ?? 0.25) ===
        (nextProps.position.counter?.animation?.bezier?.[0] ?? 0.25) &&
      (prevProps.position.counter?.animation?.bezier?.[1] ?? 0.46) ===
        (nextProps.position.counter?.animation?.bezier?.[1] ?? 0.46) &&
      (prevProps.position.counter?.animation?.bezier?.[2] ?? 0.45) ===
        (nextProps.position.counter?.animation?.bezier?.[2] ?? 0.45) &&
      (prevProps.position.counter?.animation?.bezier?.[3] ?? 0.94) ===
        (nextProps.position.counter?.animation?.bezier?.[3] ?? 0.94)
    );
  },
);
