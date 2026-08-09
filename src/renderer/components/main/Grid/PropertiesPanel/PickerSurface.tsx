import React, { useRef } from 'react';

import FloatingPopup from '@components/main/Modal/FloatingPopup';
import {
  usePanelAnchoredPopupPosition,
  useTriggerAnchoredPopupPosition,
} from '@hooks/ui/usePanelAnchoredPopupPosition';
import { useRetainedWhileOpen } from '@hooks/ui/useRetainedValue';

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

  // 닫으면 위치 훅이 좌표를 즉시 비운다. 그대로 두면 퇴장 중에 fixed 배치가 풀려
  // 팝업이 원점으로 튀고 body 포털에서 인라인으로 옮겨가며 표면이 재마운트된다
  const measured = useRetainedWhileOpen(
    open,
    detached ? trigger.position : dockedPosition,
  );
  // 측정 뒤에 좌표가 확정되므로 그 전 프레임만 감춤 -
  // 섹션 앵커가 없어 폴백 배치로 가는 경우는 감추면 안 됨.
  // 여는 동안에만 본다. 닫으면 위치 훅이 settled를 즉시 내리는데 그걸 그대로
  // 따르면 퇴장 DOM이 hidden으로 덮여 모션이 한 프레임도 안 보인다
  const awaitingPosition =
    open && (detached ? !trigger.settled : Boolean(panelElement) && !measured);
  // 폭도 좌표와 같이 붙잡는다. live 값을 쓰면 퇴장 중 폭이 0으로 무너진다
  const shownWidth = useRetainedWhileOpen(open, trigger.position?.width);

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
      // 도킹·분리 배치도 모션 대상. 실측이 끝나기 전 프레임에 등장이 소모되는 건
      // motionReady가 막는다
      motionReady={!awaitingPosition}
    >
      <div
        ref={cardRef}
        className={`dmn-motion ${cardClassName}`}
        style={{
          visibility: awaitingPosition ? 'hidden' : undefined,
          // 분리 창에서는 카드 고정 폭 대신 섹션 폭을 따름
          width: shownWidth,
        }}
      >
        {children}
      </div>
      {overlay}
    </FloatingPopup>
  );
};

export default PickerSurface;
