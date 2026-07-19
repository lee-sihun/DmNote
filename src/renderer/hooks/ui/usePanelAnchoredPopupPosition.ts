/* eslint-disable react-hooks/set-state-in-effect */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

interface PanelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface AnchoredPopupPositionOptions {
  panelRect: PanelRect;
  /** 팝업을 연 트리거 행의 뷰포트 세로 중심 — null이면 패널 세로 중앙으로 폴백 */
  anchorCenterY: number | null;
  popupWidth: number;
  popupHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  gap?: number;
  padding?: number;
}

export interface PopupPosition {
  x: number;
  y: number;
}

// X는 패널 왼쪽 도킹, Y는 트리거 행 세로 중앙 정렬 — 하단은 패널 아래로 내려가지 않게 클램프
export const getPanelAnchoredPopupPosition = ({
  panelRect,
  anchorCenterY,
  popupWidth,
  popupHeight,
  viewportWidth,
  viewportHeight,
  gap = 5,
  padding = 5,
}: AnchoredPopupPositionOptions): PopupPosition => {
  const maxX = Math.max(padding, viewportWidth - popupWidth - padding);
  // 상·하단 모두 가로 도킹과 같은 갭만큼 패널 안쪽에서 멈춤 —
  // 팝업이 패널 세로 범위보다 크면 화면 경계로 폴백
  const panelTopLimit = panelRect.top + gap;
  const panelBottomLimit = panelRect.top + panelRect.height - popupHeight - gap;
  const fitsPanelBand = panelBottomLimit >= panelTopLimit;
  const minY = Math.max(padding, fitsPanelBand ? panelTopLimit : padding);
  const maxY = Math.max(
    minY,
    Math.min(
      viewportHeight - popupHeight - padding,
      fitsPanelBand ? panelBottomLimit : Number.POSITIVE_INFINITY,
    ),
  );
  const baseY =
    anchorCenterY != null
      ? anchorCenterY - popupHeight / 2
      : panelRect.top + (panelRect.height - popupHeight) / 2;

  return {
    x: Math.min(Math.max(panelRect.left - popupWidth - gap, padding), maxX),
    y: Math.min(Math.max(baseY, minY), maxY),
  };
};

interface UsePanelAnchoredPopupPositionOptions {
  open: boolean;
  panelElement?: HTMLElement | null;
  referenceRef?: RefObject<HTMLElement | null>;
  popupRef: RefObject<HTMLElement | null>;
  fallbackWidth: number;
  fallbackHeight: number;
}

export const usePanelAnchoredPopupPosition = ({
  open,
  panelElement,
  referenceRef,
  popupRef,
  fallbackWidth,
  fallbackHeight,
}: UsePanelAnchoredPopupPositionOptions): PopupPosition | null => {
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const computePositionRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    if (!open || !panelElement) {
      setPosition(null);
      computePositionRef.current = null;
      return;
    }

    // 앵커 중심은 열리는 시점에 한 번만 캡처 — 이후 패널 스크롤·리렌더에도 제자리 유지
    const anchorElement = referenceRef?.current;
    const anchorRect = anchorElement?.getBoundingClientRect();
    const capturedAnchorCenterY = anchorRect
      ? anchorRect.top + anchorRect.height / 2
      : null;

    const compute = () => {
      const popupElement = popupRef.current;
      const next = getPanelAnchoredPopupPosition({
        panelRect: panelElement.getBoundingClientRect(),
        anchorCenterY: capturedAnchorCenterY,
        popupWidth: popupElement?.offsetWidth || fallbackWidth,
        popupHeight: popupElement?.offsetHeight || fallbackHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });

      setPosition((previous) =>
        previous && previous.x === next.x && previous.y === next.y
          ? previous
          : next,
      );
    };

    computePositionRef.current = compute;
    compute();

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => compute());
    observer?.observe(panelElement);
    if (popupRef.current) observer?.observe(popupRef.current);
    window.addEventListener('resize', compute);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', compute);
      computePositionRef.current = null;
    };
  }, [
    fallbackHeight,
    fallbackWidth,
    open,
    panelElement,
    popupRef,
    referenceRef,
  ]);

  // 팝업 콘텐츠가 같은 커밋에서 변하면 페인트 전에 다시 정렬
  useLayoutEffect(() => {
    computePositionRef.current?.();
  });

  return position;
};
