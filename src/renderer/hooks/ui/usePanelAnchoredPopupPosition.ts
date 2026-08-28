/* eslint-disable react-hooks/set-state-in-effect */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { clampToViewport } from '@utils/ui/popupGeometry';

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
    x: clampToViewport(
      panelRect.left - popupWidth - gap,
      popupWidth,
      viewportWidth,
      padding,
    ),
    y: Math.min(Math.max(baseY, minY), maxY),
  };
};

interface TriggerAnchoredPositionOptions {
  /** 트리거가 속한 속성 섹션 카드 — 팝업의 좌우 정렬·폭 기준 */
  sectionRect: { left: number; width: number };
  /** 팝업을 연 행 */
  triggerRect: { top: number; bottom: number };
  popupHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  gap?: number;
  padding?: number;
}

export interface TriggerAnchoredPosition extends PopupPosition {
  width: number;
}

export interface TriggerAnchoredResult {
  /** 앵커 탐색이 끝났는지 — 끝나기 전에는 호출자가 팝업을 감춰 첫 프레임 튐을 막는다 */
  settled: boolean;
  /** 섹션 앵커가 없으면 null — 호출자가 기본 배치로 폴백 */
  position: TriggerAnchoredPosition | null;
}

// 폭과 좌우 정렬은 섹션 카드에 맞추고, 세로는 트리거 행 바로 아래.
// 아래 공간이 모자라면 행 위로 뒤집고, 그래도 안 들어가면 화면 안으로 클램프
export const getTriggerAnchoredPopupPosition = ({
  sectionRect,
  triggerRect,
  popupHeight,
  viewportWidth,
  viewportHeight,
  gap = 5,
  padding = 5,
}: TriggerAnchoredPositionOptions): TriggerAnchoredPosition => {
  const width = Math.min(sectionRect.width, viewportWidth - padding * 2);
  const x = clampToViewport(sectionRect.left, width, viewportWidth, padding);

  const below = triggerRect.bottom + gap;
  const above = triggerRect.top - gap - popupHeight;
  const maxY = viewportHeight - popupHeight - padding;
  const y = below <= maxY || above < padding ? below : above;

  return {
    x,
    y: clampToViewport(y, popupHeight, viewportHeight, padding),
    width,
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
  const lastPositionRef = useRef<PopupPosition | null>(null);
  const computePositionRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    if (!open || !panelElement) {
      lastPositionRef.current = null;
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

    // 패널이 분리 창에 있으면 그 창의 뷰포트가 기준이다
    const ownerWindow = panelElement.ownerDocument.defaultView ?? window;
    const compute = () => {
      const popupElement = popupRef.current;
      const next = getPanelAnchoredPopupPosition({
        panelRect: panelElement.getBoundingClientRect(),
        anchorCenterY: capturedAnchorCenterY,
        popupWidth: popupElement?.offsetWidth || fallbackWidth,
        popupHeight: popupElement?.offsetHeight || fallbackHeight,
        viewportWidth: ownerWindow.innerWidth,
        viewportHeight: ownerWindow.innerHeight,
      });

      const previous = lastPositionRef.current;
      if (previous && previous.x === next.x && previous.y === next.y) return;

      lastPositionRef.current = next;
      setPosition(next);
    };

    computePositionRef.current = compute;
    compute();

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => compute());
    observer?.observe(panelElement);
    if (popupRef.current) observer?.observe(popupRef.current);
    ownerWindow.addEventListener('resize', compute);

    return () => {
      observer?.disconnect();
      ownerWindow.removeEventListener('resize', compute);
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

const UNSETTLED: TriggerAnchoredResult = { settled: false, position: null };
const NO_ANCHOR: TriggerAnchoredResult = { settled: true, position: null };

interface UseTriggerAnchoredPopupPositionOptions {
  open: boolean;
  referenceRef?: RefObject<HTMLElement | null>;
  popupRef: RefObject<HTMLElement | null>;
  fallbackHeight: number;
}

export const useTriggerAnchoredPopupPosition = ({
  open,
  referenceRef,
  popupRef,
  fallbackHeight,
}: UseTriggerAnchoredPopupPositionOptions): TriggerAnchoredResult => {
  const [result, setResult] = useState<TriggerAnchoredResult>(UNSETTLED);
  const lastPositionRef = useRef<TriggerAnchoredPosition | null>(null);
  const computePositionRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const trigger = referenceRef?.current;
    const section = trigger?.closest<HTMLElement>('[data-dmn-section="true"]');
    if (!open) {
      lastPositionRef.current = null;
      setResult(UNSETTLED);
      computePositionRef.current = null;
      return;
    }
    // 섹션 밖 트리거는 정렬 기준이 없음 — 감추지 말고 기본 배치로 넘김
    if (!trigger || !section) {
      lastPositionRef.current = null;
      setResult(NO_ANCHOR);
      computePositionRef.current = null;
      return;
    }

    // 앵커는 열리는 시점에 한 번만 캡처 — 패널 스크롤·리렌더에도 제자리 유지
    const triggerRect = trigger.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const ownerWindow = trigger.ownerDocument.defaultView ?? window;

    const compute = () => {
      const popupElement = popupRef.current;
      const next = getTriggerAnchoredPopupPosition({
        sectionRect,
        triggerRect,
        popupHeight: popupElement?.offsetHeight || fallbackHeight,
        viewportWidth: ownerWindow.innerWidth,
        viewportHeight: ownerWindow.innerHeight,
      });

      const previous = lastPositionRef.current;
      if (
        previous &&
        previous.x === next.x &&
        previous.y === next.y &&
        previous.width === next.width
      )
        return;

      lastPositionRef.current = next;
      setResult({ settled: true, position: next });
    };

    computePositionRef.current = compute;
    compute();

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => compute());
    if (popupRef.current) observer?.observe(popupRef.current);
    ownerWindow.addEventListener('resize', compute);

    return () => {
      observer?.disconnect();
      ownerWindow.removeEventListener('resize', compute);
      computePositionRef.current = null;
    };
  }, [fallbackHeight, open, popupRef, referenceRef]);

  useLayoutEffect(() => {
    computePositionRef.current?.();
  });

  return result;
};
