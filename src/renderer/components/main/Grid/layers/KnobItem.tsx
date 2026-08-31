import React from 'react';
import {
  gradientToCss,
  gradientRingStyle,
  resolveStatePair,
  type GradientSpec,
} from '@src/types/color';
import { useGridItemInteraction } from '@hooks/Grid/useGridItemInteraction';
import { useGradientPreviewSession } from '@stores/grid/useGradientEditStore';
import { useEditStatePreviewActive } from '@stores/grid/useEditStatePreviewStore';
import { resolveImageSource } from '@utils/core/imageSource';
import {
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_ACTIVE_BG,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_ACTIVE_FONT,
  DEFAULT_ELEMENT_SHADOW_SPEC,
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
} from '@utils/core/elementDefaults';
import { resolveElementBorder } from '@utils/core/elementBorder';
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
  // 보더는 키·그래프와 같은 공용 해석기 (미지정이면 기본 글래스 립)
  const resolvedKnobBorder = resolveElementBorder(
    {
      borderColor,
      activeBorderColor,
      borderGradient,
      activeBorderGradient,
      borderWidth,
    },
    previewActive,
  );
  const effectiveBorderGradient =
    previewSession?.surface === 'border'
      ? previewSession.spec
      : resolvedKnobBorder.gradient;
  const stateBackgroundColor =
    bgPair.color ||
    (previewActive ? DEFAULT_ELEMENT_ACTIVE_BG : DEFAULT_ELEMENT_BG);
  // 회전 인식 막대 색은 명시 단색 보더만 겸한다. 그라데이션 보더의 대표 첫 스톱은
  // 막대 색이 아니다 - 패널이 보여주는 기본 립(0.14 알파)을 그대로 커밋하면 막대가
  // 사라지므로, 그라데이션이거나 미지정이면 텍스트 색 계열.
  // 프리뷰 중에도 링과 같은 기준(effective)을 봐야 커밋 순간 막대가 튀지 않는다
  const stateBorderColor =
    effectiveBorderGradient == null && borderPair.color
      ? borderPair.color
      : previewActive
      ? DEFAULT_ELEMENT_ACTIVE_FONT
      : DEFAULT_ELEMENT_FONT;

  const gradientRingWidth = resolvedKnobBorder.width;
  const showBorderRing =
    Boolean(effectiveBorderGradient) && gradientRingWidth > 0;
  const resolvedRadius = borderRadius != null ? `${borderRadius}px` : '50%';
  const resolvedBorder =
    !showBorderRing && gradientRingWidth > 0
      ? `${gradientRingWidth}px solid ${resolvedKnobBorder.color}`
      : 'none';

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

  const {
    isSelectionMode,
    isDraggingOrResizing,
    draggable,
    handleSelectionDragPointerDown,
    handleClick,
    handleDoubleClick,
    handleContextMenu,
    attachRef,
  } = useGridItemInteraction({
    index,
    elementId,
    dx,
    dy,
    elementWidth: width || 60,
    elementHeight: height || 60,
    isSelected,
    selectedElements,
    zoom,
    panX,
    panY,
    activeTool,
    isViewportTransforming,
    onPositionChange,
    onClick,
    onDoubleClick,
    onCtrlClick,
    onShiftClick,
    onMultiDrag,
    onMultiDragStart,
    onMultiDragEnd,
    onEraserClick,
    onContextMenu,
    setReferenceRef,
  });

  if (position?.hidden) return null;

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
