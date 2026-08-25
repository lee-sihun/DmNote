'use no memo';
import React, { useEffect, useRef } from 'react';
import { getKeySignal } from '@stores/signals/keySignals';
import { getKeyCounterSignal } from '@stores/signals/keyCounterSignals';
import { useSignals } from '@preact/signals-react/runtime';
import { isMac } from '@utils/core/platform';
import { useDraggable } from '@hooks/Grid';
import { useSelectionDrag } from '@hooks/Grid/useSelectionDrag';
import type { KeyCounterSettings } from '@src/types/key/keys';
import { useCounterSettings } from '@hooks/overlay/useCounterSettings';
import { useSmartGuidesElements } from '@hooks/Grid';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { warmupImageSource } from '@utils/core/imageWarmup';
import {
  computeKeyElementStyles,
  type KeyElementPosition,
} from '@hooks/overlay/useKeyElementStyles';
import { useGradientPreviewSession } from '@stores/grid/useGradientEditStore';
import { useEditStatePreviewActive } from '@stores/grid/useEditStatePreviewStore';
import InsideCounterLayout from '@components/overlay/counters/InsideCounterLayout';
import KeyLabel from '@components/shared/KeyLabel';
import { useCounterAxisAnchor } from '@hooks/shared/useCounterAxisAnchor';

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
  elementId: string;
  /** 그라디언트 프리뷰 앵커 종류. id 문자열 모양으로 추론하지 않는다 */
  anchorKind?: 'key' | 'stat';
  position: KeyPosition;
  keyName: string;
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
    anchorKind,
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
    // keyName은 호출부에서 합성이 끝난 표시 라벨
    const displayName = keyName;
    const { dx, dy, width, height = 60, className, counter } = position;

    const counterSettings = useCounterSettings(counter);

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

    const effectiveElementId = elementId;

    // 편집 세션 일시 페인트 — 드래그 프리뷰가 저장·히스토리를 거치지 않고
    // 해당 표면의 spec과 대기/입력 상태 전체를 함께 그린다
    const previewAnchorKind = anchorKind ?? 'key';
    const previewSession = useGradientPreviewSession(
      previewAnchorKind,
      elementId,
      isSelected,
    );
    // 상태 프리뷰는 전용 스토어가 유일한 원천 - 단색·그림자·이미지 편집도
    // 같은 규칙으로 대기/입력 시각을 뒤집는다 (세션은 spec 페인트 전용)
    const previewActive = useEditStatePreviewActive(
      previewAnchorKind,
      elementId,
      isSelected,
    );
    const previewFillSpec =
      previewSession?.surface === 'counterFill' ? previewSession.spec : null;

    const keyRootRef = useRef<HTMLElement | null>(null);
    const anchorOrigin = { x: position.dx, y: position.dy };
    useCounterAxisAnchor(
      previewSession,
      keyRootRef,
      counterPreviewValue,
      '.counter',
      'counterFill',
      anchorOrigin,
    );
    useCounterAxisAnchor(
      previewSession,
      keyRootRef,
      position.displayText || displayName,
      '[data-key-label]',
      'font',
      anchorOrigin,
    );

    const isSelectionMode = isSelected;

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

    // 뷰포트 이동은 그리드 부모가 이미 합성 레이어를 소유
    // 키까지 중첩 승격하면 DOM 글자가 흐리게 래스터화됨
    const previewPosition: KeyPosition = {
      ...position,
      dx: renderDx,
      dy: renderDy,
      ...(previewSession?.surface === 'background'
        ? previewActive
          ? { activeBackgroundGradient: previewSession.spec }
          : { backgroundGradient: previewSession.spec }
        : {}),
      ...(previewSession?.surface === 'border'
        ? previewActive
          ? { activeBorderGradient: previewSession.spec }
          : { borderGradient: previewSession.spec }
        : {}),
      ...(previewSession?.surface === 'font'
        ? previewActive
          ? { activeFontGradient: previewSession.spec }
          : { fontGradient: previewSession.spec }
        : {}),
    };
    const {
      keyStyle: computedKeyStyle,
      borderRingStyle,
      imageStyle,
      textStyle,
      labelPaintStyle,
      labelHasGradient,
      labelMetricsDep,
      currentImageSrc,
      hasCurrentImage,
      labelText,
    } = computeKeyElementStyles({
      position: previewPosition,
      active: previewActive,
      label: displayName,
    });
    // 그리드(스케일 레이어) 안에서는 승격 금지 - WebKit은 합성 자식이 하나라도
    // 생기면 스케일 컨테이너 자체를 레이어로 만들어 내용 전체가 흐려진다.
    // 이동 키는 매 프레임 손상 영역만 재페인트하는 쪽이 선명하고 충분히 싸다
    const keyStyle: React.CSSProperties = {
      ...computedKeyStyle,
      transform: `translate(calc(${renderDx}px + var(--key-offset-x, 0px)), calc(${renderDy}px + var(--key-offset-y, 0px)))`,
      willChange: 'auto',
      backfaceVisibility: 'visible',
      transformStyle: 'flat',
      contain: 'layout style',
      zIndex: position.zIndex ?? zIndex,
      cursor: undefined,
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
          labelPaintStyle={labelPaintStyle}
          labelHasGradient={labelHasGradient}
          labelMetricsDep={labelMetricsDep}
          active={previewActive}
          counterSettings={
            previewFillSpec
              ? previewActive
                ? { ...counterSettings, fillActiveGradient: previewFillSpec }
                : { ...counterSettings, fillIdleGradient: previewFillSpec }
              : counterSettings
          }
          useInlineStyles={position.useInlineStyles === true}
        />
      );
    };

    const attachRef = (node: HTMLElement | null) => {
      keyRootRef.current = node;
      if (!isSelectionMode) {
        draggable.ref(node);
      }
      if (typeof setReferenceRef === 'function') setReferenceRef(node);
    };

    return (
      <div
        ref={attachRef}
        className={`absolute dmn-grabbable ${
          draggable && draggable.wasMoved ? '' : ''
        } ${className || ''}`}
        style={keyStyle}
        data-state={previewActive ? 'active' : 'inactive'}
        data-editing={isDraggingOrResizing ? 'true' : undefined}
        data-key-element="true"
        data-key-image={hasCurrentImage ? 'true' : undefined}
        onClick={handleClick}
        onDoubleClick={onDoubleClick ? handleDoubleClick : undefined}
        onPointerDown={
          isSelectionMode ? handleSelectionDragPointerDown : undefined
        }
        onContextMenu={handleContextMenu}
        onDragStart={(e) => e.preventDefault()}
      >
        {borderRingStyle && (
          <span
            aria-hidden="true"
            data-gradient-border-ring="true"
            style={borderRingStyle}
          />
        )}
        {hasCurrentImage ? (
          <img
            src={currentImageSrc || ''}
            alt=""
            style={imageStyle}
            draggable={false}
          />
        ) : showInsideCounter ? (
          renderInsideCounterPreview()
        ) : (
          <div
            className="flex items-center justify-center h-full font-bold"
            style={textStyle}
          >
            <KeyLabel
              text={labelText}
              paintStyle={labelPaintStyle}
              hasGradient={labelHasGradient}
              metricsDep={labelMetricsDep}
            />
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
    borderRingStyle,
    imageStyle,
    textStyle,
    labelPaintStyle,
    labelHasGradient,
    labelMetricsDep,
    inactiveImageSrc,
    activeImageSrc,
    currentImageSrc,
    hasCurrentImage,
    isTransparent,
    labelText,
  } = computeKeyElementStyles({
    position,
    active,
    label: keyName,
  });

  useEffect(() => {
    warmupImageSource(inactiveImageSrc);
    warmupImageSource(activeImageSrc);
  }, [inactiveImageSrc, activeImageSrc]);

  const counterSettings = useCounterSettings(position?.counter);

  if (isTransparent) return null;


  const showInsideCounter =
    counterEnabled &&
    counterSettings.enabled &&
    counterSettings.placement === 'inside';

  // 시그널 객체만 넘기고 .value는 읽지 않음 — 카운터 갱신이 Key 전체 리렌더를 만들지 않도록
  const counterSignal = showInsideCounter
    ? getKeyCounterSignal(mode ?? '', globalKey)
    : undefined;

  return (
    <div
      className={`absolute ${position.className || ''}`}
      style={keyStyle}
      data-state={active ? 'active' : 'inactive'}
      data-key-element="true"
      data-key-image={hasCurrentImage ? 'true' : undefined}
    >
      {borderRingStyle && (
        <span
          aria-hidden="true"
          data-gradient-border-ring="true"
          style={borderRingStyle}
        />
      )}
      {hasCurrentImage ? (
        <img
          src={currentImageSrc || ''}
          alt=""
          style={imageStyle}
          draggable={false}
        />
      ) : showInsideCounter && counterSignal ? (
        <InsideCounterLayout
          countSignal={counterSignal}
          labelText={labelText}
          textStyle={textStyle}
          labelPaintStyle={labelPaintStyle}
          labelHasGradient={labelHasGradient}
          labelMetricsDep={labelMetricsDep}
          active={active}
          counterSettings={counterSettings}
          useInlineStyles={position.useInlineStyles === true}
        />
      ) : (
        <div
          className="flex items-center justify-center h-full font-bold"
          style={textStyle}
        >
          <KeyLabel
            text={labelText}
            paintStyle={labelPaintStyle}
            hasGradient={labelHasGradient}
            metricsDep={labelMetricsDep}
          />
        </div>
      )}
    </div>
  );
});
