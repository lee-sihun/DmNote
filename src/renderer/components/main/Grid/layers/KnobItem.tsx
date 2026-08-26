import React from 'react';
import {
  gradientToCss,
  gradientRingStyle,
  resolveStatePair,
  type GradientSpec,
} from '@src/types/color';
import { isMac } from '@utils/core/platform';
import { useDraggable, useSmartGuidesElements } from '@hooks/Grid';
import { useSelectionDrag } from '@hooks/Grid/useSelectionDrag';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useGradientPreviewSession } from '@stores/grid/useGradientEditStore';
import { useEditStatePreviewActive } from '@stores/grid/useEditStatePreviewStore';
import { resolveImageSource } from '@utils/core/imageSource';
import {
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_ACTIVE_BG,
  DEFAULT_ELEMENT_BORDER_WIDTH,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_ACTIVE_FONT,
  DEFAULT_ELEMENT_SHADOW_SPEC,
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
} from '@utils/core/elementDefaults';
import {
  elementShadowToCss,
  resolveElementShadow,
  type ElementShadowSpec,
} from '@src/types/key/shadows';

interface KnobPosition {
  hidden?: boolean;
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  className?: string;
  backgroundColor?: string;
  activeBackgroundColor?: string;
  borderColor?: string;
  activeBorderColor?: string;
  backgroundGradient?: GradientSpec | null;
  activeBackgroundGradient?: GradientSpec | null;
  borderGradient?: GradientSpec | null;
  activeBorderGradient?: GradientSpec | null;
  borderWidth?: number;
  borderRadius?: number;
  shadow?: ElementShadowSpec;
  activeShadow?: ElementShadowSpec;
  inactiveImage?: string;
  activeImage?: string;
  idleImageFit?: string;
  activeImageFit?: string;
  imageFit?: string;
  idleTransparent?: boolean;
  activeTransparent?: boolean;
  useInlineStyles?: boolean;
  zIndex?: number;
}

interface SelectedElement {
  id: string;
  type?: string;
  index?: number;
}

interface KnobItemProps {
  index: number;
  elementId: string;
  position: KnobPosition;
  onPositionChange: (
    index: number,
    dx: number,
    dy: number,
    elementId: string,
  ) => void;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onCtrlClick?: (e: React.MouseEvent) => void;
  onShiftClick?: (e: React.MouseEvent) => void;
  isSelected?: boolean;
  selectedElements?: SelectedElement[];
  onMultiDrag?: (dx: number, dy: number) => void;
  onMultiDragStart?: () => void | (() => void);
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
}

const KnobItem = ({
  index,
  elementId,
  position,
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
}: KnobItemProps) => {
  const macOS = isMac();
  const {
    dx = 0,
    dy = 0,
    width = 60,
    height = 60,
    className,
    backgroundColor,
    activeBackgroundColor,
    borderColor,
    activeBorderColor,
    backgroundGradient,
    activeBackgroundGradient,
    borderGradient,
    activeBorderGradient,
    borderWidth,
    borderRadius,
    shadow,
    activeShadow,
    inactiveImage,
    activeImage,
    idleImageFit,
    activeImageFit,
    imageFit,
    idleTransparent,
    activeTransparent,
    useInlineStyles,
  } = position ?? ({} as Partial<KnobPosition>);
  const useInline = useInlineStyles === true;

  // 편집 세션 일시 페인트 — 대상 spec과 대기/입력 상태를 한 묶음으로 렌더
  const previewSession = useGradientPreviewSession(
    'knob',
    elementId,
    isSelected,
  );
  // 상태 프리뷰는 전용 스토어가 유일한 원천 (세션은 spec 페인트 전용)
  const previewActive = useEditStatePreviewActive(
    'knob',
    elementId,
    isSelected,
  );
  const bgPair = resolveStatePair(
    previewActive,
    { color: backgroundColor, gradient: backgroundGradient },
    { color: activeBackgroundColor, gradient: activeBackgroundGradient },
  );
  const borderPair = resolveStatePair(
    previewActive,
    { color: borderColor, gradient: borderGradient },
    { color: activeBorderColor, gradient: activeBorderGradient },
  );
  const effectiveBgGradient =
    previewSession?.surface === 'background'
      ? previewSession.spec
      : bgPair.gradient;
  const effectiveBorderGradient =
    previewSession?.surface === 'border'
      ? previewSession.spec
      : borderPair.gradient;
  const stateBackgroundColor =
    bgPair.color ||
    (previewActive ? DEFAULT_ELEMENT_ACTIVE_BG : DEFAULT_ELEMENT_BG);
  const stateBorderColor =
    borderPair.color ||
    (previewActive ? DEFAULT_ELEMENT_ACTIVE_FONT : DEFAULT_ELEMENT_FONT);

  // 키·그래프와 동일 규칙 — 두께 미지정이면 기본 두께 링, 0은 명시적 비활성
  const gradientRingWidth = borderWidth ?? DEFAULT_ELEMENT_BORDER_WIDTH;
  const showBorderRing =
    Boolean(effectiveBorderGradient) &&
    (borderWidth != null ? borderWidth > 0 : true);
  const resolvedRadius = borderRadius != null ? `${borderRadius}px` : '50%';
  const resolvedBorder =
    !effectiveBorderGradient && borderWidth && borderWidth > 0
      ? `${borderWidth}px solid ${stateBorderColor}`
      : 'none';
  const { getOtherElements } = useSmartGuidesElements();
  const gridSnapSize = useSettingsStore(
    (state: { gridSettings?: { gridSnapSize?: number } }) =>
      state.gridSettings?.gridSnapSize || 5,
  );
  const isDraggingOrResizing = useGridSelectionStore(
    (state: { isDraggingOrResizing: boolean }) => state.isDraggingOrResizing,
  );

  const isSelectionMode = isSelected;
  const effectiveElementId = elementId;

  const inactiveImageSrc = resolveImageSource(inactiveImage);
  const activeImageSrc = resolveImageSource(activeImage);
  const imageSrc =
    (previewActive && activeImageSrc
      ? activeImageSrc
      : inactiveImageSrc || activeImageSrc) || null;
  // 투명 노브의 기본 그림자 억제 — 오버레이(OverlayKnobItem)와 동일 규칙
  const isTransparent = previewActive
    ? activeTransparent === true
    : idleTransparent === true;
  const resolvedShadow = elementShadowToCss(
    resolveElementShadow({
      active: previewActive,
      shadow,
      activeShadow,
      defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
      defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
      suppressDefault: Boolean(
        isTransparent || imageSrc || (borderWidth && borderWidth > 0),
      ),
    }),
  );
  const resolvedFit = (
    previewActive && activeImageSrc
      ? activeImageFit || imageFit || 'cover'
      : idleImageFit || imageFit || 'cover'
  ) as React.CSSProperties['objectFit'];

  const draggable = useDraggable({
    gridSize: gridSnapSize,
    initialX: dx,
    initialY: dy,
    onPositionChange: (newDx: number, newDy: number) => {
      if (!isSelectionMode) {
        // 프리즈된 index의 재해석은 수신 측이 elementId로 수행
        onPositionChange(index, newDx, newDy, elementId);
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
    pressMovedRef,
  } = useSelectionDrag({
    enabled: isSelectionMode,
    zoom,
    startX: dx,
    startY: dy,
    elementId: effectiveElementId,
    elementWidth: width || 60,
    elementHeight: height || 60,
    selectedElements,
    getOtherElements,
    onMultiDragStart,
    onMultiDrag,
    onMultiDragEnd,
  });

  if (position?.hidden) return null;

  const handleClick = (e: React.MouseEvent) => {
    // macOS ctrl+클릭은 우클릭 제스처 — Chromium이 contextmenu 뒤에 click도 발화하므로
    // 이 클릭이 선택·패널 오픈으로 이어져 방금 연 메뉴를 닫는 것을 차단
    if (macOS && e.ctrlKey) return;
    // 드래그로 끝난 press의 trailing click은 클릭이 아니다 - 수식키 토글·
    // 범위 선택·지우개로 새지 않게 흡수. 개별 드래그는 wasMoved,
    // 선택 모드 다중 드래그는 pressMovedRef가 판별 (선택 모드에서는
    // 개별 draggable이 disabled라 wasMoved가 항상 false)
    if (draggable.wasMoved || pressMovedRef.current) {
      e.stopPropagation();
      return;
    }
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
      onClick?.(e);
    }
  };

  // 더블클릭 편집 진입 — 순수 더블클릭만 통과 (드래그·수식키·지우개·뷰포트 변환 제외)
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

  const attachRef = (node: HTMLElement | null) => {
    if (!isSelectionMode) {
      draggable.ref(node);
    }
    if (typeof setReferenceRef === 'function') {
      setReferenceRef(node);
    }
  };

  const transform = `translate(calc(${draggable.dx}px + var(--key-offset-x, 0px)), calc(${draggable.dy}px + var(--key-offset-y, 0px)))`;

  return (
    <div
      ref={attachRef}
      className={`absolute select-none dmn-grabbable ${className || ''}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        transform,
        zIndex: position.zIndex ?? zIndex,
        // 그리드 안 승격 금지 - WebKit은 합성 자식이 생기면 스케일 컨테이너를
        // 레이어로 만들어 전체가 흐려진다
        willChange: 'auto',
        contain: 'layout style',
      }}
      data-editing={isDraggingOrResizing ? 'true' : undefined}
      onClick={handleClick}
      onDoubleClick={onDoubleClick ? handleDoubleClick : undefined}
      onPointerDown={
        isSelectionMode ? handleSelectionDragPointerDown : undefined
      }
      onContextMenu={handleContextMenu}
      onDragStart={(e: React.DragEvent) => e.preventDefault()}
    >
      <div
        style={
          {
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            position: 'relative',
            ...(useInline
              ? {
                  borderRadius: resolvedRadius,
                  background: effectiveBgGradient
                    ? gradientToCss(effectiveBgGradient)
                    : stateBackgroundColor,
                  backgroundClip: 'padding-box',
                  border: resolvedBorder,
                  padding: showBorderRing
                    ? `${gradientRingWidth}px`
                    : undefined,
                  boxShadow: resolvedShadow,
                }
              : {
                  '--dmn-knob-bg-default': effectiveBgGradient
                    ? gradientToCss(effectiveBgGradient)
                    : stateBackgroundColor,
                  '--dmn-knob-border-default': resolvedBorder,
                  '--dmn-knob-radius-default': resolvedRadius,
                  '--dmn-knob-padding-default': showBorderRing
                    ? `${gradientRingWidth}px`
                    : '0px',
                  '--dmn-knob-shadow-default': resolvedShadow,
                  '--dmn-knob-indicator-default': stateBorderColor,
                }),
            boxSizing: 'border-box',
          } as React.CSSProperties
        }
        data-knob-element="true"
        data-knob-state={previewActive ? 'active' : 'inactive'}
      >
        {showBorderRing && effectiveBorderGradient && (
          <span
            aria-hidden="true"
            data-gradient-border-ring="true"
            style={{
              ...gradientRingStyle(effectiveBorderGradient, gradientRingWidth),
              ...(useInline
                ? { background: gradientToCss(effectiveBorderGradient) }
                : {}),
            }}
          />
        )}
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: resolvedFit,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              top: '12%',
              left: '50%',
              width: '8%',
              height: '76%',
              transform: 'translateX(-50%)',
              background: useInline ? stateBorderColor : undefined,
              borderRadius: '4px',
            }}
            data-knob-indicator="true"
          />
        )}
      </div>
    </div>
  );
};

export default KnobItem;
