import { useEffect, useRef, useState } from 'react';
import {
  useGridViewStore,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
  clampZoom,
} from '@stores/grid/useGridViewStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { isMac } from '@utils/core/platform';
import { useSettingsStore } from '@stores/useSettingsStore';
import type { ShortcutBinding } from '@src/types/settings/shortcuts';
import { isModalLayerActive } from '@components/main/Modal/popupLayer';

interface UseGridZoomPanOptions {
  mode: string;
  containerRef: React.RefObject<HTMLDivElement>;
  contentRef: React.RefObject<HTMLDivElement>;
  /** benchmark에서 제거 전 이벤트 처리 경로를 재현 */
  continuousInputStrategy?: 'legacy' | 'frame';
}

interface GridCoords {
  x: number;
  y: number;
}

export function useGridZoomPan({
  mode,
  containerRef,
  contentRef,
  continuousInputStrategy = 'frame',
}: UseGridZoomPanOptions) {
  const { getViewState, setZoom, setPan, resetView } = useGridViewStore();
  const viewState = getViewState(mode);
  const { zoom, panX, panY } = viewState;

  const macOS = isMac();

  const wheelFrameRef = useRef<number | null>(null);
  const legacyWheelFrameRef = useRef<number | null>(null);
  const pendingWheelRef = useRef<{
    clientX: number;
    clientY: number;
    deltaX: number;
    deltaY: number;
    shiftKey: boolean;
    zoomModifier: boolean;
  } | null>(null);
  const [isTransforming, setIsTransforming] = useState(false);
  const isTransformingRef = useRef(false);
  const transformIdleTimerRef = useRef<number | null>(null);

  const setTransformingState = (next: boolean) => {
    if (isTransformingRef.current === next) return;
    isTransformingRef.current = next;
    setIsTransforming(next);
  };

  const touchTransforming = () => {
    setTransformingState(true);
    if (transformIdleTimerRef.current !== null) {
      window.clearTimeout(transformIdleTimerRef.current);
    }
    transformIdleTimerRef.current = window.setTimeout(() => {
      transformIdleTimerRef.current = null;
      setTransformingState(false);
    }, 120);
  };

  /**
   * 클라이언트 좌표를 그리드 로컬 좌표로 변환
   * (줌/팬이 적용된 상태에서 실제 그리드 상의 좌표)
   */
  const clientToGridCoords = (
    clientX: number,
    clientY: number,
  ): GridCoords | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const localX = (clientX - rect.left - panX) / zoom;
    const localY = (clientY - rect.top - panY) / zoom;
    return { x: localX, y: localY };
  };

  /**
   * 그리드 로컬 좌표를 클라이언트 좌표로 변환
   */
  const gridToClientCoords = (
    gridX: number,
    gridY: number,
  ): GridCoords | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = gridX * zoom + panX + rect.left;
    const clientY = gridY * zoom + panY + rect.top;
    return { x: clientX, y: clientY };
  };

  /**
   * 마우스 위치 기준 줌 (마우스 포인터 아래 지점을 고정)
   */
  const zoomAtPoint = (clientX: number, clientY: number, newZoom: number) => {
    if (!containerRef.current) return;

    const clampedZoom = clampZoom(newZoom);
    if (clampedZoom === zoom) return;

    const rect = containerRef.current.getBoundingClientRect();

    // 마우스 위치의 현재 그리드 좌표
    const mouseGridX = (clientX - rect.left - panX) / zoom;
    const mouseGridY = (clientY - rect.top - panY) / zoom;

    // 새 줌 레벨에서 같은 그리드 좌표가 같은 화면 위치에 오도록 팬 조정
    const newPanX = clientX - rect.left - mouseGridX * clampedZoom;
    const newPanY = clientY - rect.top - mouseGridY * clampedZoom;

    touchTransforming();
    setZoom(mode, clampedZoom);
    setPan(mode, newPanX, newPanY);
  };

  /**
   * 중앙 기준 줌 인
   */
  const zoomIn = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    zoomAtPoint(centerX, centerY, zoom + ZOOM_STEP);
  };

  /**
   * 중앙 기준 줌 아웃
   */
  const zoomOut = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    zoomAtPoint(centerX, centerY, zoom - ZOOM_STEP);
  };

  /**
   * 줌 100%로 리셋
   */
  const resetZoomFn = () => {
    resetView(mode);
  };

  /**
   * 팬 이동
   */
  const pan = (deltaX: number, deltaY: number) => {
    touchTransforming();
    setPan(mode, panX + deltaX, panY + deltaY);
  };

  /**
   * 휠 이벤트 핸들러
   */
  const handleWheel = (e: WheelEvent) => {
    if (isModalLayerActive()) return;
    e.preventDefault();
    const isWheelZoomModifierPressed = macOS
      ? e.metaKey || e.ctrlKey // macOS: Cmd+휠, 그리고 트랙패드 핀치(ctrlKey=true)도 줌으로 유지
      : e.ctrlKey; // Windows/Linux: Ctrl+휠
    const nextWheel = {
      clientX: e.clientX,
      clientY: e.clientY,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      shiftKey: e.shiftKey,
      zoomModifier: isWheelZoomModifierPressed,
    };
    const applyWheel = (next: typeof nextWheel) => {
      if (next.zoomModifier) {
        const delta = next.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        zoomAtPoint(next.clientX, next.clientY, zoom + delta);
        return;
      }
      const hasHorizontalDelta = Math.abs(next.deltaX) > 0.01;
      if (next.shiftKey && !hasHorizontalDelta) {
        pan(-next.deltaY, 0);
      } else {
        pan(-next.deltaX, -next.deltaY);
      }
    };
    if (continuousInputStrategy === 'legacy') {
      if (legacyWheelFrameRef.current !== null) return;
      applyWheel(nextWheel);
      legacyWheelFrameRef.current = requestAnimationFrame(() => {
        legacyWheelFrameRef.current = null;
      });
      return;
    }
    const pending = pendingWheelRef.current;
    pendingWheelRef.current = {
      ...nextWheel,
      deltaX:
        pending?.zoomModifier === isWheelZoomModifierPressed
          ? pending.deltaX + e.deltaX
          : e.deltaX,
      deltaY:
        pending?.zoomModifier === isWheelZoomModifierPressed
          ? pending.deltaY + e.deltaY
          : e.deltaY,
    };
    if (wheelFrameRef.current !== null) return;
    wheelFrameRef.current = requestAnimationFrame(() => {
      wheelFrameRef.current = null;
      const next = pendingWheelRef.current;
      pendingWheelRef.current = null;
      if (!next || isModalLayerActive()) return;
      applyWheel(next);
    });
  };

  /**
   * 키보드 단축키 핸들러
   */
  const handleKeyDown = (e: KeyboardEvent) => {
    if (isModalLayerActive()) return;
    // 입력 요소에서는 단축키 무시
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    const matchesShortcut = (
      event: KeyboardEvent,
      binding?: ShortcutBinding,
    ) => {
      if (!binding?.key) return false;
      const ctrl = !!binding.ctrl;
      const shift = !!binding.shift;
      const alt = !!binding.alt;
      const meta = !!binding.meta;
      return (
        event.code === binding.key &&
        event.ctrlKey === ctrl &&
        event.shiftKey === shift &&
        event.altKey === alt &&
        event.metaKey === meta
      );
    };

    const { shortcuts } = useSettingsStore.getState();
    if (matchesShortcut(e, shortcuts?.resetZoom)) {
      e.preventDefault();
      resetZoomFn();
      return;
    }
    if (matchesShortcut(e, shortcuts?.zoomIn)) {
      e.preventDefault();
      zoomIn();
      return;
    }
    if (matchesShortcut(e, shortcuts?.zoomOut)) {
      e.preventDefault();
      zoomOut();
      return;
    }
  };

  /**
   * 미들 버튼 드래그 핸들러
   */
  const handleMiddleMouseDown = (e: MouseEvent) => {
    // 미들 버튼만 처리
    if (e.button !== 1) return;
    if (isModalLayerActive()) return;

    e.preventDefault();
    e.stopPropagation(); // 이벤트 전파 방지 (요소들의 mousedown 이벤트가 발생하지 않도록)

    const setMiddleButtonDragging =
      useGridSelectionStore.getState().setMiddleButtonDragging;
    setMiddleButtonDragging(true);

    // 드래그 중 커서를 grabbing으로 변경하고 요소들의 pointer-events를 비활성화
    const container = containerRef.current;
    if (container) {
      container.style.cursor = 'grabbing';
    }
    // contentRef 내의 요소들이 마우스 이벤트를 받지 않도록 설정
    const content = contentRef.current;
    if (content) {
      content.style.pointerEvents = 'none';
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const startPanX = panX;
    const startPanY = panY;
    let panFrame: number | null = null;
    let pendingPoint: { x: number; y: number } | null = null;

    const applyPendingPan = () => {
      const point = pendingPoint;
      pendingPoint = null;
      if (!point || isModalLayerActive()) return;
      touchTransforming();
      setPan(mode, startPanX + point.x - startX, startPanY + point.y - startY);
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      pendingPoint = { x: moveEvent.clientX, y: moveEvent.clientY };
      if (continuousInputStrategy === 'legacy') {
        applyPendingPan();
        return;
      }
      if (panFrame !== null) return;
      panFrame = requestAnimationFrame(() => {
        panFrame = null;
        applyPendingPan();
      });
    };

    const handleMouseUp = () => {
      if (panFrame !== null) {
        cancelAnimationFrame(panFrame);
        panFrame = null;
        applyPendingPan();
      }
      if (transformIdleTimerRef.current !== null) {
        window.clearTimeout(transformIdleTimerRef.current);
        transformIdleTimerRef.current = null;
      }
      setTransformingState(false);
      setMiddleButtonDragging(false);
      // 커서 및 pointer-events 복원
      if (container) {
        container.style.cursor = '';
      }
      if (content) {
        content.style.pointerEvents = '';
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // 핸들러를 ref에 저장하여 이벤트 리스너 안정화
  const handleWheelRef = useRef(handleWheel);
  const handleMiddleMouseDownRef = useRef(handleMiddleMouseDown);
  const handleKeyDownRef = useRef(handleKeyDown);
  // eslint-disable-next-line react-hooks/refs -- 매 렌더 ref 동기화 (의도적)
  handleWheelRef.current = handleWheel;
  // eslint-disable-next-line react-hooks/refs -- 매 렌더 ref 동기화 (의도적)
  handleMiddleMouseDownRef.current = handleMiddleMouseDown;
  // eslint-disable-next-line react-hooks/refs -- 매 렌더 ref 동기화 (의도적)
  handleKeyDownRef.current = handleKeyDown;

  // container DOM 요소를 상태로 추적 (ref.current는 dependency로 사용 불가)
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setContainerEl(containerRef.current);
  }, [containerRef]);

  // 휠 이벤트 등록
  useEffect(() => {
    if (!containerEl) return;

    const handler = (e: WheelEvent) => handleWheelRef.current(e);
    containerEl.addEventListener('wheel', handler, { passive: false });

    return () => {
      containerEl.removeEventListener('wheel', handler);
    };
  }, [containerEl]);

  // 미들 버튼 드래그 이벤트 등록 (캡처 단계에서 처리하여 요소 이벤트보다 먼저 잡음)
  useEffect(() => {
    if (!containerEl) return;

    const handler = (e: MouseEvent) => handleMiddleMouseDownRef.current(e);
    containerEl.addEventListener('mousedown', handler, true);

    return () => {
      containerEl.removeEventListener('mousedown', handler, true);
    };
  }, [containerEl]);

  // 키보드 이벤트 등록
  useEffect(() => {
    const handler = (e: KeyboardEvent) => handleKeyDownRef.current(e);
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (wheelFrameRef.current !== null) {
        cancelAnimationFrame(wheelFrameRef.current);
        wheelFrameRef.current = null;
        pendingWheelRef.current = null;
      }
      if (legacyWheelFrameRef.current !== null) {
        cancelAnimationFrame(legacyWheelFrameRef.current);
        legacyWheelFrameRef.current = null;
      }
      if (transformIdleTimerRef.current !== null) {
        window.clearTimeout(transformIdleTimerRef.current);
        transformIdleTimerRef.current = null;
      }
    };
  }, []);

  return {
    // 현재 상태
    zoom,
    panX,
    panY,

    // 좌표 변환
    clientToGridCoords,
    gridToClientCoords,

    // 액션
    setZoom: (newZoom: number) => setZoom(mode, newZoom),
    setPan: (newPanX: number, newPanY: number) =>
      setPan(mode, newPanX, newPanY),
    zoomIn,
    zoomOut,
    zoomAtPoint,
    resetZoom: resetZoomFn,
    pan,

    // 상수
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    zoomStep: ZOOM_STEP,
    isTransforming,
  };
}
