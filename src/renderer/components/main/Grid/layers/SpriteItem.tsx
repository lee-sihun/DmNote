import React from 'react';
import { isMac } from '@utils/core/platform';
import { useDraggable, useSmartGuidesElements } from '@hooks/Grid';
import { useSelectionDrag } from '@hooks/Grid/useSelectionDrag';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useSpriteEditPreview } from '@stores/grid/useSpriteEditPreviewStore';
import { resolveImageSource } from '@utils/core/imageSource';
import { computeSpriteImageStyle } from '@utils/sprite/spriteImageStyles';
import { DEFAULT_SPRITE_SIZE } from '@src/types/key/sprites';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';

interface SelectedElement {
  id: string;
  type?: string;
  index?: number;
}

interface SpriteItemProps {
  index: number;
  elementId: string;
  position: CanonicalReactiveSpritePosition;
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

// 활동 영역은 에디터 전용 가이드 - 오버레이에는 그리지 않는다.
// 아이템 자체는 호버에만 점선을 보이고(아래 클래스, 같은 색), 이 상수는 복제 고스트 몫
export const ACTIVITY_AREA_BORDER = '1px dashed rgba(237, 238, 242, 0.4)';

// 이미지가 있으면 점선이 소음이라 호버에만, 없으면 가이드가 유일한 실체라 상시.
// 투명 보더를 유지해 호버 시 레이아웃이 밀리지 않는다.
// 호버 판정은 루트(group) 기준 - pointerdown 캡처가 자식 :hover를 끊어
// 클릭 순간 점선이 한 프레임 꺼지는 깜빡임을 막는다
const GUIDE_BORDER_CLASS = {
  selected: 'border border-solid border-[var(--ui-selection-border)]',
  hoverOnly:
    'border border-dashed border-transparent group-hover/sprite:border-[rgba(237,238,242,0.4)]',
  always: 'border border-dashed border-[rgba(237,238,242,0.4)]',
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
}: SpriteItemProps) => {
  const macOS = isMac();
  const {
    dx = 0,
    dy = 0,
    width = DEFAULT_SPRITE_SIZE,
    height = DEFAULT_SPRITE_SIZE,
    className,
  } = position;

  const { getOtherElements } = useSmartGuidesElements();
  const gridSnapSize = useSettingsStore(
    (state: { gridSettings?: { gridSnapSize?: number } }) =>
      state.gridSettings?.gridSnapSize ?? 5,
  );
  const isDraggingOrResizing = useGridSelectionStore(
    (state: { isDraggingOrResizing: boolean }) => state.isDraggingOrResizing,
  );

  const isSelectionMode = isSelected;

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

  const imageSrc = resolveImageSource(
    previewPose?.imageOverride ?? position.baseImage,
  );

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
    elementId,
    elementWidth: width || DEFAULT_SPRITE_SIZE,
    elementHeight: height || DEFAULT_SPRITE_SIZE,
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
    elementId,
    elementWidth: width || DEFAULT_SPRITE_SIZE,
    elementHeight: height || DEFAULT_SPRITE_SIZE,
    selectedElements,
    getOtherElements,
    onMultiDragStart,
    onMultiDrag,
    onMultiDragEnd,
  });

  if (position.hidden) return null;

  const handleClick = (e: React.MouseEvent) => {
    // macOS ctrl+클릭은 우클릭 제스처 - contextmenu 뒤에 오는 click이
    // 선택·패널 오픈으로 이어져 방금 연 메뉴를 닫는 것을 차단
    if (macOS && e.ctrlKey) return;
    // 드래그로 끝난 press의 trailing click 흡수 (KnobItem과 동일 규칙)
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

  // 더블클릭 편집 진입 - 순수 더블클릭만 통과
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
        className={`rounded-[4px] ${
          isSelected
            ? GUIDE_BORDER_CLASS.selected
            : imageSrc
            ? GUIDE_BORDER_CLASS.hoverOnly
            : GUIDE_BORDER_CLASS.always
        }`}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          boxSizing: 'border-box',
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
              ),
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              color: 'rgba(237, 238, 242, 0.45)',
            }}
            data-sprite-placeholder="true"
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="3"
                y="3"
                width="18"
                height="18"
                rx="3"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle cx="9" cy="9" r="2" fill="currentColor" />
              <path
                d="M4 17.5L9.5 12.5L13.5 16L16.5 13.5L20 16.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
        {showPivotMarker ? (
          // 기준점 마커 - 회전·배율 축의 위치를 실시간으로 보여준다 (기준점 편집 동안)
          <div
            data-sprite-pivot-marker="true"
            style={{
              position: 'absolute',
              left: `${
                position.imageRect.x +
                position.pivot.x * position.imageRect.width
              }px`,
              top: `${
                position.imageRect.y +
                position.pivot.y * position.imageRect.height
              }px`,
              transform: 'translate(-50%, -50%)',
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
