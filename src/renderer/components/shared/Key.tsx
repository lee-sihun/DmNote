'use no memo';
import React, { useRef, useEffect } from 'react';
import { getKeySignal } from '@stores/signals/keySignals';
import { getKeyCounterSignal } from '@stores/signals/keyCounterSignals';
import { useSignals } from '@preact/signals-react/runtime';
import { isMac } from '@utils/core/platform';
import { useDraggable } from '@hooks/Grid';
import { useSelectionDrag } from '@hooks/Grid/useSelectionDrag';
import { getKeyInfoByGlobalKey } from '@utils/core/KeyMaps';
import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
  type KeyCounterSettings,
} from '@src/types/key/keys';
import { useSmartGuidesElements } from '@hooks/Grid';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { resolveImageSource } from '@utils/core/imageSource';
import { warmupImageSource } from '@utils/core/imageWarmup';
import {
  computeKeyElementStyles,
  type KeyElementPosition,
} from '@hooks/overlay/useKeyElementStyles';
import {
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_BORDER,
  DEFAULT_ELEMENT_RADIUS,
  DEFAULT_ELEMENT_FONT_WEIGHT,
} from '@utils/core/elementDefaults';
import InsideCounterLayout from '@components/overlay/counters/InsideCounterLayout';

// DraggableKey에서 counter가 KeyCounterSettings 타입인 확장 position
interface KeyPosition extends KeyElementPosition {
  counter?: KeyCounterSettings;
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
  onDoubleClick?: (e: React.MouseEvent) => void;
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
  position: KeyElementPosition;
  mode?: string;
  counterEnabled?: boolean;
}

const DraggableKey = React.memo(
  ({
    index,
    elementId,
    position,
    keyName,
    onPositionChange,
    onClick,
    onDoubleClick,
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
  }: DraggableKeyProps) => {
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
      (state) => state.gridSettings?.gridSnapSize || 5,
    );

    const isDraggingOrResizing = useGridSelectionStore(
      (state) => state.isDraggingOrResizing,
    );

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

    const {
      handlePointerDown: handleSelectionDragPointerDown,
      movedDuringPressRef,
    } = useSelectionDrag({
      enabled: isSelectionMode,
      zoom,
      startX: dx,
      startY: dy,
      elementId: effectiveElementId,
      elementWidth: width || 60,
      elementHeight: height || 60,
      elementType: 'key',
      elementIndex: index,
      selectedElements,
      getOtherElements,
      onMultiDragStart,
      onMultiDrag,
      onMultiDragEnd,
    });

    const handleClick = (e: React.MouseEvent) => {
      // macOS ctrl+클릭은 우클릭 제스처 — Chromium이 contextmenu 뒤에 click도 발화하므로
      // 이 클릭이 선택·패널 오픈으로 이어져 방금 연 메뉴를 닫는 것을 차단
      if (macOS && e.ctrlKey) return;
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

    // 더블클릭 편집 진입 — 순수 더블클릭만 통과.
    // 두 번째 press가 다중 드래그로 이어진 경우(movedDuringPressRef)와
    // 단일 드래그(wasMoved), 수식키·지우개·뷰포트 변환 중은 제외
    const handleDoubleClick = (e: React.MouseEvent) => {
      if (!onDoubleClick) return;
      if (macOS && e.ctrlKey) return;
      if (e.shiftKey || e.metaKey || e.ctrlKey) return;
      if (activeTool === 'eraser') return;
      if (isViewportTransforming) return;
      if (draggable.recentPressMovedRef.current || movedDuringPressRef.current)
        return;
      e.stopPropagation();
      onDoubleClick(e);
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

    // 명시 보더가 있을 때만 렌더 — 기본은 보더 없음(인셋 링 섀도가 담당)
    // 에디터는 항상 대기 상태 — 오버레이의 상태별 판정과 동일하게 idle 색만 본다
    const hasExplicitBorder =
      borderWidth != null ? borderWidth > 0 : borderColor != null;
    const explicitBorder = `${borderWidth ?? 3}px solid ${
      borderColor || DEFAULT_ELEMENT_BORDER
    }`;

    const keyStyle = {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(calc(${renderDx}px + var(--key-offset-x, 0px)), calc(${renderDy}px + var(--key-offset-y, 0px)))`,
      backgroundColor:
        useInline && backgroundColor
          ? backgroundColor
          : `var(--key-bg, ${
              inactiveImageSrc
                ? 'transparent'
                : backgroundColor || DEFAULT_ELEMENT_BG
            })`,
      borderRadius:
        useInline && borderRadius != null
          ? `${borderRadius}px`
          : `var(--key-radius, ${
              borderRadius != null
                ? `${borderRadius}px`
                : `${DEFAULT_ELEMENT_RADIUS}px`
            })`,
      border: useInline
        ? hasExplicitBorder
          ? explicitBorder
          : 'none'
        : `var(--key-border, ${hasExplicitBorder ? explicitBorder : 'none'})`,
      overflow: 'hidden' as const,
      willChange: shouldPromoteTransformLayer ? 'transform' : 'auto',
      contain: 'layout style paint',
      imageRendering: 'auto' as const,
      isolation: 'isolate' as const,
      boxSizing: 'border-box' as const,
      zIndex: position.zIndex ?? zIndex,
    };

    const effectiveImageFit = idleImageFit || imageFit || 'cover';
    const imageStyle = {
      width: '100%',
      height: '100%',
      objectFit: effectiveImageFit as React.CSSProperties['objectFit'],
      display: 'block' as const,
      pointerEvents: 'none' as const,
      userSelect: 'none' as const,
    };

    const textDecorations: string[] = [];
    if (fontUnderline) textDecorations.push('underline');
    if (fontStrikethrough) textDecorations.push('line-through');

    const textStyle = {
      willChange: 'auto',
      color:
        useInline && fontColor
          ? fontColor
          : `var(--key-text-color, ${fontColor || DEFAULT_ELEMENT_FONT})`,
      fontSize: fontSize ? `${fontSize}px` : undefined,
      fontFamily: fontFamily
        ? `"${fontFamily}", "Pretendard Variable", sans-serif`
        : undefined,
      fontWeight: fontWeight ?? DEFAULT_ELEMENT_FONT_WEIGHT,
      fontStyle: fontItalic ? 'italic' : 'normal',
      textDecoration:
        textDecorations.length > 0 ? textDecorations.join(' ') : 'none',
    };

    if (position?.hidden) return null;

    // 오버레이와 동일 컴포넌트로 렌더 — 에디터/오버레이 텍스트 배치 싱크 보장
    const renderInsideCounterPreview = () => {
      if (!showInsideCounter) {
        return null;
      }

      const displayValue =
        (counterValueSignal?.value ?? counterPreviewValue ?? 0) | 0;

      return (
        <InsideCounterLayout
          count={displayValue}
          labelText={labelText}
          textStyle={textStyle}
          active={false}
          counterSettings={counterSettings}
        />
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
        className={`absolute dmn-grabbable ${
          draggable && draggable.wasMoved ? '' : ''
        } ${className || ''}`}
        style={keyStyle}
        data-state="inactive"
        data-editing={isDraggingOrResizing ? 'true' : undefined}
        data-key-element="true"
        data-key-image={inactiveImageSrc ? 'true' : undefined}
        onClick={handleClick}
        onDoubleClick={onDoubleClick ? handleDoubleClick : undefined}
        onPointerDown={
          isSelectionMode ? handleSelectionDragPointerDown : undefined
        }
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
  },
);

export default DraggableKey;

export const Key = React.memo(function Key({
  keyName,
  globalKey,
  position,
  mode,
  counterEnabled = false,
}: KeyProps) {
  useSignals();
  const selectorKey = globalKey || keyName;
  const active = getKeySignal(selectorKey).value;

  const {
    keyStyle,
    imageStyle,
    textStyle,
    inactiveImageSrc,
    activeImageSrc,
    currentImageSrc,
    hasCurrentImage,
    isTransparent,
    labelText,
  } = computeKeyElementStyles({ position, active, label: keyName });

  useEffect(() => {
    warmupImageSource(inactiveImageSrc);
    warmupImageSource(activeImageSrc);
  }, [inactiveImageSrc, activeImageSrc]);

  if (isTransparent) return null;

  const counterSettings = normalizeCounterSettings(
    position?.counter ?? createDefaultCounterSettings(),
  );
  const showInsideCounter =
    counterEnabled &&
    counterSettings.enabled &&
    counterSettings.placement === 'inside';

  const counterSignal = showInsideCounter
    ? getKeyCounterSignal(mode ?? '', globalKey)
    : undefined;
  const counterValue = counterSignal?.value ?? 0;

  return (
    <div
      className={`absolute ${position.className || ''}`}
      style={keyStyle}
      data-state={active ? 'active' : 'inactive'}
      data-key-element="true"
      data-key-image={hasCurrentImage ? 'true' : undefined}
    >
      {hasCurrentImage ? (
        <img
          src={currentImageSrc || ''}
          alt=""
          style={imageStyle}
          draggable={false}
        />
      ) : showInsideCounter ? (
        <InsideCounterLayout
          count={counterValue}
          labelText={labelText}
          textStyle={textStyle}
          active={active}
          counterSettings={counterSettings}
        />
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
});
