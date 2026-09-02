import React from 'react';
import { useGridItemInteraction } from '@hooks/Grid/useGridItemInteraction';
import { useSpriteEditPreview } from '@stores/grid/useSpriteEditPreviewStore';
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
import { anchorPx } from '@utils/sprite/spriteGeometry';
import {
  activityAreaGuideMetrics,
  editorChromeScale,
} from '@utils/grid/activityAreaGuide';
import { DEFAULT_SPRITE_SIZE } from '@src/types/key/sprites';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';
import type { GridItemProps } from './gridItemProps';

// 활동 영역은 에디터 전용 가이드 - 오버레이에는 그리지 않는다.
// 이미지가 있으면 점선이 소음이라 호버에만, 없으면 가이드가 유일한 실체라 상시.
// 선택 상태는 그리드 공통 아웃라인이 전담한다 - 여기서 또 그리면 이중선이 된다.
// 호버 판정은 루트(group) 기준 - pointerdown 캡처가 자식 :hover를 끊어
// 클릭 순간 점선이 한 프레임 꺼지는 깜빡임을 막는다
const GUIDE_BORDER_CLASS = {
  hoverOnly:
    'border-dashed border-transparent group-hover/sprite:border-[color:var(--ui-guide-activity)]',
  always: 'border-dashed border-[color:var(--ui-guide-activity)]',
} as const;

// 캔버스의 스프라이트는 정적이다: 평소엔 idle 상태, 자세 팝업이 열려 있으면
// 그 자세를 그린다 (편집창 전용 프리뷰). 키 눌림 라이브 반응은 오버레이 창 몫
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

  // 편집 중 프리뷰 - 자세 팝업이면 그 자세를 그린다. 유효 자세는 composed poses가
  // 최신(스크럽 프리뷰 병합)이라 우선하고, 무효 draft(preferFallback)나 canonical에
  // 없는 신규 자세는 발행된 스냅샷으로 그린다. transform과 이미지는 같은 자세에서
  // 함께 파생 (혼합 상태 방지). 기준점 편집 중이면 축 마커만 얹는다
  const editPreview = useSpriteEditPreview(elementId);
  const posePreview = editPreview?.kind === 'pose' ? editPreview : null;
  const previewPose = posePreview
    ? posePreview.preferFallback
      ? posePreview.fallbackPose
      : position.poses.find((pose) => pose.poseId === posePreview.poseId) ??
        posePreview.fallbackPose
    : null;
  const showPivotMarker = editPreview?.kind === 'pivot';
  const pivotMarkerPx = anchorPx(position.imageRect, position.pivot);

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
  // 이미지·원본 크기·축은 한 벌로 움직인다 - 폴백도 기본 이미지 배치로 함께 간다
  let visual = previewPose
    ? spritePoseVisual(position, previewPose)
    : spriteIdleVisual(position);
  if (imageSrc && failedImageSrcs.has(imageSrc)) {
    imageSrc = fallbackSrc;
    visual = spriteIdleVisual(position);
  }
  const placement = placeSpriteVisual(position, visual);

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

  const transform = `translate(calc(${draggable.dx}px + var(--key-offset-x, 0px)), calc(${draggable.dy}px + var(--key-offset-y, 0px)))`;

  return (
    <div
      ref={attachRef}
      className={`group/sprite absolute select-none dmn-grabbable ${
        className || ''
      }`}
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
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
        data-sprite-element="true"
        data-selected={isSelected ? 'true' : undefined}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            draggable={false}
            style={{
              // 정적 렌더라 transition 채널 없음, 외관 채널 규칙은 오버레이와 동일
              ...computeSpriteImageStyle(
                position,
                previewPose ? previewPose.transform : position.idleTransform,
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
        {isSelected ? null : (
          // 활동 영역 가이드 - 레이아웃에 참여하지 않는 별도 층이라 안쪽 이미지
          // 좌표를 밀지 않는다 (오버레이와 같은 원점). 이미지 위에 그려 가려지지 않는다
          <div
            data-sprite-activity-guide="true"
            className={
              imageSrc
                ? GUIDE_BORDER_CLASS.hoverOnly
                : GUIDE_BORDER_CLASS.always
            }
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              ...activityAreaGuideMetrics(zoom),
            }}
          />
        )}
        {showPivotMarker ? (
          // 기준점 마커 - 회전·배율 축의 위치를 실시간으로 보여준다 (기준점 편집 동안)
          <div
            data-sprite-pivot-marker="true"
            style={{
              position: 'absolute',
              left: `${pivotMarkerPx.x}px`,
              top: `${pivotMarkerPx.y}px`,
              // 마커도 에디터 크롬이라 화면 크기 고정 - 중심은 축 위치에 남는다
              transform: `translate(-50%, -50%) scale(${editorChromeScale(
                zoom,
              )})`,
              pointerEvents: 'none',
              color: 'var(--ui-selection-border)',
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 15 15"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="7.5"
                cy="7.5"
                r="3"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M7.5 0.5V3M7.5 12V14.5M0.5 7.5H3M12 7.5H14.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default SpriteItem;
