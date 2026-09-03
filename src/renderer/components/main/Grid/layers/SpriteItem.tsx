import React from 'react';
import { useGridItemInteraction } from '@hooks/Grid/useGridItemInteraction';
import { useSpriteEditPreview } from '@stores/grid/useSpriteEditPreviewStore';
import { isSameSpriteTransform } from '@utils/sprite/spriteGeometry';
import {
  isErrorForCurrentSrc,
  useFailedImageSrcs,
} from '@hooks/overlay/useFailedImageSrcs';
import { resolveImageSource } from '@utils/core/imageSource';
import { computeSpriteImageStyle } from '@utils/sprite/spriteImageStyles';
import SpriteImagePlaceholder from '@components/main/common/SpriteImagePlaceholder';
import { resolvePoseImage } from '@utils/sprite/poseResolver';
import {
  placeSpriteVisual,
  spriteIdleVisual,
  spritePoseVisual,
} from '@utils/sprite/spritePlacement';
import { DEFAULT_SPRITE_SIZE } from '@src/types/key/sprites';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';
import type { GridItemProps } from './gridItemProps';

// 자세 편집 중 기본 자세를 뒤에 남기는 고스트의 투명도
const IDLE_GHOST_OPACITY = 0.3;

// 캔버스의 스프라이트는 정적이다: 평소엔 기본 자세, 자세 팝업이 열려 있으면
// 그 자세를 그린다 (편집창 전용 프리뷰). 키 눌림 라이브 반응은 오버레이 창 몫.
// 선택·기준점·자세 핸들은 그리드 오버레이 층(SpriteCanvasHandles)이 그린다
const SpriteItem = ({
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
}: GridItemProps<CanonicalReactiveSpritePosition>) => {
  const {
    dx = 0,
    dy = 0,
    width = DEFAULT_SPRITE_SIZE,
    height = DEFAULT_SPRITE_SIZE,
    className,
  } = position;

  // 편집 중 프리뷰 - 자세 팝업이면 그 자세를 그린다. 드래그·스크럽 중이거나 무효
  // draft면 발행된 스냅샷을 우선하고, 평소에는 canonical 자세를 따른다
  // transform과 이미지는 같은 자세에서 함께 파생해 혼합 상태를 막는다
  const posePreview = useSpriteEditPreview(elementId);
  const previewPose = posePreview
    ? posePreview.preferFallback
      ? posePreview.fallbackPose
      : position.poses.find((pose) => pose.poseId === posePreview.poseId) ??
        posePreview.fallbackPose
    : null;

  // 유실 이미지를 그대로 두면 캔버스에 깨진 아이콘이 박히고, 송출 화면(오버레이)은
  // 폴백을 그려 미리보기가 결과와 어긋난다. 폴백 규칙은 오버레이와 같다.
  // 훅 인자는 저장된 경로로 고정 - 편집 중 draft override를 넣으면 스크럽마다
  // 키가 바뀌어 실패 집합이 초기화된다
  const { failedImageSrcs, markFailed } = useFailedImageSrcs(
    position.baseImage,
    ...position.poses.map((pose) => pose.imageOverride),
  );
  const baseSrc = resolveImageSource(position.baseImage);
  const fallbackSrc = baseSrc && !failedImageSrcs.has(baseSrc) ? baseSrc : null;
  let imageSrc = resolveImageSource(
    resolvePoseImage(previewPose?.imageOverride, position.baseImage),
  );
  // 이미지·원본 크기는 한 벌로 움직인다 - 폴백도 기본 이미지 배치로 함께 간다
  let visual = previewPose
    ? spritePoseVisual(position, previewPose)
    : spriteIdleVisual(position);
  if (imageSrc && failedImageSrcs.has(imageSrc)) {
    imageSrc = fallbackSrc;
    visual = spriteIdleVisual(position);
  }
  const placement = placeSpriteVisual(position, visual);
  const transform = previewPose
    ? previewPose.transform
    : position.idleTransform;

  // 자세 편집 중에는 기본 자세를 반투명 고스트로 뒤에 남겨 "어디서 얼마나
  // 움직였는지"가 보인다. 기본 자세와 같은 그림이면 겹쳐 그릴 이유가 없다
  const idlePlacement = placeSpriteVisual(position, spriteIdleVisual(position));
  const showIdleGhost =
    previewPose !== null &&
    fallbackSrc !== null &&
    (imageSrc !== fallbackSrc ||
      !isSameSpriteTransform(transform, position.idleTransform));

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
    elementWidth: width || DEFAULT_SPRITE_SIZE,
    elementHeight: height || DEFAULT_SPRITE_SIZE,
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

  if (position.hidden) return null;

  const rootTransform = `translate(calc(${draggable.dx}px + var(--key-offset-x, 0px)), calc(${draggable.dy}px + var(--key-offset-y, 0px)))`;

  return (
    <div
      ref={attachRef}
      className={`absolute select-none dmn-grabbable ${className || ''}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        transform: rootTransform,
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
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
        data-sprite-element="true"
        data-selected={isSelected ? 'true' : undefined}
      >
        {showIdleGhost ? (
          <img
            src={fallbackSrc}
            alt=""
            draggable={false}
            data-sprite-idle-ghost="true"
            style={{
              ...computeSpriteImageStyle(
                position,
                position.idleTransform,
                undefined,
                idlePlacement,
              ),
              opacity: IDLE_GHOST_OPACITY,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        ) : null}
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            draggable={false}
            style={{
              // 정적 렌더라 transition 채널 없음, 외관 채널 규칙은 오버레이와 동일
              ...computeSpriteImageStyle(
                position,
                transform,
                undefined,
                placement,
              ),
              pointerEvents: 'none',
              userSelect: 'none',
            }}
            onError={(event) => {
              if (!isErrorForCurrentSrc(event.currentTarget, imageSrc)) return;
              markFailed(imageSrc);
            }}
          />
        ) : (
          <SpriteImagePlaceholder />
        )}
      </div>
    </div>
  );
};

export default SpriteItem;
