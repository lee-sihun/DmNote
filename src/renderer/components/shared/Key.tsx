'use no memo';
import React, { useEffect, useRef } from 'react';
import { getKeySignal } from '@stores/signals/keySignals';
import { getKeyCounterSignal } from '@stores/signals/keyCounterSignals';
import { useSignals } from '@preact/signals-react/runtime';
import type { KeyCounterSettings } from '@src/types/key/keys';
import { useCounterSettings } from '@hooks/overlay/useCounterSettings';
import { useFailedImageSrcs } from '@hooks/overlay/useFailedImageSrcs';
import { warmupImageSource } from '@utils/core/imageWarmup';
import {
  computeKeyElementStyles,
  type KeyElementPosition,
} from '@hooks/overlay/useKeyElementStyles';
import { useGradientPreviewSession } from '@stores/grid/useGradientEditStore';
import { useEditStatePreviewActive } from '@stores/grid/useEditStatePreviewStore';
import InsideCounterLayout from '@components/overlay/counters/InsideCounterLayout';
import {
  KeyElementContent,
  OverlayKeyElementFace,
} from '@components/shared/KeyElementFace';
import { useCounterAxisAnchor } from '@hooks/shared/useCounterAxisAnchor';
import {
  useGridElementInteraction,
  type GridElementInteractionProps,
} from '@hooks/Grid/useGridElementInteraction';

// DraggableKey에서 counter가 KeyCounterSettings 타입인 확장 position
interface KeyPosition extends KeyElementPosition {
  counter?: KeyCounterSettings;
}

interface DraggableKeyProps extends GridElementInteractionProps {
  /** 그라디언트 프리뷰 앵커 종류. id 문자열 모양으로 추론하지 않는다 */
  anchorKind?: 'key' | 'stat';
  position: KeyPosition;
  keyName: string;
  zIndex?: number;
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

    // keyName은 호출부에서 합성이 끝난 표시 라벨
    const displayName = keyName;
    const { dx, dy, width, height = 60, className, counter } = position;

    const counterSettings = useCounterSettings(counter);

    const showInsideCounter =
      counterEnabled &&
      counterSettings.enabled &&
      counterSettings.placement === 'inside';

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

    const interaction = useGridElementInteraction({
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
    const {
      dx: renderDx,
      dy: renderDy,
      handleClick,
      handleContextMenu,
      handleDoubleClick,
      handleSelectionDragPointerDown,
      isDraggingOrResizing,
      isSelectionMode,
      wasMoved,
    } = interaction;

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
    const { failedImageSrcs, markFailed } = useFailedImageSrcs(
      previewPosition.inactiveImage,
      previewPosition.activeImage,
    );
    const computedStyles = computeKeyElementStyles({
      position: previewPosition,
      active: previewActive,
      label: displayName,
      failedImageSrcs,
    });
    const {
      keyStyle: computedKeyStyle,
      textStyle,
      labelPaintStyle,
      labelHasGradient,
      labelMetricsDep,
      labelText,
      hasCurrentImage,
      imageMode,
    } = computedStyles;
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
      interaction.attachRef(node);
    };

    return (
      <div
        ref={attachRef}
        className={`absolute dmn-grabbable ${wasMoved ? '' : ''} ${
          className || ''
        }`}
        style={keyStyle}
        data-state={previewActive ? 'active' : 'inactive'}
        data-editing={isDraggingOrResizing ? 'true' : undefined}
        data-key-element="true"
        data-key-image={hasCurrentImage ? 'true' : undefined}
        data-key-image-mode={hasCurrentImage ? imageMode : undefined}
        onClick={handleClick}
        onDoubleClick={onDoubleClick ? handleDoubleClick : undefined}
        onPointerDown={
          isSelectionMode ? handleSelectionDragPointerDown : undefined
        }
        onContextMenu={handleContextMenu}
        onDragStart={(e) => e.preventDefault()}
      >
        <KeyElementContent
          styles={{ ...computedStyles, keyStyle }}
          insideContent={
            showInsideCounter ? renderInsideCounterPreview() : undefined
          }
          markImageFailed={markFailed}
        />
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

  const { failedImageSrcs, markFailed } = useFailedImageSrcs(
    position.inactiveImage,
    position.activeImage,
  );
  const styles = computeKeyElementStyles({
    position,
    active,
    label: keyName,
    failedImageSrcs,
  });
  const {
    textStyle,
    labelPaintStyle,
    labelHasGradient,
    labelMetricsDep,
    inactiveImageSrc,
    activeImageSrc,
    labelText,
  } = styles;

  useEffect(() => {
    warmupImageSource(inactiveImageSrc);
    warmupImageSource(activeImageSrc);
  }, [inactiveImageSrc, activeImageSrc]);

  const counterSettings = useCounterSettings(position?.counter);

  if (position.hidden) return null;
  if (styles.isTransparent) {
    return (
      <OverlayKeyElementFace
        position={position}
        active={active}
        styles={styles}
        markImageFailed={markFailed}
      />
    );
  }

  const showInsideCounter =
    counterEnabled &&
    counterSettings.enabled &&
    counterSettings.placement === 'inside';

  // 시그널 객체만 넘기고 .value는 읽지 않음 — 카운터 갱신이 Key 전체 리렌더를 만들지 않도록
  const counterSignal = showInsideCounter
    ? getKeyCounterSignal(mode ?? '', globalKey)
    : undefined;

  const insideContent =
    showInsideCounter && counterSignal ? (
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
    ) : undefined;

  return (
    <OverlayKeyElementFace
      position={position}
      active={active}
      styles={styles}
      insideContent={insideContent}
      markImageFailed={markFailed}
    />
  );
});
