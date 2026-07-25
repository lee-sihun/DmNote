import React, { useRef } from 'react';

import FloatingPopup from '@components/main/Modal/FloatingPopup';
import {
  usePanelAnchoredPopupPosition,
  useTriggerAnchoredPopupPosition,
} from '@hooks/ui/usePanelAnchoredPopupPosition';

// 분리 창은 패널 왼쪽에 도킹할 여백이 없음 —
// 같은 팝업을 트리거 행 바로 아래에 붙이고 폭·좌우 정렬은 속성 섹션에 맞춘다
const isDetachedPanelWindow = (): boolean =>
  typeof window !== 'undefined' && window.__dmn_window_type === 'panel';

// 트리거와 팝업 사이 간격 — 좌표 계산기의 gap과 같은 값
const POPUP_GAP = 5;

interface PickerSurfaceProps {
  open: boolean;
  ariaLabel: string;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement?: HTMLElement | null;
  // 도킹 좌표 계산 폴백 크기
  fallbackWidth: number;
  fallbackHeight: number;
  // 팝업 카드 클래스 (고정 폭 포함)
  cardClassName: string;
  placement?: string;
  // 도킹 좌표가 없을 때만 적용되는 세로 보정
  offsetY?: number;
  // 도킹 좌표가 없을 때 쓰는 호출자 지정 좌표
  fallbackFixedX?: number;
  fallbackFixedY?: number;
  closeOnScroll?: boolean;
  portalToBody?: boolean;
  interactiveRefs?: React.RefObject<HTMLElement>[];
  onClose: () => void;
  children: React.ReactNode;
  // 중첩 피커 — 카드 옆에 함께 렌더
  overlay?: React.ReactNode;
}

// 피커 표시 호스트 — 메인 창은 패널 왼쪽 도킹, 분리 창은 트리거 행 아래.
// 팝업 자체는 한 벌이라 배치만 갈리고 preview/commit 계약은 그대로다
const PickerSurface = ({
  open,
  ariaLabel,
  referenceRef,
  panelElement = null,
  fallbackWidth,
  fallbackHeight,
  cardClassName,
  placement = 'right-start',
  offsetY = 0,
  fallbackFixedX,
  fallbackFixedY,
  closeOnScroll = false,
  portalToBody = false,
  interactiveRefs = [],
  onClose,
  children,
  overlay,
}: PickerSurfaceProps) => {
  const detached = isDetachedPanelWindow();

  const cardRef = useRef<HTMLDivElement>(null);
  const dockedPosition = usePanelAnchoredPopupPosition({
    open: open && !detached,
    panelElement,
    referenceRef,
    popupRef: cardRef,
    fallbackWidth,
    fallbackHeight,
  });
  const trigger = useTriggerAnchoredPopupPosition({
    open: open && detached,
    referenceRef,
    popupRef: cardRef,
    fallbackHeight,
  });

  const measured = detached ? trigger.position : dockedPosition;
  // 측정 뒤에 좌표가 확정되므로 그 전 프레임만 감춤 —
  // 섹션 앵커가 없어 폴백 배치로 가는 경우는 감추면 안 됨
  const awaitingPosition = detached
    ? !trigger.settled
    : Boolean(panelElement) && !measured;

  return (
    <FloatingPopup
      open={open}
      ariaLabel={ariaLabel}
      referenceRef={referenceRef}
      fixedX={measured?.x ?? fallbackFixedX}
      fixedY={measured?.y ?? fallbackFixedY}
      // 섹션 정렬을 못 잡은 경우에만 쓰이는 폴백 배치
      placement={detached ? 'bottom-end' : placement}
      offset={detached ? POPUP_GAP : 32}
      // 측정 좌표는 이미 정확하므로 세로 보정을 무시
      offsetY={measured || detached ? 0 : offsetY}
      className="z-50"
      interactiveRefs={interactiveRefs}
      onClose={onClose}
      autoClose={false}
      closeOnScroll={closeOnScroll}
      portalToBody={Boolean(panelElement) || portalToBody}
      animate={!detached && !panelElement}
    >
      <div
        ref={cardRef}
        className={cardClassName}
        style={{
          visibility: awaitingPosition ? 'hidden' : undefined,
          // 분리 창에서는 카드 고정 폭 대신 섹션 폭을 따름
          width: trigger.position?.width,
        }}
      >
        {children}
      </div>
      {overlay}
    </FloatingPopup>
  );
};

export default PickerSurface;
