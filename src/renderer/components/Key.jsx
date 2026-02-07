import React, { memo, useMemo, useCallback, useRef, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getKeySignal } from "@stores/keySignals";
import { getKeyCounterSignal } from "@stores/keyCounterSignals";
import { useSignals } from "@preact/signals-react/runtime";
import { isMac } from "@utils/platform";
import { useDraggable } from "@hooks/Grid";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";
import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
} from "@src/types/keys";
import { toCssRgba } from "@utils/colorUtils";
import { useSmartGuidesElements } from "@hooks/Grid";
import { useSmartGuidesStore } from "@stores/useSmartGuidesStore";
import { useSettingsStore } from "@stores/useSettingsStore";
import { useGridSelectionStore } from "@stores/useGridSelectionStore";
import { resolveImageSource } from "@utils/imageSource";
import { warmupImageSource } from "@utils/imageWarmup";
import {
  calculateBounds,
  calculateSnapPoints,
  calculateGroupBounds,
} from "@utils/smartGuides";

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
  // 카운터 미리보기 props
  counterEnabled = false,
  counterPreviewValue = 0,
  counterValueSignal,
}) {
  if (position?.hidden) return null;
  // Grid에서도 Signal 기반 업데이트가 필요한 경우가 있어 신호 구독을 활성화
  useSignals();

  const macOS = isMac();
  const { displayName } = getKeyInfoByGlobalKey(keyName);
  const {
    dx,
    dy,
    width,
    height = 60,
    activeImage,
    inactiveImage,
    className,
    // 스타일 속성들
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
    // 글꼴 스타일 속성들
    fontWeight,
    fontItalic,
    fontUnderline,
    fontStrikethrough,
    // 카운터 설정
    counter,
  } = position;

  // 표시할 텍스트: displayText가 있으면 사용, 없으면 기본 displayName
  const labelText = displayText || displayName;
  const inactiveImageSrc = resolveImageSource(inactiveImage);

  // 카운터 설정 정규화
  const counterSettings = normalizeCounterSettings(
    counter ?? createDefaultCounterSettings(),
  );

  // 카운터 표시 조건: 전역 활성화 + 개별 키 활성화 + inside 배치
  const showInsideCounter =
    counterEnabled &&
    counterSettings.enabled &&
    counterSettings.placement === "inside";

  // 스마트 가이드를 위한 다른 요소들의 bounds 가져오기
  const { getOtherElements } = useSmartGuidesElements();

  // 그리드 스냅 크기 가져오기
  const gridSnapSize = useSettingsStore(
    (state) => state.gridSettings?.gridSnapSize || 5,
  );

  // 드래그/리사이즈 중인 상태 (CSS 애니메이션 비활성화용)
  const isDraggingOrResizing = useGridSelectionStore(
    (state) => state.isDraggingOrResizing,
  );

  // 다중 선택 드래그 상태
  const multiDragRef = useRef({ isDragging: false, startX: 0, startY: 0 });
  const nodeRef = useRef(null);
  const effectiveElementId = elementId || `key-${index}`;

  // 선택된 상태면 드래그 모드 활성화
  const isSelectionMode = isSelected;

  const draggable = useDraggable({
    gridSize: gridSnapSize,
    initialX: dx,
    initialY: dy,
    onPositionChange: (newDx, newDy) => {
      // 선택 모드가 아닐 때만 개별 이동
      if (!isSelectionMode) {
        onPositionChange(index, newDx, newDy);
      }
    },
    zoom,
    panX,
    panY,
    // 스마트 가이드 옵션
    elementId: effectiveElementId,
    elementWidth: width || 60,
    elementHeight: height || 60,
    getOtherElements,
    // 선택 모드에서는 개별 드래그 비활성화
    disabled: isSelectionMode,
  });

  // 선택 요소 드래그 핸들러 (스마트 가이드 포함)
  const handleSelectionDragMouseDown = useCallback(
    (e) => {
      if (!isSelectionMode || e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      // 드래그 시작 전 기존 스마트 가이드 클리어 (이전 드래그가 정상 종료되지 않은 경우 대비)
      useSmartGuidesStore.getState().clearGuides();

      // 드래그 시작 시 애니메이션 비활성화
      useGridSelectionStore.getState().setDraggingOrResizing(true);

      // 드래그 시작 시 히스토리 저장
      onMultiDragStart?.();

      // 현재 키의 시작 위치 저장 (스냅 계산용)
      const startDx = dx;
      const startDy = dy;
      const currentWidth = width || 60;
      const currentHeight = height || 60;
      const elementId = effectiveElementId;

      multiDragRef.current = {
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        lastSnappedDeltaX: 0,
        lastSnappedDeltaY: 0,
      };

      let rafId = null;
      // 드래그 종료 플래그 (rAF 콜백에서 체크)
      let dragEnded = false;
      const smartGuidesStore = useSmartGuidesStore.getState();

      const handleMouseMove = (moveEvent) => {
        if (!multiDragRef.current.isDragging || dragEnded) return;

        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;

          // 드래그가 종료되었으면 rAF 콜백에서도 무시
          if (dragEnded) return;

          const currentZoom = zoom;
          // raw delta (스냅 전)
          const rawDeltaX =
            (moveEvent.clientX - multiDragRef.current.startX) / currentZoom;
          const rawDeltaY =
            (moveEvent.clientY - multiDragRef.current.startY) / currentZoom;

          // 이동 후 예상 위치
          const newX = startDx + rawDeltaX;
          const newY = startDy + rawDeltaY;

          // gridSettings에서 정렬/간격 가이드 활성화 여부 확인
          const gridSettings = useSettingsStore.getState().gridSettings;
          const alignmentGuidesEnabled =
            gridSettings?.alignmentGuides !== false;
          const spacingGuidesEnabled = gridSettings?.spacingGuides !== false;

          // 스마트 가이드 계산 (현재 키 기준으로 다른 비선택 요소들과 스냅)
          const otherElements = getOtherElements(elementId);

          // 선택된 다른 요소들도 제외 (자기 자신만 기준)
          const nonSelectedElements = otherElements.filter(
            (el) => !selectedElements.some((sel) => sel.id === el.id),
          );

          const draggedBounds = calculateBounds(
            newX,
            newY,
            currentWidth,
            currentHeight,
            elementId,
          );

          // 다중 선택 시 그룹 전체의 bounds 계산 (캔버스 중앙 스냅용)
          let groupBounds = null;
          if (selectedElements.length > 1) {
            // 선택된 요소들의 현재 bounds 수집
            const selectedBoundsArray = selectedElements
              .map((sel) => {
                // 현재 드래그 중인 요소인 경우 새 위치 사용
                if (
                  sel.id === elementId ||
                  (sel.type === "key" && sel.index === index)
                ) {
                  return draggedBounds;
                }
                // 다른 선택된 요소들은 otherElements에서 찾아서 이동량 적용
                const found = otherElements.find((el) => el.id === sel.id);
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

          // 다중 선택 시 그룹 바운딩 박스를 스냅 기준으로 사용
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

          let finalX = newX;
          let finalY = newY;

          // 스마트 가이드 스냅 적용
          if (snapResult?.didSnapX) {
            // 다중 선택 시: 그룹 바운딩 박스의 스냅 이동량을 개별 요소에 적용
            if (selectedElements.length > 1 && groupBounds) {
              const groupSnapDeltaX = snapResult.snappedX - groupBounds.left;
              finalX = newX + groupSnapDeltaX;
            } else {
              finalX = snapResult.snappedX;
            }
          } else {
            // 그리드 스냅
            const snapSize = gridSettings?.gridSnapSize || 5;
            finalX = Math.round(newX / snapSize) * snapSize;
          }

          if (snapResult?.didSnapY) {
            // 다중 선택 시: 그룹 바운딩 박스의 스냅 이동량을 개별 요소에 적용
            if (selectedElements.length > 1 && groupBounds) {
              const groupSnapDeltaY = snapResult.snappedY - groupBounds.top;
              finalY = newY + groupSnapDeltaY;
            } else {
              finalY = snapResult.snappedY;
            }
          } else {
            // 그리드 스냅
            const snapSize = gridSettings?.gridSnapSize || 5;
            finalY = Math.round(newY / snapSize) * snapSize;
          }

          // 스냅된 delta 계산
          const snappedDeltaX = Math.round(finalX - startDx);
          const snappedDeltaY = Math.round(finalY - startDy);

          // 가이드라인 업데이트
          if (snapResult && (snapResult.didSnapX || snapResult.didSnapY)) {
            // 다중 선택 시 그룹 바운딩 박스를 표시
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
                    "group",
                  )
                : calculateBounds(
                    finalX,
                    finalY,
                    currentWidth,
                    currentHeight,
                    elementId,
                  );
            smartGuidesStore.setDraggedBounds(displayBounds);
            smartGuidesStore.setActiveGuides(snapResult.guides);

            // 간격 가이드도 업데이트
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

          // 이전 delta와의 차이만큼 이동
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
        // 드래그 종료 플래그 설정 (pending rAF 콜백이 실행되지 않도록)
        dragEnded = true;
        multiDragRef.current.isDragging = false;

        // pending rAF가 있으면 취소
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }

        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        window.removeEventListener("blur", handleMouseUp);
        // 스마트 가이드 클리어
        useSmartGuidesStore.getState().clearGuides();
        // 드래그 종료 시 애니메이션 복원
        useGridSelectionStore.getState().setDraggingOrResizing(false);
        // 드래그 종료 시 오버레이 동기화
        onMultiDragEnd?.();
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      // window blur 시에도 드래그 종료 처리 (창이 포커스를 잃었을 때)
      window.addEventListener("blur", handleMouseUp);
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

  const handleClick = (e) => {
    // 선택된 상태에서 Ctrl+클릭으로 선택 해제
    const isPrimaryModifierPressed = macOS ? e.metaKey : e.ctrlKey;
    const isShiftPressed = e.shiftKey;

    if (isSelectionMode && isPrimaryModifierPressed && onCtrlClick) {
      e.stopPropagation();
      onCtrlClick(e);
      return;
    }

    // 선택된 상태에서는 일반 클릭 이벤트 무시
    if (isSelectionMode) {
      e.stopPropagation();
      return;
    }

    if (activeTool === "eraser") {
      onEraserClick?.();
      return;
    }

    // 드래그 중이 아니었을 때만 선택 처리
    if (!draggable.wasMoved) {
      // Shift+클릭이면 범위 선택
      if (isShiftPressed && onShiftClick) {
        e.stopPropagation();
        onShiftClick(e);
        return;
      }
      // Ctrl+클릭이면 다중 선택 (추가/제거 토글)
      if (isPrimaryModifierPressed && onCtrlClick) {
        e.stopPropagation();
        onCtrlClick(e);
        return;
      }
      // 일반 클릭이면 단일 선택 (기존 선택 대체)
      if (onClick) {
        onClick(e);
      }
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 선택된 상태에서는 컨텍스트 메뉴 무시
    if (isSelectionMode) return;
    onContextMenu?.(e);
  };

  // 드래그 중에는 훅의 dx/dy 사용 (부모 리렌더 최소화)
  const renderDx = draggable.dx;
  const renderDy = draggable.dy;

  // 인라인 스타일 우선 여부에 따라 CSS 변수 또는 직접 값 사용
  const useInline = useInlineStyles === true;

  const keyStyle = useMemo(
    () => ({
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate3d(calc(${renderDx}px + var(--key-offset-x, 0px)), calc(${renderDy}px + var(--key-offset-y, 0px)), 0)`,
      backgroundColor:
        useInline && backgroundColor
          ? backgroundColor
          : `var(--key-bg, ${
              inactiveImageSrc
                ? "transparent"
                : backgroundColor || "rgba(46, 46, 47, 0.9)"
            })`,
      borderRadius:
        useInline && borderRadius != null
          ? `${borderRadius}px`
          : `var(--key-radius, ${
              borderRadius != null ? `${borderRadius}px` : "10px"
            })`,
      border:
        useInline && (borderColor || borderWidth != null)
          ? `${borderWidth ?? 3}px solid ${
              borderColor || "rgba(113, 113, 113, 0.9)"
            }`
          : `var(--key-border, ${borderWidth ?? 3}px solid ${
              borderColor || "rgba(113, 113, 113, 0.9)"
            })`,
      overflow: "hidden",
      willChange: "transform",
      backfaceVisibility: "hidden",
      transformStyle: "preserve-3d",
      contain: "layout style paint",
      imageRendering: "auto",
      isolation: "isolate",
      boxSizing: "border-box",
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
    ],
  );

  const effectiveImageFit = idleImageFit || imageFit || "cover";
  const imageStyle = useMemo(
    () => ({
      width: "100%",
      height: "100%",
      objectFit: effectiveImageFit,
      display: "block",
      pointerEvents: "none",
      userSelect: "none",
    }),
    [effectiveImageFit],
  );

  const textStyle = useMemo(() => {
    // text-decoration 조합
    const textDecorations = [];
    if (fontUnderline) textDecorations.push("underline");
    if (fontStrikethrough) textDecorations.push("line-through");

    return {
      willChange: "auto",
      contain: "layout style paint",
      color:
        useInline && fontColor
          ? fontColor
          : `var(--key-text-color, ${fontColor || "rgba(121, 121, 121, 0.9)"})`,
      fontSize: fontSize ? `${fontSize}px` : undefined,
      fontFamily: fontFamily
        ? `"${fontFamily}", "SUIT-Regular", sans-serif`
        : undefined,
      fontWeight: fontWeight ?? 700,
      fontStyle: fontItalic ? "italic" : "normal",
      textDecoration:
        textDecorations.length > 0 ? textDecorations.join(" ") : "none",
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

  // 카운터 미리보기 렌더링 (Grid 편집용)
  const counterFillColor = counterSettings.fill.idle;
  const counterStrokeColor = counterSettings.stroke.idle;
  const contentGap = Number.isFinite(counterSettings.gap)
    ? counterSettings.gap
    : 6;
  const fillColorCss = toCssRgba(counterFillColor, "#FFFFFF");
  const strokeColorCss = toCssRgba(counterStrokeColor, "transparent");

  const renderInsideCounterPreview = () => {
    if (!showInsideCounter) {
      return null;
    }

    const displayValue =
      (counterValueSignal?.value ?? counterPreviewValue ?? 0) | 0;
    const strokeWidth = strokeColorCss.alpha > 0 ? "1px" : "0px";

    const counterDecorations = [];
    if (counterSettings.fontUnderline) counterDecorations.push("underline");
    if (counterSettings.fontStrikethrough)
      counterDecorations.push("line-through");
    const counterTextDecoration =
      counterDecorations.length > 0 ? counterDecorations.join(" ") : "none";

    const counterElement = (
      <span
        key="counter"
        className="counter pointer-events-none select-none"
        data-text={displayValue}
        data-counter-state="inactive"
        style={{
          fontSize: `${counterSettings.fontSize ?? 16}px`,
          fontFamily: counterSettings.fontFamily
            ? `"${counterSettings.fontFamily}", "SUIT-Regular", sans-serif`
            : undefined,
          fontWeight: counterSettings.fontWeight ?? 400,
          fontStyle: counterSettings.fontItalic ? "italic" : "normal",
          textDecoration: counterTextDecoration,
          lineHeight: 1,
          "--counter-color-default": fillColorCss.css,
          "--counter-stroke-color-default": strokeColorCss.css,
          "--counter-stroke-width-default": strokeWidth,
        }}
      >
        {displayValue}
      </span>
    );

    const nameElement = (
      <span
        key="label"
        className="font-bold text-[14px] pointer-events-none select-none"
        style={textStyle}
      >
        {labelText}
      </span>
    );

    const isHorizontal =
      counterSettings.align === "left" || counterSettings.align === "right";

    const elements = isHorizontal
      ? counterSettings.align === "left"
        ? [counterElement, nameElement]
        : [nameElement, counterElement]
      : counterSettings.align === "top"
      ? [counterElement, nameElement]
      : [nameElement, counterElement];

    const alignMode = counterSettings.alignMode || "center";
    const isBetween = alignMode === "between";
    const containerClass = `flex ${
      isHorizontal ? "" : "flex-col"
    } w-full h-full items-center pointer-events-none select-none`;

    return (
      <div
        className={containerClass}
        style={{
          justifyContent: isBetween ? "space-between" : "center",
          padding: isBetween
            ? isHorizontal
              ? `0 ${contentGap}px`
              : `${contentGap}px 0`
            : "0px",
          gap: isBetween ? "0px" : `${contentGap}px`,
        }}
      >
        {elements}
      </div>
    );
  };

  const attachRef = (node) => {
    // 드래그 훅에 ref 연결 (선택 모드가 아닐 때만)
    if (!isSelectionMode) {
      draggable.ref(node);
    }
    nodeRef.current = node;
    // 팝업 위치 지정을 위해 부모에 노드 전달
    if (typeof setReferenceRef === "function") setReferenceRef(node);
  };

  return (
    <div
      ref={attachRef}
      className={`absolute cursor-pointer ${
        draggable && draggable.wasMoved ? "" : ""
      } ${className || ""}`}
      style={keyStyle}
      data-state="inactive"
      data-editing={isDraggingOrResizing ? "true" : undefined}
      data-key-element="true"
      onClick={handleClick}
      onMouseDown={isSelectionMode ? handleSelectionDragMouseDown : undefined}
      onContextMenu={handleContextMenu}
      onDragStart={(e) => e.preventDefault()}
    >
      {inactiveImageSrc ? (
        <img src={inactiveImageSrc} alt="" style={imageStyle} draggable={false} />
      ) : showInsideCounter ? (
        renderInsideCounterPreview()
      ) : (
        <div
          className="flex items-center justify-center h-full font-bold"
          style={textStyle}
        >
          {labelText}
        </div>
      )}
    </div>
  );
}

export const Key = memo(
  ({ keyName, globalKey, position, mode, counterEnabled = false }) => {
    // React 환경에서 신호 변경을 구독하도록 활성화
    useSignals();
    // 각 Key는 자신의 활성 상태 신호를 직접 구독
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
      className, // 단일 클래스 네임으로 통일
      // 스타일 속성들
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
      // 글꼴 스타일 속성들
      fontWeight,
      fontItalic,
      fontUnderline,
      fontStrikethrough,
    } = position;

    // 표시할 텍스트: displayText가 있으면 사용, 없으면 기본 keyName
    const labelText = displayText || keyName;

    // 인라인 스타일 우선 여부
    const useInline = useInlineStyles === true;

    const stateBackgroundColor = active
      ? activeBackgroundColor ?? backgroundColor
      : backgroundColor;
    const stateBorderColor = active
      ? activeBorderColor ?? borderColor
      : borderColor;
    const stateFontColor = active ? activeFontColor ?? fontColor : fontColor;

    const inactiveImageSrc = resolveImageSource(inactiveImage);
    const activeImageSrc = resolveImageSource(activeImage);

    // 상태 전환 직전 이미지 디코드를 미리 수행해 첫 렌더 끊김을 줄임
    useEffect(() => {
      warmupImageSource(inactiveImageSrc);
      warmupImageSource(activeImageSrc);
    }, [inactiveImageSrc, activeImageSrc]);

    // 투명화 옵션 체크
    const isTransparent = active ? activeTransparent : idleTransparent;

    // 투명화가 활성화되어 있으면 아무것도 렌더링하지 않음
    if (isTransparent) {
      return null;
    }

    // 활성 상태에서 activeImage가 없으면 inactiveImage를 fallback으로 사용
    const currentImageSrc =
      (active && activeImageSrc ? activeImageSrc : inactiveImageSrc) || null;
    const hasCurrentImage = !!currentImageSrc;
    const isUsingActiveImage = active && !!activeImageSrc;
    const effectiveImageFit = isUsingActiveImage
      ? activeImageFit || imageFit || "cover"
      : idleImageFit || imageFit || "cover";

    const keyStyle = useMemo(() => {
      // 기본 배경색 계산
      const defaultBgColor = hasCurrentImage
        ? "transparent"
        : active
        ? "rgba(121, 121, 121, 0.9)"
        : "rgba(46, 46, 47, 0.9)";

      // 기본 테두리색 계산
      const defaultBorderColor = active
        ? "rgba(255, 255, 255, 0.9)"
        : "rgba(113, 113, 113, 0.9)";

      // 기본 텍스트 색상 계산
      const defaultTextColor =
        active && !activeImageSrc ? "#FFFFFF" : "rgba(121, 121, 121, 0.9)";

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
                borderRadius != null ? `${borderRadius}px` : "10px"
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
        overflow: "hidden",
        // GPU 가속 최적화: active 상태 변경 시에만 willChange 적용
        willChange: active ? "transform, background-color" : "transform",
        backfaceVisibility: "hidden",
        transformStyle: "preserve-3d",
        contain: "layout style paint",
        imageRendering: "auto",
        isolation: "isolate",
        boxSizing: "border-box",
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
        width: "100%",
        height: "100%",
        objectFit: effectiveImageFit,
        display: "block",
        pointerEvents: "none",
        userSelect: "none",
        position: "relative",
        zIndex: 0,
        // mask 오버레이 대신 필터만 적용해 페인트 비용을 줄임
        filter: fallbackImageDimmed ? "brightness(0.62)" : "none",
      }),
      [effectiveImageFit, fallbackImageDimmed],
    );

    const textStyle = useMemo(() => {
      // text-decoration 조합
      const textDecorations = [];
      if (fontUnderline) textDecorations.push("underline");
      if (fontStrikethrough) textDecorations.push("line-through");

      return {
        willChange: "auto",
        contain: "layout style paint",
        fontSize: fontSize ? `${fontSize}px` : undefined,
        fontFamily: fontFamily
          ? `"${fontFamily}", "SUIT-Regular", sans-serif`
          : undefined,
        fontWeight: fontWeight ?? 700,
        fontStyle: fontItalic ? "italic" : "normal",
        textDecoration:
          textDecorations.length > 0 ? textDecorations.join(" ") : "none",
      };
    }, [
      fontSize,
      fontFamily,
      fontWeight,
      fontItalic,
      fontUnderline,
      fontStrikethrough,
    ]);

    // 텍스트 표시 조건: 현재 상태에 사용할 이미지가 없을 때만 텍스트를 표시
    const counterSettings = normalizeCounterSettings(
      position?.counter ?? createDefaultCounterSettings(),
    );
    // 개별 키의 카운터 enabled와 전역 counterEnabled 모두 확인
    const showInsideCounter =
      counterEnabled &&
      counterSettings.enabled &&
      counterSettings.placement === "inside";

    let counterSignal;
    if (showInsideCounter) {
      counterSignal = getKeyCounterSignal(mode ?? "", globalKey);
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

    const fillColorCss = toCssRgba(counterFillColor, "#FFFFFF");
    const strokeColorCss = toCssRgba(counterStrokeColor, "transparent");

    const renderInsideLayout = () => {
      if (!showInsideCounter) {
        return null;
      }

      const displayValue = counterValue || 0;
      const strokeWidth = strokeColorCss.alpha > 0 ? "1px" : "0px";

      const counterDecorations = [];
      if (counterSettings.fontUnderline) counterDecorations.push("underline");
      if (counterSettings.fontStrikethrough)
        counterDecorations.push("line-through");
      const counterTextDecoration =
        counterDecorations.length > 0 ? counterDecorations.join(" ") : "none";

      const counterElement = (
        <span
          key="counter"
          className="counter pointer-events-none select-none"
          data-text={displayValue}
          data-counter-state={active ? "active" : "inactive"}
          style={{
            fontSize: `${counterSettings.fontSize ?? 16}px`,
            fontFamily: counterSettings.fontFamily
              ? `"${counterSettings.fontFamily}", "SUIT-Regular", sans-serif`
              : undefined,
            fontWeight: counterSettings.fontWeight ?? 400,
            fontStyle: counterSettings.fontItalic ? "italic" : "normal",
            textDecoration: counterTextDecoration,
            lineHeight: 1,
            "--counter-color-default": fillColorCss.css,
            "--counter-stroke-color-default": strokeColorCss.css,
            "--counter-stroke-width-default": strokeWidth,
          }}
        >
          {displayValue}
        </span>
      );

      const nameElement = (
        <span
          key="label"
          className="font-bold text-[14px] pointer-events-none select-none"
          style={textStyle}
        >
          {labelText}
        </span>
      );

      const isHorizontal =
        counterSettings.align === "left" || counterSettings.align === "right";

      const elements = isHorizontal
        ? counterSettings.align === "left"
          ? [counterElement, nameElement]
          : [nameElement, counterElement]
        : counterSettings.align === "top"
        ? [counterElement, nameElement]
        : [nameElement, counterElement];

      const alignMode = counterSettings.alignMode || "center";
      const isBetween = alignMode === "between";
      const containerClass = `flex ${
        isHorizontal ? "" : "flex-col"
      } w-full h-full items-center pointer-events-none select-none`;

      return (
        <div
          className={containerClass}
          style={{
            justifyContent: isBetween ? "space-between" : "center",
            padding: isBetween
              ? isHorizontal
                ? `0 ${contentGap}px`
                : `${contentGap}px 0`
              : "0px",
            gap: isBetween ? "0px" : `${contentGap}px`,
          }}
        >
          {elements}
        </div>
      );
    };

    // macOS 용 오버레이 드래그 핸들러
    const handleKeyMouseDown = useCallback((e) => {
      if (!isMac()) return;

      if (e.buttons === 1) {
        getCurrentWindow().startDragging();
      }
    }, []);

    return (
      <div
        data-tauri-drag-region
        className={`absolute ${className || ""}`}
        style={keyStyle}
        data-state={active ? "active" : "inactive"}
        onMouseDown={handleKeyMouseDown}
      >
        {hasCurrentImage ? (
          <img src={currentImageSrc || ""} alt="" style={imageStyle} draggable={false} />
        ) : showText ? (
          showInsideCounter ? (
            renderInsideLayout()
          ) : (
            <div
              className="flex items-center justify-center h-full font-bold"
              style={textStyle}
            >
              {labelText}
            </div>
          )
        ) : null}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // active는 내부 selector로 구독하므로 여기서는 position/keyName만 비교
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
      // 스타일 속성 비교
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
      // 글꼴 스타일 속성 비교
      prevProps.position.fontWeight === nextProps.position.fontWeight &&
      prevProps.position.fontItalic === nextProps.position.fontItalic &&
      prevProps.position.fontUnderline === nextProps.position.fontUnderline &&
      prevProps.position.fontStrikethrough ===
        nextProps.position.fontStrikethrough &&
      // 카운터 설정 비교
      prevProps.position.counter?.enabled ===
        nextProps.position.counter?.enabled &&
      prevProps.position.counter?.placement ===
        nextProps.position.counter?.placement &&
      prevProps.position.counter?.align === nextProps.position.counter?.align &&
      (prevProps.position.counter?.alignMode ?? "center") ===
        (nextProps.position.counter?.alignMode ?? "center") &&
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
        (nextProps.position.counter?.fontStrikethrough ?? false)
    );
  },
);
