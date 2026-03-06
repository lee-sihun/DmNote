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

interface UseGridZoomPanOptions {
  mode: string;
  containerRef: React.RefObject<HTMLDivElement>;
  contentRef: React.RefObject<HTMLDivElement>;
}

interface GridCoords {
  x: number;
  y: number;
}

export function useGridZoomPan({
  mode,
  containerRef,
  contentRef,
}: UseGridZoomPanOptions) {
  const { getViewState, setZoom, setPan, resetView } = useGridViewStore();
  const viewState = getViewState(mode);
  const { zoom, panX, panY } = viewState;

  const macOS = isMac();

  // 휠 이벤트 누적 방지용 ref
  const isWheelProcessingRef = useRef(false);
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
    // 기본 스크롤 방지
    e.preventDefault();

    // 빠른 연속 휠 이벤트 방지
    if (isWheelProcessingRef.current) return;
    isWheelProcessingRef.current = true;
    requestAnimationFrame(() => {
      isWheelProcessingRef.current = false;
    });

    const isWheelZoomModifierPressed = macOS
      ? e.metaKey || e.ctrlKey // macOS: Cmd+휠, 그리고 트랙패드 핀치(ctrlKey=true)도 줌으로 유지
      : e.ctrlKey; // Windows/Linux: Ctrl+휠

    if (isWheelZoomModifierPressed) {
      // (Ctrl/Cmd) + 휠: 줌
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      zoomAtPoint(e.clientX, e.clientY, zoom + delta);
    } else {
      // 휠/트랙패드 2손가락: 패닝
      // - 트랙패드는 deltaX/deltaY가 같이 들어오므로 수평/대각 이동 지원
      // - 일부 마우스 휠은 deltaX=0만 오기 때문에 기존 Shift+휠 수평 패닝도 유지
      const hasHorizontalDelta = Math.abs(e.deltaX) > 0.01;

      if (e.shiftKey && !hasHorizontalDelta) {
        pan(-e.deltaY, 0);
      } else {
        pan(-e.deltaX, -e.deltaY);
      }
    }
  };

  /**
   * 키보드 단축키 핸들러
   */
  const handleKeyDown = (e: KeyboardEvent) => {
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

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      touchTransforming();
      setPan(mode, startPanX + deltaX, startPanY + deltaY);
    };

    const handleMouseUp = () => {
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

  // 휠 이벤트 등록
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  });

  // 미들 버튼 드래그 이벤트 등록 (캡처 단계에서 처리하여 요소 이벤트보다 먼저 잡음)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('mousedown', handleMiddleMouseDown, true);

    return () => {
      container.removeEventListener('mousedown', handleMiddleMouseDown, true);
    };
  });

  // 키보드 이벤트 등록
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  });

  useEffect(() => {
    return () => {
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
