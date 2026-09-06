import React from 'react';
import {
  gradientToCss,
  resolveStatePair,
  type GradientSpec,
} from '@src/types/color';
import KnobFace from '@components/shared/KnobFace';
import { useGradientPreviewSession } from '@stores/grid/useGradientEditStore';
import { useEditStatePreviewActive } from '@stores/grid/useEditStatePreviewStore';
import { resolveImageSource } from '@utils/media/imageSource';
import {
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_ACTIVE_BG,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_ACTIVE_FONT,
  DEFAULT_ELEMENT_SHADOW_SPEC,
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
} from '@utils/element/elementDefaults';
import { resolveElementBorder } from '@utils/element/elementBorder';
import {
  elementShadowToCss,
  resolveElementShadow,
  type ElementShadowSpec,
} from '@src/types/key/shadows';
import {
  useGridElementInteraction,
  type GridElementInteractionProps,
} from '@hooks/Grid/useGridElementInteraction';
import { elementRotationTransform } from '@utils/element/rotation';

interface KnobPosition {
  hidden?: boolean;
  rotation?: number;
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

interface KnobItemProps extends GridElementInteractionProps {
  position: KnobPosition;
  zIndex?: number;
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
    attachRef,
    dx: renderDx,
    dy: renderDy,
    handleClick,
    handleContextMenu,
    handleDoubleClick,
    handleSelectionDragPointerDown,
    isDraggingOrResizing,
    isSelectionMode,
  } = useGridElementInteraction({
    index,
    elementId,
    initialX: dx,
    initialY: dy,
    elementWidth: width || 60,
    elementHeight: height || 60,
    onPositionChange,
    onClick,
    onDoubleClick,
    onCtrlClick,
    onShiftClick,
    isSelected,
    selectedElements,
    onMultiDrag,
    onMultiDragStart,
    onMultiDragEnd,
    activeTool,
    onEraserClick,
    onContextMenu,
    setReferenceRef,
    zoom,
    panX,
    panY,
    isViewportTransforming,
  });

  if (position?.hidden) return null;
  const transform = `translate(calc(${renderDx}px + var(--key-offset-x, 0px)), calc(${renderDy}px + var(--key-offset-y, 0px)))${elementRotationTransform(
    position.rotation,
  )}`;

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
      <KnobFace
        active={previewActive}
        useInlineStyles={useInline}
        background={
          effectiveBgGradient
            ? gradientToCss(effectiveBgGradient)
            : stateBackgroundColor
        }
        border={resolvedBorder}
        borderRadius={resolvedRadius}
        shadow={resolvedShadow}
        indicatorColor={stateBorderColor}
        borderGradient={effectiveBorderGradient}
        borderWidth={gradientRingWidth}
        showBorderRing={showBorderRing}
        imageSrc={imageSrc}
        imageFit={resolvedFit}
      />
    </div>
  );
};

export default KnobItem;
